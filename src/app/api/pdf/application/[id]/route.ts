import { assertCanViewApplication } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { buildApplicationPdf } from "@/lib/pdf/packet";
import { apiUser, deny, fileResponse, isUuid } from "@/lib/http";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return deny(401);
  const { id } = await params;
  if (!isUuid(id)) return deny();
  try {
    await assertCanViewApplication(user, id);
  } catch {
    return deny();
  }
  const pdf = await buildApplicationPdf(id);
  await audit(user._id, "application.download_pdf", "application", id);
  return fileResponse(pdf, "application/pdf", `enrollment-packet-${id.slice(0, 8)}.pdf`, false);
}
