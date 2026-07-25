// components/CollaborativeEditor.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { io, Socket } from "socket.io-client";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Quote,
  Code,
  Undo2,
  Redo2,
} from "lucide-react";
import { useAutosave } from "@/hooks/useAutosave";
import SaveStatusIndicator from "@/components/SaveStatus";
import PresenceBar, { type PresenceUser as PresenceBarUser } from "@/components/PresenceBar";

export interface CurrentUser {
  id: string;
  name: string;
  color: string;
  image?: string | null;
}

export type DocumentRole = "OWNER" | "EDITOR" | "VIEWER";

interface CollaborativeEditorProps {
  documentId: string;
  currentUser: CurrentUser;
  role: DocumentRole;
  onSave?: () => void;
}

type ConnectionStatus = "connected" | "reconnecting" | "offline";

interface RemotePresenceUser {
  userId: string;
  name: string;
  color: string;
  cursor: { anchor: number; head: number } | null;
}

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

export default function CollaborativeEditor({
  documentId,
  currentUser,
  role,
  onSave,
}: CollaborativeEditorProps) {
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [presenceUsers, setPresenceUsers] = useState<Map<string, RemotePresenceUser>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);

  const editable = role !== "VIEWER";

  // Y.Doc must be stable across renders for a given documentId — recreated
  // only if documentId itself changes.
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);

  const { status: saveStatus, savedAt, errorMessage, saveNow } = useAutosave({
    documentId,
    ydoc,
  });

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false, // Yjs/Collaboration handles undo-redo instead
        }),
        Underline,
        Placeholder.configure({
          placeholder: editable ? "Start writing..." : "This document is empty.",
        }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCaret.configure({
          provider: { awareness: awarenessRef.current ?? new Awareness(ydoc) },
          user: { name: currentUser.name, color: currentUser.color },
        }),
      ],
      editable,
      immediatelyRender: false,
    },
    [ydoc, editable]
  );

  useEffect(() => {
    const awareness = new Awareness(ydoc);
    awarenessRef.current = awareness;
    awareness.setLocalStateField("user", {
      name: currentUser.name,
      color: currentUser.color,
    });

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("connected");
      socket.emit("join-document", {
        docId: documentId,
        userId: currentUser.id,
        name: currentUser.name,
        color: currentUser.color,
      });
    });

    socket.on("disconnect", () => setStatus("offline"));
    socket.io.on("reconnect_attempt", () => setStatus("reconnecting"));
    socket.io.on("reconnect", () => setStatus("connected"));

    socket.on("sync-state", (update: ArrayBuffer | Uint8Array) => {
      Y.applyUpdate(ydoc, new Uint8Array(update), "remote");
    });

    socket.on("yjs-update", (update: ArrayBuffer | Uint8Array) => {
      Y.applyUpdate(ydoc, new Uint8Array(update), "remote");
    });

    socket.on("awareness-update", (update: number[]) => {
      applyAwarenessUpdate(awareness, new Uint8Array(update), "remote");
    });

    // --- Presence bar data (separate from cursor rendering, which
    // CollaborationCursor handles internally via the same awareness) ---
    socket.on("presence-list", (list: RemotePresenceUser[]) => {
      const next = new Map<string, RemotePresenceUser>();
      for (const u of list) next.set(u.userId, u);
      setPresenceUsers(next);
    });
    socket.on(
      "user-joined",
      (payload: { userId: string; name: string; color: string }) => {
        setPresenceUsers((prev) => {
          const next = new Map(prev);
          next.set(payload.userId, { ...payload, cursor: null });
          return next;
        });
      }
    );
    socket.on("user-left", (payload: { userId: string }) => {
      setPresenceUsers((prev) => {
        if (!prev.has(payload.userId)) return prev;
        const next = new Map(prev);
        next.delete(payload.userId);
        return next;
      });
    });
    socket.on(
      "cursor-moved",
      (payload: { userId: string; cursor: { anchor: number; head: number } }) => {
        setPresenceUsers((prev) => {
          const existing = prev.get(payload.userId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(payload.userId, { ...existing, cursor: payload.cursor });
          return next;
        });
      }
    );

    // Relay local Yjs changes to the server — skip changes that originated
    // remotely (origin === "remote") to avoid re-broadcasting an echo.
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      socket.emit("yjs-update", { docId: documentId, update, userId: currentUser.id });
    };
    ydoc.on("update", onDocUpdate);

    const onAwarenessUpdate = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (origin === "remote") return;
      const changedClients = added.concat(updated, removed);
      const update = encodeAwarenessUpdate(awareness, changedClients);
      socket.emit("awareness-update", { docId: documentId, update: Array.from(update) });
    };
    awareness.on("update", onAwarenessUpdate);

    return () => {
      ydoc.off("update", onDocUpdate);
      awareness.off("update", onAwarenessUpdate);
      socket.emit("leave-document", { docId: documentId, userId: currentUser.id });
      socket.disconnect();
      awareness.destroy();
      ydoc.destroy();
    };
  }, [documentId, currentUser.id, currentUser.name, currentUser.color, ydoc]);

  const handleSaveNow = async () => {
    await saveNow();
    onSave?.();
  };

  if (!editor) return null;

  const presenceBarUsers: PresenceBarUser[] = Array.from(presenceUsers.values())
    .filter((u) => u.userId !== currentUser.id)
    .map((u) => ({
      userId: u.userId,
      name: u.name,
      color: u.color,
      isEditing: u.cursor !== null,
    }));

  return (
    <div className="flex flex-col border rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-gray-50 px-3 py-2">
        <div className="flex items-center gap-3">
          {editable && <Toolbar editor={editor} />}
        </div>
        <div className="flex items-center gap-3">
          <PresenceBar users={presenceBarUsers} />
          {editable && (
            <SaveStatusIndicator
              status={saveStatus}
              savedAt={savedAt}
              errorMessage={errorMessage}
              onSaveClick={handleSaveNow}
            />
          )}
          <ConnectionIndicator status={status} />
        </div>
      </div>
      <EditorContent
        editor={editor}
        className="prose max-w-none p-4 min-h-[400px] focus:outline-none"
      />
    </div>
  );
}

