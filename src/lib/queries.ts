import "server-only";
import { CATEGORY_LABELS } from "@/lib/forms/templates";
import { cols, type Klass, type Course, type User, type Enrollment, type AttendanceStatus } from "@/db";
import { todayLocal } from "@/lib/dates";
import { isPendingFill } from "@/lib/attendance-math";

type PublicUser = Pick<User, "_id" | "name" | "email">;
const publicUser = { projection: { _id: 1, name: 1, email: 1 } } as const;

export async function usersById(ids: string[]): Promise<Map<string, PublicUser>> {
  if (!ids.length) return new Map();
  const { users } = await cols();
  const list = await users.find({ _id: { $in: [...new Set(ids)] } }, publicUser).toArray();
  return new Map(list.map((u) => [u._id, u]));
}

export async function coursesById(ids: string[]): Promise<Map<string, Course>> {
  if (!ids.length) return new Map();
  const { courses } = await cols();
  return new Map((await courses.find({ _id: { $in: [...new Set(ids)] } }).toArray()).map((c) => [c._id, c]));
}

export async function getClassWithCourse(classId: string): Promise<{ klass: Klass; course: Course } | null> {
  const { classes, courses } = await cols();
  const klass = await classes.findOne({ _id: classId });
  if (!klass) return null;
  const course = await courses.findOne({ _id: klass.courseId });
  return course ? { klass, course } : null;
}

export async function classesForStudent(studentId: string) {
  const { enrollments, classes } = await cols();
  const list = await enrollments.find({ studentId, status: "ACTIVE" }).toArray();
  const ks = await classes.find({ _id: { $in: list.map((e) => e.classId) } }).sort({ startDate: 1 }).toArray();
  const cs = await coursesById(ks.map((k) => k.courseId));
  return ks.map((klass) => ({ klass, course: cs.get(klass.courseId)!, enrollment: list.find((e) => e.classId === klass._id)! }));
}

export async function instructorsForClasses(ks: Klass[]) {
  const people = await usersById(ks.flatMap((k) => k.instructors.map((i) => i.instructorId)));
  return ks.flatMap((k) =>
    k.instructors.filter((i) => people.has(i.instructorId)).map((i) => ({ classId: k._id, role: i.role, ...people.get(i.instructorId)! })),
  );
}

export type AttendanceRow = { date: string; status: AttendanceStatus; hours: number; note: string };

export async function attendanceForEnrollment(e: Pick<Enrollment, "_id" | "classId">): Promise<AttendanceRow[]> {
  const { classSessions } = await cols();
  const sessions = await classSessions.find({ classId: e.classId, [`records.${e._id}`]: { $exists: true } }).sort({ date: 1 }).toArray();
  return sessions.map((s) => ({ date: s.date, ...s.records[e._id] }));
}

export async function rosterForClass(classId: string) {
  const { enrollments, applications } = await cols();
  const list = await enrollments.find({ classId }).toArray();
  const people = await usersById(list.map((e) => e.studentId));
  const apps = await applications.find({ studentId: { $in: list.map((e) => e.studentId) } }, { projection: { studentId: 1, category: 1 } }).toArray();
  return list
    .filter((e) => people.has(e.studentId))
    .map((enrollment) => ({
      enrollment,
      student: people.get(enrollment.studentId)!,
      category: apps.find((a) => a.studentId === enrollment.studentId)?.category ?? null,
    }))
    .sort((a, b) => a.student.name.localeCompare(b.student.name));
}

export async function classOptions() {
  const { classes, courses, enrollments } = await cols();
  const activeCourses = await courses.find({ archived: false }).toArray();
  const ks = await classes.find({ archived: false, courseId: { $in: activeCourses.map((c) => c._id) } }).sort({ startDate: 1 }).toArray();
  const counts = await enrollments
    .aggregate<{ _id: string; n: number }>([{ $match: { status: "ACTIVE" } }, { $group: { _id: "$classId", n: { $sum: 1 } } }])
    .toArray();
  return ks
    .map((k) => {
      const course = activeCourses.find((c) => c._id === k.courseId)!;
      const n = counts.find((c) => c._id === k._id)?.n ?? 0;
      return { id: k._id, label: `${course.name}: ${k.code}, ${k.cohort} (${n}/${k.capacity}) · ${k.fundingProgram === "MIXED" ? "Mixed funding" : CATEGORY_LABELS[k.fundingProgram]}`, sort: course.name };
    })
    .sort((a, b) => a.sort.localeCompare(b.sort));
}

