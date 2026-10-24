import "server-only";
import { cols, newId } from "@/db";

export async function audit(actorId: string | null, action: string, entity: string, entityId: string | null, meta: Record<string, unknown> = {}) {
  const { auditLogs } = await cols();
  await auditLogs.insertOne({ _id: newId(), actorId, action, entity, entityId, meta, createdAt: new Date() });
}
