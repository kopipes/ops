"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import {
  issueCommentSchema,
  issueInputSchema,
  issueStatusChangeSchema,
} from "@/lib/schemas";
import {
  addIssueComment,
  changeIssueStatus,
  createIssue,
  softDeleteIssue,
  updateIssueFields,
} from "@/server/services/issues";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";

export interface IssueActionState {
  ok?: boolean;
  error?: string;
  issueId?: string;
}

async function acting() {
  const session = await requireUser();
  return session.user;
}

function toError(err: unknown): IssueActionState {
  if (err instanceof ForbiddenError || err instanceof ValidationError) return { error: err.message };
  console.error("[issue action]", err);
  return { error: "Terjadi kesalahan. Coba lagi." };
}

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function parseIssueForm(formData: FormData) {
  return issueInputSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    categoryId: formData.get("categoryId"),
    severity: formData.get("severity") ?? "medium",
    nextStep: formData.get("nextStep"),
    picUserId: formData.get("picUserId") ?? "",
    picExternal: formData.get("picExternal") ?? "",
    dueAt: formData.get("dueAt") ?? "",
    photoIds: formData.getAll("photoIds").map(String).filter(Boolean),
    projectId: formData.get("projectId"),
    projectDayId: formData.get("projectDayId") ?? "",
    phase: (formData.get("phase") as string) || null,
    checkResultId: formData.get("checkResultId") ?? "",
    reportId: formData.get("reportId") ?? "",
  });
}

export async function createIssueAction(
  _prev: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const user = await acting();
  const parsed = parseIssueForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  try {
    const { issueId } = await createIssue(getDb(), user, parsed.data);
    revalidatePath("/issues");
    revalidatePath(`/projects/${parsed.data.projectId}`);
    redirect(`/issues/${issueId}`);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return toError(err);
  }
}

export async function updateIssueAction(
  _prev: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const user = await acting();
  const issueId = String(formData.get("issueId") ?? "");
  const parsed = parseIssueForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  try {
    const res = await updateIssueFields(getDb(), user, issueId, parsed.data);
    revalidatePath(`/issues/${issueId}`);
    revalidatePath("/issues");
    return {
      ok: true,
      issueId,
      error: res.changed ? undefined : "Tidak ada perubahan.",
    };
  } catch (err) {
    return toError(err);
  }
}

export async function changeIssueStatusAction(formData: FormData): Promise<void> {
  const user = await acting();
  const parsed = issueStatusChangeSchema.safeParse({
    issueId: formData.get("issueId"),
    status: formData.get("status"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return;

  try {
    await changeIssueStatus(
      getDb(),
      user,
      parsed.data.issueId,
      parsed.data.status,
      parsed.data.note,
    );
    revalidatePath(`/issues/${parsed.data.issueId}`);
    revalidatePath("/issues");
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    revalidatePath("/");
    revalidatePath("/reports/day/[id]", "page");
    revalidatePath("/projects/[id]", "page");
  } catch (err) {
    console.error("[issue status]", toError(err));
  }
}

export async function addIssueCommentAction(formData: FormData): Promise<void> {
  const user = await acting();
  const parsed = issueCommentSchema.safeParse({
    issueId: formData.get("issueId"),
    note: formData.get("note"),
    photoIds: formData.getAll("photoIds").map(String).filter(Boolean),
  });
  if (!parsed.success) return;

  try {
    await addIssueComment(getDb(), user, parsed.data.issueId, parsed.data.note, parsed.data.photoIds);
    revalidatePath(`/issues/${parsed.data.issueId}`);
  } catch (err) {
    console.error("[issue comment]", toError(err));
  }
}

export async function softDeleteIssueAction(formData: FormData): Promise<void> {
  const user = await acting();
  const issueId = String(formData.get("issueId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!issueId) return;

  try {
    await softDeleteIssue(getDb(), user, issueId, reason);
    revalidatePath("/issues");
    redirect("/issues");
  } catch (err) {
    console.error("[issue delete]", toError(err));
  }
}
