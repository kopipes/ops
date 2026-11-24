import { redirect } from "next/navigation";
import { requireUserWithoutPasswordChange } from "@/server/auth/current-user";

export default async function LegacyChecklistPage() {
  await requireUserWithoutPasswordChange();
  redirect("/master/templates");
}
