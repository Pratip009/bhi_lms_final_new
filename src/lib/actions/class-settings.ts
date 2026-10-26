"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cols } from "@/db";
import { requireUser } from "@/lib/auth";
import { assertCanManageClass, ForbiddenError } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { scheduleProblem } from "@/lib/attendance-math";
import { sendClassroomLinkEmail, trySend } from "@/lib/email";
import { getClassWithCourse } from "@/lib/queries";
import type { ActionState } from "@/lib/action";

const uuid = z.string().uuid();

async function guard(classId: string) {
  const user = await requireUser();
  if (!uuid.safeParse(classId).success) return { user, error: { error: "Unknown class." } as ActionState };
  try {
    await assertCanManageClass(user, classId);
    return { user, error: null };
  } catch (e) {
    if (e instanceof ForbiddenError) return { user, error: { error: "You don't have access to this class." } as ActionState };
    throw e;
  }
}

/** A plain https link (Google Classroom, Meet...). Anything else (javascript:, http:, typos) is refused. */
function parseLink(raw: string): string | null {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Instructor or admin: the class's Google Classroom link and daily schedule. The schedule is used when
 * students fill out a day (hours outside class time and the break are not counted). Changing it only
 * affects days filled out afterwards; days already filled keep their hours.
 */
export async function saveClassSettingsAction(classId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { user, error } = await guard(classId);
  if (error) return error;
  const url = parseLink(String(fd.get("classroomUrl") ?? "").trim());
  if (url === null) return { fieldErrors: { classroomUrl: "Paste the full link, starting with https://" } };
  const t = (k: string) => String(fd.get(k) ?? "").trim() || null;
  const schedule = { sessionStart: t("sessionStart"), sessionEnd: t("sessionEnd"), breakStart: t("breakStart"), breakEnd: t("breakEnd") };
  const problem = scheduleProblem(schedule);
  if (problem) return { error: problem };
  const { classes } = await cols();
  const before = await classes.findOne({ _id: classId }, { projection: { classroomUrl: 1, sessionStart: 1, sessionEnd: 1, breakStart: 1, breakEnd: 1 } });
  if (!before) return { error: "Unknown class." };
  const linkChanged = (before.classroomUrl ?? "") !== url;
  await classes.updateOne({ _id: classId }, { $set: { classroomUrl: url || null, ...schedule, ...(linkChanged ? { classroomSentAt: null } : {}) } });
  await audit(user._id, "class.settings", "class", classId, { before, after: { classroomUrl: url || null, ...schedule } });
  revalidatePath("/instructor", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: linkChanged && url ? "Saved. Press “Email the link to students” to send it." : "Class settings saved." };
}

/** Emails the class's Google Classroom link to every active student. */
export async function sendClassroomLinkAction(classId: string, _: ActionState): Promise<ActionState> {
  const { user, error } = await guard(classId);
  if (error) return error;
  if (!(await rateLimit(`classroom-mail:${classId}`, 5, 3600))) return { error: "The link was sent several times in the last hour. Try again later." };
  const row = await getClassWithCourse(classId);
  if (!row) return { error: "Unknown class." };
  const url = row.klass.classroomUrl;
  if (!url) return { error: "Save the Google Classroom link first." };
  const { enrollments, users, classes } = await cols();
  const active = await enrollments.find({ classId, status: "ACTIVE" }, { projection: { studentId: 1 } }).toArray();
  if (!active.length) return { error: "There are no students in this class yet." };
  const people = await users.find({ _id: { $in: active.map((e) => e.studentId) }, disabledAt: null }, { projection: { name: 1, email: 1 } }).toArray();
  const className = `${row.course.name} (${row.klass.code})`;
  let sent = 0;
  const failed: string[] = [];
  for (const p of people) {
    if (await trySend(() => sendClassroomLinkEmail(p.email, p.name, className, url, user.name))) sent++;
    else failed.push(p.name);
  }
  if (sent) await classes.updateOne({ _id: classId }, { $set: { classroomSentAt: new Date() } });
  await audit(user._id, "class.classroom_link_sent", "class", classId, { sent, failed: failed.length });
  revalidatePath("/instructor", "layout");
  revalidatePath("/admin", "layout");
  if (failed.length) return { error: `Sent to ${sent} of ${people.length}. Couldn't email: ${failed.join(", ")}. The link is still on their dashboards.` };
  return { ok: true, message: `Google Classroom link emailed to ${sent} student${sent === 1 ? "" : "s"}.` };
}
