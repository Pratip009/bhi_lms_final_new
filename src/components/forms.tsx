"use client";

import { createContext, useContext, useState, useTransition, type ReactNode, type FormEvent } from "react";
import type { ActionState } from "@/lib/action";
import { Alert, buttonClass, cx, type ButtonVariant } from "./ui";

const Ctx = createContext<{ state: ActionState; pending: boolean }>({ state: {}, pending: false });

/**
 * Form that calls a server action without resetting the user's input on errors.
 * Server actions may redirect(); Next.js handles that navigation automatically.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  resetOnSuccess,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (confirm && !window.confirm(confirm)) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    start(async () => {
      try {
        const res = (await action(state, fd)) ?? {};
        setState(res);
        if (res.ok && resetOnSuccess) form.reset();
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) throw err;
        setState({ error: "Something went wrong. Try again." });
      }
    });
  }
  return (
    <Ctx.Provider value={{ state, pending }}>
      <form onSubmit={onSubmit} className={className} noValidate>
        {state.error && <div className="mb-4"><Alert tone="error">{state.error}</Alert></div>}
        {state.ok && state.message && <div className="mb-4"><Alert tone="success">{state.message}</Alert></div>}
        <fieldset disabled={pending} className="contents">{children}</fieldset>
      </form>
    </Ctx.Provider>
  );
}

export function useFormCtx() {
  return useContext(Ctx);
}

export function Submit({ children, variant = "primary", name, value, className }: { children: ReactNode; variant?: ButtonVariant; name?: string; value?: string; className?: string }) {
  const { pending } = useFormCtx();
  return (
    <button type="submit" name={name} value={value} className={buttonClass(variant, className)} aria-busy={pending}>
      {pending ? "Working..." : children}
    </button>
  );
}

const inputCls =
  "block w-full rounded-md border border-line bg-white px-3 py-2 text-[0.95rem] text-ink placeholder:text-slate-400 focus:border-pine-600 focus:outline-none focus:ring-2 focus:ring-pine-100 aria-[invalid=true]:border-brick-600";

type FieldProps = {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  help?: string;
  options?: string[];
  autoComplete?: string;
  maxLength?: number;
  inputMode?: "numeric" | "decimal" | "text" | "email" | "tel";
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
};

export function Field(p: FieldProps) {
  const { state } = useFormCtx();
  const err = state.fieldErrors?.[p.name];
  const id = `f-${p.name}`;
  const common = {
    id,
    name: p.name,
    "aria-invalid": err ? true : undefined,
    "aria-describedby": err ? `${id}-err` : p.help ? `${id}-help` : undefined,
    defaultValue: p.defaultValue,
    readOnly: p.readOnly,
  };
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {p.label}
        {p.required && <span className="text-brick-600"> *</span>}
      </label>
      {p.type === "textarea" ? (
        <textarea {...common} rows={p.rows ?? 4} maxLength={p.maxLength} className={inputCls} />
      ) : p.type === "select" ? (
        <select {...common} className={inputCls}>
          <option value="">Choose...</option>
          {p.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          {...common}
          type={p.type ?? "text"}
          autoComplete={p.autoComplete}
          maxLength={p.maxLength}
          inputMode={p.inputMode}
          placeholder={p.placeholder}
          className={inputCls}
        />
      )}
      {p.help && !err && <p id={`${id}-help`} className="text-xs text-slate-500">{p.help}</p>}
      {err && <p id={`${id}-err`} className="text-xs font-medium text-brick-600">{err}</p>}
    </div>
  );
}

export function Checkbox({ name, label, defaultChecked, required }: { name: string; label: string; defaultChecked?: boolean; required?: boolean }) {
  const { state } = useFormCtx();
  const err = state.fieldErrors?.[name];
  return (
    <div>
      <label className={cx("flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm", err ? "border-brick-600" : "border-line")}>
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-pine-700" />
        <span>{label}{required && <span className="text-brick-600"> *</span>}</span>
      </label>
      {err && <p className="mt-1 text-xs font-medium text-brick-600">{err}</p>}
    </div>
  );
}
