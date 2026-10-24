"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/action";
import { ActionForm, Submit, useFormCtx } from "@/components/forms";
import { setCategoryAction } from "./actions";

type Current = { enrollmentType: string | null; fundingProgram: string | null; county: string | null };

const card = "flex cursor-pointer flex-col gap-1 rounded-lg border border-line bg-white p-4 has-[:checked]:border-pine-700 has-[:checked]:ring-2 has-[:checked]:ring-pine-100";

function Err({ name }: { name: string }) {
  const { state } = useFormCtx();
  const e = state.fieldErrors?.[name];
  return e ? <p className="mt-2 text-xs font-medium text-brick-600">{e}</p> : null;
}

function Choices({ current }: { current: Current }) {
  const [type, setType] = useState(current.enrollmentType ?? "");
  const [program, setProgram] = useState(current.fundingProgram ?? "");
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">1. Enrollment type</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={card}>
            <span className="flex items-center gap-2 font-semibold">
              <input type="radio" name="enrollmentType" value="PRIVATE" checked={type === "PRIVATE"} onChange={() => setType("PRIVATE")} className="accent-pine-700" />
              Private
            </span>
            <span className="text-sm text-slate-600">You pay tuition yourself.</span>
          </label>
          <label className={card}>
            <span className="flex items-center gap-2 font-semibold">
              <input type="radio" name="enrollmentType" value="NON_PRIVATE" checked={type === "NON_PRIVATE"} onChange={() => setType("NON_PRIVATE")} className="accent-pine-700" />
              Non-Private
            </span>
            <span className="text-sm text-slate-600">Your training is funded by an agency program.</span>
          </label>
        </div>
        <Err name="enrollmentType" />
      </fieldset>

      {type === "NON_PRIVATE" && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">2. Funding program</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={card}>
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="fundingProgram" value="EQISS" checked={program === "EQISS"} onChange={() => setProgram("EQISS")} className="accent-pine-700" />
                EQISS / One-Stop
              </span>
            </label>
            <label className={card}>
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="fundingProgram" value="DFS" checked={program === "DFS"} onChange={() => setProgram("DFS")} className="accent-pine-700" />
                DFS
              </span>
              <span className="text-sm text-slate-600">Department of Family Services</span>
            </label>
          </div>
          <Err name="fundingProgram" />
        </fieldset>
      )}

      {type === "NON_PRIVATE" && program === "EQISS" && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">3. County</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {[["HUDSON", "Hudson County"], ["BERGEN", "Bergen County"], ["SOMERSET", "Somerset County"]].map(([v, l]) => (
              <label key={v} className={card}>
                <span className="flex items-center gap-2 font-semibold">
                  <input type="radio" name="county" value={v} defaultChecked={current.county === v} className="accent-pine-700" />
                  {l}
                </span>
              </label>
            ))}
          </div>
          <Err name="county" />
        </fieldset>
      )}
    </div>
  );
}

export function CategoryForm({ current, hasAnswers, action, submitLabel }: {
  current: Current; hasAnswers: boolean; action?: (p: ActionState, fd: FormData) => Promise<ActionState>; submitLabel?: string;
}) {
  return (
    <ActionForm action={action ?? setCategoryAction} className="space-y-5"
      confirm={current.enrollmentType && hasAnswers ? "Changing your enrollment type or program removes answers, signatures and files that only apply to your current choice. Continue?" : undefined}>
      <Choices current={current} />
      <Submit>{submitLabel ?? (current.enrollmentType ? "Save and continue" : "Continue")}</Submit>
    </ActionForm>
  );
}
