// components/PresenceBar.tsx
"use client";

import { useState } from "react";

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  image?: string | null;
  isEditing?: boolean; // true = actively editing, false/undefined = just viewing
}

interface PresenceBarProps {
  users: PresenceUser[];
  maxVisible?: number;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ user, size = 32 }: { user: PresenceUser; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = user.image && !imgFailed;

  return (
    <div
      className="relative rounded-full ring-2 ring-white flex items-center justify-center text-xs font-medium text-white shrink-0 overflow-hidden"
      style={{
        width: size,
        height: size,
        backgroundColor: showImage ? undefined : user.color,
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image!}
          alt={user.name}
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        getInitials(user.name)
      )}
      {user.isEditing && (
        <span
          className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-500 ring-1 ring-white"
          aria-label="editing"
        />
      )}
    </div>
  );
}

function AvatarWithTooltip({ user }: { user: PresenceUser }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Avatar user={user} />
      {hovered && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20
                     whitespace-nowrap rounded-md bg-gray-900 text-white text-xs
                     px-2 py-1 shadow-lg transition-opacity duration-150
                     pointer-events-none"
        >
          <div className="font-medium">{user.name}</div>
          <div className="text-gray-300">
            {user.isEditing ? "Editing" : "Viewing"}
          </div>
          {/* Little arrow */}
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-full
                       border-4 border-transparent border-b-gray-900"
          />
        </div>
      )}
    </div>
  );
}

export default function PresenceBar({ users, maxVisible = 5 }: PresenceBarProps) {
  const visibleUsers = users.slice(0, maxVisible);
  const overflowCount = Math.max(users.length - maxVisible, 0);

  if (users.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="w-2 h-2 rounded-full bg-gray-300" />
        No one else here
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="flex -space-x-2 sm:-space-x-2.5">
        {visibleUsers.map((user) => (
          <AvatarWithTooltip key={user.userId} user={user} />
        ))}
        {overflowCount > 0 && (
          <div
            className="relative rounded-full ring-2 ring-white flex items-center
                       justify-center text-xs font-medium text-gray-600 bg-gray-200
                       shrink-0"
            style={{ width: 32, height: 32 }}
            title={`${overflowCount} more`}
          >
            +{overflowCount}
          </div>
        )}
      </div>
      <span className="hidden sm:inline text-xs text-gray-500 whitespace-nowrap">
        {users.length} online
      </span>
    </div>
  );
}