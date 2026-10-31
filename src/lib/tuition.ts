import "server-only";
import Stripe from "stripe";
import { cols, newId, type Application, type PaymentRequest } from "@/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { formatUsd } from "@/lib/payment";
import { notifyAdminsPayment, sendPaymentReceivedEmail, trySend } from "@/lib/email";

/**
 * Online tuition payment for Private students, with Stripe Checkout (Stripe's hosted payment page:
 * card details never reach this server).
 *
 * Flow: a Private student chooses a course → presses "Pay" → a payment for that course's tuition and
 * fees is opened and a Checkout session created for exactly that amount → Stripe confirms the payment
 * to /api/stripe/webhook (and the student's return to /application/paid checks it too) →
 * settleCheckoutSession() marks it paid once → the enrollment forms open. Payment never approves an
 * application; the office reviews and approves it after the student submits.
 */

let client: Stripe | null = null;
export const stripeEnabled = () => !!env().STRIPE_SECRET_KEY;
export function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("Online payment isn't set up (STRIPE_SECRET_KEY is empty).");
  client ??= new Stripe(key, { appInfo: { name: "BHI LMS" }, maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

const adminEmails = async () =>
  (await (await cols()).users.find({ role: "ADMIN", disabledAt: null }, { projection: { email: 1 } }).toArray()).map((a) => a.email);

/** True when the current request is waiting for the student's payment. */
export const requestOpen = (app: Pick<Application, "category" | "paymentStatus" | "paymentRequest">) =>
  app.category === "PRIVATE" && app.paymentStatus === "REQUESTED" && app.paymentRequest?.status === "OPEN";

/**
 * Stops a Checkout session from taking a payment (when a request is cancelled or replaced).
 * Returns "PAID" if the student had already paid in it: the caller must then settle, not cancel.
 */
export async function closeCheckout(sessionId: string | null | undefined): Promise<"CLOSED" | "PAID"> {
  if (!sessionId || !stripeEnabled()) return "CLOSED";
  const s = await stripe().checkout.sessions.retrieve(sessionId);
  if (s.status === "complete") return s.payment_status === "unpaid" ? "CLOSED" : "PAID";
  if (s.status === "open") await stripe().checkout.sessions.expire(sessionId);
  return "CLOSED";
}

export type SettleResult =
  | { state: "PAID"; applicationId: string; approved: false; message: string }
  | { state: "PROCESSING" | "NOT_PAID" | "IGNORED"; applicationId?: string; message: string };

/**
 * Records a completed Checkout session. Safe to call any number of times for the same session (Stripe
 * retries webhooks, and the student's return page calls it too): the payment is recorded once, by a
 * conditional update, and approval is itself conditional.
 */
export async function settleCheckoutSession(session: Stripe.Checkout.Session, via: "webhook" | "return"): Promise<SettleResult> {
  const applicationId = session.metadata?.applicationId;
  const requestId = session.metadata?.requestId;
  if (!applicationId || !requestId) return { state: "IGNORED", message: "Not a tuition payment." };
  if (session.payment_status === "unpaid") {
    return session.status === "complete"
      ? { state: "PROCESSING", applicationId, message: "Your payment is processing. We'll email you when it's confirmed." }
      : { state: "NOT_PAID", applicationId, message: "The payment wasn't completed." };
  }

  const { applications, users } = await cols();
  const app = await applications.findOne({ _id: applicationId });
  if (!app) return { state: "IGNORED", message: "Unknown application." };
  const student = await users.findOne({ _id: app.studentId }, { projection: { name: 1, email: 1 } });
  const studentName = student?.name ?? "A student";
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const paid = session.amount_total ?? 0;
  const current = app.paymentRequest?.id === requestId ? app.paymentRequest : null;
  const now = new Date();

  // Money arrived for a request that isn't the current one (cancelled or replaced after the student
  // opened the payment page). Never lost silently: recorded and the office is told to sort it out.
  if (!current || current.status === "CANCELLED") {
    // (A student changed course after opening a payment page for the earlier one, or the office cancelled it.)
    const known = await audits(applicationId, "application.payment_unexpected", session.id);
    if (!known) {
      await audit(null, "application.payment_unexpected", "application", applicationId, { sessionId: session.id, paymentIntent, amountCents: paid, requestId, via });
      await notifyAdminsPayment(await adminEmails(), studentName, applicationId, "Payment for a cancelled request",
        `${formatUsd(paid)} was paid online for a payment request that had been cancelled or replaced. Refund it in Stripe, or mark the tuition paid.`);
    }
    return { state: "IGNORED", applicationId, message: "This payment request was cancelled. The office has been told about your payment and will contact you." };
  }
  if (session.currency !== "usd" || paid !== current.amountCents) {
    // Cannot happen with sessions this app creates; checked anyway so a wrong amount never approves anyone.
    await audit(null, "application.payment_mismatch", "application", applicationId, { sessionId: session.id, paid, expected: current.amountCents, currency: session.currency });
    await notifyAdminsPayment(await adminEmails(), studentName, applicationId, "Payment amount mismatch",
      `Stripe reported ${formatUsd(paid)} but the request was for ${formatUsd(current.amountCents)}. Check it in Stripe.`);
    return { state: "IGNORED", applicationId, message: "We couldn't match your payment. The office will contact you." };
  }

  const res = await applications.updateOne(
    { _id: applicationId, "paymentRequest.id": requestId, paymentStatus: { $nin: ["PAID", "WAIVED"] } },
    {
      $set: {
        paymentStatus: "PAID", paymentReference: paymentIntent, paymentVerifiedAt: now, paymentVerifiedById: null,
        "paymentRequest.status": "PAID", "paymentRequest.paidAt": now, "paymentRequest.amountPaidCents": paid,
        "paymentRequest.stripePaymentIntentId": paymentIntent, "paymentRequest.checkoutSessionId": session.id, updatedAt: now,
      },
    },
  );
  if (res.modifiedCount) {
    await audit(null, "application.payment_received", "application", applicationId, { amountCents: paid, paymentIntent, sessionId: session.id, via });
    const course = app.courseId ? await (await cols()).courses.findOne({ _id: app.courseId }, { projection: { name: 1 } }) : null;
    if (student) await trySend(() => sendPaymentReceivedEmail(student.email, student.name, formatUsd(paid), course?.name ?? "your course"));
    await notifyAdminsPayment(await adminEmails(), studentName, applicationId, "Tuition paid online", `${formatUsd(paid)} received through Stripe.`);
  } else if (current.checkoutSessionId && current.checkoutSessionId !== session.id && current.stripePaymentIntentId !== paymentIntent) {
    // Already paid, and this is a second, different payment (e.g. two browser tabs): flag for a refund.
    const known = await audits(applicationId, "application.payment_duplicate", session.id);
    if (!known) {
      await audit(null, "application.payment_duplicate", "application", applicationId, { sessionId: session.id, paymentIntent, amountCents: paid });
      await notifyAdminsPayment(await adminEmails(), studentName, applicationId, "Duplicate tuition payment",
        `A second payment of ${formatUsd(paid)} was made. Refund one of them in Stripe.`);
    }
  }

  return {
    state: "PAID", applicationId, approved: false,
    message: "Payment received. Your enrollment forms are now open.",
  };
}

/** Has this event for this Checkout session already been logged? (keeps alerts to one per problem) */
async function audits(applicationId: string, action: string, sessionId: string) {
  const { auditLogs } = await cols();
  return (await auditLogs.countDocuments({ entity: "application", entityId: applicationId, action, "meta.sessionId": sessionId }, { limit: 1 })) > 0;
}

/** The request the student pays now, with the course name for the Stripe line item. */
export async function checkoutTarget(app: Application): Promise<{ request: PaymentRequest; courseName: string } | null> {
  if (!requestOpen(app) || !app.paymentRequest) return null;
  const course = app.courseId ? await (await cols()).courses.findOne({ _id: app.courseId }, { projection: { name: 1 } }) : null;
  return { request: app.paymentRequest, courseName: course?.name ?? "Tuition" };
}

/** Tuition and fees for a Private student's chosen course, in cents (0 = not set; the office must set it). */
export async function amountDueCents(app: Pick<Application, "courseId">): Promise<{ cents: number; courseName: string } | null> {
  if (!app.courseId) return null;
  const course = await (await cols()).courses.findOne({ _id: app.courseId }, { projection: { name: 1, fees: 1 } });
  if (!course) return null;
  const f = course.fees;
  const cents = f ? f.tuitionCents + f.feesCents + f.booksCents + f.toolsCents + f.otherCents : Math.round(env().PRIVATE_TUITION_USD * 100);
  return { cents, courseName: course.name };
}

/**
 * The open payment for the student's current course, created (or replaced, if the course or amount
 * changed) as needed. Returns "PAID" if an earlier payment page turns out to have been paid already.
 */
export async function openPaymentForCourse(app: Application, studentId: string): Promise<{ request: PaymentRequest; courseName: string } | { error: string } | "PAID"> {
  if (app.category !== "PRIVATE") return { error: "Only Private enrollment has a tuition payment." };
  if (app.paymentStatus === "PAID" || app.paymentStatus === "WAIVED") return "PAID";
  const due = await amountDueCents(app);
  if (!due) return { error: "Choose your course first." };
  if (due.cents < 50) return { error: "The tuition for this course hasn't been set yet. Please contact the BHI office." };
  const current = app.paymentRequest?.status === "OPEN" ? app.paymentRequest : null;
  if (current && current.amountCents === due.cents && (current.courseId ?? app.courseId) === app.courseId) return { request: current, courseName: due.courseName };

  const { applications } = await cols();
  if (current) {
    // The course (or its price) changed: stop the old payment page first, unless it was just paid.
    if ((await closeCheckout(current.checkoutSessionId)) === "PAID") {
      await settleCheckoutSession(await stripe().checkout.sessions.retrieve(current.checkoutSessionId!), "return");
      return "PAID";
    }
    await applications.updateOne(
      { _id: app._id, "paymentRequest.id": current.id, "paymentRequest.status": "OPEN" },
      { $set: { "paymentRequest.status": "CANCELLED", "paymentRequest.cancelledAt": new Date(), "paymentRequest.cancelReason": "course or amount changed" } },
    );
  }
  const now = new Date();
  const request: PaymentRequest = {
    id: newId(), courseId: app.courseId ?? null, amountCents: due.cents, currency: "usd", note: `Tuition and fees: ${due.courseName}`,
    requestedById: studentId, requestedAt: now, status: "OPEN", checkoutSessionId: null, checkoutUrl: null, checkoutAttempts: 0,
  };
  const fresh = await applications.findOne({ _id: app._id }, { projection: { paymentRequest: 1 } });
  const res = await applications.updateOne(
    { _id: app._id, category: "PRIVATE", paymentStatus: { $nin: ["PAID", "WAIVED"] }, "paymentRequest.id": fresh?.paymentRequest?.id ?? null },
    { $set: { paymentRequest: request, paymentStatus: "REQUESTED", updatedAt: now }, ...(fresh?.paymentRequest ? { $push: { paymentRequestHistory: fresh.paymentRequest } } : {}) },
  );
  if (!res.modifiedCount) return { error: "Your application changed meanwhile. Reload the page and try again." };
  await audit(studentId, "application.payment_opened", "application", app._id, { amountCents: due.cents, courseId: app.courseId, requestId: request.id });
  return { request, courseName: due.courseName };
}
