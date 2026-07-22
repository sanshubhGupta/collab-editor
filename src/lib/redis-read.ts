// src/lib/redis-read.ts
import Redis from "ioredis";

// Separate from server/redis.ts (which is for the standalone socket server).
// This is a lightweight client for Next.js API routes to read presence
// counts only — no publish/subscribe needed here.
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const globalForRedis = globalThis as unknown as { redisRead: Redis | undefined };

export const redisRead =
  globalForRedis.redisRead ??
  new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redisRead = redisRead;
}

export async function getOnlineCount(docId: string): Promise<number> {
  try {
    if (redisRead.status === "wait") await redisRead.connect();
    const count = await redisRead.hlen(`presence:${docId}`);
    return count;
  } catch (err) {
    console.error(`[redis-read] getOnlineCount failed for ${docId}:`, err);
    return 0; // fail safe — dashboard shouldn't break if Redis is down
  }
}