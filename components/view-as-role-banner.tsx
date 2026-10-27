"use client";

import { Eye, X } from "lucide-react";
import { glassShineStyle } from "@/lib/glass-shine";
import { setViewAsRole, useViewAsRole } from "@/lib/view-as-role";

// While an owner or admin is viewing the app as a role (lib/view-as-role.ts): a pill along the top of every page saying so,
// in the role's colour, with Exit — back to their own view.
export function ViewAsRoleBanner() {
  const viewAs = useViewAsRole();
  if (!viewAs) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[58px] z-[160] flex justify-center px-3">
      <div
        role="status"
        className="glass-shine pointer-events-auto flex max-w-full items-center gap-2 rounded-full border py-1 pl-3.5 pr-1 text-[12.5px] font-medium text-white shadow-[var(--shadow-md)]"
        style={glassShineStyle(viewAs.roleColor)}
      >
        <Eye size={14} className="shrink-0" />
        <span className="min-w-0 truncate">
          Viewing as <span className="font-semibold">{viewAs.roleName}</span>
          <span className="max-sm:hidden"> — what they can see and do</span>
        </span>
        <button
          type="button"
          onClick={() => setViewAsRole(null)}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/90 px-2.5 text-[12px] font-semibold text-[#0F172A] transition hover:bg-white"
        >
          <X size={13} strokeWidth={2.6} />
          Exit
        </button>
      </div>
    </div>
  );
}
