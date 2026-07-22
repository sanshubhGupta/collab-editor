// src/lib/with-document-access.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export type DocumentRole = "OWNER" | "EDITOR" | "VIEWER";

export interface DocumentAccessGranted {
  allowed: true;
  role: DocumentRole;
  isPublic: boolean;
}

export interface DocumentAccessDenied {
  allowed: false;
  response: NextResponse;
}

export type DocumentAccessResult = DocumentAccessGranted | DocumentAccessDenied;

/**
 * Central RBAC check for a single document. Queries DocumentMember (and
 * Document.ownerId / isPublic) fresh on every call — never trusts a
 * client-supplied role. Returns either the resolved role (OWNER take
 * priority, then explicit membership, then public-viewer fallback) or a
 * ready-to-return NextResponse (404/403) if access should be denied.
 *
 * Usage in a route handler:
 *   const access = await checkDocumentAccess(documentId, userId);
 *   if (!access.allowed) return access.response;
 *   // access.role is now safe to use
 */
export async function checkDocumentAccess(
  documentId: string,
  userId: string
): Promise<DocumentAccessResult> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      ownerId: true,
      isPublic: true,
      members: { where: { userId }, select: { role: true } },
    },
  });

  if (!doc) {
    return {
      allowed: false,
      response: NextResponse.json({ error: "Document not found" }, { status: 404 }),
    };
  }

  if (doc.ownerId === userId) {
    return { allowed: true, role: "OWNER", isPublic: doc.isPublic };
  }

  const memberRole = doc.members[0]?.role;
  if (memberRole) {
    return { allowed: true, role: memberRole as DocumentRole, isPublic: doc.isPublic };
  }

  if (doc.isPublic) {
    return { allowed: true, role: "VIEWER", isPublic: doc.isPublic };
  }

  return {
    allowed: false,
    response: NextResponse.json({ error: "You do not have access to this document" }, { status: 403 }),
  };
}