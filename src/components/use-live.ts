"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls a JSON endpoint while the tab is visible (and right away when it becomes visible again).
 * Every response carries the server's clock (`serverNow`); the hook keeps the offset to the device's
 * clock (corrected for half the round trip), so countdowns are exact even if the device clock is wrong.
 */
export function useLive<T extends { serverNow: number }>(url: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const offset = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const t0 = Date.now();
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const json = (await r.json()) as T;
      const t1 = Date.now();
      offset.current = json.serverNow - (t0 + t1) / 2;
      setData(json);
      setFailed(false);
      setUpdatedAt(t1);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  }, [url]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, intervalMs);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  }, [load, intervalMs]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);
  return { data, failed, load, serverNow, updatedAt };
}

/** Re-renders every `ms` (for countdowns and "updated 3s ago"). */
export function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** 9:41 -> "9:41"; 65_000 ms -> "1:05". Never negative. */
export function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
