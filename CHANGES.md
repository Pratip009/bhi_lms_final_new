# QA fixes — 31 October 2026

Base: `9c4b4cb` (26 Oct 2026). 13 commits, one per topic, so each can be reviewed and merged separately (`git log 9c4b4cb..HEAD`).
Checked with: `npm run build` (passes), `npx tsc --noEmit` (clean, including tests), `npm test` (39/39 pass).
**Not run:** `test:e2e` and `test:regressions` (need a database and server); Stripe, email and PDF output (need staging). See TESTING.md.

The numbers in brackets refer to the QA checklist.

## Enrollment
- **Forms (3.1–3.3).** All 7 Common and 3 Private forms now have the full paper wording and fields from the October 2026 packets (`src/lib/forms/templates.ts`, version 2). New field types: `radio`, `multi` (check all that apply), `heading`, `note`, `ssn`. Cross-field rules (`check`) make "explain" required when a question is answered Yes. Empty fields are pre-filled from earlier forms (`prefill`; `src/lib/forms/context.ts`). The Laptop Receipt is removed, so the packet is 7 Common + 3 Private + 1 Non-Private. **Still pending:** Non-Private Enrollment Agreement wording (not supplied).
- **SSN.** Stored as `123-45-6789`. Masked on review screens. Shown in full on the admin form-edit page (each view is audit-logged) and in the PDF packet.
- **Course list (1.4).** `data/bhi-courses.json` holds the 15 programs with fee breakdown and hours, loaded by `npm run db:seed` or `npm run db:courses` (idempotent). `Course` gains `fees`, `hours` and `certification`, all editable on the course form. Private students see the price when choosing; Non-Private students never do.
- **Payment before forms (2.2–2.4).** Private: course → `/enroll/payment` → Stripe Checkout for the course's total → forms open. `paymentGate()` returns `BEFORE_FORMS`. The payment is created by the student's click (`openPaymentForCourse` in `src/lib/tuition.ts`), and a course change replaces an open payment. Payment no longer approves the application. Course and enrollment type lock once paid. The admin card is reduced to "Paid in person / Waive / Back to unpaid" (plus cancelling an open payment). The admin "send payment request" UI is gone; its action is kept for applications from the older flow. Rejecting a paid application shows a refund reminder.
- **Corrections (4.3–4.5).** "Request corrections" opens a compose panel: To (registered email), Subject, Message, and the parts to reopen. `nextStepPath()` in `src/lib/enrollment.ts` drives every "Continue" and "Save and continue". While correcting, the student goes to the next flagged part, then Review, and locked parts are skipped. The admin's message is shown on each flagged page.
- **Instructor sign-up link on sign-in (6.3).**

## After approval
- **Approval = placement (4.2).** If placement fails, the approval is undone (`application.approve_undone` in the audit log).
- **Dashboard (5.1–5.3).** No application status on the dashboard. A single "Open Google Classroom" button to classroom.google.com. Students whose classes have all ended keep the dashboard and can reach earlier attendance (`studentStage(..., hasEarlierEnrollment)`).
- **Enrollment periods (8.2).** `startEnrollment()` always starts a new row. The index is now a partial unique index on (student, class) for ACTIVE only. **Run `npm run db:setup` after deploying.**
- **Instructor history (8.3).** `Klass.instructorHistory` records removed section instructors with start and stop dates. The class page shows section and course assignments in an "Instructor history" table.

## Attendance
- **One daily sheet** (`src/lib/actions/daily.ts`, `src/components/day-attendance.tsx`) for instructors and admins (`/admin/classes/[id]/attendance`). Each student gets a status, time in and time out; hours come from `computeDay()` with the class break deducted. Non-attended statuses get zero hours and no times. Students who left after that date can still be corrected. Replaces `recordAttendanceAction`.
- **New `SICK` status.** EQISS mapping: ABSENT/EXCUSED → A, HOLIDAY → H, SICK → S (`biweeklyCodeFor`, `statusForBiweeklyCode`).
- **Two-way EQISS sync.** Daily saves update the biweekly report (`syncRecordToBiweekly`), and staff edits on the report update daily records (`syncBiweeklyToDays`). Customer initials are no longer auto-filled.
- **Student signatures.** Students sign their own monthly days on their login (`signMyMonthAction`).
- **Day sign-off.** Admins can sign a class day.
- **Check-in codes** are optional per class (`Klass.checkInEnabled`, **off by default, including existing classes**). Late = more than `Klass.lateAfterMinutes` (default 10) after the class start time (`checkInStatus`).
- **Biweekly periods** are anchored to the student's first class start in the course (`periodAnchor`), so a move doesn't split fortnights differently.

## Admin usability
- **Home** is a plain-language to-do list with one button per item.
- **Menu:** Home, Applications, Students, Courses and classes, Instructors, Attendance and reports (tabs: Today / Records / Monthly progress reports), Help (the existing guide, now linked, with its links filled in).
- **Consistent words:** "class" (not section/cohort) and "instructor" (not teacher).
- **Times and history:** local times everywhere (`fmtDateTime`), and the application history in plain English.
- **Class page:** roster and instructors first. Class settings and "Advanced" (edit dates, merge, archive) are folded away.
- **Attendance records** default to the last 7 days. Applications have a "Private: not paid yet" filter that includes unsubmitted ones.

## Decisions taken as defaults (please confirm with BHI)
- **Amount charged:** the course's Total from the fee table. Are the $25 application and $100 registration fees extra?
- **Paper fee lines:** Supply = Tools column; Other = Fees + Other columns; Uniforms = $0.
- **Course availability:** every course is open to every enrollment type until limited on the course page.
- **Certifications for programs 9–15** are left empty: the certification column in BHI_Program_Fee_Structure.pdf has one extra entry (MEDCA at row 9). Moved up one row they read 9 OSHA, 10 NABCEP, 11 Google UI/UX, 12 CDA National Credential, 13 SORA, 14 Completion, 15 GED (see `note` in data/bhi-courses.json).
- **Unlabeled line under GED** in the fee structure (3,500 / 250 / 0 / 0 / 250 = 4,000, 600 h, GED) is not loaded. Same total as GED, so the Private charge is unaffected.
- **Currency** is not printed in the fee structure; amounts are treated as US dollars.
- **Photo Release:** keeps an "I do not give permission" choice.
- **Background Check:** the paper blanks for the school's name are filled with "Bright Horizon Institute".
