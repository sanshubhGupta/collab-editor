// server/db-persist.ts
import * as Y from "yjs";
import { prisma } from "../src/lib/prisma";
import { loadDocFromRedis, saveDocToRedis } from "./redis";

/**
 * Load raw document bytes directly from Postgres. Returns null if the
 * document doesn't exist. This does NOT touch Redis — callers that want
 * the Redis-first cache behavior should use loadAndApplyDocument instead.
 */
export async function loadDocumentContent(docId: string): Promise<Uint8Array | null> {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: docId },
      select: { content: true },
    });

    if (!doc || !doc.content) return null;

    return new Uint8Array(doc.content);
  } catch (err) {
    console.error(`[db-persist] loadDocumentContent failed for doc ${docId}:`, err);
    return null;
  }
}

/**
 * Encode the current Yjs doc state and write it to Document.content.
 * updatedBy is accepted for future audit-logging / activity-tracking use
 * (e.g. a version history table) — not persisted anywhere yet since no
 * such column/table exists in the current schema.
 */
export async function saveDocumentContent(
  docId: string,
  ydoc: Y.Doc,
  updatedBy: string
): Promise<void> {
  try {
    const state = Y.encodeStateAsUpdate(ydoc);

    await prisma.document.update({
      where: { id: docId },
      data: { content: Buffer.from(state) },
    });
  } catch (err) {
    console.error(
      `[db-persist] saveDocumentContent failed for doc ${docId} (updatedBy: ${updatedBy}):`,
      err
    );
    throw err; // rethrow — caller (flushRoom) needs to know persistence failed
  }
}

/**
 * Load a document's state into the given Y.Doc, trying Redis first (fast
 * path) and falling back to Postgres on a cache miss. On a Postgres hit,
 * the result is written back into Redis so subsequent joins for the same
 * doc hit the fast path.
 *
 * If the document has no content in either store yet (brand new document),
 * the Y.Doc is left empty — this is expected for newly created documents.
 */
export async function loadAndApplyDocument(docId: string, ydoc: Y.Doc): Promise<void> {
  try {
    const cached = await loadDocFromRedis(docId);
    if (cached) {
      Y.applyUpdate(ydoc, cached);
      return;
    }

    const fromDb = await loadDocumentContent(docId);
    if (fromDb) {
      Y.applyUpdate(ydoc, fromDb);
      // Cache back into Redis so the next join for this doc is a fast path.
      await saveDocToRedis(docId, fromDb);
      return;
    }

    // No content anywhere — new/empty document. Nothing to apply.
  } catch (err) {
    console.error(`[db-persist] loadAndApplyDocument failed for doc ${docId}:`, err);
    // Don't throw — a fresh empty Y.Doc is a safe fallback so the user
    // can still open and start editing rather than being fully blocked.
  }
}