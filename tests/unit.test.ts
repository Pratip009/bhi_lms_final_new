import { test } from "node:test";
import assert from "node:assert/strict";
import { homeFor, studentStage } from "../src/lib/routing";
import { TEMPLATES, templatesFor, schemaFor, coerceRaw, documentsFor, attendanceFormatFor, describeEnrollment } from "../src/lib/forms/templates";
import { validateSelection } from "../src/lib/selection";
import { approvalBlockedByPayment, formsBlockedByPayment, submitBlockedByPayment } from "../src/lib/payment";
import { courseServes } from "../src/lib/courses";
import {
  biweeklyDayHours, biweeklyDueDate, biweeklyTotal, contentHash, hoursFromTimes, mondayOf, monthlyEntriesHash, periodDates, periodStartFor, periodsBetween, timesProblem,
} from "../src/lib/timesheet";
import { REPORT_FIELDS, monthParts, reportSchema } from "../src/lib/reports/template";
import { detectFileType } from "../src/lib/file-validation";
import { generateOtp } from "../src/lib/crypto";

test("Non-Private tracks (EQISS, DFS) never receive fee templates, even if misconfigured", () => {
  for (const c of ["EQISS", "DFS"] as const) {
    assert.ok(templatesFor(c).every((t) => !t.containsFees), c);
  }
  // Simulate a misconfiguration: a fee template that claims to apply to everyone.
  TEMPLATES.push({ key: "bad", title: "Bad", version: 1, group: "COMMON", appliesTo: "ALL", containsFees: true, requiresSignature: false, pendingOfficialText: false, fields: [] });
  try {
    assert.ok(!templatesFor("EQISS").some((t) => t.key === "bad"));
    assert.ok(!templatesFor("DFS").some((t) => t.key === "bad"));
    assert.ok(templatesFor("PRIVATE").some((t) => t.key === "bad"));
  } finally {
    TEMPLATES.pop();
  }
});

const COMMON = ["student_data", "educational_background", "background_check", "emergency_medical", "workforce_registration", "grievance_policy", "photo_release"];

test("every track gets the 7 Common Forms once, in the packet order", () => {
  for (const c of ["PRIVATE", "EQISS", "DFS"] as const) {
    const keys = templatesFor(c).map((t) => t.key);
    assert.deepEqual(keys.slice(0, 7), COMMON, c);
    assert.equal(new Set(keys).size, keys.length, `${c}: duplicate templates`);
  }
});

test("Private gets Private Forms; Non-Private gets the Non-Private agreement only", () => {
  assert.deepEqual(templatesFor("PRIVATE").slice(7).map((t) => t.key), ["private_agreement_1", "private_agreement_2", "refund_schedule"]);
  for (const c of ["EQISS", "DFS"] as const) assert.deepEqual(templatesFor(c).slice(7).map((t) => t.key), ["nonprivate_agreement"]);
  assert.ok(templatesFor("PRIVATE").filter((t) => t.group === "PRIVATE").every((t) => t.containsFees));
});

test("resume and photo ID are required for every track; referral upload only for Non-Private", () => {
  for (const c of ["PRIVATE", "EQISS", "DFS"] as const) {
    assert.ok(documentsFor(c).some((d) => d.type === "RESUME" && d.required));
    assert.ok(documentsFor(c).some((d) => d.type === "PHOTO_ID" && d.required));
  }
  assert.ok(!documentsFor("PRIVATE").some((d) => d.type === "REFERRAL"));
  assert.ok(documentsFor("DFS").some((d) => d.type === "REFERRAL"));
});

test("enrollment choice: type, program and county are validated and kept separate", () => {
  assert.equal(validateSelection({}).ok, false);
  const p = validateSelection({ enrollmentType: "PRIVATE", fundingProgram: "EQISS", county: "HUDSON" });
  assert.ok(p.ok && p.category === "PRIVATE" && p.selection.fundingProgram === null && p.selection.county === null);
  const noProg = validateSelection({ enrollmentType: "NON_PRIVATE" });
  assert.ok(!noProg.ok && noProg.field === "fundingProgram");
  const dfs = validateSelection({ enrollmentType: "NON_PRIVATE", fundingProgram: "DFS", county: "BERGEN" });
  assert.ok(dfs.ok && dfs.category === "DFS" && dfs.selection.county === null);
  const noCounty = validateSelection({ enrollmentType: "NON_PRIVATE", fundingProgram: "EQISS" });
  assert.ok(!noCounty.ok && noCounty.field === "county");
  assert.equal(validateSelection({ enrollmentType: "NON_PRIVATE", fundingProgram: "EQISS", county: "ESSEX" }).ok, false);
  for (const county of ["HUDSON", "BERGEN", "SOMERSET"]) {
    const r = validateSelection({ enrollmentType: "NON_PRIVATE", fundingProgram: "EQISS", county });
    assert.ok(r.ok && r.category === "EQISS" && r.selection.county === county);
  }
});

