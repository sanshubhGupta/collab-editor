// src/middleware.ts
import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

// Test-only bypass: Playwright can't drive a real GitHub OAuth redirect
// reliably, so this lets a request skip the auth check entirely — but
// ONLY when TEST_AUTH_BYPASS_SECRET is set in the server's environment
// AND the request sends a matching header. In production, this env var
// should never be set, making this branch permanently dead code there.
const TEST_BYPASS_HEADER = "x-playwright-test-bypass";

export default async function middleware(req: NextRequest) {
  const bypassSecret = process.env.TEST_AUTH_BYPASS_SECRET;
  if (bypassSecret && req.headers.get(TEST_BYPASS_HEADER) === bypassSecret) {
    return NextResponse.next();
  }

  // @ts-expect-error — auth() from NextAuth v5 beta works as middleware
  // when called directly like this; matches the original single-line form.
  return auth(req);
}

export const config = {
  matcher: ["/dashboard/:path*", "/doc/:path*"],
};