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
import {
  loadAndApplyDocument,
  saveDocumentContent,
  hashBytes,
  getDocumentOwnerId,
  saveVersionSnapshot,
} from "./db-persist";
import {
  activeConnectionsGauge,
  yjsMessagesCounter,
  syncLatencyHistogram,
  getMetricsText,
  metricsContentType,
} from "./metrics";

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
  ownerId: string;
  lastEditorUserId: string | null;
  lastVersionHash: string | null;
  lastVersionAt: number;
}

interface CursorPosition {
  anchor: number;
  head: number;
}

const SERVER_ID = uuidv4();
const PORT = Number(process.env.SOCKET_PORT) || 3001;
const PERSIST_INTERVAL_MS = 5000;
const VERSION_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const rooms = new Map<string, RoomState>();

const httpServer = createServer();

// Handle GET /metrics directly on the raw HTTP server, alongside Socket.io.
// Socket.io only intercepts requests matching its own path (/socket.io/ by
// default) — any other request event listener, like this one, runs
// independently for everything else.
httpServer.on("request", async (req, res) => {
  if (req.method === "GET" && req.url === "/metrics") {
    try {
      const metrics = await getMetricsText();
      res.writeHead(200, { "Content-Type": metricsContentType });
      res.end(metrics);
    } catch (err) {
      console.error("[metrics] failed to serve /metrics:", err);
      res.writeHead(500);
      res.end("Failed to collect metrics");
    }
  }
});

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

  const ownerId = (await getDocumentOwnerId(docId)) ?? "";

  const room: RoomState = {
    ydoc,
    clients: new Set<string>(),
    dirty: false,
    ownerId,
    lastEditorUserId: null,
    lastVersionHash: null,
    lastVersionAt: Date.now(),
  };
  rooms.set(docId, room);

  // Subscribe this server instance to updates published by OTHER server
  // instances for this doc, so multi-instance deployments stay in sync.
  // Origin-tagging prevents us re-applying our own writes. This also
  // catches updates published by Next.js API routes (e.g. version restore)
  // via publishRestoreUpdate, which uses a fixed senderServerId that never
  // matches SERVER_ID, so those are always applied.
  subscribeToDocument(docId, (update: Uint8Array, originServerId: string) => {
    if (originServerId === SERVER_ID) return;
    Y.applyUpdate(room.ydoc, update);
    room.dirty = true;
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

/**
 * Auto-versioning: called every 2 minutes for every room. Skips rooms with
 * no connected clients (not "actively edited"), and skips saving a new
 * version if the content hash is identical to the last saved version
 * (avoids no-op version spam when nothing actually changed).
 */
async function maybeSaveVersion(docId: string, room: RoomState): Promise<void> {
  if (room.clients.size === 0) return;
  if (Date.now() - room.lastVersionAt < VERSION_INTERVAL_MS) return;

  const state = Y.encodeStateAsUpdate(room.ydoc);
  const currentHash = hashBytes(state);

  if (room.lastVersionHash === currentHash) {
    room.lastVersionAt = Date.now();
    return;
  }

  const createdById = room.lastEditorUserId ?? room.ownerId;
  if (!createdById) return; // no known user to credit — skip rather than guess

  try {
    await saveVersionSnapshot(docId, state, createdById);
    room.lastVersionHash = currentHash;
    room.lastVersionAt = Date.now();
  } catch (err) {
    console.error(`[version] auto-save failed for doc ${docId}:`, err);
  }
}

io.on("connection", (socket: Socket) => {
  activeConnectionsGauge.inc();
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
    async (payload: { docId: string; update: Uint8Array; userId?: string }) => {
      const receivedAt = Date.now();
      const { docId, update, userId } = payload;
      const room = rooms.get(docId);
      if (!room) return;

      try {
        Y.applyUpdate(room.ydoc, update);
        room.dirty = true;
        if (userId) room.lastEditorUserId = userId;

        socket.to(docId).emit("yjs-update", update);

        // Measured up to the broadcast call completing, as specified —
        // deliberately NOT including publishYjsUpdate's Redis round-trip
        // below, since that's cross-instance sync, not the local broadcast.
        syncLatencyHistogram.observe(Date.now() - receivedAt);
        yjsMessagesCounter.inc();

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
    },
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

  socket.on("awareness-update", (payload: { docId: string; update: number[] }) => {
    socket.to(payload.docId).emit("awareness-update", payload.update);
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
  socket.on("disconnect", () => {
    activeConnectionsGauge.dec();
    void handleLeave();
  });
});

// Auto-persist every 5s for any dirty rooms.
const persistTimer = setInterval(() => {
  for (const [docId, room] of rooms.entries()) {
    void flushRoom(docId, room);
  }
}, PERSIST_INTERVAL_MS);

// Auto-version every 2 minutes for actively-edited rooms.
const versionTimer = setInterval(() => {
  for (const [docId, room] of rooms.entries()) {
    void maybeSaveVersion(docId, room);
  }
}, VERSION_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`[socket-server] listening on port ${PORT}`);
});

async function shutdown(): Promise<void> {
  console.log("[socket-server] SIGTERM received, flushing all rooms...");
  clearInterval(persistTimer);
  clearInterval(versionTimer);

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