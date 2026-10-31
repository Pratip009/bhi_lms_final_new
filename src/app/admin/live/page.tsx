import { AttendanceTabs } from "@/components/attendance-tabs";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { AdminLiveOverview } from "@/components/admin-live-overview";
import { todayLocal } from "@/lib/dates";

export const metadata: Metadata = { title: "Live attendance" };
export const dynamic = "force-dynamic";

export default async function AdminLivePage() {
  await requireAdmin();
  return (
    <>
      <AttendanceTabs active="today" />
      <PageHeader title="Live attendance" description={`Every class running today (${todayLocal()}). Updates by itself. Open a class to see each student.`} />
      <AdminLiveOverview />
    </>
  );
}
