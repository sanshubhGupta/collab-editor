import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-gray-900">
          Sign in to Collab Editor
        </h1>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            Sign-in failed. Please try again.
          </p>
        )}

        <GitHubSignInButton />
      </div>
    </div>
  );
}