"use client";

import Link from "next/link";
import { Badge, Empty } from "./ui";
import { mmss, useLive, useTick } from "./use-live";

type Overview = {
  serverNow: number; date: string;
  classes: {
    classId: string; name: string; instructors: string; enrolled: number; open: boolean; expiresAt: number | null;
    checkedIn: number; pending: number; filled: number; present: number; late: number; absent: number; hours: number; signed: boolean; signedOutdated: boolean;
  }[];
};

/** Admin: every class running today, updating live. */
export function AdminLiveOverview() {
  const { data, failed, serverNow, updatedAt } = useLive<Overview>("/api/live", 5000);
  useTick(1000);
  if (!data) return <p className="text-sm text-slate-600">{failed ? "Couldn't load. Retrying..." : "Loading..."}</p>;
  if (!data.classes.length) return <Empty>No classes with students are running today.</Empty>;
  const ago = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : 0;
  return (
    <>
      <p className="mb-3 flex items-center gap-2 text-xs text-slate-600" aria-live="polite">
        <span className={`inline-block h-2 w-2 rounded-full ${failed ? "bg-brick-600" : "animate-pulse bg-pine-600"}`} aria-hidden />
        {failed ? "Reconnecting..." : `Live · updated ${ago}s ago`}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-mist text-left text-xs font-semibold text-slate-600">
            <tr>{["Class", "Check-in code", "Checked in", "Waiting to fill", "Filled out", "Present / late / absent", "Hours", "Signed"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.classes.map((c) => {
              const left = c.expiresAt ? c.expiresAt - serverNow() : 0;
              return (
                <tr key={c.classId}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/classes/${c.classId}#live`} className="font-semibold text-pine-700 underline">{c.name}</Link>
                    <span className="block text-xs text-slate-500">{c.instructors || "No instructor assigned"}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{c.open && left > 0 ? <Badge tone="marigold">Open · {mmss(left)}</Badge> : <span className="text-slate-500">Closed</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{c.checkedIn} / {c.enrolled}</td>
                  <td className="px-3 py-2 tabular-nums">{c.pending}</td>
                  <td className="px-3 py-2 tabular-nums">{c.filled}</td>
                  <td className="px-3 py-2 tabular-nums">{c.present} / {c.late} / {c.absent}</td>
                  <td className="px-3 py-2 tabular-nums">{c.hours.toFixed(2)}</td>
                  <td className="px-3 py-2">{c.signed ? <Badge tone="pine">Signed</Badge> : c.signedOutdated ? <Badge tone="brick">Changed after signing</Badge> : <Badge>Not yet</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