test("all three EQISS counties share one attendance format; DFS and Private use the monthly sheet", () => {
  assert.equal(attendanceFormatFor("EQISS"), "BIWEEKLY");
  assert.equal(attendanceFormatFor("DFS"), "MONTHLY");
  assert.equal(attendanceFormatFor("PRIVATE"), "MONTHLY");
  assert.equal(describeEnrollment({ category: "EQISS", county: "SOMERSET" }), "Non-Private: EQISS / One-Stop, Somerset County");
});

test("payment gate: approval always needs a settled Private payment; Non-Private is never gated", () => {
  const priv = { category: "PRIVATE" as const, paymentStatus: "PENDING" as const };
  assert.equal(approvalBlockedByPayment(priv), true);
  assert.equal(approvalBlockedByPayment({ ...priv, paymentStatus: "PAID" }), false);
  assert.equal(approvalBlockedByPayment({ ...priv, paymentStatus: "WAIVED" }), false);
  assert.equal(formsBlockedByPayment(priv, "BEFORE_FORMS"), true);
  assert.equal(formsBlockedByPayment(priv, "BEFORE_SUBMIT"), false);
  assert.equal(submitBlockedByPayment(priv, "BEFORE_SUBMIT"), true);
  assert.equal(submitBlockedByPayment(priv, "BEFORE_APPROVAL"), false);
  for (const c of ["EQISS", "DFS"] as const) {
    const a = { category: c, paymentStatus: "NOT_REQUIRED" as const };
    assert.equal(approvalBlockedByPayment(a) || formsBlockedByPayment(a, "BEFORE_FORMS") || submitBlockedByPayment(a, "BEFORE_FORMS"), false);
  }
});

test("courses with no funding programs are open to all; otherwise only listed programs", () => {
  assert.equal(courseServes({ fundingPrograms: [] }, "DFS"), true);
  assert.equal(courseServes({ fundingPrograms: ["PRIVATE"] }, "EQISS"), false);
  assert.equal(courseServes({ fundingPrograms: ["EQISS", "DFS"] }, "DFS"), true);
  assert.equal(courseServes({ fundingPrograms: [] }, null), false);
});

test("handwritten times: hours = end - start - lunch; bad combinations refused", () => {
  assert.equal(hoursFromTimes({ startTime: "09:00", lunchOut: "12:00", lunchIn: "12:30", endTime: "15:00" }), 5.5);
  assert.equal(hoursFromTimes({ startTime: "09:00", endTime: "13:15" }), 4.25);
  assert.equal(hoursFromTimes({ startTime: "09:00" }), null);
  assert.ok(timesProblem({ startTime: "9am" }));
  assert.ok(timesProblem({ startTime: "10:00", endTime: "09:00" }));
  assert.ok(timesProblem({ lunchOut: "12:00" }));
  assert.ok(timesProblem({ startTime: "09:00", lunchOut: "12:30", lunchIn: "12:00", endTime: "15:00" }));
  assert.equal(timesProblem({}), null);
  // Extra fields on the object (as the integration API passes whole records) are ignored.
  assert.equal(timesProblem({ startTime: "09:00", endTime: "12:00", enrollmentId: "0b6c…", status: "PRESENT" } as never), null);
});

