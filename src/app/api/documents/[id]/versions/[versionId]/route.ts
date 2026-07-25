// src/app/api/documents/[id]/versions/[versionId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkDocumentAccess } from "@/lib/with-document-access";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: documentId, versionId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await checkDocumentAccess(documentId, session.user.id);
  if (!access.allowed) return access.response;

  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    select: { documentId: true, snapshot: true },
  });

  if (!version || version.documentId !== documentId) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  return NextResponse.json({
    snapshot: Buffer.from(version.snapshot).toString("base64"),
  });
}