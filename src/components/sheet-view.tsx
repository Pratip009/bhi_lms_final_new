import { notFound } from "next/navigation";
import type { Enrollment, User } from "@/db";
import { cols } from "@/db";
import { getVisibleEnrollment, ForbiddenError } from "@/lib/authz";
import { thisMonthLocal } from "@/lib/dates";
import { usersById } from "@/lib/queries";
import { biweeklyPeriodsFor, biweeklyTotals, currentPeriodFor, getOrCreateBiweekly, loadMonthlySheet, periodAnchor, sheetFormatFor, sheetMonths } from "@/lib/sheets";
import { periodStartFor } from "@/lib/timesheet";
import { getClassWithCourse } from "@/lib/queries";
import { BiweeklySheet } from "./biweekly-sheet";
import { MonthlySheet } from "./monthly-sheet";
import { PageHeader } from "./ui";

export async function loadEnrollmentFor(user: User, enrollmentId: string): Promise<Enrollment> {
  if (!/^[0-9a-f-]{36}$/.test(enrollmentId)) notFound();
  try {
    return await getVisibleEnrollment(user, enrollmentId);
  } catch (e) {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  }
}

/**
 * The right attendance sheet for a student: the shared EQISS biweekly report (Hudson, Bergen and
 * Somerset alike) or the DFS / Private monthly handwritten sheet. Access is checked by the caller's
 * loadEnrollmentFor (admin, an instructor of the course, or the student themself).
 */
export async function SheetView({ user, enrollment, sp, basePath, back }: {
  user: User; enrollment: Enrollment; sp: { month?: string; period?: string }; basePath: string; back?: React.ReactNode;
}) {
  const row = await getClassWithCourse(enrollment.classId);
  if (!row) notFound();
  const student = await (await cols()).users.findOne({ _id: enrollment.studentId }, { projection: { name: 1 } });
  const studentName = student?.name ?? "";
  const format = await sheetFormatFor(enrollment.studentId);
  const header = (
    <>
      {back}
      <PageHeader title={`Attendance: ${studentName}`} description={`${row.course.name}, section ${row.klass.code}${enrollment.status !== "ACTIVE" ? ` (${enrollment.status.toLowerCase()}; history)` : ""}`} />
    </>
  );

  if (format === "BIWEEKLY") {
    const anchor = (await periodAnchor(enrollment)) || row.klass.startDate;
    const periods = biweeklyPeriodsFor(row.klass, anchor);
    const wanted = sp.period && /^\d{4}-\d{2}-\d{2}$/.test(sp.period) ? periodStartFor(anchor, sp.period) : currentPeriodFor(row.klass, anchor);
    const period = periods.includes(wanted) ? wanted : periods[0];
    if (!period) return <>{header}<p className="text-sm text-slate-600">The program hasn't started yet. The first two-week report opens on {row.klass.startDate}.</p></>;
    const sheet = await getOrCreateBiweekly(enrollment, period);
    if (!sheet) notFound();
    const totals = await biweeklyTotals(sheet);
    return (
      <>
        {header}
        <BiweeklySheet sheet={sheet} totals={totals} periods={periods} basePath={basePath} studentName={studentName}
          viewer={{ role: user.role, name: user.name }} />
      </>
    );
  }

  const months = sheetMonths(row.klass.startDate, row.klass.endDate);
  const month = sp.month && months.includes(sp.month) ? sp.month : months.includes(thisMonthLocal()) ? thisMonthLocal() : months[0];
  if (!month) return <>{header}<p className="text-sm text-slate-600">No months to show yet.</p></>;
  const sheet = await loadMonthlySheet(enrollment, month);
  if (!sheet) notFound();
  const recorders = await usersById(sheet.rows.map((r) => r.record?.recordedById).filter((x): x is string => !!x));
  return (
    <>
      {header}
      <MonthlySheet sheet={sheet} enrollmentId={enrollment._id} month={month} months={months} basePath={basePath}
        mode={user.role === "STUDENT" ? "VIEW" : "STAFF"} viewerName={user.name} signerNames={new Map([...recorders].map(([k, v]) => [k, v.name]))} />
    </>
  );
}