test("biweekly periods: 14 days Monday to Sunday, anchored on the program start", () => {
  assert.equal(mondayOf("2026-10-14"), "2026-10-12"); // Wednesday -> Monday
  assert.equal(mondayOf("2026-10-18"), "2026-10-12"); // Sunday -> Monday
  const p = periodStartFor("2026-09-02", "2026-10-14"); // program starts Wed 2 Sep -> anchor Mon 31 Aug
  assert.equal(p, "2026-10-12");
  const days = periodDates(p);
  assert.equal(days.length, 14);
  assert.equal(new Date(`${days[0]}T12:00:00Z`).getUTCDay(), 1);
  assert.equal(new Date(`${days[13]}T12:00:00Z`).getUTCDay(), 0);
  assert.equal(periodStartFor("2026-09-02", "2026-09-13"), "2026-08-31");
  assert.equal(periodStartFor("2026-09-02", "2026-09-14"), "2026-09-14");
  assert.deepEqual(periodsBetween("2026-09-02", "2026-09-30"), ["2026-08-31", "2026-09-14", "2026-09-28"]);
});

test("biweekly report is due two business days after the period", () => {
  assert.equal(biweeklyDueDate("2026-10-12"), "2026-10-27"); // ends Sun 25 Oct -> Tue 27 Oct
});

test("biweekly hours: A, H and S days count zero; totals add up", () => {
  assert.equal(biweeklyDayHours({ timeIn: "09:00", timeOut: "13:30", code: "" }), 4.5);
  for (const code of ["A", "H", "S"] as const) assert.equal(biweeklyDayHours({ timeIn: "09:00", timeOut: "13:30", code }), 0);
  assert.equal(biweeklyTotal([{ hours: 4.5 }, { hours: 0 }, { hours: 3.25 }]), 7.75);
});

test("sheet hashes change when entries change and ignore key order", () => {
  assert.equal(contentHash({ a: 1, b: [1, 2] }), contentHash({ b: [1, 2], a: 1 }));
  const rows = [{ date: "2026-10-01", record: { status: "PRESENT" as const, hours: 4, note: "", startTime: "09:00" } }];
  const h = monthlyEntriesHash(rows);
  assert.notEqual(h, monthlyEntriesHash([{ ...rows[0], record: { ...rows[0].record, startTime: "09:15" } }]));
});

test("progress report follows the template: lesson numbers and comments required to submit", () => {
  assert.deepEqual(REPORT_FIELDS.map((f) => f.label), ["Lesson(s) number", "Comments"]);
  assert.equal(reportSchema(false).safeParse({ lessons: "", comments: "" }).success, true);
  assert.equal(reportSchema(true).safeParse({ lessons: "4-6", comments: "" }).success, false);
  assert.equal(reportSchema(true).safeParse({ lessons: "4-6", comments: "Good progress." }).success, true);
  assert.deepEqual(monthParts("2026-10"), { month: "October", year: "2026" });
});

test("student routing follows status", () => {
  assert.equal(studentStage("DRAFT", false), "ENROLL");
  assert.equal(studentStage("CORRECTIONS_REQUESTED", false), "ENROLL");
  assert.equal(studentStage("SUBMITTED", false), "STATUS");
  assert.equal(studentStage("APPROVED", false), "STATUS");
  assert.equal(studentStage("APPROVED", true), "DASHBOARD");
  assert.equal(studentStage("APPROVED", false, true), "DASHBOARD", "earlier records stay reachable after classes end");
  assert.equal(studentStage("REJECTED", true), "STATUS");
  assert.equal(homeFor({ role: "STUDENT", emailVerified: false }), "/verify");
  assert.equal(homeFor({ role: "INSTRUCTOR", emailVerified: true, instructorStatus: "PENDING" }), "/instructor/pending");
  assert.equal(homeFor({ role: "ADMIN", emailVerified: true }), "/admin");
});

test("form schema enforces required fields and confirmations", () => {
  const grievance = TEMPLATES.find((t) => t.key === "grievance_policy")!;
  const bad = schemaFor(grievance).safeParse(coerceRaw(grievance, {}));
  assert.equal(bad.success, false);
  const good = schemaFor(grievance).safeParse(coerceRaw(grievance, { studentName: "Ana Diaz" }));
  assert.equal(good.success, true);
  const personal = TEMPLATES.find((t) => t.key === "student_data")!;
  const r = schemaFor(personal).safeParse(coerceRaw(personal, { orientation: "on", legalName: "A", dateOfBirth: "not-a-date", ssn: "123456789", cellPhone: "1", email: "a@gmail.com", street: "x", city: "x", state: "x", zip: "1" }));
  assert.equal(r.success, false);
  assert.ok(!r.success && r.error.issues.some((i) => i.path[0] === "dateOfBirth"));
  const noOrientation = schemaFor(personal).safeParse(coerceRaw(personal, { legalName: "A", dateOfBirth: "2000-01-01", ssn: "123456789", cellPhone: "1", email: "a@gmail.com", street: "x", city: "x", state: "x", zip: "1" }));
  assert.ok(!noOrientation.success && noOrientation.error.issues.some((i) => i.path[0] === "orientation"), "the mandatory orientation must be acknowledged");
});

