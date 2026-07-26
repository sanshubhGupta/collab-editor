// __tests__/rbac.test.ts

// Mock the Prisma client BEFORE importing anything that depends on it.
// The real @/lib/prisma imports the generated Prisma client, which uses
// import.meta.url — pure ESM syntax that Jest's default CommonJS transform
// cannot handle (the same class of error hit earlier running server/index.ts
// under plain ts-node). Since this test only needs to verify
// checkDocumentAccess's DECISION LOGIC, not real database behavior,
// mocking removes any need to load that real, ESM-only module at all.
jest.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { checkDocumentAccess } from "@/lib/with-document-access";

const mockFindUnique = prisma.document.findUnique as jest.Mock;

describe("checkDocumentAccess (RBAC)", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
  });

  test("returns OWNER role when the requesting user is the document owner", async () => {
    mockFindUnique.mockResolvedValue({
      ownerId: "user-1",
      isPublic: false,
      members: [],
    });

    const result = await checkDocumentAccess("doc-1", "user-1");

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.role).toBe("OWNER");
    }
  });

  test("returns the member's explicit role when they are a DocumentMember", async () => {
    mockFindUnique.mockResolvedValue({
      ownerId: "user-1",
      isPublic: false,
      members: [{ role: "EDITOR" }],
    });

    const result = await checkDocumentAccess("doc-1", "user-2");

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.role).toBe("EDITOR");
    }
  });

  test("falls back to VIEWER for a non-member on a public document", async () => {
    mockFindUnique.mockResolvedValue({
      ownerId: "user-1",
      isPublic: true,
      members: [],
    });

    const result = await checkDocumentAccess("doc-1", "random-user");

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.role).toBe("VIEWER");
    }
  });

  test("denies access with 403 for a non-member on a private document", async () => {
    mockFindUnique.mockResolvedValue({
      ownerId: "user-1",
      isPublic: false,
      members: [],
    });

    const result = await checkDocumentAccess("doc-1", "random-user");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(403);
    }
  });

  test("denies access with 404 when the document does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await checkDocumentAccess("nonexistent-doc", "user-1");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(404);
    }
  });
});