import { MongoClient } from "mongodb";
import { ensureIndexes } from "./indexes";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  await ensureIndexes(client.db(process.env.MONGODB_DB || undefined));
  await client.close();
  console.log("Indexes are in place.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
