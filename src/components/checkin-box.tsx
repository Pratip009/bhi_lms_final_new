"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/action";
import type { StudentDayState } from "@/lib/live";
import { Alert, buttonClass } from "./ui";
import { mmss, useLive, useTick } from "./use-live";

type CheckInAct = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type FillAct = (prev: ActionState) => Promise<ActionState>;

/**
 * Student, for one class today: enter the instructor's code while it's valid (live countdown), then
 * press "Fill my attendance" at the end of class. Updates itself every few seconds, so the code box
 * appears as soon as the instructor issues a code.
 */
export function CheckInBox({ classId, checkIn, fill }: { classId: string; checkIn: CheckInAct; fill: FillAct }) {
  const router = useRouter();
  const { data: s, load, serverNow } = useLive<StudentDayState>(`/api/checkin/${classId}/me`, 5000);
  const [msg, setMsg] = useState<ActionState>({});
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  useTick(500);

  if (!s || !s.runsToday) return null;
  const left = s.expiresAt ? s.expiresAt - serverNow() : 0;

  function submitCode(e: FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("code", code);
    startTransition(async () => {
      try {
        const res = (await checkIn({}, fd)) ?? {};
        setMsg(res);
        if (res.ok) setCode("");
      } catch {
        setMsg({ error: "Something went wrong. Try again." });
      }
      await load();
      router.refresh();
    });
  }

  function pressFill() {
    const now = new Date(serverNow()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const end = s?.schedule.sessionEnd ? ` Class ends at ${s.schedule.sessionEnd}.` : "";
    if (!window.confirm(`Fill out today's attendance with time out now (${now})?${end}\n\nOnly do this when class is over. You can't change it afterwards.`)) return;
    startTransition(async () => {
      try {
        setMsg((await fill({})) ?? {});
      } catch {
        setMsg({ error: "Something went wrong. Try again." });
      }
      await load();
      router.refresh();
    });
  }

  const feedback = (
    <>
      {msg.error && <div className="mb-2"><Alert tone="error">{msg.error}</Alert></div>}
      {msg.ok && msg.message && <div className="mb-2"><Alert tone="success">{msg.message}</Alert></div>}
    </>
  );

  // 1. Done for today.
  if (s.filled) {
    return (
      <div role="status" className="rounded-md border border-pine-100 bg-pine-50 px-4 py-3 text-sm text-pine-900">
        <p className="font-semibold">Today's attendance is filled out{s.filled.byInstructor ? " (by your instructor)" : ""}</p>
        <p className="mt-0.5 tabular-nums">
          {s.filled.startTime}–{s.filled.endTime}{s.filled.lunchOut ? `, break ${s.filled.lunchOut}–${s.filled.lunchIn} not counted` : ""} · {s.filled.hours.toFixed(2)} h
        </p>
        <p className="mt-0.5 text-xs">{s.signed ? "Signed by your instructor." : "Your instructor will sign today's sheet."}</p>
      </div>
    );
  }
  // 2. Checked in: waiting for the end of class.
  if (s.checkedIn) {
    return (
      <div className="rounded-md border border-pine-100 bg-pine-50 px-4 py-3 text-sm text-pine-900">
        {feedback}
        <p className="font-semibold">Checked in at {s.checkedIn.time}{s.checkedIn.late ? " (late)" : " (on time)"}</p>
        {s.canFill ? (
          <>
            <p className="mt-1 text-xs">When class is over, press the button to fill out today's attendance. No signature needed.</p>
            <button type="button" disabled={pending} onClick={pressFill} className={buttonClass("primary", "mt-3 w-full sm:w-auto")}>
              {pending ? "Filling..." : "Fill my attendance"}
            </button>
          </>
        ) : (
          <p className="mt-1 text-xs">{s.signed ? "Today's sheet is already signed. Ask your instructor about any change." : "Your instructor is completing today's sheet."}</p>
        )}
      </div>
    );
  }

  // 3. A code is valid now.
  if (s.open && left > 0) {
    return (
      <div className="rounded-md border border-marigold-100 bg-marigold-100/40 px-4 py-3">
        {feedback}
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">Check-in is open</p>
          <p className="text-sm tabular-nums">Code works for <span className="font-mono font-bold">{mmss(left)}</span></p>
        </div>
        <form onSubmit={submitCode} className="mt-2 flex flex-wrap items-end gap-2" noValidate>
          <label className="w-40">
            <span className="mb-1 block text-xs text-slate-600">6-digit code</span>
            <input name="code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} required className="block w-full rounded-md border border-line px-3 py-2 font-mono text-lg tracking-widest" aria-invalid={!!msg.fieldErrors?.code} />
          </label>
          <button type="submit" disabled={pending || code.length !== 6} className={buttonClass("primary")}>{pending ? "Checking..." : "Check in"}</button>
        </form>
        {msg.fieldErrors?.code && <p className="mt-1 text-xs font-medium text-brick-600">{msg.fieldErrors.code}</p>}
      </div>
    );
  }

  // 4. Recorded by staff (e.g. absent, excused).
  if (s.recorded) {
    const label = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", EXCUSED: "Excused", HOLIDAY: "Holiday", SICK: "Sick" }[s.recorded.status];
    return (
      <div role="status" className="rounded-md border border-line bg-mist px-4 py-3 text-sm">
        <p className="font-semibold">Today: {label}{s.recorded.hours ? `, ${s.recorded.hours.toFixed(2)} h` : ""}</p>
        <p className="mt-0.5 text-xs text-slate-600">Recorded by your instructor{s.signed ? " and signed" : ""}.</p>
      </div>
    );
  }

  // 5. Code issued earlier and expired, and this student didn't check in.
  if (s.sessionExists) {
    return (
      <div className="rounded-md border border-line bg-mist px-4 py-3 text-sm">
        {feedback}
        <p className="font-semibold">No valid check-in code right now</p>
        <p className="mt-0.5 text-xs text-slate-600">Codes work for 10 minutes. Missed it, or no phone with you? Tell your instructor; they'll mark you on the attendance sheet.</p>
      </div>
    );
  }
  return null;
}
