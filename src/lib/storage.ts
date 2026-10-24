import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Private file storage on local disk, outside /public. Files are only reachable through
 * /api/files/[id], which checks permissions. Swap this module for S3/R2 by keeping the same API.
 */
const root = () => path.resolve(env().STORAGE_DIR);

function resolveKey(key: string) {
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.[a-z0-9]{2,5}$/.test(key)) throw new Error("Invalid storage key");
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function putFile(folder: string, ext: string, data: Buffer): Promise<string> {
  const key = `${folder}/${randomUUID()}.${ext}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { mode: 0o600 });
  return key;
}

export const getFile = (key: string) => readFile(resolveKey(key));
export const deleteFile = async (key: string) => unlink(resolveKey(key)).catch(() => undefined);
