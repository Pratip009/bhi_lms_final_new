import { cx } from "./ui";

export const JOURNEY = ["Create account", "Enroll", "Admin approval", "Class assignment", "Dashboard"] as const;

/** The student's path, shown as a vertical rail. `current` is the index of the active step. */
export function Journey({ current, tone = "light" }: { current: number; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <ol className="relative space-y-5" aria-label="Enrollment progress">
      {JOURNEY.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="relative flex items-center gap-3 pl-0" aria-current={active ? "step" : undefined}>
            {i < JOURNEY.length - 1 && (
              <span aria-hidden className={cx("absolute left-[11px] top-6 h-5 w-0.5", done ? (dark ? "bg-marigold-500" : "bg-pine-600") : dark ? "bg-white/20" : "bg-line")} />
            )}
            <span
              aria-hidden
              className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold",
                done && (dark ? "border-marigold-500 bg-marigold-500 text-pine-900" : "border-pine-600 bg-pine-600 text-white"),
                active && (dark ? "border-marigold-500 text-marigold-500" : "border-pine-700 text-pine-700"),
                !done && !active && (dark ? "border-white/30 text-white/40" : "border-line text-slate-400"),
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={cx("text-sm", active ? "font-semibold" : "", dark ? (active ? "text-white" : "text-white/70") : active ? "text-ink" : "text-slate-500")}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
