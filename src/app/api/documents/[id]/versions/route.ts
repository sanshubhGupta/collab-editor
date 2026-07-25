// src/app/api/documents/[id]/versions/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Y from "yjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkDocumentAccess } from "@/lib/with-document-access";

export interface VersionListItem {
  id: string;
  createdAt: string;
  createdByName: string | null;
  byteSize: number;
  label: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await checkDocumentAccess(documentId, session.user.id);
  if (!access.allowed) return access.response;

  const versions = await prisma.documentVersion.findMany({
    where: { documentId },
    select: {
      id: true,
      createdAt: true,
      label: true,
      snapshot: true,
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const list: VersionListItem[] = versions.map((v: typeof versions[number]) => ({
    id: v.id,
    createdAt: v.createdAt.toISOString(),
    createdByName: v.createdBy.name,
    byteSize: v.snapshot.length,
    label: v.label,
  }));

  return NextResponse.json({ versions: list });
}

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

  const access = await checkDocumentAccess(documentId, userId);
  if (!access.allowed) return access.response;
  if (access.role !== "OWNER" && access.role !== "EDITOR") {
    return NextResponse.json(
      { error: "You do not have permission to create a version" },
      { status: 403 }
    );
  }

  let body: { label?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { content: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    // Best available "current" state from this process is Postgres, which
    // trails live edits by at most the 5s auto-persist window.
    const ydoc = new Y.Doc();
    if (document.content) {
      Y.applyUpdate(ydoc, new Uint8Array(document.content));
    }
    const snapshot = Y.encodeStateAsUpdate(ydoc);

    const version = await prisma.documentVersion.create({
      data: {
        documentId,
        snapshot: Buffer.from(snapshot),
        createdById: userId,
        label: body.label?.trim() || null,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    console.error(`[POST /api/documents/${documentId}/versions] failed:`, err);
    return NextResponse.json({ error: "Failed to create version" }, { status: 500 });
  }
}