function Toolbar({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const buttons: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean }[] = [
    {
      label: "Bold",
      icon: <BoldIcon size={16} />,
      onClick: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
    },
    {
      label: "Italic",
      icon: <ItalicIcon size={16} />,
      onClick: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
    },
    {
      label: "Underline",
      icon: <UnderlineIcon size={16} />,
      onClick: () => editor.chain().focus().toggleUnderline().run(),
      active: editor.isActive("underline"),
    },
    {
      label: "H1",
      icon: <span className="text-xs font-bold">H1</span>,
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      active: editor.isActive("heading", { level: 1 }),
    },
    {
      label: "H2",
      icon: <span className="text-xs font-bold">H2</span>,
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
    },
    {
      label: "H3",
      icon: <span className="text-xs font-bold">H3</span>,
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive("heading", { level: 3 }),
    },
    {
      label: "Bullet list",
      icon: <List size={16} />,
      onClick: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      label: "Ordered list",
      icon: <ListOrdered size={16} />,
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
    },
    {
      label: "Blockquote",
      icon: <Quote size={16} />,
      onClick: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive("blockquote"),
    },
    {
      label: "Code block",
      icon: <Code size={16} />,
      onClick: () => editor.chain().focus().toggleCodeBlock().run(),
      active: editor.isActive("codeBlock"),
    },
  ];

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {buttons.map((btn) => (
        <button
          key={btn.label}
          type="button"
          title={btn.label}
          onClick={btn.onClick}
          className={`p-1.5 rounded hover:bg-gray-200 ${btn.active ? "bg-gray-300" : ""}`}
        >
          {btn.icon}
        </button>
      ))}
      <div className="w-px h-5 bg-gray-300 mx-1" />
      <button
        type="button"
        title="Undo"
        onClick={() => editor.chain().focus().undo().run()}
        className="p-1.5 rounded hover:bg-gray-200"
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        title="Redo"
        onClick={() => editor.chain().focus().redo().run()}
        className="p-1.5 rounded hover:bg-gray-200"
      >
        <Redo2 size={16} />
      </button>
    </div>
  );
}

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { label: string; color: string }> = {
    connected: { label: "Connected", color: "bg-green-500" },
    reconnecting: { label: "Reconnecting", color: "bg-yellow-500" },
    offline: { label: "Offline", color: "bg-red-500" },
  };
  const { label, color } = config[status];

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-600">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </div>
  );
}