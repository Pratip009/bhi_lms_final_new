import { MongoClient, type Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { ensureIndexes } from "./indexes";

/**
 * October 2026 data migration. Safe to run repeatedly; DRY RUN unless --apply is passed.
 *
 *   npx tsx scripts/migrate-2026-10.ts            # report what would change
 *   npx tsx scripts/migrate-2026-10.ts --apply    # change it
 *   ... --apply --course-assignments-from-sections  # also give each section instructor a course assignment
 *
 * What it does (nothing is deleted):
 * 1. Applications: the old "Hudson County" category becomes Non-Private / EQISS / One-Stop / Hudson County;
 *    old "EQISS" becomes Non-Private / EQISS / One-Stop with the county left blank (listed for an admin to set);
 *    "PRIVATE" gets enrollmentType PRIVATE. Approved students in a section get courseId from that section.
 *    Answers to the earlier placeholder forms stay on the application and are shown as "earlier form versions".
 * 2. Courses and sections: the "HUDSON_COUNTY" funding program becomes "EQISS".
 * 3. Enrollments: courseId is filled from their section.
 * 4. Optional: section-level instructors get a course assignment for that section's course. This widens
 *    their access to every section of the course, so it is opt-in.
 */
type Any = Record<string, unknown> & { _id: string };

export async function migrate(db: Db, apply: boolean, courseAssignments: boolean) {
  const log = (s: string) => console.log(`${apply ? "" : "[dry run] "}${s}`);
  const apps = db.collection<Any>("applications");
  const courses = db.collection<Any>("courses");
  const classes = db.collection<Any>("classes");
  const enrollments = db.collection<Any>("enrollments");
  const assignments = db.collection<Any>("course_assignments");
  const needCounty: string[] = [];

  // 1. Applications
  for (const a of await apps.find({ $or: [{ enrollmentType: { $exists: false } }, { enrollmentType: null }, { category: "HUDSON_COUNTY" }] }).toArray()) {
    let set: Record<string, unknown> | null = null;
    if (a.category === "HUDSON_COUNTY") set = { category: "EQISS", enrollmentType: "NON_PRIVATE", fundingProgram: "EQISS", county: "HUDSON" };
    else if (a.category === "EQISS") { set = { enrollmentType: "NON_PRIVATE", fundingProgram: "EQISS", county: a.county ?? null }; if (!a.county) needCounty.push(a._id); }
    else if (a.category === "PRIVATE") set = { enrollmentType: "PRIVATE", fundingProgram: null, county: null };
    else if (a.category == null) set = { enrollmentType: null, fundingProgram: null, county: null };
    if (!set) { log(`! application ${a._id}: unknown category ${String(a.category)}; left as is`); continue; }
    if (!("submissions" in a)) set.submissions = [];
    if (!("courseId" in a)) set.courseId = null;
    log(`application ${a._id}: ${String(a.category)} -> ${JSON.stringify(set)}`);
    if (apply) await apps.updateOne({ _id: a._id }, { $set: set });
  }
  // Approved students already in a section: record that section's course as their chosen course.
  for (const a of await apps.find({ status: "APPROVED", $or: [{ courseId: null }, { courseId: { $exists: false } }] }).toArray()) {
    const e = await enrollments.find({ studentId: a.studentId }).sort({ assignedAt: -1 }).limit(1).next();
    const k = e ? await classes.findOne({ _id: e.classId as string }) : null;
    if (!k) { log(`! approved application ${a._id} has no section; set its course by hand`); continue; }
    log(`application ${a._id}: courseId <- ${String(k.courseId)}`);
    if (apply) await apps.updateOne({ _id: a._id }, { $set: { courseId: k.courseId } });
  }

  // 2. Funding programs on courses and sections
  for (const c of await courses.find({ fundingPrograms: "HUDSON_COUNTY" }).toArray()) {
    const next = [...new Set((c.fundingPrograms as string[]).map((p) => (p === "HUDSON_COUNTY" ? "EQISS" : p)))];
    log(`course ${String(c.name)}: fundingPrograms ${JSON.stringify(c.fundingPrograms)} -> ${JSON.stringify(next)}`);
    if (apply) await courses.updateOne({ _id: c._id }, { $set: { fundingPrograms: next } });
  }
  const hc = await classes.countDocuments({ fundingProgram: "HUDSON_COUNTY" });
  if (hc) { log(`${hc} section(s): fundingProgram HUDSON_COUNTY -> EQISS`); if (apply) await classes.updateMany({ fundingProgram: "HUDSON_COUNTY" }, { $set: { fundingProgram: "EQISS" } }); }

  // 3. Enrollments
  const noCourse = await enrollments.find({ courseId: { $exists: false } }).toArray();
  if (noCourse.length) log(`${noCourse.length} enrollment(s): courseId filled from their section`);
  if (apply) for (const e of noCourse) {
    const k = await classes.findOne({ _id: e.classId as string }, { projection: { courseId: 1 } });
    if (k) await enrollments.updateOne({ _id: e._id }, { $set: { courseId: k.courseId } });
  }

  // 4. Optional course assignments
  if (courseAssignments) {
    for (const k of await classes.find({ archived: false, "instructors.0": { $exists: true } }).toArray()) {
      for (const i of k.instructors as { instructorId: string; assignedAt: Date }[]) {
        if (await assignments.findOne({ instructorId: i.instructorId, courseId: k.courseId as string, removedAt: null })) continue;
        log(`course assignment: instructor ${i.instructorId} -> course ${String(k.courseId)}`);
        if (apply) await assignments.insertOne({ _id: randomUUID(), instructorId: i.instructorId, courseId: k.courseId, assignedById: "migration", assignedAt: i.assignedAt ?? new Date(), removedAt: null, removedById: null });
      }
    }
  }

  if (needCounty.length) console.warn(`! ${needCounty.length} EQISS application(s) have no county (Hudson / Bergen / Somerset). Set it from each application's admin page: ${needCounty.join(", ")}`);
  if (!apply) console.log("\nDry run only. Re-run with --apply to make these changes (take a backup first).");
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  const apply = process.argv.includes("--apply");
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db(process.env.MONGODB_DB || undefined);
  if (apply) await ensureIndexes(db);
  await migrate(db, apply, process.argv.includes("--course-assignments-from-sections"));
  await client.close();
}

if (process.argv[1]?.includes("migrate-2026-10")) main().catch((e) => { console.error(e); process.exit(1); });
