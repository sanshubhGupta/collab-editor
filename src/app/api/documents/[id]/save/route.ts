// src/app/api/documents/[id]/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Y from "yjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { update?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.update || typeof body.update !== "string") {
    return NextResponse.json({ error: "Missing 'update' field" }, { status: 400 });
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      ownerId: true,
      content: true,
      members: {
        where: { userId },
        select: { role: true },
      },
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const isOwner = document.ownerId === userId;
  const memberRole = document.members[0]?.role;
  const canEdit = isOwner || memberRole === "OWNER" || memberRole === "EDITOR";

  if (!canEdit) {
    return NextResponse.json(
      { error: "You do not have permission to edit this document" },
      { status: 403 }
    );
  }

  let incomingUpdate: Uint8Array;
  try {
    incomingUpdate = new Uint8Array(Buffer.from(body.update, "base64"));
  } catch {
    return NextResponse.json({ error: "Invalid base64 update" }, { status: 400 });
  }

  try {
    const ydoc = new Y.Doc();

    // Apply existing content first (if any), then the incoming update, so
    // this behaves as a merge rather than a blind overwrite — consistent
    // with how the WebSocket server persists state.
    if (document.content) {
      Y.applyUpdate(ydoc, new Uint8Array(document.content));
    }
    Y.applyUpdate(ydoc, incomingUpdate);

    const mergedState = Y.encodeStateAsUpdate(ydoc);

    await prisma.document.update({
      where: { id: documentId },
      data: { content: Buffer.from(mergedState) },
    });

    return NextResponse.json({ savedAt: new Date().toISOString() });
  } catch (err) {
    console.error(`[save route] failed to persist doc ${documentId}:`, err);
    return NextResponse.json({ error: "Failed to save document" }, { status: 500 });
  }
}