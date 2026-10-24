import Link from "next/link";
import type { ReactNode } from "react";
import { Journey } from "./journey";
import { logoutAction } from "@/app/(auth)/actions";

export function StudentShell({ name, step, children, nav }: { name: string; step: number; children: ReactNode; nav?: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/" className="text-lg font-bold tracking-tight text-pine-700">BHI</Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate-600 sm:inline">{name}</span>
            <form action={logoutAction}><button className="font-semibold text-pine-700 underline">Sign out</button></form>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-8">
          <div className="rounded-lg border border-line bg-white p-5"><Journey current={step} /></div>
          {nav}
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
