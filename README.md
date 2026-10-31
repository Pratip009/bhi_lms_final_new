# BHI LMS

Enrollment, approval, class assignment, attendance and monthly progress reports for BHI.

**Workflows (October 2026 requirements):**

- **Private:** register → verify email → Private → choose course → pay the course's tuition and fees online (Stripe) → Common Forms + Private Forms → resume and documents → submit → admin decision → enrolled in the chosen course → dashboard (monthly attendance sheet).
- **EQISS / One-Stop:** register → Non-Private → EQISS + Hudson, Bergen or Somerset County → course → Common Forms + Non-Private Enrollment Agreement → resume and documents → submit → admin decision → enrolled → biweekly ITA report (same sheet for all three counties).
- **DFS:** register → Non-Private → DFS → course → Common Forms + Non-Private Enrollment Agreement → resume and documents → submit → admin decision → enrolled → monthly handwritten attendance.
- **Instructor:** sign up at `/register/instructor` (or be invited by an admin) → admin approves → admin assigns one or more courses → instructor sees those courses' students, each with an **Attendance Sheet** and a **Monthly Progress Report**.

Corrections: the admin clicks **Request corrections**, which opens an email to the student's registered address. The admin ticks the parts to reopen, writes the message and clicks Send. The student is taken straight to those parts (locked parts are skipped), edits and resubmits; everything else stays saved and every submission is kept as a snapshot.

**Stack:** Next.js 15 (App Router, TypeScript), MongoDB (official Node.js driver), Tailwind CSS, Zod, Resend (email OTP), pdf-lib.

## Setup

Requirements: Node.js 20+, MongoDB 6+ (MongoDB Atlas works; a replica set is not required).

```bash
npm install
cp .env.example .env.local        # then fill it in (see below)
npm run db:setup                  # creates the indexes (unique emails, class codes, etc.)
npm run db:seed                   # loads the BHI course list (data/bhi-courses.json), creates admin accounts from SEED_ADMINS and prints one-time passwords
npm run db:courses                # (optional) re-loads the course list on its own; safe to repeat, never overwrites admin edits
npm run dev                       # http://localhost:3000
```

Then, as an admin: check the course list under **Courses and classes** (fees, hours, certification and which enrollment types may choose each course), and assign instructors to courses.

### Upgrading from the 26 October 2026 version (QA fixes)

Take a database backup, deploy, then run `npm run db:setup` (replaces the enrollment index so a student can have more than one enrollment period in the same class) and `npm run db:courses` (adds the official course list). Notes: check-in codes are now off unless turned on per class in Class settings; applications already submitted keep their answers, and the new form fields show as "-" for them. See CHANGES.md.

### Upgrading an existing installation to the October 2026 version

Take a database backup first, then:

```bash
npm run db:migrate                # DRY RUN: prints what would change
npm run db:migrate -- --apply     # applies it (also creates the new indexes)
# optional: give each existing section instructor a course assignment (widens their access to the whole course)
npm run db:migrate -- --apply --course-assignments-from-sections
```

The migration converts the old "Hudson County" category to Non-Private / EQISS / One-Stop / Hudson County, marks old "EQISS" applications as EQISS with no county (they are listed so an admin can set the county), renames the HUDSON_COUNTY funding program on courses and sections to EQISS, and fills in course ids. Nothing is deleted: answers to the earlier placeholder forms stay on each application and appear under "Answers from earlier form versions".
```

Admins sign in with the printed one-time password, then use **Forgot password** to set their own (a code is emailed).

### Environment

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (`mongodb://` or `mongodb+srv://`) |
| `MONGODB_DB` | Optional database name if it isn't in the URI |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 48`). Also keys the OTP hashes. |
| `APP_URL` | Public URL used in email links |
| `RESEND_API_KEY` / `EMAIL_FROM` | Resend credentials. `EMAIL_FROM` must be on a domain verified in Resend. Required in production. |
| `STORAGE_DIR` | Folder for uploaded files (outside `public/`) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe keys for online tuition payment (`sk_test_...` / `whsec_...` while testing). Webhook endpoint: `https://<site>/api/stripe/webhook` with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Without keys, the office records payments made in person. |
| `PRIVATE_TUITION_USD` | Fallback amount only, for a course that has no fees set on the Courses page. |
| `PRIVATE_PAYMENT_GATE` | Deprecated; still accepted. Private payment is always required before the forms. |
| `PAYMENT_INSTRUCTIONS` | Deprecated; still accepted. |
| `PAYMENT_STAGE` | Deprecated; still accepted so older `.env` files validate. |
| `REQUIRE_GMAIL` | `true` = student sign-up requires a Gmail address (@gmail.com or @googlemail.com) |
| `APP_TIMEZONE` | Office time zone for "today" and report months. Default `America/New_York` |
| `ATTENDANCE_EDIT_DAYS` | Instructors can't change attendance older than this many days; admins always can. `0` (default) = no lock |
| `INTEGRATION_API_KEY` | 24+ chars; enables the attendance-app API. Empty = disabled. |
| `SEED_ADMINS` | `Name:email,Name:email` for `npm run db:seed` |
| `ALLOW_CONSOLE_EMAIL` | Testing only. `true` prints emails to the server log instead of sending. Never set in real production. |

