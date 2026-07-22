// src/app/dashboard/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOnlineCount } from "@/lib/redis-read";
import DashboardClient from "@/components/DashboardClient";
import type { DocumentListItem } from "@/app/api/documents/route";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

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

  const documents: DocumentListItem[] = await Promise.all(
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

  return <DashboardClient initialDocuments={documents} />;
}