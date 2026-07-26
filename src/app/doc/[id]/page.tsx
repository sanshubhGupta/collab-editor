// src/app/doc/[id]/page.tsx
"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import CollaborativeEditor from "@/components/CollaborativeEditor";
import VersionHistory from "@/components/VersionHistory";

// TEMPORARY TEST PAGE — reads user identity from ?userId=&name= query
// params (for Playwright / multi-window manual testing), falling back to
// a default so it still works with a plain URL. Real auth wiring is a
// later step — this is not how the production doc page will work.
export default function DocPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [historyOpen, setHistoryOpen] = useState(false);

  const fakeUserId = searchParams.get("userId") ?? "test-user-1";
  const fakeUserName = searchParams.get("name") ?? "Test User One";

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Test Doc: {params.id}</h1>
        <button
          onClick={() => setHistoryOpen(true)}
          className="text-sm text-gray-600 hover:text-gray-900 border rounded-md px-3 py-1.5"
        >
          Version history
        </button>
      </div>

      <CollaborativeEditor
        documentId={params.id}
        currentUser={{
          id: fakeUserId,
          name: fakeUserName,
          color: "#3b82f6",
        }}
        role="EDITOR"
      />

      {historyOpen && (
        <VersionHistory
          documentId={params.id}
          role="EDITOR"
          onClose={() => setHistoryOpen(false)}
          onRestored={() => window.location.reload()}
        />
      )}
    </div>
  );
}