Without `RESEND_API_KEY` in development, emails (including OTP codes) are printed to the server console.

## Deploying

- Any Node host works (Vercel, Render, Railway, a VPS). Use MongoDB Atlas (or another managed MongoDB) with backups turned on, and allow your host's IPs in Atlas Network Access.
- **File storage:** uploads are written to `STORAGE_DIR` on local disk. On Vercel or any host with an ephemeral disk, replace `src/lib/storage.ts` with S3/R2 (same three functions: `putFile`, `getFile`, `deleteFile`). On a VPS, point `STORAGE_DIR` at a persistent, backed-up volume.
- Run `npm run db:setup` once per environment (and again after updates; it's safe to repeat).
- Serve over HTTPS (session cookies are `Secure` in production).

## Tests

```bash
npm test                 # unit tests: enrollment rules, fee filtering, payment gate, time math, biweekly periods, reports
npm run test:e2e         # end-to-end against a running dev server (see header of tests/e2e.mjs)
npm run test:regressions # earlier audit loopholes; same setup as test:e2e
```

The end-to-end suite (97 checks) drives the real server over HTTP through every workflow above: enrollment choices and county, course eligibility, fee privacy (including the generated PDF text), corrections and resubmission history, admin edits, approval and course enrollment, instructor sign-up/approval/course assignment, the EQISS biweekly report (14 days, codes, signatures, locking), the monthly handwritten sheet (times, signature, sign-off, change flags), progress reports, Private payment gating, section moves and merges, assignment changes, access control, and the handwritten-app integration. It expects a fresh database, an admin account, `ALLOW_CONSOLE_EMAIL=true`, `PRIVATE_TUITION_USD=4500`, `INTEGRATION_API_KEY`, `MONGODB_URI` and the server log at `LOG`.

## Where things live

| Area | Files |
| --- | --- |
| Enrollment forms (Common, Private, Non-Private) and uploads | `src/lib/forms/templates.ts` |
| Enrollment choice, payment gate, course eligibility | `src/lib/selection.ts`, `src/lib/payment.ts`, `src/lib/courses.ts`, `src/lib/enrollment.ts` |
| Approval → course enrollment, section moves and merges | `src/lib/placement.ts` |
| Attendance sheets (monthly handwritten, EQISS biweekly) | `src/lib/timesheet.ts` (rules), `src/lib/sheets.ts`, `src/lib/actions/sheets.ts`, `src/components/*sheet*` |
| EQISS report wording | `src/lib/eqiss-text.ts` |
| Monthly Student Progress Report | `src/lib/reports/template.ts` |
| Data migration | `scripts/migrate-2026-10.ts` |
| Status rules (who sees which screen) | `src/lib/routing.ts`, `src/lib/auth.ts`, `src/middleware.ts` |
| Permissions (admin / instructor / student) | `src/lib/authz.ts` |
| OTP, sessions, rate limits | `src/lib/otp.ts`, `src/lib/session.ts`, `src/lib/rate-limit.ts` |
| Emails | `src/lib/email.ts` |
| PDFs (packet, attendance sheet, report) | `src/lib/pdf/` |
| Database documents and connection | `src/db/types.ts`, `src/db/index.ts`, indexes in `scripts/indexes.ts` |
| Student pages | `src/app/enroll`, `src/app/application`, `src/app/dashboard` |
| Admin pages and actions | `src/app/admin` |
| Instructor pages and actions | `src/app/instructor` |
| Attendance-app integration | `src/app/api/integrations` |

## Waiting on documents and decisions from the office

The admin home page lists anything still outstanding at the bottom.

1. **Non-Private Enrollment Agreement wording.** Every Common and Private form now has the official wording and fields from the October 2026 packets (`src/lib/forms/templates.ts`). Only `nonprivate_agreement` still has `pendingOfficialText: true`; paste its printed text into `body`, match the fields, set it to `false` and bump `version`.
2. **EQISS certification statements:** paste the customer and instructor statements from "Equus Timesheet - Updated 2026.docx" into `src/lib/eqiss-text.ts`.
3. **Course list details to confirm** (`data/bhi-courses.json`): certifications for programs 9–15 are left empty because the certification column in the source has one extra entry (the likely correct values are in the file's `note`); the unlabeled line under GED; which enrollment types may choose each course (all are open to everyone until set); whether the $25 application and $100 registration fees are part of each Total.
4. **Inter-Agency Referral / Status Change Form** and **Social Security card copy:** optional uploads until BHI confirms.

## Admin controls added in the October 2026 audit

- **Funding check on class assignment.** A student can only join a class whose funding program matches their category (or a Mixed class). Admins can override with "Allow funding mismatch"; the override is recorded in the audit log.
- **Reopen a rejected application.** Sends it back to the review queue; the original reason stays in the audit log.
- **Tuition payment (private students only).** Mark paid, waived or back to pending. Funded applications can't be given a payment status.
- **Assigning instructors to classes.** From a class page (pick the instructor) or from an instructor's page (pick the class; classes are listed by course). Each class has at most one lead: making someone lead while another lead exists needs "Replace current lead", which turns the old lead into an assistant. Archived classes and disabled accounts can't be assigned, and the instructor is emailed when given a new class. The dashboard counts classes with no instructor.
- **Disable / re-enable accounts** (students and instructors). Disabling signs the person out everywhere, blocks sign-in and the attendance API, and removes them from assignment pickers.

## Daily attendance

Each class has a **Daily attendance** screen (instructors: from their class; admins: Courses and classes → class → Daily attendance).

1. For each student, choose Present, Late, Absent, Sick, Holiday or Excused. Time in and time out start at the class times (Class settings) and can be changed; lunch is the class break and is taken off automatically. Hours are calculated, never typed. Absent, sick, holiday and excused days count zero hours.
2. Save, then sign the day. An admin can sign on the instructor's behalf (e.g. a substitute taught).
3. DFS and Private students see their monthly sheet and sign the days they attended on their own login. The instructor signs off the month.
4. EQISS students' biweekly reports are filled from the same daily records (A = absent or excused, H = holiday, S = sick). Staff edits on the report update the daily records too, so the two never disagree. Students enter their own initials.

**Optional check-in codes:** in Class settings, "Students check in with a code on their phone" (off by default). When on, the instructor shows a 6-digit code that works for 10 minutes; students enter it on their dashboard and press "Fill my attendance" at the end of class. A student is late when they check in more than the class's "late after" minutes past the class start time. Two students checking in from the same phone are flagged. The saved, signed daily sheet is always the official record.

## Upgrading an existing database

Run `npm run db:setup` after deploying. It sets the normalised email on existing accounts and creates the unique index that stops one Gmail inbox (dots, `+tags`, googlemail.com) from registering twice. If two existing accounts already share an inbox, the oldest keeps it and the others are printed as `! Duplicate mailbox` for an admin to merge or disable.

## How data is stored in MongoDB

Each change is a single atomic document update, so the app needs no multi-document transactions and runs on a standalone MongoDB, a replica set or Atlas.

| Collection | Holds |
| --- | --- |
| `users` | Students, instructors and admins (role, instructor approval, verified email) |
| `applications` | One per student, with form answers, signatures, uploaded-file records and correction requests embedded |
| `courses`, `classes` | Courses and their classes/cohorts. Each class embeds its assigned instructors |
| `enrollments` | Student-to-class enrollment periods. A student can have several periods in the same class (e.g. after returning); only one can be active |
| `attendance_checkins` | Live student check-in per class and day: opening time, late threshold, and each student's check-in time and device |
| `class_sessions` | One per class per date, holding that day's attendance for every student |
| `progress_reports` | One per student enrollment per month, with the instructor's signature and earlier versions |
| `course_assignments` | Instructor ↔ course; removing one sets `removedAt` so history stays |
| `attendance_signoffs` | Instructor sign-off of a DFS/Private monthly sheet, with earlier sign-offs |
| `biweekly_timesheets` | EQISS / One-Stop biweekly ITA report, one per enrollment and two-week period |
| `sessions`, `otp_codes`, `rate_limits`, `audit_logs` | Sign-in sessions, email codes, rate limits, and the history of every admin action |

Uploaded files themselves are stored on disk or object storage (see Deploying), not in MongoDB.

## Security notes

- **Email verification:** a 6-digit code sent with Resend. It is stored as an HMAC hash and expires in 10 minutes. Five wrong tries burn the code. Resends need a 60-second wait and are capped at 5 per hour. Verification, password reset and login are all rate-limited.
- **Sign-in protection:** login uses constant-time checks and a generic error message, and forgot-password gives the same response for any email. The sign-up form does say when an email is already registered (so people know to sign in instead); it is rate-limited to 10 sign-ups per hour per network.
- **Sessions:** a signed cookie backed by a database row. A session stops working when it's revoked, when the user is disabled, or when the password changes.
- **Permissions:** every page and server action checks the user's role and record ownership against the database; the middleware is only a fast first filter. Instructors can only reach classes assigned to them, and students only their own records.
- **Fee privacy:** fee forms are filtered out on the server for funded categories, on screens, in saves and in PDFs. Changing a student's category deletes any fee answers already stored.
- **Uploads:** each file's type is checked from its content. Files are 10 MB max, stored outside `public/`, and served only after a permission check, with `nosniff` and sandbox headers.
- **Safe status changes:** status changes are conditional updates, so a double click or two admins acting at once can't push an application through twice. Unique indexes stop duplicate accounts, class codes, enrollments and monthly reports.
- **Attendance integrity:** the instructor screen and the attendance-app API share one set of rules (no future dates, nothing outside the class, no marks after a student left, optional edit lock). Every change records the previous and new values in `audit_logs`.
- **Audit and exports:** admin actions, sign-ins and staff file downloads are written to `audit_logs`. CSV exports neutralise spreadsheet formulas.
