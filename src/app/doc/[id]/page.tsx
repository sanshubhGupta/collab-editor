// src/app/doc/[id]/page.tsx
"use client";

import { useParams } from "next/navigation";
import CollaborativeEditor from "@/components/CollaborativeEditor";

// TEMPORARY TEST PAGE — hardcoded fake user, no real auth check yet.
// Replace this with the real Phase 4 dashboard-linked version later.
export default function DocPage() {
  const params = useParams<{ id: string }>();

  // Open this same URL in two different browser windows with DIFFERENT
  // fakeUserId values (change the number below) to simulate two people
  // editing at once.
  const fakeUserId = "test-user-1";
  const fakeUserName = "Test User One";

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">Test Doc: {params.id}</h1>
      <CollaborativeEditor
        documentId={params.id}
        currentUser={{
          id: fakeUserId,
          name: fakeUserName,
          color: "#3b82f6",
        }}
        role="EDITOR"
      />
    </div>
  );
}