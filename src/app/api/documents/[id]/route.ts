// src/app/api/documents/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkDocumentAccess } from "@/lib/with-document-access";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await checkDocumentAccess(documentId, session.user.id);
  if (!access.allowed) return access.response;
  if (access.role !== "OWNER") {
    return NextResponse.json(
      { error: "Only the owner can rename this document" },
      { status: 403 }
    );
  }

  let body: { title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
  }

  try {
    const updated = await prisma.document.update({
      where: { id: documentId },
      data: { title },
      select: { id: true, title: true, updatedAt: true },
    });
    return NextResponse.json({ document: updated });
  } catch (err) {
    console.error(`[PATCH /api/documents/${documentId}] failed:`, err);
    return NextResponse.json({ error: "Failed to rename document" }, { status: 500 });
  }
}

export async function DELETE(
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
  if (access.role !== "OWNER") {
    return NextResponse.json(
      { error: "Only the owner can delete this document" },
      { status: 403 }
    );
  }

  try {
    await prisma.document.delete({ where: { id: documentId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[DELETE /api/documents/${documentId}] failed:`, err);
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
}