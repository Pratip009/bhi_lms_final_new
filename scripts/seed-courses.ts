import { loadEnvConfig } from "@next/env";
// Read .env, .env.local etc. the same way the website does, so `npm run db:...` sees MONGODB_URI.
loadEnvConfig(process.cwd());
import { MongoClient, type Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = { name: string; formerNames?: string[]; tuition: number; fees: number; books: number; tools: number; other: number; total: number; hours: number; certification: string };
const cents = (usd: number) => Math.round(usd * 100);

/**
 * Adds the official BHI course list (data/bhi-courses.json) with fees and hours. Safe to run again:
 * a course that already exists (same name) is left as the admin set it, except that missing fees,
 * hours or certification are filled in. New courses are open to every enrollment type until an admin
 * limits them on the Courses page.
 */
export async function seedCourses(db: Db) {
  const file = JSON.parse(readFileSync(join(__dirname, "..", "data", "bhi-courses.json"), "utf8")) as { courses: Row[] };
  const courses = db.collection("courses");
  let added = 0, completed = 0;
  for (const r of file.courses) {
    const sum = r.tuition + r.fees + r.books + r.tools + r.other;
    if (sum !== r.total) throw new Error(`${r.name}: fees add up to ${sum}, but the total says ${r.total}`);
    const fees = { tuitionCents: cents(r.tuition), feesCents: cents(r.fees), booksCents: cents(r.books), toolsCents: cents(r.tools), otherCents: cents(r.other) };
    // A course loaded under an earlier spelling of its name is renamed, never duplicated.
    let existing = await courses.findOne({ name: r.name });
    if (!existing && r.formerNames?.length) {
      existing = await courses.findOne({ name: { $in: r.formerNames } });
      if (existing) await courses.updateOne({ _id: existing._id }, { $set: { name: r.name } });
    }
    if (!existing) {
      await courses.insertOne({
        _id: randomUUID() as unknown as never, name: r.name, description: "", fundingPrograms: [], archived: false, createdAt: new Date(),
        fees, hours: r.hours, certification: r.certification || null,
      });
      added++;
      continue;
    }
    const set: Record<string, unknown> = {};
    if (!existing.fees) set.fees = fees;
    if (existing.hours == null) set.hours = r.hours;
    if (!existing.certification && r.certification) set.certification = r.certification;
    if (Object.keys(set).length) {
      await courses.updateOne({ _id: existing._id }, { $set: set });
      completed++;
    }
  }
  console.log(`Courses: ${added} added, ${completed} completed with fees/hours, ${file.courses.length - added - completed} unchanged.`);
}

if (require.main === module) {
  (async () => {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    try {
      await seedCourses(client.db(process.env.MONGODB_DB || undefined));
    } finally {
      await client.close();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
