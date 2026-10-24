import { redirect } from "next/navigation";
import { currentUser, homePath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(await homePath(user));
}
