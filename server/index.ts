// server/index.ts
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import * as Y from "yjs";
import { v4 as uuidv4 } from "uuid";
import {
  publishYjsUpdate,
  subscribeToDocument,
  saveDocToRedis,
  loadDocFromRedis,
  setPresence,
  getPresence,
  removePresence,
} from "./redis";
import { loadAndApplyDocument, saveDocumentContent } from "./db-persist";

interface PresenceData {
  userId: string;
  name: string;
  color: string;
  cursor: CursorPosition | null;
  lastSeen: number;
}

// docId -> (userId -> PresenceData). In-memory for fast local broadcasts;
// mirrored into Redis (via setPresence/getPresence) as the cross-instance
// source of truth with a TTL safety net.
const presenceRooms = new Map<string, Map<string, PresenceData>>();

function getPresenceRoom(docId: string): Map<string, PresenceData> {
  let room = presenceRooms.get(docId);
  if (!room) {
    room = new Map<string, PresenceData>();
    presenceRooms.set(docId, room);
  }
  return room;
}

interface RoomState {
  ydoc: Y.Doc;
  clients: Set<string>;
  dirty: boolean;
}

interface CursorPosition {
  anchor: number;
  head: number;
}

const SERVER_ID = uuidv4();
const PORT = Number(process.env.SOCKET_PORT) || 3001;
const PERSIST_INTERVAL_MS = 5000;

const rooms = new Map<string, RoomState>();

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

async function getOrCreateRoom(docId: string): Promise<RoomState> {
  const existing = rooms.get(docId);
  if (existing) return existing;

  const ydoc = new Y.Doc();

  // Try Redis first (fast path), fall back to Postgres. loadAndApplyDocument
  // handles the Postgres path and re-caches into Redis on a miss.
  const redisState = await loadDocFromRedis(docId);
  if (redisState) {
    Y.applyUpdate(ydoc, redisState);
  } else {
    await loadAndApplyDocument(docId, ydoc);
  }

  const room: RoomState = { ydoc, clients: new Set<string>(), dirty: false };
  rooms.set(docId, room);

  // Subscribe this server instance to updates published by OTHER server
  // instances for this doc, so multi-instance deployments stay in sync.
  // Origin-tagging prevents us re-applying our own writes.
  subscribeToDocument(docId, (update: Uint8Array, originServerId: string) => {
    if (originServerId === SERVER_ID) return;
    Y.applyUpdate(room.ydoc, update);
    io.to(docId).emit("yjs-update", update);
  });

  return room;
}

async function flushRoom(docId: string, room: RoomState): Promise<void> {
  if (!room.dirty) return;
  try {
    await saveDocumentContent(docId, room.ydoc, "system");
    await saveDocToRedis(docId, Y.encodeStateAsUpdate(room.ydoc));
    room.dirty = false;
  } catch (err) {
    console.error(`[persist] failed to flush doc ${docId}:`, err);
  }
}

io.on("connection", (socket: Socket) => {
  let currentDocId: string | null = null;
  let currentUserId: string | null = null;

  socket.on(
    "join-document",
    async (payload: {
      docId: string;
      userId: string;
      name: string;
      color: string;
    }) => {
      const { docId, userId, name, color } = payload;
      try {
        const room = await getOrCreateRoom(docId);

        socket.join(docId);
        room.clients.add(socket.id);
        currentDocId = docId;
        currentUserId = userId;

        socket.emit("sync-state", Y.encodeStateAsUpdate(room.ydoc));

        const presenceData: PresenceData = {
          userId,
          name,
          color,
          cursor: null,
          lastSeen: Date.now(),
        };
        getPresenceRoom(docId).set(userId, presenceData);
        await setPresence(docId, userId, presenceData);

        socket.to(docId).emit("user-joined", { userId, name, color });

        const presence = await getPresence(docId);
        socket.emit("presence-list", presence);
      } catch (err) {
        console.error(`[join-document] error for doc ${docId}:`, err);
        socket.emit("error", { message: "Failed to join document" });
      }
    },
  );

  socket.on(
    "yjs-update",
    async (payload: { docId: string; update: Uint8Array }) => {
      const { docId, update } = payload;
      const room = rooms.get(docId);
      if (!room) return;

      try {
        Y.applyUpdate(room.ydoc, update);
        room.dirty = true;

        socket.to(docId).emit("yjs-update", update);
        await publishYjsUpdate(docId, update, SERVER_ID);
      } catch (err) {
        console.error(`[yjs-update] error for doc ${docId}:`, err);
      }
    },
  );

  socket.on(
    "cursor-update",
    async (payload: { docId: string; userId: string; cursor: CursorPosition }) => {
        const { docId, userId, cursor } = payload;
        const presenceRoom = presenceRooms.get(docId);
        const existing = presenceRoom?.get(userId);
        if (!presenceRoom || !existing) return;

        const updated: PresenceData = { ...existing, cursor, lastSeen: Date.now() };
        presenceRoom.set(userId, updated);

        socket.to(docId).emit("cursor-moved", { userId, cursor });

        // Refresh Redis mirror + TTL, but don't block the broadcast on it.
        void setPresence(docId, userId, updated);
    }
    );

  socket.on("presence-heartbeat", async (payload: { docId: string; userId: string }) => {
        const { docId, userId } = payload;
        const presenceRoom = presenceRooms.get(docId);
        const existing = presenceRoom?.get(userId);
        if (!presenceRoom || !existing) return;

        const updated: PresenceData = { ...existing, lastSeen: Date.now() };
        presenceRoom.set(userId, updated);
        await setPresence(docId, userId, updated);
  });

  async function handleLeave(): Promise<void> {
    if (!currentDocId || !currentUserId) return;

    const docId = currentDocId;
    const userId = currentUserId;
    const room = rooms.get(docId);

    const presenceRoom = presenceRooms.get(docId);
    presenceRoom?.delete(userId);
    await removePresence(docId, userId);
    socket.to(docId).emit("user-left", { userId });

    if (presenceRoom && presenceRoom.size === 0) {
        presenceRooms.delete(docId);
    }

    if (!room) return;
    room.clients.delete(socket.id);

    if (room.clients.size === 0) {
        await flushRoom(docId, room);
        rooms.delete(docId);
    }
  }

  socket.on("leave-document", handleLeave);
  socket.on("disconnect", handleLeave);
});

// Auto-persist every 5s for any dirty rooms.
const persistTimer = setInterval(() => {
  for (const [docId, room] of rooms.entries()) {
    void flushRoom(docId, room);
  }
}, PERSIST_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`[socket-server] listening on port ${PORT}`);
});

async function shutdown(): Promise<void> {
  console.log("[socket-server] SIGTERM received, flushing all rooms...");
  clearInterval(persistTimer);

  await Promise.all(
    Array.from(rooms.entries()).map(([docId, room]) => flushRoom(docId, room)),
  );

  io.close(() => {
    httpServer.close(() => {
      console.log("[socket-server] shutdown complete");
      process.exit(0);
    });
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
