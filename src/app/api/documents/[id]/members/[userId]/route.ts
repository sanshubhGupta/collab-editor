// src/app/api/documents/[id]/members/[userId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkDocumentAccess } from "@/lib/with-document-access";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id: documentId, userId: targetUserId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await checkDocumentAccess(documentId, session.user.id);
  if (!access.allowed) return access.response;
  if (access.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can remove members" }, { status: 403 });
  }

  try {
    await prisma.documentMember.delete({
      where: { documentId_userId: { documentId, userId: targetUserId } },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[DELETE /api/documents/${documentId}/members/${targetUserId}] failed:`, err);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}