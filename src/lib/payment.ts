// Pure rules for Private tuition payment (no DB, no secrets) so they can be unit-tested.
import type { Application } from "@/db/types";

export type PaymentGate = "BEFORE_FORMS" | "BEFORE_SUBMIT" | "BEFORE_APPROVAL";

/** Read without full env validation so pure modules and tests can use it. */
export function paymentGate(): PaymentGate {
  const v = process.env.PRIVATE_PAYMENT_GATE;
  return v === "BEFORE_SUBMIT" || v === "BEFORE_APPROVAL" ? v : "BEFORE_FORMS";
}

type PaymentFields = Pick<Application, "category" | "paymentStatus">;

/** Verified by an admin (PAID) or waived. Never set from the student's side. */
export const paymentSettled = (a: PaymentFields) => a.category !== "PRIVATE" || a.paymentStatus === "PAID" || a.paymentStatus === "WAIVED";

/** Private student must pay before opening the forms. */
export const formsBlockedByPayment = (a: PaymentFields, gate: PaymentGate = paymentGate()) =>
  a.category === "PRIVATE" && gate === "BEFORE_FORMS" && !paymentSettled(a);

/** Private student must pay before submitting. */
export const submitBlockedByPayment = (a: PaymentFields, gate: PaymentGate = paymentGate()) =>
  a.category === "PRIVATE" && gate !== "BEFORE_APPROVAL" && !paymentSettled(a);

/** Approval of a Private application always needs a settled payment. */
export const approvalBlockedByPayment = (a: PaymentFields) => a.category === "PRIVATE" && !paymentSettled(a);
