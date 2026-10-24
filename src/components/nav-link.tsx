"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const path = usePathname();
  const active = href === "/admin" || href === "/instructor" ? path === href : path.startsWith(href);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={cx("flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm", active ? "bg-white/10 font-semibold text-white" : "text-white/75 hover:bg-white/5 hover:text-white")}>
      {label}
      {!!badge && <span className="rounded bg-marigold-500 px-1.5 text-xs font-bold text-pine-900">{badge}</span>}
    </Link>
  );
}
