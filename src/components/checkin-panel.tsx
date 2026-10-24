"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/action";
import { Alert, Badge, buttonClass } from "@/components/ui";

type Entry = { name: string; time: string; status: "PRESENT" | "LATE"; sameDeviceAs: string[] };
type State = {
  exists: boolean; open: boolean; code: string | null; secondsLeft: number | null; lateAfterMinutes: number | null;
  openedAt: string | null; closesAt: string | null; enrolled: number; entries: Entry[];
};
type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const POLL_MS = 3000;

export function CheckInPanel({ classId, start, close }: { classId: string; start: Act; close: Act }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const [late, setLate] = useState("10");
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/checkin/${classId}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setState(await r.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [classId]);

  // Poll only while the tab is visible, and refresh immediately when it becomes visible again.
  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // Local one-second countdown between polls.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setTick(0), [state?.code]);

  function run(action: Act, fd: FormData) {
    startTransition(async () => {
      const res = (await action({}, fd)) ?? {};
      setMsg(res);
      await load();
      router.refresh(); // update the attendance sheet below with the latest check-ins
    });
  }

  if (!state) return <div className="mb-6 rounded-lg border border-line bg-white p-5 text-sm text-slate-600">{failed ? "Couldn't load check-in. Retrying..." : "Loading check-in..."}</div>;

  const secondsLeft = state.secondsLeft ? Math.max(1, state.secondsLeft - tick) : null;
  const flagged = state.entries.filter((e) => e.sameDeviceAs.length);

  return (
    <section aria-labelledby="checkin-title" className="mb-6 rounded-lg border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="checkin-title" className="font-semibold">Student check-in (today)</h2>
          <p className="text-sm text-slate-600">
            {state.open
              ? `Open since ${state.openedAt}. Students checking in more than ${state.lateAfterMinutes} min after opening are marked late. Closes by itself at ${state.closesAt}.`
              : state.exists
                ? "Closed. You can reopen it; check-ins so far are kept."
                : "Students check in on their phones with a code that changes every 30 seconds."}
          </p>
        </div>
        <p className="text-sm font-semibold tabular-nums" aria-live="polite">{state.entries.length} of {state.enrolled} checked in</p>
      </div>

      {msg.error && <div className="mt-3"><Alert tone="error">{msg.error}</Alert></div>}
      {failed && <div className="mt-3"><Alert tone="warning">Connection problem. The code below may be out of date; retrying...</Alert></div>}

      {state.open ? (
        <div className="mt-4 grid gap-5 md:grid-cols-[auto_1fr]">
          <div className="rounded-lg bg-pine-800 px-8 py-6 text-center text-white">
            <p className="text-xs uppercase tracking-wider text-white/70">Check-in code</p>
            <p className="mt-1 font-mono text-5xl font-bold tracking-[0.2em] tabular-nums" aria-live="off">{state.code}</p>
            <p className="mt-2 text-xs text-white/70">New code in {secondsLeft}s</p>
          </div>
          <div className="min-w-0">
            {flagged.length > 0 && (
              <div className="mb-3"><Alert tone="warning">Same phone used by more than one student: {flagged.map((e) => `${e.name} (with ${e.sameDeviceAs.join(", ")})`).join("; ")}. Check they're in the room.</Alert></div>
            )}
            <EntryList entries={state.entries} />
            <button type="button" disabled={pending} onClick={() => run(close, new FormData())} className={buttonClass("secondary") + " mt-4"}>
              {pending ? "Working..." : "Close check-in"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          {state.entries.length > 0 && <div className="mb-4"><EntryList entries={state.entries} /></div>}
          <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(); fd.set("lateAfterMinutes", late); run(start, fd); }} className="flex flex-wrap items-end gap-3">
            {!state.exists && (
              <div className="space-y-1.5">
                <label htmlFor="late" className="block text-sm font-medium">Late after (minutes)</label>
                <input id="late" type="number" min={0} max={120} value={late} onChange={(e) => setLate(e.target.value)} className="w-24 rounded-md border border-line px-2 py-1.5" />
              </div>
            )}
            <button type="submit" disabled={pending} className={buttonClass("primary")}>{pending ? "Working..." : state.exists ? "Reopen check-in" : "Start check-in"}</button>
          </form>
        </div>
      )}
    </section>
  );
}

function EntryList({ entries }: { entries: Entry[] }) {
  if (!entries.length) return <p className="text-sm text-slate-600">No one has checked in yet.</p>;
  return (
    <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line text-sm">
      {entries.map((e, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="font-medium">{e.name}{e.sameDeviceAs.length > 0 && <span className="ml-2 text-xs text-marigold-700">same phone as {e.sameDeviceAs.join(", ")}</span>}</span>
          <span className="flex items-center gap-2 tabular-nums text-slate-600">{e.time}<Badge tone={e.status === "LATE" ? "marigold" : "pine"}>{e.status === "LATE" ? "Late" : "On time"}</Badge></span>
        </li>
      ))}
    </ul>
  );
}
