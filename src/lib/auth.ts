import { auth } from "@/auth";

export async function getServerSession() {
  const session = await auth();
  return session;
}

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized: no active session.");
  }
  return session;
}