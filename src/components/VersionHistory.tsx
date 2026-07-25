// src/components/VersionHistory.tsx
"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { X, Clock, RotateCcw, Loader2 } from "lucide-react";
import type { VersionListItem } from "@/app/api/documents/[id]/versions/route";
import type { DocumentRole } from "@/components/CollaborativeEditor";

interface VersionHistoryProps {
  documentId: string;
  role: DocumentRole;
  onClose: () => void;
  onRestored: () => void;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function VersionHistory({
  documentId,
  role,
  onClose,
  onRestored,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRestore = role === "OWNER" || role === "EDITOR";

  // Preview doc is a standalone, throwaway Y.Doc — never connected to any
  // socket, never written to. Purely for rendering old content read-only.
  const [previewYdoc, setPreviewYdoc] = useState(() => new Y.Doc());

  const previewEditor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: previewYdoc }),
      ],
      editable: false,
      immediatelyRender: false,
    },
    [previewYdoc]
  );

  // Plain CSS slide-in (no animation library): mount off-screen first, then
  // flip to the "in" position on the next frame so the transition actually
  // animates instead of snapping straight to its final position.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadVersions() {
      try {
        const res = await fetch(`/api/documents/${documentId}/versions`);
        if (!res.ok) throw new Error("Failed to load version history");
        const data: { versions: VersionListItem[] } = await res.json();
        if (!cancelled) setVersions(data.versions);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load versions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadVersions();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function handleSelectVersion(versionId: string) {
    setSelectedId(versionId);
    setConfirmRestore(false);
    setPreviewLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/documents/${documentId}/versions/${versionId}`);
      if (!res.ok) throw new Error("Failed to load version content");
      const data: { snapshot: string } = await res.json();

      const bytes = new Uint8Array(Buffer.from(data.snapshot, "base64"));
      const freshDoc = new Y.Doc();
      Y.applyUpdate(freshDoc, bytes);
      setPreviewYdoc(freshDoc); // triggers previewEditor recreation via its deps
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRestore() {
    if (!selectedId) return;
    setRestoring(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/${selectedId}/restore`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Restore failed");
      }
      onRestored();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
      setRestoring(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* slide-in panel — plain CSS transform transition, no animation library */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl flex flex-col
                    transition-transform duration-200 ease-out
                    ${mounted ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock size={18} />
            Version history
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        {/* version list */}
        <div className="border-b max-h-64 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-gray-400">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="p-4 text-sm text-gray-400">No versions saved yet.</div>
          ) : (
            <ul>
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => handleSelectVersion(v.id)}
                    className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition-colors ${
                      selectedId === v.id ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {relativeTime(v.createdAt)}
                      {v.label && <span className="text-gray-400"> — {v.label}</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      by {v.createdByName ?? "Unknown"} · {formatSize(v.byteSize)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* preview */}
        <div className="flex-1 overflow-y-auto p-4">
          {!selectedId ? (
            <div className="text-sm text-gray-400 text-center pt-8">
              Select a version to preview it
            </div>
          ) : previewLoading ? (
            <div className="flex items-center justify-center pt-8 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            <div className="prose prose-sm max-w-none border rounded-md p-3 bg-gray-50">
              <EditorContent editor={previewEditor} />
            </div>
          )}
        </div>

        {/* restore action */}
        {selectedId && (
          <div className="border-t p-4">
            {!canRestore ? (
              <div className="text-xs text-gray-400 text-center">
                You have view-only access — only editors and the owner can restore.
              </div>
            ) : confirmRestore ? (
              <div className="flex flex-col gap-2">
                <div className="text-sm text-gray-700">
                  Restore this version? This merges its content into the current
                  document — it won&apos;t erase anything typed since then.
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRestore}
                    disabled={restoring}
                    className="flex-1 flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm py-2 rounded-md"
                  >
                    {restoring ? <Loader2 size={14} className="animate-spin" /> : "Confirm restore"}
                  </button>
                  <button
                    onClick={() => setConfirmRestore(false)}
                    disabled={restoring}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm py-2 rounded-md"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRestore(true)}
                className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-black text-white text-sm py-2 rounded-md"
              >
                <RotateCcw size={14} />
                Restore this version
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}