test("file types are detected from content", () => {
  assert.equal(detectFileType(Buffer.from("%PDF-1.7 ..."))?.ext, "pdf");
  assert.equal(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.ext, "png");
  assert.equal(detectFileType(Buffer.from("MZ\x90\x00 windows exe")), null);
  assert.equal(detectFileType(Buffer.from("<html><script>")), null);
});

test("OTP codes are 6 digits", () => {
  for (let i = 0; i < 200; i++) assert.match(generateOtp(), /^\d{6}$/);
});

// ---- Added with the audit fixes ----
import { canonicalEmail } from "../src/lib/email-canonical";
import { todayLocal } from "../src/lib/dates";
import { attendanceChanges, dateProblem, enrolledOn } from "../src/lib/attendance-rules";

test("Gmail aliases collapse to one mailbox; other domains are untouched", () => {
  const base = canonicalEmail("janedoe@gmail.com");
  for (const alias of ["Jane.Doe@gmail.com", "j.a.n.e.d.o.e+lms@gmail.com", "janedoe+2@googlemail.com", " JANEDOE@GMAIL.COM "]) {
    assert.equal(canonicalEmail(alias), base, alias);
  }
  assert.equal(canonicalEmail("jane.doe+x@yahoo.com"), "jane.doe+x@yahoo.com");
});

test("'today' follows the office time zone, not UTC", () => {
  // 01:30 UTC on Oct 14 is still Oct 13 in New Jersey.
  assert.equal(todayLocal(new Date("2026-10-14T01:30:00Z")), "2026-10-13");
});

const klass = { archived: false, startDate: "2020-01-01", endDate: "2099-12-31" } as never;
test("attendance dates: no future dates, nothing outside the class, archived classes refused", () => {
  assert.match(dateProblem(klass, "2099-01-01", "INSTRUCTOR")!, /future/);
  assert.match(dateProblem(klass, "2019-12-31", "ADMIN")!, /outside/);
  assert.match(dateProblem({ ...(klass as object), archived: true } as never, "2020-02-01", "ADMIN")!, /archived/);
  assert.equal(dateProblem(klass, todayLocal(), "INSTRUCTOR"), null);
});

test("attendance edit lock applies to instructors only", () => {
  process.env.ATTENDANCE_EDIT_DAYS = "7";
  try {
    const old = todayLocal(new Date(Date.now() - 30 * 86_400_000));
    assert.match(dateProblem(klass, old, "INSTRUCTOR")!, /locked/);
    assert.equal(dateProblem(klass, old, "ADMIN"), null);
  } finally {
    delete process.env.ATTENDANCE_EDIT_DAYS;
  }
});

test("withdrawn students can only be marked up to the day they left", () => {
  const left = { status: "WITHDRAWN" as const, endedAt: new Date("2026-03-10T15:00:00Z") };
  assert.ok(enrolledOn(left, "2026-03-10"));
  assert.ok(!enrolledOn(left, "2026-03-11"));
  assert.ok(enrolledOn({ status: "ACTIVE", endedAt: null }, "2099-01-01"));
});

test("attendance audit records before and after values, and skips unchanged rows", () => {
  const before = { e1: { status: "ABSENT", hours: 0, note: "", recordedById: "x", updatedAt: new Date() } } as never;
  const changes = attendanceChanges(before, { e1: { status: "PRESENT", hours: 6, note: "" }, e2: { status: "LATE", hours: 3, note: "" } });
  assert.deepEqual(changes.map((c) => [c.enrollmentId, c.from?.status ?? null, c.to.status]), [["e1", "ABSENT", "PRESENT"], ["e2", null, "LATE"]]);
  assert.equal(attendanceChanges(before, { e1: { status: "ABSENT", hours: 0, note: "" } }).length, 0);
});

