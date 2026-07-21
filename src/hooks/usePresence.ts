// src/hooks/usePresence.ts
import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

export interface CursorPosition {
  anchor: number;
  head: number;
}

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  cursor: CursorPosition | null;
  lastSeen: number;
}

interface UsePresenceOptions {
  socket: Socket | null;
  docId: string;
  userId: string;
  name: string;
}

interface UsePresenceResult {
  onlineUsers: PresenceUser[];
  totalCount: number;
  myColor: string;
}

const HEARTBEAT_INTERVAL_MS = 25_000;
const STALE_THRESHOLD_MS = 30_000;

/**
 * Deterministically derive an HSL color from a userId (simple string hash
 * -> hue), so the same user gets the same color on every client/session
 * without any server-side color assignment table.
 */
export function colorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0; // force 32-bit int
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

export function usePresence({
  socket,
  docId,
  userId,
  name,
}: UsePresenceOptions): UsePresenceResult {
  const [onlineUsers, setOnlineUsers] = useState<Map<string, PresenceUser>>(
    new Map()
  );
  const myColorRef = useRef<string>(colorForUserId(userId));

  useEffect(() => {
    if (!socket) return;

    const myColor = myColorRef.current;

    function handlePresenceList(list: PresenceUser[]) {
      const next = new Map<string, PresenceUser>();
      for (const u of list) next.set(u.userId, u);
      setOnlineUsers(next);
    }

    function handleUserJoined(payload: { userId: string; name: string; color: string }) {
      setOnlineUsers((prev) => {
        const next = new Map(prev);
        next.set(payload.userId, {
          userId: payload.userId,
          name: payload.name,
          color: payload.color,
          cursor: null,
          lastSeen: Date.now(),
        });
        return next;
      });
    }

    function handleUserLeft(payload: { userId: string }) {
      setOnlineUsers((prev) => {
        if (!prev.has(payload.userId)) return prev;
        const next = new Map(prev);
        next.delete(payload.userId);
        return next;
      });
    }

    function handleCursorMoved(payload: { userId: string; cursor: CursorPosition }) {
      setOnlineUsers((prev) => {
        const existing = prev.get(payload.userId);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(payload.userId, { ...existing, cursor: payload.cursor, lastSeen: Date.now() });
        return next;
      });
    }

    socket.on("presence-list", handlePresenceList);
    socket.on("user-joined", handleUserJoined);
    socket.on("user-left", handleUserLeft);
    socket.on("cursor-moved", handleCursorMoved);

    socket.emit("join-document", { docId, userId, name, color: myColor });

    const heartbeatTimer = setInterval(() => {
      socket.emit("presence-heartbeat", { docId, userId });
    }, HEARTBEAT_INTERVAL_MS);

    // Client-side backstop: drop anyone we haven't heard from recently.
    // The server/Redis TTL is the authoritative cleanup path; this just
    // covers the gap if a user-left event is missed (e.g. network drop).
    const staleSweepTimer = setInterval(() => {
      setOnlineUsers((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [id, u] of prev) {
          if (id !== userId && now - u.lastSeen > STALE_THRESHOLD_MS) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, STALE_THRESHOLD_MS);

    return () => {
      socket.emit("leave-document", { docId, userId });
      socket.off("presence-list", handlePresenceList);
      socket.off("user-joined", handleUserJoined);
      socket.off("user-left", handleUserLeft);
      socket.off("cursor-moved", handleCursorMoved);
      clearInterval(heartbeatTimer);
      clearInterval(staleSweepTimer);
    };
  }, [socket, docId, userId, name]);

  const onlineUsersList = Array.from(onlineUsers.values());

  return {
    onlineUsers: onlineUsersList,
    totalCount: onlineUsersList.length,
    myColor: myColorRef.current,
  };
}