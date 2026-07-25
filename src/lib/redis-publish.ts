// src/lib/redis-publish.ts
import { redisRead } from "./redis-read";

interface RestoreUpdateMessage {
  senderServerId: string;
  update: string; // base64
}

/**
 * Publishes a Yjs update from the Next.js process into the same
 * doc:{docId} Redis channel the standalone socket server subscribes to
 * (see server/redis.ts subscribeToDocument). If a room for this document
 * is currently active in the socket server's memory, it will apply this
 * update to the REAL live Y.Doc and broadcast it to connected clients —
 * this is how a Next.js API route can affect live collaboration state
 * despite running in a separate process.
 *
 * senderServerId is set to a fixed marker (not a real server's UUID) so
 * the socket server's echo-prevention check never matches it — this
 * update should always be applied, never skipped as an "echo."
 */
export async function publishRestoreUpdate(docId: string, update: Uint8Array): Promise<void> {
  try {
    const message: RestoreUpdateMessage = {
      senderServerId: "nextjs-api",
      update: Buffer.from(update).toString("base64"),
    };
    await redisRead.publish(`doc:${docId}`, JSON.stringify(message));
  } catch (err) {
    console.error(`[redis-publish] failed to publish restore update for ${docId}:`, err);
  }
}