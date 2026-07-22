// hooks/useAutosave.ts
import { useCallback, useRef, useState } from "react";
import * as Y from "yjs";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutosaveOptions {
  documentId: string;
  ydoc: Y.Doc;
}

interface UseAutosaveResult {
  status: SaveStatus;
  savedAt: Date | null;
  errorMessage: string | null;
  saveNow: () => Promise<void>;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Manual save trigger (not an automatic-on-every-keystroke autosave).
 * The WebSocket server (Phase 2) already handles continuous autosave every
 * 5s — this hook exists for explicit user-triggered saves (e.g. a "Save
 * now" button, or before navigating away) so there's only ever one
 * automatic write path to Postgres, avoiding a write race.
 */
export function useAutosave({ documentId, ydoc }: UseAutosaveOptions): UseAutosaveResult {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const saveNow = useCallback(async () => {
    if (inFlightRef.current) return; // avoid overlapping saves
    inFlightRef.current = true;
    setStatus("saving");
    setErrorMessage(null);

    const update = Y.encodeStateAsUpdate(ydoc);
    const payload = { update: toBase64(update) };

    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      try {
        const res = await fetch(`/api/documents/${documentId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Save failed with status ${res.status}`);
        }

        const data: { savedAt: string } = await res.json();
        setStatus("saved");
        setSavedAt(new Date(data.savedAt));
        inFlightRef.current = false;
        return;
      } catch (err) {
        attempt += 1;
        if (attempt > MAX_RETRIES) {
          setStatus("error");
          setErrorMessage(err instanceof Error ? err.message : "Save failed");
          inFlightRef.current = false;
          return;
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        await sleep(delay);
      }
    }
  }, [documentId, ydoc]);

  return { status, savedAt, errorMessage, saveNow };
}