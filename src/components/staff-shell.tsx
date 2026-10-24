import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { NavLink } from "./nav-link";

export function StaffShell({ name, role, nav, children }: { name: string; role: string; nav: { href: string; label: string; badge?: number }[]; children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-pine-900 text-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:block">
          <Link href="/" className="text-lg font-bold tracking-tight">BHI</Link>
          <p className="text-xs text-white/60 lg:mt-1">{role}</p>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {nav.map((n) => <NavLink key={n.href} {...n} />)}
        </nav>
        <div className="hidden border-t border-white/10 px-5 py-4 text-sm lg:absolute lg:bottom-0 lg:block lg:w-full">
          <p className="truncate text-white/80">{name}</p>
          <form action={logoutAction}><button className="mt-1 text-white/70 underline hover:text-white">Sign out</button></form>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-8 lg:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
        <form action={logoutAction} className="mt-10 lg:hidden"><button className="text-sm text-slate-600 underline">Sign out</button></form>
      </main>
    </div>
  );
}
