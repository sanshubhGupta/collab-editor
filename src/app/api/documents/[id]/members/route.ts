// src/app/api/documents/[id]/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkDocumentAccess } from "@/lib/with-document-access";

export interface MemberListItem {
  userId: string;
  name: string | null;
  email: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
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

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      owner: { select: { id: true, name: true, email: true } },
      members: {
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const members: MemberListItem[] = [
    { userId: doc.owner.id, name: doc.owner.name, email: doc.owner.email, role: "OWNER" },
    ...doc.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role as "EDITOR" | "VIEWER",
    })),
  ];

  return NextResponse.json({ members });
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
  if (access.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can add members" }, { status: 403 });
  }

  let body: { email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const role = body.role;
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (role !== "EDITOR" && role !== "VIEWER") {
    return NextResponse.json({ error: "Role must be EDITOR or VIEWER" }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (!targetUser) {
    // Since auth is GitHub-OAuth-only, a User row only exists after that
    // person has signed in at least once — you can't invite someone who's
    // never logged in. Surface that clearly rather than a vague 404.
    return NextResponse.json(
      { error: "No user found with that email. They need to sign in at least once before being added." },
      { status: 404 }
    );
  }

  if (targetUser.id === userId) {
    return NextResponse.json({ error: "You already own this document" }, { status: 400 });
  }

  try {
    const member = await prisma.documentMember.upsert({
      where: { documentId_userId: { documentId, userId: targetUser.id } },
      update: { role },
      create: { documentId, userId: targetUser.id, role },
    });

    return NextResponse.json(
      {
        member: {
          userId: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          role: member.role,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error(`[POST /api/documents/${documentId}/members] failed:`, err);
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }
}