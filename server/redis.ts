// server/redis.ts
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const RETRY_MAX_DELAY_MS = 5000;

function createClient(label: string): Redis {
  const client = new Redis(REDIS_URL, {
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, RETRY_MAX_DELAY_MS);
      console.warn(`[redis:${label}] retrying connection (attempt ${times}), delay ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  client.on("error", (err: Error) => {
    console.error(`[redis:${label}] error:`, err.message);
  });

  client.on("connect", () => {
    console.log(`[redis:${label}] connected`);
  });

  client.on("reconnecting", () => {
    console.warn(`[redis:${label}] reconnecting...`);
  });

  return client;
}

// Two separate connections: a subscriber connection is put into a special
// mode by Redis once it issues SUBSCRIBE, and can no longer run normal
// commands (GET/SET/PUBLISH/etc). So we keep one client dedicated to
// publishing/reading and another dedicated purely to subscribing.
const publisherClient = createClient("publisher");
const subscriberClient = createClient("subscriber");

const YDOC_TTL_SECONDS = 24 * 60 * 60; // 24h
const PRESENCE_TTL_SECONDS = 30; // 30s

function ydocKey(docId: string): string {
  return `ydoc:${docId}`;
}

function presenceKey(docId: string): string {
  return `presence:${docId}`;
}

function channelName(docId: string): string {
  return `doc:${docId}`;
}

interface PubSubMessage {
  senderServerId: string;
  update: string; // base64-encoded Uint8Array
}

/**
 * Publish a Yjs update to all server instances subscribed to this document's
 * channel. The senderServerId is embedded so the originating server can
 * ignore its own broadcast when it comes back through the subscriber.
 */
export async function publishYjsUpdate(
  docId: string,
  update: Uint8Array,
  senderServerId: string
): Promise<void> {
  try {
    const message: PubSubMessage = {
      senderServerId,
      update: Buffer.from(update).toString("base64"),
    };
    await publisherClient.publish(channelName(docId), JSON.stringify(message));
  } catch (err) {
    console.error(`[redis] publishYjsUpdate failed for doc ${docId}:`, err);
  }
}

/**
 * Subscribe to updates for a document. The callback receives the decoded
 * update and the originating server's ID so the caller can skip re-applying
 * / re-broadcasting updates that originated from itself.
 */
export function subscribeToDocument(
  docId: string,
  callback: (update: Uint8Array, senderServerId: string) => void
): void {
  const channel = channelName(docId);

  subscriberClient.subscribe(channel, (err) => {
    if (err) {
      console.error(`[redis] failed to subscribe to ${channel}:`, err);
    }
  });

  subscriberClient.on("message", (receivedChannel: string, raw: string) => {
    if (receivedChannel !== channel) return;
    try {
      const parsed = JSON.parse(raw) as PubSubMessage;
      const update = new Uint8Array(Buffer.from(parsed.update, "base64"));
      callback(update, parsed.senderServerId);
    } catch (err) {
      console.error(`[redis] failed to parse message on ${channel}:`, err);
    }
  });
}

/**
 * Persist the full encoded Yjs doc state to Redis as a fast cache layer,
 * with a 24h TTL (Postgres remains the source of truth for anything older).
 */
export async function saveDocToRedis(docId: string, state: Uint8Array): Promise<void> {
  try {
    await publisherClient.set(
      ydocKey(docId),
      Buffer.from(state),
      "EX",
      YDOC_TTL_SECONDS
    );
  } catch (err) {
    console.error(`[redis] saveDocToRedis failed for doc ${docId}:`, err);
  }
}

/**
 * Load a document's encoded state from Redis, if cached. Returns null on
 * cache miss (caller should fall back to Postgres) or on error.
 */
export async function loadDocFromRedis(docId: string): Promise<Uint8Array | null> {
  try {
    const buf = await publisherClient.getBuffer(ydocKey(docId));
    if (!buf) return null;
    return new Uint8Array(buf);
  } catch (err) {
    console.error(`[redis] loadDocFromRedis failed for doc ${docId}:`, err);
    return null;
  }
}

export interface PresenceEntry {
  userId: string;
  name: string;
  color: string;
  cursor: { anchor: number; head: number } | null;
  lastSeen: number;
}

/**
 * Store a user's presence info in a per-document hash. Each field's TTL
 * resets on the whole key every time someone calls this (HSET doesn't
 * support per-field TTL pre-Redis 7.4), so we refresh the key's TTL here.
 * A 30s TTL means a client that disconnects without a clean "leave" event
 * naturally drops out of presence within 30s.
 */
export async function setPresence(
  docId: string,
  userId: string,
  entry: PresenceEntry
): Promise<void> {
  try {
    const key = presenceKey(docId);
    await publisherClient.hset(key, userId, JSON.stringify(entry));
    await publisherClient.expire(key, PRESENCE_TTL_SECONDS);
  } catch (err) {
    console.error(`[redis] setPresence failed for doc ${docId}, user ${userId}:`, err);
  }
}

/**
 * Get all currently-present users for a document. Filters out any stale
 * entries older than the TTL window as a safety net, in case the hash key
 * TTL was extended by another user's activity after this one went stale.
 */
export async function getPresence(docId: string): Promise<PresenceEntry[]> {
  try {
    const key = presenceKey(docId);
    const raw = await publisherClient.hgetall(key);
    const now = Date.now();

    const entries: PresenceEntry[] = [];
    for (const value of Object.values(raw)) {
      try {
        const entry = JSON.parse(value) as PresenceEntry;
        if (now - entry.lastSeen <= PRESENCE_TTL_SECONDS * 1000) {
          entries.push(entry);
        }
      } catch {
        // skip malformed entry
      }
    }
    return entries;
  } catch (err) {
    console.error(`[redis] getPresence failed for doc ${docId}:`, err);
    return [];
  }
}

/**
 * Remove a single user from a document's presence hash (e.g. on clean
 * disconnect, rather than waiting for the 30s TTL).
 */
export async function removePresence(docId: string, userId: string): Promise<void> {
  try {
    await publisherClient.hdel(presenceKey(docId), userId);
  } catch (err) {
    console.error(`[redis] removePresence failed for doc ${docId}, user ${userId}:`, err);
  }
}

export async function closeRedisConnections(): Promise<void> {
  await Promise.all([publisherClient.quit(), subscriberClient.quit()]);
}