export async function activeCountsByClass(): Promise<Map<string, number>> {
  const { enrollments } = await cols();
  const rows = await enrollments
    .aggregate<{ _id: string; n: number }>([{ $match: { status: "ACTIVE" } }, { $group: { _id: "$classId", n: { $sum: 1 } } }])
    .toArray();
  return new Map(rows.map((r) => [r._id, r.n]));
}

/** Escapes user text for use inside a case-insensitive $regex. */
export const regexSafe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const ATTENDANCE_LABEL: Record<string, string> = { PRESENT: "Present", ABSENT: "Absent", LATE: "Late", EXCUSED: "Excused", HOLIDAY: "Holiday" };

export type AttendanceSearch = { classId?: string; studentId?: string; from?: string; to?: string; limit?: number };

/** Flattens class-session documents into one row per student per date, newest first. */
export async function searchAttendance(q: AttendanceSearch) {
  const { classSessions, enrollments, classes } = await cols();
  const enrollmentFilter: Record<string, unknown> = {};
  if (q.classId) enrollmentFilter.classId = q.classId;
  if (q.studentId) enrollmentFilter.studentId = q.studentId;
  const ens = await enrollments.find(enrollmentFilter).toArray();
  if (!ens.length) return [];
  const byId = new Map(ens.map((e) => [e._id, e]));
  const dateFilter: Record<string, string> = {};
  if (q.from) dateFilter.$gte = q.from;
  if (q.to) dateFilter.$lte = q.to;
  const sessions = await classSessions
    .find({ classId: { $in: [...new Set(ens.map((e) => e.classId))] }, ...(q.from || q.to ? { date: dateFilter } : {}) })
    .sort({ date: -1 })
    .limit(5000)
    .toArray();
  const people = await usersById(ens.map((e) => e.studentId));
  const codes = new Map((await classes.find({ _id: { $in: sessions.map((s) => s.classId) } }, { projection: { code: 1 } }).toArray()).map((k) => [k._id, k.code]));
  const rows = sessions.flatMap((s) =>
    Object.entries(s.records)
      .filter(([eid]) => byId.has(eid))
      .map(([eid, r]) => {
        const e = byId.get(eid)!;
        const u = people.get(e.studentId);
        return { date: s.date, classId: s.classId, code: codes.get(s.classId) ?? "", studentId: e.studentId, student: u?.name ?? "", email: u?.email ?? "", ...r };
      }),
  );
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.student.localeCompare(b.student));
  return rows.slice(0, q.limit ?? 50_000);
}

/**
 * Class days (last 60) that still need the instructor: students who checked in but haven't filled out
 * the day, or a day with marks that isn't signed yet.
 */
export async function attendanceToDo(classIds?: string[]) {
  const { classSessions } = await cols();
  const today = todayLocal();
  const since = todayLocal(new Date(Date.now() - 60 * 86_400_000));
  const days = await classSessions
    .find({ date: { $gte: since, $lte: today }, ...(classIds ? { classId: { $in: classIds } } : {}) }, { projection: { classId: 1, date: 1, records: 1, signoff: 1 } })
    .toArray();
  return days
    .map((d) => {
      const recs = Object.values(d.records ?? {});
      return { classId: d.classId, date: d.date, pending: recs.filter((r) => isPendingFill(r)).length, unsigned: recs.length > 0 && !d.signoff };
    })
    .filter((x) => x.pending > 0 || x.unsigned)
    .sort((a, b) => b.date.localeCompare(a.date));
}
