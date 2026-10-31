import { loadEnvConfig } from "@next/env";
// Read .env, .env.local etc. the same way the website does, so `npm run db:...` sees MONGODB_URI.
loadEnvConfig(process.cwd());
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { ensureIndexes } from "./indexes";
import { seedCourses } from "./seed-courses";
import { canonicalEmail } from "../src/lib/email-canonical";

/**
 * Creates the admin accounts listed in SEED_ADMINS ("Name:email,Name:email").
 * Each new admin gets a random one-time password printed once; they should change it
 * with "Forgot password" (OTP by email) after first sign-in. Existing accounts are left alone.
 */
async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db(process.env.MONGODB_DB || undefined);
  await ensureIndexes(db);
  await seedCourses(db);
  const users = db.collection("users");
  const entries = (process.env.SEED_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, email] = s.split(":").map((x) => x.trim());
      if (!name || !email || !email.includes("@")) throw new Error(`Bad SEED_ADMINS entry: ${s}`);
      return { name, email: email.toLowerCase() };
    });
  if (!entries.length) throw new Error("SEED_ADMINS is empty");

  for (const { name, email } of entries) {
    const existing = await users.findOne({ email });
    if (existing) {
      console.log(`- ${email} already exists (role ${existing.role}); skipped`);
      continue;
    }
    const password = randomBytes(12).toString("base64url");
    const now = new Date();
    await users.insertOne({
      _id: randomUUID() as never, name, email, emailCanonical: canonicalEmail(email), role: "ADMIN", instructorStatus: null,
      passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: now, disabledAt: null, passwordChangedAt: now, createdAt: now,
    });
    console.log(`+ ${name} <${email}>  one-time password: ${password}`);
  }
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
