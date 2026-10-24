import { cols } from "@/db";
import { getVisibleEnrollment } from "@/lib/authz";
import { buildReportPdf } from "@/lib/pdf/report";
import { apiUser, deny, fileResponse, isUuid } from "@/lib/http";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user || user.role === "STUDENT") return deny(user ? 404 : 401);
  const { id } = await params;
  if (!isUuid(id)) return deny();
  const rep = await (await cols()).progressReports.findOne({ _id: id }, { projection: { enrollmentId: 1, month: 1 } });
  if (!rep) return deny();
  try {
    await getVisibleEnrollment(user, rep.enrollmentId);
  } catch {
    return deny();
  }
  const pdf = await buildReportPdf(id);
  return fileResponse(pdf, "application/pdf", `progress-report-${rep.month}.pdf`, false);
}
