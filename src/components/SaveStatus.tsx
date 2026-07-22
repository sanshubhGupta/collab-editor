// components/SaveStatus.tsx
"use client";

import { Check, Loader2, AlertCircle, Save } from "lucide-react";
import type { SaveStatus as SaveStatusType } from "@/hooks/useAutosave";

interface SaveStatusProps {
  status: SaveStatusType;
  savedAt: Date | null;
  errorMessage: string | null;
  onSaveClick: () => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function SaveStatusIndicator({
  status,
  savedAt,
  errorMessage,
  onSaveClick,
}: SaveStatusProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {status === "idle" && (
        <button
          type="button"
          onClick={onSaveClick}
          className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
        >
          <Save size={14} />
          Save now
        </button>
      )}

      {status === "saving" && (
        <span className="flex items-center gap-1 text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          Saving...
        </span>
      )}

      {status === "saved" && (
        <span className="flex items-center gap-1 text-green-600">
          <Check size={14} />
          Saved{savedAt ? ` at ${formatTime(savedAt)}` : ""}
        </span>
      )}

      {status === "error" && (
        <button
          type="button"
          onClick={onSaveClick}
          className="flex items-center gap-1 text-red-600 hover:text-red-700"
          title={errorMessage ?? "Save failed"}
        >
          <AlertCircle size={14} />
          Save failed — retry
        </button>
      )}
    </div>
  );
}