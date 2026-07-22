// src/app/api/documents/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Y from "yjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOnlineCount } from "@/lib/redis-read";

export interface DocumentListItem {
  id: string;
  title: string;
  updatedAt: string;
  ownerId: string;
  ownerName: string | null;
  role: "OWNER" | "EDITOR" | "VIEWER";
  onlineCount: number;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const docs = await prisma.document.findMany({
      where: {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        ownerId: true,
        owner: { select: { name: true } },
        members: { where: { userId }, select: { role: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const withPresence: DocumentListItem[] = await Promise.all(
      docs.map(async (doc) => ({
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt.toISOString(),
        ownerId: doc.ownerId,
        ownerName: doc.owner.name,
        role: doc.ownerId === userId ? "OWNER" : doc.members[0]?.role ?? "VIEWER",
        onlineCount: await getOnlineCount(doc.id),
      }))
    );

    return NextResponse.json({ documents: withPresence });
  } catch (err) {
    console.error("[GET /api/documents] failed:", err);
    return NextResponse.json({ error: "Failed to load documents" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { title?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const title = body.title?.trim() || "Untitled Document";

  try {
    const emptyState = Y.encodeStateAsUpdate(new Y.Doc());

    const doc = await prisma.document.create({
      data: {
        title,
        content: Buffer.from(emptyState),
        ownerId: userId,
      },
      select: { id: true, title: true, updatedAt: true, ownerId: true },
    });

    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/documents] failed:", err);
    return NextResponse.json({ error: "Failed to create document" }, { status: 500 });
  }
}