// ---- Student check-in (optional per class; codes work for 10 minutes) ----
import { checkInStatus, codeFor, codeMatches, isOpen, msLeft, statusAt, sharedDevices, CODE_VALID_MINUTES } from "../src/lib/checkin";

const SECRET = "x".repeat(40);
const sess = { _id: "s1", seed: "seed-1" };

test("check-in codes are 6 digits and match only the current code", () => {
  const code = codeFor(SECRET, sess);
  assert.match(code, /^\d{6}$/);
  assert.ok(codeMatches(SECRET, sess, code));
  assert.ok(!codeMatches(SECRET, sess, "12345"));
  assert.ok(!codeMatches(SECRET, sess, "abcdef"));
  assert.ok(!codeMatches(SECRET, { ...sess, seed: "seed-2" }, code), "a new code replaces the old one");
});

test("codes differ per session, per new code and per secret", () => {
  assert.notEqual(codeFor(SECRET, sess), codeFor(SECRET, { ...sess, _id: "s2" }));
  assert.notEqual(codeFor(SECRET, sess), codeFor(SECRET, { ...sess, seed: "seed-2" }));
  assert.notEqual(codeFor(SECRET, sess), codeFor("y".repeat(40), sess));
});

test("a code works for 10 minutes", () => {
  const now = new Date();
  const s = { closedAt: null, expiresAt: new Date(now.getTime() + CODE_VALID_MINUTES * 60_000) };
  assert.ok(isOpen(s, now));
  assert.ok(msLeft(s, now) > 0);
  assert.ok(!isOpen(s, new Date(now.getTime() + CODE_VALID_MINUTES * 60_000 + 1)));
});

test("without a class start time, lateness is measured from the first code", () => {
  const openedAt = new Date("2026-10-13T13:00:00Z");
  const s = { openedAt, lateAfterMinutes: 10 };
  assert.equal(statusAt(s, new Date("2026-10-13T13:10:00Z")), "PRESENT");
  assert.equal(statusAt(s, new Date("2026-10-13T13:10:01Z")), "LATE");
});

test("with a class start time, lateness is measured from the start time plus the grace minutes", () => {
  assert.equal(checkInStatus("09:10", "09:00", 10, "LATE"), "PRESENT");
  assert.equal(checkInStatus("09:11", "09:00", 10, "PRESENT"), "LATE");
  assert.equal(checkInStatus("09:05", "09:00", 0, "PRESENT"), "LATE");
  assert.equal(checkInStatus("09:30", null, 10, "PRESENT"), "PRESENT", "falls back when the class has no start time");
});

test("check-in closes when closed or expired", () => {
  const now = new Date();
  assert.ok(isOpen({ closedAt: null, expiresAt: new Date(now.getTime() + 1000) }, now));
  assert.ok(!isOpen({ closedAt: now, expiresAt: new Date(now.getTime() + 1000) }, now));
  assert.ok(!isOpen({ closedAt: null, expiresAt: new Date(now.getTime() - 1) }, now));
});

test("two students on one phone are both flagged", () => {
  const flags = sharedDevices({ a: { deviceId: "d1" }, b: { deviceId: "d1" }, c: { deviceId: "d2" } });
  assert.deepEqual(flags.get("a"), ["b"]);
  assert.deepEqual(flags.get("b"), ["a"]);
  assert.equal(flags.has("c"), false);
});

// ---- Daily statuses and the EQISS report ----
import { attended, biweeklyCodeFor, statusForBiweeklyCode } from "../src/lib/attendance-rules";

test("day statuses map to EQISS codes and back", () => {
  assert.equal(biweeklyCodeFor("ABSENT"), "A");
  assert.equal(biweeklyCodeFor("EXCUSED"), "A");
  assert.equal(biweeklyCodeFor("HOLIDAY"), "H");
  assert.equal(biweeklyCodeFor("SICK"), "S");
  assert.equal(biweeklyCodeFor("PRESENT"), "");
  assert.equal(biweeklyCodeFor("LATE"), "");
  assert.equal(statusForBiweeklyCode("S"), "SICK");
  assert.equal(statusForBiweeklyCode("H"), "HOLIDAY");
  assert.equal(statusForBiweeklyCode("A"), "ABSENT");
  assert.equal(statusForBiweeklyCode(""), null);
  assert.ok(attended("PRESENT") && attended("LATE") && !attended("SICK") && !attended("ABSENT"));
});

