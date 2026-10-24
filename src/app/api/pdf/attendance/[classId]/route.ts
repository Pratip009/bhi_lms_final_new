import { assertCanManageClass } from "@/lib/authz";
import { buildAttendancePdf } from "@/lib/pdf/attendance";
import { apiUser, deny, fileResponse, isUuid } from "@/lib/http";

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request, { params }: { params: Promise<{ classId: string }> }) {
  const user = await apiUser();
  if (!user) return deny(401);
  const { classId } = await params;
  if (!isUuid(classId)) return deny();
  try {
    await assertCanManageClass(user, classId);
  } catch {
    return deny();
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isDate(from) || !isDate(to) || from! > to!) return new Response("Invalid date range", { status: 400 });
  const pdf = await buildAttendancePdf(classId, from!, to!);
  return fileResponse(pdf, "application/pdf", `attendance-${from}-to-${to}.pdf`, false);
}
