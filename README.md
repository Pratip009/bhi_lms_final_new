# BHI LMS

Enrollment, approval, class assignment, attendance and monthly progress reports for BHI.

**Workflows (October 2026 requirements):**

- **Private:** register → verify email → Private → choose course → tuition payment verified by the office → Common Forms + Private Forms → resume and documents → submit → admin decision → enrolled in the chosen course → dashboard (monthly handwritten attendance).
- **EQISS / One-Stop:** register → Non-Private → EQISS + Hudson, Bergen or Somerset County → course → Common Forms + Non-Private Enrollment Agreement → resume and documents → submit → admin decision → enrolled → biweekly ITA report (same sheet for all three counties).
- **DFS:** register → Non-Private → DFS → course → Common Forms + Non-Private Enrollment Agreement → resume and documents → submit → admin decision → enrolled → monthly handwritten attendance.
- **Instructor:** sign up at `/register/instructor` (or be invited by an admin) → admin approves → admin assigns one or more courses → instructor sees those courses' students, each with an **Attendance Sheet** and a **Monthly Progress Report**.

Corrections: an admin requests resubmission with a written note (emailed to the student). The flagged sections reopen; the student edits and resubmits; every submission is kept as a snapshot.

**Stack:** Next.js 15 (App Router, TypeScript), MongoDB (official Node.js driver), Tailwind CSS, Zod, Resend (email OTP), pdf-lib.

## Setup

Requirements: Node.js 20+, MongoDB 6+ (MongoDB Atlas works; a replica set is not required).

```bash
npm install
cp .env.example .env.local        # then fill it in (see below)
npm run db:setup                  # creates the indexes (unique emails, class codes, etc.)
npm run db:seed                   # creates admin accounts from SEED_ADMINS and prints one-time passwords
npm run dev                       # http://localhost:3000
```

Then, as an admin: add the BHI course list under **Courses and classes** (students choose from it), and assign instructors to courses.

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
| `PRIVATE_TUITION_USD` | Tuition shown to Private students only (0 = "as stated in your Private Enrollment Agreement") |
| `PRIVATE_PAYMENT_GATE` | When a Private payment must be verified: `BEFORE_FORMS` (default), `BEFORE_SUBMIT` or `BEFORE_APPROVAL`. Approval always requires a paid or waived payment. |
| `PAYMENT_INSTRUCTIONS` | Plain text shown to Private students on the payment step. No card details are collected; the office verifies payments. |
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

The admin dashboard shows a warning while any of these is outstanding.

1. **Official form wording.** The photographed packets are not in the repository. Each form in `src/lib/forms/templates.ts` has the official title and order, a minimal set of fields and `pendingOfficialText: true`. Paste the printed text into `body` (one string per paragraph), match the fields to the paper form, set `pendingOfficialText: false` and bump `version`. Keep `containsFees: true` on the Private Forms.
2. **Inter-Agency Referral / Status Change Form:** not identifiable in the photographs. Non-Private students can upload it (optional) until BHI provides it.
3. **EQISS certification statements:** paste the customer and instructor statements from "Equus Timesheet - Updated 2026.docx" into `src/lib/eqiss-text.ts`.
4. **Course list:** add the official BHI courses in the admin (none are created automatically).
5. **Payment timing:** `PRIVATE_PAYMENT_GATE` defaults to the brief's "pay before forms". There is no online payment provider; the office records payments as paid or waived.
6. **Social Security card copy:** optional upload until BHI confirms it is required.

## Admin controls added in the October 2026 audit

- **Funding check on class assignment.** A student can only join a class whose funding program matches their category (or a Mixed class). Admins can override with "Allow funding mismatch"; the override is recorded in the audit log.
- **Reopen a rejected application.** Sends it back to the review queue; the original reason stays in the audit log.
- **Tuition payment (private students only).** Mark paid, waived or back to pending. Funded applications can't be given a payment status.
- **Assigning instructors to classes.** From a class page (pick the instructor) or from an instructor's page (pick the class; classes are listed by course). Each class has at most one lead: making someone lead while another lead exists needs "Replace current lead", which turns the old lead into an assistant. Archived classes and disabled accounts can't be assigned, and the instructor is emailed when given a new class. The dashboard counts classes with no instructor.
- **Disable / re-enable accounts** (students and instructors). Disabling signs the person out everywhere, blocks sign-in and the attendance API, and removes them from assignment pickers.

## Student check-in (attendance)

1. On the attendance page for today, the instructor (or an admin, from the class page) taps **Start check-in** and chooses after how many minutes arrivals count as late (default 10).
2. The screen shows a 6-digit code that changes every 30 seconds, a live "x of y checked in" count, and who arrived when.
3. Students see a check-in box on their dashboard (and class page) and enter the code. Each student checks in once, only for their own active classes, only on a day the class runs.
4. The instructor closes check-in (it also closes itself after 4 hours). The attendance sheet is then pre-filled: checked-in students as present or late with their check-in time, everyone else as absent. The instructor reviews, adjusts and saves. **The saved sheet is the official record**; a check-in alone never becomes attendance.

Safeguards: a code works for 30 to 60 seconds, so one sent to someone outside expires almost at once; a student gets 10 tries per 10 minutes; two students checking in from the same phone are both flagged to the instructor; reopening keeps earlier check-ins and still measures lateness from the first opening. Check-ins that the saved sheet doesn't account for (never saved, or saved as absent before the student checked in) are flagged on the instructor's pages and the admin dashboard until resolved. An absent mark saved after a check-in is treated as the instructor's decision.

Limitation: no code can stop someone in the room from reading the code to an absent student over the phone in real time. The headcount, the shared-phone flag and the instructor's confirmation are the backstop.

## Upgrading an existing database

Run `npm run db:setup` after deploying. It sets the normalised email on existing accounts and creates the unique index that stops one Gmail inbox (dots, `+tags`, googlemail.com) from registering twice. If two existing accounts already share an inbox, the oldest keeps it and the others are printed as `! Duplicate mailbox` for an admin to merge or disable.

## How data is stored in MongoDB

Each change is a single atomic document update, so the app needs no multi-document transactions and runs on a standalone MongoDB, a replica set or Atlas.

| Collection | Holds |
| --- | --- |
| `users` | Students, instructors and admins (role, instructor approval, verified email) |
| `applications` | One per student, with form answers, signatures, uploaded-file records and correction requests embedded |
| `courses`, `classes` | Courses and their classes/cohorts. Each class embeds its assigned instructors |
| `enrollments` | Student-to-class assignments (unique per student and class) |
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