test("rate limit counts the overlap with the previous window", () => {
  // Same weighting as lib/rate-limit.ts: 6 attempts just before a boundary + 5 just after must exceed a limit of 10.
  const estimate = (curr: number, prev: number, elapsed: number) => curr + prev * (1 - elapsed);
  assert.ok(estimate(5, 6, 0.01) > 10);
  assert.ok(estimate(5, 6, 0.99) <= 10); // the old attempts have aged out
});

// ---- Official enrollment forms (October 2026 packets) ----

test("all Common and Private forms carry the official wording; only the Non-Private agreement is still pending", () => {
  assert.deepEqual(TEMPLATES.filter((t) => t.pendingOfficialText).map((t) => t.key), ["nonprivate_agreement"]);
  assert.equal(TEMPLATES.some((t) => t.key === "laptop_receipt"), false, "laptop receipt is signed in person, not online");
  assert.deepEqual(templatesFor("PRIVATE").map((t) => t.key).slice(7), ["private_agreement_1", "private_agreement_2", "refund_schedule"]);
});

test("Yes answers on the Background Check need an explanation", () => {
  const t = TEMPLATES.find((x) => x.key === "background_check")!;
  const base = { firstName: "Ana", lastName: "Diaz", street: "1 Main St", city: "Jersey City", state: "NJ", zip: "07306", dateOfBirth: "1990-01-01", ssn: "123456789", arrested: "No", abuse: "No", lifestyle: "No" };
  const ok = schemaFor(t).safeParse(coerceRaw(t, base));
  assert.ok(ok.success);
  assert.equal((ok as { data: Record<string, unknown> }).data.ssn, "123-45-6789", "SSNs are stored in one format");
  const bad = schemaFor(t).safeParse(coerceRaw(t, { ...base, arrested: "Yes" }));
  assert.ok(!bad.success && bad.error.issues.some((i) => i.path[0] === "explain"));
  assert.ok(schemaFor(t).safeParse(coerceRaw(t, { ...base, arrested: "Yes", explain: "2005, dismissed" })).success);
});

test("check-all-that-apply answers are lists limited to the printed options", () => {
  const t = TEMPLATES.find((x) => x.key === "workforce_registration")!;
  const raw = coerceRaw(t, { race: ["Asian", "White"], contactBy: "Email" });
  assert.deepEqual(raw.race, ["Asian", "White"]);
  assert.deepEqual(raw.contactBy, ["Email"]);
  const r = schemaFor(t).safeParse(coerceRaw(t, { race: ["Martian"] }));
  assert.ok(!r.success && r.error.issues.some((i) => i.path[0] === "race"));
});

test("heading and note lines never store an answer", () => {
  for (const t of TEMPLATES) {
    const keys = Object.keys(coerceRaw(t, {}));
    for (const f of t.fields.filter((x) => x.type === "heading" || x.type === "note")) assert.ok(!keys.includes(f.name), `${t.key}.${f.name}`);
  }
});

test("Private forms show the chosen course's fees; Non-Private students never get them", () => {
  const t = TEMPLATES.find((x) => x.key === "private_agreement_1")!;
  const body = (t.body as (c: unknown) => string[])({ studentName: "Ana Diaz", course: { name: "Pharmacy Technician", fees: { tuitionCents: 350000, feesCents: 17500, booksCents: 27500, toolsCents: 0, otherCents: 0 } } });
  assert.ok(body.some((p) => p.includes("Ana Diaz") && p.includes("Pharmacy Technician")));
  assert.ok(body.some((p) => p.includes("Tuition $3,500") && p.includes("Books $275") && p.includes("other $175")));
  for (const c of ["EQISS", "DFS"] as const) assert.ok(templatesFor(c).every((x) => !x.containsFees));
});

test("Private payment comes before the forms", () => {
  assert.ok(formsBlockedByPayment({ category: "PRIVATE", paymentStatus: "PENDING" }));
  assert.ok(formsBlockedByPayment({ category: "PRIVATE", paymentStatus: "REQUESTED" }));
  assert.ok(!formsBlockedByPayment({ category: "PRIVATE", paymentStatus: "PAID" }));
  assert.ok(!formsBlockedByPayment({ category: "EQISS", paymentStatus: "NOT_REQUIRED" }));
});
