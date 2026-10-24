"use client";

import { ActionForm, Field, Submit } from "@/components/forms";
import { reportPaymentAction } from "../actions";

export function PaymentReportForm() {
  return (
    <ActionForm action={reportPaymentAction} className="space-y-4">
      <Field name="reference" label="Receipt or confirmation number" required maxLength={200} help="From your receipt, money order or online payment confirmation." />
      <Submit variant="secondary">Send to the office for verification</Submit>
    </ActionForm>
  );
}
