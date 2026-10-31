// Pure rules for Private tuition payment (no DB, no secrets) so they can be unit-tested.
import type { Application } from "@/db/types";

/**
 * When a Private student's payment is required. BHI's workflow is: register → choose Private and a
 * course → pay online (Stripe) → the Common and Private forms open → submit → admin decision. So the
 * gate is "before forms": forms, uploads and submission stay closed until the payment is confirmed
 * (or the office records it as paid in person, or waives it). The other values are kept only so older
 * settings and tests still read sensibly.
 */
export type PaymentGate = "BEFORE_FORMS" | "BEFORE_SUBMIT" | "BEFORE_APPROVAL";

export function paymentGate(): PaymentGate {
  return "BEFORE_FORMS";
}

type PaymentFields = Pick<Application, "category" | "paymentStatus">;

/** Paid (online or verified by an admin) or waived. Never set from the student's side. */
export const paymentSettled = (a: PaymentFields) => a.category !== "PRIVATE" || a.paymentStatus === "PAID" || a.paymentStatus === "WAIVED";

/** Private student must pay before opening the forms. */
export const formsBlockedByPayment = (a: PaymentFields, gate: PaymentGate = paymentGate()) =>
  a.category === "PRIVATE" && gate === "BEFORE_FORMS" && !paymentSettled(a);

/** Private student must pay before submitting (only with a legacy gate). */
export const submitBlockedByPayment = (a: PaymentFields, gate: PaymentGate = paymentGate()) =>
  a.category === "PRIVATE" && gate !== "BEFORE_APPROVAL" && !paymentSettled(a);

/** Approval of a Private application always needs a settled payment. */
export const approvalBlockedByPayment = (a: PaymentFields) => a.category === "PRIVATE" && !paymentSettled(a);

/** Stripe's minimum card charge is $0.50; the maximum here guards against typos (an extra zero). */
export const MIN_PAYMENT_CENTS = 50;
export const MAX_PAYMENT_CENTS = 5_000_000; // $50,000

/**
 * "1500", "1,500.00", "$1500.5" -> 150000 / 150000 / 150050 cents. Returns null for anything that
 * isn't a plain dollar amount with at most 2 decimals, or is outside the allowed range.
 * Parsed as text (not floating point), so 0.1 + 0.2 style errors can't happen.
 */
export function parseUsdToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents >= MIN_PAYMENT_CENTS && cents <= MAX_PAYMENT_CENTS ? cents : null;
}

/** 150050 -> "$1,500.50". */
export const formatUsd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
