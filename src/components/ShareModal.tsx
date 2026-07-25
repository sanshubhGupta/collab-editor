// src/components/ShareModal.tsx
"use client";

import { useEffect, useState } from "react";
import { X, Trash2, Loader2 } from "lucide-react";
import type { MemberListItem } from "@/app/api/documents/[id]/members/route";

interface ShareModalProps {
  documentId: string;
  currentUserId: string;
  onClose: () => void;
}

type InviteRole = "EDITOR" | "VIEWER";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function ShareModal({ documentId, currentUserId, onClose }: ShareModalProps) {
  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("EDITOR");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMembers() {
      try {
        const res = await fetch(`/api/documents/${documentId}/members`);
        if (!res.ok) throw new Error("Failed to load members");
        const data: { members: MemberListItem[] } = await res.json();
        if (!cancelled) setMembers(data.members);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load members");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadMembers();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function handleInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;

    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add member");

      setMembers((prev) => {
        const withoutExisting = prev.filter((m) => m.userId !== data.member.userId);
        return [...withoutExisting, data.member];
      });
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(userId: string) {
    const prevMembers = members;
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    try {
      const res = await fetch(`/api/documents/${documentId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove member");
    } catch (err) {
      setMembers(prevMembers); // rollback
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Share document</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="email"
            placeholder="person@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInvite()}
            className="flex-1 border rounded-md px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
            className="border rounded-md px-2 py-2 text-sm"
          >
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !email.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-2 rounded-md"
          >
            {inviting ? <Loader2 size={14} className="animate-spin" /> : "Add"}
          </button>
        </div>

        {error && <div className="text-xs text-red-600 mb-3">{error}</div>}

        <div className="border-t pt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">People with access</div>
          {loading ? (
            <div className="text-sm text-gray-400">Loading...</div>
          ) : (
            <ul className="space-y-2 max-h-60 overflow-y-auto">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{m.name ?? m.email}</div>
                    <div className="text-xs text-gray-400">{m.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{m.role}</span>
                    {m.role !== "OWNER" && (
                      <button
                        onClick={() => handleRemove(m.userId)}
                        className="text-gray-300 hover:text-red-500"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}