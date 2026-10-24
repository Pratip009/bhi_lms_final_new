import { assertCanManageClass } from "@/lib/authz";
import { searchAttendance } from "@/lib/queries";
import { apiUser, csvCell, deny, isUuid } from "@/lib/http";

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "INSTRUCTOR")) return deny(user ? 404 : 401);
  const sp = new URL(req.url).searchParams;
  const classId = sp.get("classId");
  const studentId = sp.get("studentId");
  const from = sp.get("from");
  const to = sp.get("to");
  if (isUuid(classId)) {
    try {
      await assertCanManageClass(user, classId);
    } catch {
      return deny();
    }
  } else if (user.role !== "ADMIN") {
    return new Response("classId is required", { status: 400 });
  }
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const rows = await searchAttendance({
    classId: isUuid(classId) ? classId : undefined,
    studentId: isUuid(studentId) ? studentId : undefined,
    from: isDate(from) ? from! : undefined,
    to: isDate(to) ? to! : undefined,
  });
  const lines = [["Date", "Student", "Email", "Class", "Status", "Hours", "Note"].map(csvCell).join(",")];
  for (const r of rows) lines.push([r.date, r.student, r.email, r.code, r.status, r.hours.toFixed(2), r.note].map(csvCell).join(","));
  return new Response(lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="attendance.csv"', "Cache-Control": "private, no-store" },
  });
}
