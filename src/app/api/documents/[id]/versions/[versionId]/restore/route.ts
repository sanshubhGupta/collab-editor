// src/app/api/documents/[id]/versions/[versionId]/restore/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Y from "yjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkDocumentAccess } from "@/lib/with-document-access";
import { publishRestoreUpdate } from "@/lib/redis-publish";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: documentId, versionId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const access = await checkDocumentAccess(documentId, userId);
  if (!access.allowed) return access.response;
  if (access.role !== "OWNER" && access.role !== "EDITOR") {
    return NextResponse.json(
      { error: "You do not have permission to restore this document" },
      { status: 403 }
    );
  }

  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
  });
  if (!version || version.documentId !== documentId) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { content: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    // Step 1: load the snapshot into a TEMPORARY doc, never the live one directly.
    const snapshotDoc = new Y.Doc();
    Y.applyUpdate(snapshotDoc, new Uint8Array(version.snapshot));
    const snapshotUpdate = Y.encodeStateAsUpdate(snapshotDoc);

    // Step 2: merge that snapshot's state INTO current content, rather than
    // overwriting — current content first, snapshot update applied on top.
    // Yjs's CRDT merge rules (not a manual diff) decide the resulting content.
    const mergedDoc = new Y.Doc();
    if (document.content) {
      Y.applyUpdate(mergedDoc, new Uint8Array(document.content));
    }
    Y.applyUpdate(mergedDoc, snapshotUpdate);
    const mergedState = Y.encodeStateAsUpdate(mergedDoc);

    // Step 3: persist as both current content AND a new version entry
    // (so the restore itself is undoable via version history too).
    await prisma.$transaction([
      prisma.document.update({
        where: { id: documentId },
        data: { content: Buffer.from(mergedState) },
      }),
      prisma.documentVersion.create({
        data: {
          documentId,
          snapshot: Buffer.from(mergedState),
          createdById: userId,
          label: `Restored from ${version.createdAt.toISOString()}`,
        },
      }),
    ]);

    // Step 4: broadcast to any currently-active live room via Redis pub/sub.
    // If the socket server has this doc open in memory, it applies this to
    // the REAL live Y.Doc as a normal CRDT operation and pushes it to every
    // connected client. If no one has it open, this is a harmless no-op —
    // the next person to join will load the already-updated Postgres content.
    await publishRestoreUpdate(documentId, snapshotUpdate);

    return NextResponse.json({ success: true, restoredFrom: version.id });
  } catch (err) {
    console.error(`[restore] failed for doc ${documentId}, version ${versionId}:`, err);
    return NextResponse.json({ error: "Failed to restore version" }, { status: 500 });
  }
}