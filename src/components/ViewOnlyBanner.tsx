// src/components/ViewOnlyBanner.tsx
import { Eye } from "lucide-react";

export default function ViewOnlyBanner() {
  return (
    <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-4 py-2">
      <Eye size={14} />
      View only — you dont have permission to edit this document.
    </div>
  );
}