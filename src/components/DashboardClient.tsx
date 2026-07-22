// src/components/DashboardClient.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Users, Trash2, Pencil, Check, X } from "lucide-react";
import type { DocumentListItem } from "@/app/api/documents/route";

interface DashboardClientProps {
  initialDocuments: DocumentListItem[];
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DashboardClient({ initialDocuments }: DashboardClientProps) {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentListItem[]>(initialDocuments);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled Document" }),
      });
      if (!res.ok) throw new Error("Failed to create document");
      const data: { document: { id: string } } = await res.json();
      router.push(`/doc/${data.document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create document");
      setCreating(false);
    }
  }

  function startRename(doc: DocumentListItem) {
    setEditingId(doc.id);
    setEditingTitle(doc.title);
  }

  async function confirmRename(docId: string) {
    const title = editingTitle.trim();
    if (!title) {
      setEditingId(null);
      return;
    }
    const prevDocs = documents;
    setDocuments((docs) => docs.map((d) => (d.id === docId ? { ...d, title } : d)));
    setEditingId(null);

    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Rename failed");
    } catch (err) {
      setDocuments(prevDocs); // roll back optimistic update
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  async function handleDelete(docId: string) {
    const prevDocs = documents;
    setDocuments((docs) => docs.filter((d) => d.id !== docId));
    setConfirmDeleteId(null);

    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch (err) {
      setDocuments(prevDocs); // roll back optimistic update
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">My Documents</h1>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                     text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} />
          {creating ? "Creating..." : "New Document"}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="text-center text-gray-400 py-20">
          No documents yet. Create your first one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="border rounded-lg p-4 hover:shadow-md transition-shadow duration-150 bg-white"
            >
              {editingId === doc.id ? (
                <div className="flex items-center gap-1 mb-2">
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmRename(doc.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 border rounded px-2 py-1 text-sm"
                  />
                  <button onClick={() => confirmRename(doc.id)} className="text-green-600 p-1">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-gray-400 p-1">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-start justify-between mb-2">
                  <button
                    onClick={() => router.push(`/doc/${doc.id}`)}
                    className="text-left font-medium text-gray-900 hover:underline line-clamp-1"
                  >
                    {doc.title}
                  </button>
                  {doc.role === "OWNER" && (
                    <button
                      onClick={() => startRename(doc)}
                      className="text-gray-400 hover:text-gray-700 p-1 shrink-0"
                      title="Rename"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
              )}

              <div className="text-xs text-gray-500 mb-3">
                Edited {relativeTime(doc.updatedAt)} · {doc.ownerName ?? "Unknown owner"}
              </div>

              <div className="flex items-center justify-between">
                {doc.onlineCount > 0 ? (
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                    <Users size={12} />
                    {doc.onlineCount} online
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Offline</span>
                )}

                {doc.role === "OWNER" &&
                  (confirmDeleteId === doc.id ? (
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-gray-500">Delete?</span>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="text-red-600 font-medium"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-gray-400"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(doc.id)}
                      className="text-gray-300 hover:text-red-500 p-1"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}