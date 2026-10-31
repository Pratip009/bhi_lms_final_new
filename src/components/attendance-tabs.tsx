import Link from "next/link";
import { cx } from "./ui";

/** Tabs that join the admin's attendance pages into one menu item: today, records, monthly reports. */
export function AttendanceTabs({ active }: { active: "today" | "records" | "reports" }) {
  const tabs = [
    { key: "today", href: "/admin/live", label: "Today" },
    { key: "records", href: "/admin/attendance", label: "Attendance records" },
    { key: "reports", href: "/admin/reports", label: "Monthly progress reports" },
  ];
  return (
    <nav aria-label="Attendance and reports" className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={active === t.key ? "page" : undefined}
          className={cx("-mb-px rounded-t-md border px-4 py-2 text-sm font-semibold", active === t.key ? "border-line border-b-white bg-white text-pine-800" : "border-transparent text-slate-600 hover:text-pine-700")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
