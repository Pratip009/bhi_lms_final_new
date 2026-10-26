"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/action";
import type { Board, BoardRow } from "@/lib/live";
import { Alert, Badge, buttonClass, cx, fmtDate } from "./ui";
import { SignForm } from "./sign-form";
import { mmss, useLive, useTick } from "./use-live";

type Act = (prev: ActionState) => Promise<ActionState>;
type SignAct = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const CODE_VALID_MS = 10 * 60_000;
const STATUS_TONE = { PRESENT: "pine", LATE: "marigold", ABSENT: "brick", EXCUSED: "neutral", HOLIDAY: "neutral" } as const;
const STATUS_LABEL = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", EXCUSED: "Excused", HOLIDAY: "Holiday" } as const;

/**
 * The live attendance sheet for one class day: the 10-minute check-in code, every student's check-in,
 * time in/out and hours as they happen, the day's totals, and the instructor's daily signature.
 * Refreshes every 3 seconds while visible. Admins see the same board (they don't sign).
 */
export function LiveDayBoard({ classId, date, canSign, viewerName, start, close, complete, sign }: {
  classId: string; date: string; canSign: boolean; viewerName: string;
  start: Act; close: Act; complete: Act; sign: SignAct;
}) {
  const router = useRouter();
  const { data: b, failed, load, serverNow, updatedAt } = useLive<Board>(`/api/checkin/${classId}?date=${date}`, 3000);
  const [msg, setMsg] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const [projector, setProjector] = useState(false);
  useTick(250);

  // When the code runs out on screen, fetch the new state right away instead of waiting for the next poll.
  const msLeft = b?.checkIn.expiresAt ? b.checkIn.expiresAt - serverNow() : 0;
  const expiredFor = useRef<number | null>(null);
  useEffect(() => {
    if (b?.checkIn.open && msLeft <= 0 && expiredFor.current !== b.checkIn.expiresAt) {
      expiredFor.current = b.checkIn.expiresAt;
      load();
    }
  });

  function run(action: Act, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      try {
        setMsg((await action({})) ?? {});
      } catch {
        setMsg({ error: "Something went wrong. Try again." });
      }
      await load();
      router.refresh(); // the correction form below shows the new marks
    });
  }

  if (!b) {
    return <div className="mb-6 rounded-lg border border-line bg-white p-5 text-sm text-slate-600">{failed ? "Couldn't load live attendance. Retrying..." : "Loading live attendance..."}</div>;
  }

  const t = b.totals;
  const open = b.checkIn.open && msLeft > 0;
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  const showCodeControls = b.today && b.running && b.rows.length > 0 && !b.signoff;

  return (
    <section id="live" aria-labelledby="live-title" className="mb-6 rounded-lg border border-line bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="live-title" className="font-semibold">Attendance · {fmtDate(date)}{b.today && " (today)"}</h2>
          <p className="text-xs text-slate-600">
            {b.schedule.sessionStart
              ? `Class time ${b.schedule.sessionStart}–${b.schedule.sessionEnd}${b.schedule.breakStart ? `, break ${b.schedule.breakStart}–${b.schedule.breakEnd} (not counted)` : ""}.`
              : "No class times set: hours count from check-in to fill-out. Set class times in Class settings for exact counting."}
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-slate-600" aria-live="polite">
          <span className={cx("inline-block h-2 w-2 rounded-full", failed ? "bg-brick-600" : "bg-pine-600 animate-pulse")} aria-hidden />
          {failed ? "Reconnecting..." : `Live · updated ${ago ?? 0}s ago`}
        </p>
      </header>

      <dl className="grid grid-cols-3 gap-px border-b border-line bg-line text-center sm:grid-cols-6">
        {[
          ["Students", t.enrolled],
          ["Checked in", t.checkedIn],
          ["Filled out", t.filled],
          ["Waiting to fill", t.pending],
          ["Absent", t.absent],
          ["Total hours", t.hours.toFixed(2)],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-2 py-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-4 p-5">
        {msg.error && <Alert tone="error">{msg.error}</Alert>}
        {msg.ok && msg.message && <Alert tone="success">{msg.message}</Alert>}

        {showCodeControls && (
          open ? (
            <div className="grid gap-4 rounded-lg bg-pine-800 p-5 text-white md:grid-cols-[auto_1fr] md:items-center">
              <div className="text-center">
                <p className="text-xs uppercase tracking-wider text-white/70">Check-in code</p>
                <p className="mt-1 font-mono text-5xl font-bold tracking-[0.2em] tabular-nums">{b.checkIn.code}</p>
              </div>
              <div>
                <p className="text-sm">Works for <span className="font-mono text-2xl font-bold tabular-nums">{mmss(msLeft)}</span> more</p>
                <div className="mt-2 h-2 overflow-hidden rounded bg-white/20" aria-hidden>
                  <div className="h-full bg-marigold-500 transition-[width] duration-200" style={{ width: `${Math.min(100, (msLeft / CODE_VALID_MS) * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-white/80">
                  {b.checkIn.rounds > 1 ? `Code ${b.checkIn.rounds} of the day. ` : ""}On time until {b.checkIn.onTimeUntil}; check-ins after that are late.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setProjector(true)} className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-pine-800">Show full screen</button>
                  <button type="button" disabled={pending} onClick={() => run(close, "Stop the code now? Students who haven't checked in won't be able to.")} className="rounded-md border border-white/40 px-3 py-1.5 text-sm font-semibold">Close now</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line p-4">
              <p className="text-sm text-slate-700">
                {b.checkIn.rounds === 0
                  ? "Generate a code when class starts. It works for 10 minutes; students who check in with it are on time."
                  : `The last code has expired. On-time window ended at ${b.checkIn.onTimeUntil}.`}
              </p>
              <button type="button" disabled={pending} className={buttonClass(b.checkIn.rounds === 0 ? "primary" : "secondary")}
                onClick={() => run(start, b.checkIn.rounds === 0 ? undefined : "Issue a new 10-minute code for latecomers? Check-ins with it after the on-time window are marked late.")}>
                {pending ? "Working..." : b.checkIn.rounds === 0 ? "Generate check-in code (10 min)" : "New code for latecomers (10 min)"}
              </button>
            </div>
          )
        )}

        <RosterTable rows={b.rows} />

        <DayFooter b={b} canSign={canSign} viewerName={viewerName} sign={sign} pending={pending}
          onComplete={() => run(complete, b.today
            ? "Complete today now? Students who haven't checked in are marked absent, and students who checked in but didn't fill out get their time out set to now. Check-in closes."
            : "Complete this day? Students with no mark are marked absent, and students who didn't fill out get their time out set to the class end time.")} />
      </div>

      {projector && open && (
        <Projector code={b.checkIn.code ?? ""} msLeft={msLeft} className={b.className} checkedIn={t.checkedIn} enrolled={t.enrolled} onClose={() => setProjector(false)} />
      )}
    </section>
  );
}

function how(r: BoardRow): string {
  switch (r.state) {
    case "NOT_CHECKED_IN": return "Not checked in";
    case "CHECKED_IN": return r.record ? "In class, waiting to fill out" : "Checked in";
    case "FILLED": return `Filled by student${r.record?.filledAt ? ` at ${r.record.filledAt}` : ""}`;
    case "FILLED_BY_INSTRUCTOR": return "Time out filled by instructor";
    case "ABSENT": return r.record?.source === "AUTO_ABSENT" ? "Did not check in" : "Marked by staff";
    default: return "Entered by staff";
  }
}

function RosterTable({ rows }: { rows: BoardRow[] }) {
  if (!rows.length) return <p className="text-sm text-slate-600">No students were enrolled on this date.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-mist text-left text-xs font-semibold text-slate-600">
          <tr>{["Student", "Checked in", "Time in", "Break", "Time out", "Hours", "Status", ""].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.enrollmentId} className={cx(r.state === "CHECKED_IN" && "bg-marigold-100/30")}>
              <td className="px-3 py-2">
                <span className="font-semibold">{r.name}</span>
                {r.attention && <span className="mt-0.5 block text-xs font-medium text-marigold-700">{r.attention}</span>}
              </td>
              <td className="px-3 py-2 tabular-nums text-slate-700">{r.checkIn ? <>{r.checkIn.time}{r.checkIn.round > 1 && <span className="text-xs text-slate-500"> (code {r.checkIn.round})</span>}</> : "–"}</td>
              <td className="px-3 py-2 tabular-nums">{r.record?.startTime || "–"}</td>
              <td className="px-3 py-2 tabular-nums text-slate-600">{r.record?.lunchOut ? `${r.record.lunchOut}–${r.record.lunchIn}` : "–"}</td>
              <td className="px-3 py-2 tabular-nums">{r.record?.endTime || "–"}</td>
              <td className="px-3 py-2 tabular-nums font-semibold">{r.record ? (r.record.minutes / 60).toFixed(2) : "–"}</td>
              <td className="px-3 py-2">{r.record ? <Badge tone={STATUS_TONE[r.record.status]}>{STATUS_LABEL[r.record.status]}</Badge> : <Badge>No mark</Badge>}</td>
              <td className="px-3 py-2 text-xs text-slate-600">{how(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayFooter({ b, canSign, viewerName, sign, pending, onComplete }: {
  b: Board; canSign: boolean; viewerName: string; sign: SignAct; pending: boolean; onComplete: () => void;
}) {
  const t = b.totals;
  const needsCompleting = t.pending > 0 || t.unmarked > 0;
  const summary = `${t.present} present, ${t.late} late, ${t.absent} absent${t.excused ? `, ${t.excused} excused` : ""}; ${t.hours.toFixed(2)} hours in total`;
  return (
    <div className="space-y-3 border-t border-line pt-4">
      {b.signoff && (
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.signoff.imageDataUrl} alt={`Signature of ${b.signoff.signerName}`} className="h-14 rounded border border-line bg-white" />
          <div className="text-sm">
            <p className="font-semibold">Signed by {b.signoff.signerName}</p>
            <p className="text-slate-600">{b.signoff.signedAt}{b.signoff.history ? ` · signed ${b.signoff.history + 1} times` : ""}</p>
          </div>
          {b.signoff.current ? <Badge tone="pine">Signed and current</Badge> : <Badge tone="brick">Changed after signing</Badge>}
        </div>
      )}
      {b.signoff && !b.signoff.current && <Alert tone="warning">Marks changed after this day was signed. The instructor needs to review and sign again.</Alert>}

      {needsCompleting && (!b.today || b.checkIn.rounds > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-mist p-3">
          <p className="text-sm">{b.signBlockers.join(" ")}</p>
          <button type="button" disabled={pending} onClick={onComplete} className={buttonClass("secondary")}>{pending ? "Working..." : "Complete the day"}</button>
        </div>
      )}

      {canSign && (!b.signoff || !b.signoff.current) && (
        b.signBlockers.length === 0 ? (
          <div className="rounded-md border border-line p-4">
            <h3 className="mb-2 font-semibold">{b.signoff ? "Sign again" : "Sign today's attendance"}</h3>
            <SignForm key={`${b.date}:${b.signoff?.signedAt ?? ""}`} action={sign} defaultName={viewerName} label="Sign attendance for this day"
              statement={`I confirm the attendance above for ${b.className} on ${b.date} is accurate: ${summary}.`} />
          </div>
        ) : !needsCompleting ? <Alert tone="info">Before signing: {b.signBlockers.join(" ")}</Alert> : null
      )}
      {!canSign && !b.signoff && b.signBlockers.length === 0 && <p className="text-sm text-slate-600">Ready for the instructor to sign: {summary}.</p>}
    </div>
  );
}

/** Full-screen code for a projector or TV. Esc or the button closes it. */
function Projector({ code, msLeft, className, checkedIn, enrolled, onClose }: {
  code: string; msLeft: number; className: string; checkedIn: number; enrolled: number; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Check-in code" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-pine-900 p-6 text-center text-white">
      <p className="text-xl text-white/80">{className}</p>
      <p className="mt-2 text-lg text-white/70">Check in on your phone with this code</p>
      <p className="my-6 font-mono text-[min(18vw,14rem)] font-bold leading-none tracking-[0.15em] tabular-nums">{code}</p>
      <p className="text-3xl font-semibold tabular-nums">{mmss(msLeft)}</p>
      <p className="mt-4 text-lg text-white/80">{checkedIn} of {enrolled} checked in</p>
      <button type="button" onClick={onClose} className="mt-10 rounded-md border border-white/40 px-5 py-2 font-semibold">Close full screen (Esc)</button>
    </div>
  );
}
