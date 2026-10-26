import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "MONGODB_URI must start with mongodb:// or mongodb+srv://"),
  MONGODB_DB: z.string().optional(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  RESEND_API_KEY: z.string().optional().default(""),
  // Accepts "Name <email@domain>" or "email@domain"; strips quotes some editors add around the value.
  EMAIL_FROM: z
    .string()
    .default("BHI LMS <no-reply@example.org>")
    .transform((v) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim())
    .refine(
      (v) => /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(v) || /^[^<>]+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(v),
      'EMAIL_FROM must look like "BHI LMS <no-reply@yourdomain.org>" or "no-reply@yourdomain.org"',
    ),
  STORAGE_DIR: z.string().default("./storage"),
  /** Deprecated (kept so old .env files still validate). Use PRIVATE_PAYMENT_GATE. */
  PAYMENT_STAGE: z.enum(["PENDING", "DURING_ENROLLMENT", "AFTER_APPROVAL", "OFFLINE"]).default("PENDING"),
  /**
   * No longer used: Private students now submit first and pay after an admin's payment request.
   * Kept so existing .env files still validate.
   */
  PRIVATE_PAYMENT_GATE: z.enum(["BEFORE_FORMS", "BEFORE_SUBMIT", "BEFORE_APPROVAL"]).default("BEFORE_APPROVAL"),
  /**
   * Stripe (online tuition payment for Private students). Secret key from the Stripe dashboard
   * (sk_test_... while testing, sk_live_... in production) and the signing secret of the webhook
   * endpoint https://<your site>/api/stripe/webhook (whsec_...). Empty = online payment is off; admins
   * can still mark payments paid offline or waived.
   */
  STRIPE_SECRET_KEY: z.string().optional().default("").refine((v) => v === "" || /^(sk|rk)_(test|live)_/.test(v), "STRIPE_SECRET_KEY must start with sk_test_ or sk_live_"),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default("").refine((v) => v === "" || v.startsWith("whsec_"), "STRIPE_WEBHOOK_SECRET must start with whsec_"),
  /** Shown to Private students only on the payment step (e.g. how to pay the office). Plain text. */
  PAYMENT_INSTRUCTIONS: z.string().max(2000).default(""),
  PRIVATE_TUITION_USD: z.coerce.number().min(0).default(0),
  REQUIRE_GMAIL: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  INTEGRATION_API_KEY: z.string().optional().default(""),
  APP_TIMEZONE: z.string().default("America/New_York").refine((tz) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
  }, "APP_TIMEZONE must be an IANA time zone such as America/New_York"),
  ATTENDANCE_EDIT_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
  NODE_ENV: z.string().default("development"),
  // Testing/staging only: print emails to the server log instead of sending them.
  ALLOW_CONSOLE_EMAIL: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/** Validated environment. Throws a clear error on first use if misconfigured. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (parsed.data.RESEND_API_KEY && /@example\.(org|com)>?$/.test(parsed.data.EMAIL_FROM)) {
    throw new Error("EMAIL_FROM is still the placeholder address. Set it to an address on a domain verified in Resend (or onboarding@resend.dev for testing).");
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.RESEND_API_KEY && !parsed.data.ALLOW_CONSOLE_EMAIL) {
    throw new Error("RESEND_API_KEY is required in production (OTP emails cannot be delivered without it).");
  }
  if (parsed.data.STRIPE_SECRET_KEY && !parsed.data.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set (payments are confirmed by Stripe's webhook).");
  }
  cached = parsed.data;
  return cached;
}
