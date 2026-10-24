import type { Metadata } from "next";
import Link from "next/link";
import { cols, type User } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { ActionButton, AddInstructorForm } from "@/components/action-widgets";
import { Badge, Card, Empty, PageHeader, StatusBadge, Table, Td, fmtDate } from "@/components/ui";
import { createInstructorAction, decideInstructorAction, resendInviteAction } from "../actions";

export const metadata: Metadata = { title: "Instructors" };

function AccountStatus({ i }: { i: User }) {
  if (i.disabledAt) return <Badge tone="brick">Disabled</Badge>;
  if (i.instructorStatus === "REJECTED") return <StatusBadge status="REJECTED" />;
  if (!i.emailVerifiedAt) {
    const expired = !i.inviteExpiresAt || i.inviteExpiresAt < new Date();
    return <Badge tone="marigold">{expired ? "Invite expired" : `Invited, expires ${fmtDate(i.inviteExpiresAt)}`}</Badge>;
  }
  return <Badge tone="pine">Active</Badge>;
}

export default async function InstructorsPage() {
  await requireAdmin();
  const { users, classes } = await cols();
  const instructors = await users.find({ role: "INSTRUCTOR" }, { projection: { passwordHash: 0, inviteTokenHash: 0 } }).sort({ name: 1 }).toArray();
  const ks = await classes.find({ "instructors.0": { $exists: true } }, { projection: { instructors: 1 } }).toArray();
  const classCount = (id: string) => ks.filter((k) => k.instructors.some((i) => i.instructorId === id)).length;
  // Only accounts that self-registered before admin-created accounts existed can still be pending.
  const legacyPending = instructors.filter((i) => i.instructorStatus === "PENDING");
  const others = instructors.filter((i) => i.instructorStatus !== "PENDING");
  return (
    <>
      <PageHeader title="Instructors" description="Add instructors here. Each gets an email link to set their own password, then you assign them to classes from each class page." />
      <Card title="Add an instructor" className="mb-6">
        <AddInstructorForm action={createInstructorAction} />
      </Card>

      {legacyPending.length > 0 && (
        <Card title={`Older sign-ups waiting for approval (${legacyPending.length})`} className="mb-6">
          <ul className="divide-y divide-line">
            {legacyPending.map((i) => (
              <li key={i._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{i.name}</p>
                  <p className="text-sm text-slate-600">{i.email}, signed up {fmtDate(i.createdAt)}{i.emailVerifiedAt ? "" : " (email not verified yet)"}</p>
                </div>
                <div className="flex gap-2">
                  <ActionButton action={decideInstructorAction.bind(null, i._id)} label="Approve" hidden={{ decision: "APPROVED" }} />
                  <ActionButton action={decideInstructorAction.bind(null, i._id)} label="Reject" variant="secondary" hidden={{ decision: "REJECTED" }} confirm={`Reject ${i.name}?`} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {others.length === 0 ? <Empty>No instructors yet. Add one above.</Empty> : (
        <Table head={["Instructor", "Account", "Classes", ""]}>
          {others.map((i) => (
            <tr key={i._id}>
              <Td><Link href={`/admin/instructors/${i._id}`} className="font-semibold text-pine-700 underline">{i.name}</Link><p className="text-slate-500">{i.email}</p></Td>
              <Td><AccountStatus i={i} /></Td>
              <Td className="tabular-nums">{classCount(i._id)}</Td>
              <Td>
                {i.instructorStatus === "REJECTED" ? (
                  <ActionButton action={decideInstructorAction.bind(null, i._id)} label="Approve" variant="ghost" hidden={{ decision: "APPROVED" }} />
                ) : !i.emailVerifiedAt && !i.disabledAt ? (
                  <ActionButton action={resendInviteAction.bind(null, i._id)} label="Resend invite" variant="ghost" />
                ) : (
                  <Link href={`/admin/instructors/${i._id}`} className="text-pine-700 underline">View classes</Link>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}