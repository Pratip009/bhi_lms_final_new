import "server-only";
import { randomUUID } from "node:crypto";
import { GridFSBucket } from "mongodb";
import { database } from "@/db";

/**
 * Private file storage in MongoDB GridFS (collections uploads.files + uploads.chunks).
 * Works on any host, including Vercel, because nothing is written to local disk.
 * Files are only reachable through /api/files/[id], which checks permissions.
 * The storage key ("<applicationId>/<uuid>.<ext>") is used as the GridFS file _id. The driver types
 * ids as ObjectId, but GridFS accepts any BSON value as an id, hence the `as never` casts.
 */
const KEY_RE = /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.[a-z0-9]{2,5}$/;

function checkKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
  return key;
}

async function bucket() {
  return new GridFSBucket(await database(), { bucketName: "uploads" });
}

export async function putFile(folder: string, ext: string, data: Buffer, contentType?: string): Promise<string> {
  const key = checkKey(`${folder}/${randomUUID()}.${ext}`);
  const b = await bucket();
  await new Promise<void>((resolve, reject) => {
    const stream = b.openUploadStreamWithId(key as never, key, { metadata: { contentType: contentType ?? null } });
    stream.once("finish", () => resolve());
    stream.once("error", reject);
    stream.end(data);
  });
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  const b = await bucket();
  const chunks: Buffer[] = [];
  for await (const chunk of b.openDownloadStream(checkKey(key) as never)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function deleteFile(key: string): Promise<void> {
  try {
    await (await bucket()).delete(checkKey(key) as never);
  } catch {
    /* best effort: file may already be gone */
  }
}