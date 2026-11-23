"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { requireUser, requireUserWithoutPasswordChange } from "@/server/auth/current-user";
import {
  assignOfficerSchema,
  checkbox,
  dayTypeUpdateSchema,
  deleteProjectSchema,
  projectInputSchema,
  projectRoleSchema,
  projectChecklistEditSchema,
  PHASES,
  setMemberRoleSchema,
  setStatusSchema,
} from "@/lib/schemas";
import {
  createProject,
  generateProjectCode,
  loadFacts,
  setProjectStatus,
  softDeleteProject,
  updateProject,
  updateProjectDay,
} from "@/server/services/projects";
import {
  addMember,
  removeMember,
  setMemberRole,
} from "@/server/services/members";
import {
  buildChecklistFromProject,
  buildChecklistFromTemplates,
  syncProjectChecklist,
} from "@/server/services/project-checklist";
import { editProjectChecklist } from "@/server/services/project-checklist-editor";
import { divisions } from "@/server/db/schema";
import { canCreateProject, canViewProjectWorkspace } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";

export interface ProjectActionState {
  ok?: boolean;
  error?: string;
  projectId?: string;
}

async function acting() {
  const session = await requireUser();
  return session.user;
}

function toError(err: unknown): ProjectActionState {
  if (err instanceof ForbiddenError || err instanceof ValidationError) return { error: err.message };
  console.error("[project action]", err);
  return { error: "Terjadi kesalahan. Coba lagi." };
}

const revalidateProject = (id?: string) => {
  revalidatePath("/projects");
  if (id) revalidatePath(`/projects/${id}`);
  revalidatePath("/");
};

/** Suggests the next code for a division — used by the wizard's first step. */
export async function suggestProjectCodeAction(divisionId: string): Promise<string> {
  const db = getDb();
  const division = await db
    .select({ code: divisions.code })
    .from(divisions)
    .where(eq(divisions.id, divisionId))
    .get();
  return generateProjectCode(db, {
    divisionCode: division?.code ?? "PRJ",
    year: new Date().getFullYear(),
  });
}

export async function deleteProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const { user } = await requireUserWithoutPasswordChange();
  const parsed = deleteProjectSchema.safeParse({
    projectId: formData.get("projectId"),
    confirmationCode: formData.get("confirmationCode"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  try {
    await softDeleteProject(getDb(), user, parsed.data.projectId, parsed.data.reason, parsed.data.confirmationCode);
  } catch (err) {
    return toError(err);
  }
  revalidateProject(parsed.data.projectId);
  for (const path of ["/issues", "/reports", "/dashboard", "/admin/audit"]) revalidatePath(path);
  redirect("/projects?deleted=1");
}

function parseProjectForm(formData: FormData) {
  const additional = formData.getAll("additionalDivisionIds").map(String).filter(Boolean);

  const memberIds = formData.getAll("memberIds").map(String).filter(Boolean);
  const members = memberIds.map((userId) => ({
    userId,
    roleInProject: formData.get(`role_${userId}`) ?? "crew",
  }));

  // Checklist rows arrive as parallel arrays from the step-3 editor.
  const labels = formData.getAll("cl_label").map(String);
  const phases = formData.getAll("cl_phase").map(String);
  const categories = formData.getAll("cl_category").map(String);
  const sourceIds = formData.getAll("cl_source").map(String);
  const requireds = formData.getAll("cl_required").map(String);
  const photos = formData.getAll("cl_photo").map(String);
  const saveToMaster = formData.getAll("cl_savemaster").map(String);

  const checklistItems = labels.map((label, i) => ({
    sourceItemId: sourceIds[i] && sourceIds[i] !== "" ? sourceIds[i] : null,
    phase: phases[i] as "opening" | "monitoring" | "closing",
    categoryName: categories[i] || "Umum",
    label,
    description: null,
    isRequired: requireds[i] === "1",
    requiresPhoto: photos[i] === "1",
    saveToMaster: saveToMaster[i] === "1",
  }));

  return projectInputSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    client: formData.get("client") ?? "",
    venue: formData.get("venue"),
    address: formData.get("address") ?? "",
    description: formData.get("description") ?? "",
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    timezone: formData.get("timezone") ?? "Asia/Jakarta",
    ownerDivisionId: formData.get("ownerDivisionId"),
    additionalDivisionIds: additional,
    openingWindowStart: formData.get("openingWindowStart") ?? "06:00",
    openingWindowEnd: formData.get("openingWindowEnd") ?? "11:00",
    closingWindowStart: formData.get("closingWindowStart") ?? "17:00",
    closingWindowEnd: formData.get("closingWindowEnd") ?? "23:59",
    saveAsDraft: checkbox(formData.get("saveAsDraft")),
    checklistSource: (formData.get("checklistSource") as "template" | "project" | "empty") ?? "empty",
    templateIds: formData.getAll("templateIds").map(String).filter(Boolean),
    sourceProjectId: formData.get("sourceProjectId") ?? "",
    checklistItems,
    members,
  });
}

/**
 * Builds the final checklist rows for the wizard: the chosen source, merged with
 * anything the manager hand-added or unchecked in step 3.
 */
export async function resolveWizardChecklist(
  formData: FormData,
): Promise<{ rows: Awaited<ReturnType<typeof buildChecklistFromTemplates>> }> {
  const {user}=await requireUserWithoutPasswordChange();
  if(!canCreateProject(user))throw new ForbiddenError("Kamu tidak berhak membuat checklist project");
  const db = getDb();
  const source = (formData.get("checklistSource") as string) ?? "empty";
  const templateIds = formData.getAll("templateIds").map(String).filter(Boolean);
  const sourceProjectId = String(formData.get("sourceProjectId") ?? "").trim();

  let base: Awaited<ReturnType<typeof buildChecklistFromTemplates>> = [];
  if (source === "template") base = await buildChecklistFromTemplates(db, templateIds);
  else if (source === "project" && sourceProjectId) {
    if(!canViewProjectWorkspace(user,await loadFacts(db,sourceProjectId)))throw new ForbiddenError("Project sumber tidak tersedia dalam aksesmu");
    base = await buildChecklistFromProject(db, sourceProjectId);
  }

  // Rows the user unchecked are submitted with cl_removed=<sourceKey>.
  const removedKeys = new Set(formData.getAll("cl_removed").map(String));
  return { rows: base.filter((r) => !removedKeys.has(r.sourceItemId ?? `${r.phase}::${r.label}`)) };
}

export async function saveProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const user = await acting();
  const parsed = parseProjectForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  const existingId = String(formData.get("projectId") ?? "").trim();

  try {
    const db = getDb();
    if (existingId) {
      await updateProject(db, user, existingId, parsed.data);
      revalidateProject(existingId);
      return { ok: true, projectId: existingId };
    }

    // Authorize and resolve source data before creating any destination rows.
    const { rows } = await resolveWizardChecklist(formData);
    const { projectId } = await createProject(db, user, parsed.data);

    /*
     * Snapshot the checklist (§5.3 no.4).
     *
     * `resolveWizardChecklist` is the single source of truth: it merges the chosen
     * template(s) / source project, drops unchecked rows, and appends the custom
     * rows the manager typed in step 3. `parsed.data.checklistItems` is derived
     * from the SAME hidden cl_* fields, so appending it separately inserted every
     * item twice — which made reports render each checklist line two times.
     */
    const saveCustom = formData.get("saveCustomToMaster") === "on";

    if (rows.length > 0) {
      await syncProjectChecklist(db, projectId, {
        rows,
        saveCustomToMaster: saveCustom,
        actor: user,
        divisionId: parsed.data.ownerDivisionId,
      });
    }

    revalidateProject(projectId);
    // Wizard step 5 ("Review & Simpan"): go straight to the new project.
    redirect(`/projects/${projectId}`);
  } catch (err) {
    // Next's redirect() throws a special error that must be re-thrown.
    if (isRedirectError(err)) throw err;
    return toError(err);
  }
}

/**
 * `redirect()` works by throwing; a catch-all would otherwise swallow it and
 * silently strand the user on the wizard.
 */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

/** Persists the active list while retaining the versions used in earlier reports. */
export async function saveProjectChecklistAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const { user } = await requireUserWithoutPasswordChange();
  const projectId = formData.get("projectId");
  if (typeof projectId !== "string" || !projectId) return { error: "Project tidak valid" };

  try {
    let rows: unknown;
    try {
      rows = JSON.parse(String(formData.get("rows") ?? ""));
    } catch {
      return { error: "Daftar checklist tidak valid" };
    }
    const parsed = projectChecklistEditSchema.safeParse({ rows, version: formData.get("version") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Checklist tidak valid" };
    editProjectChecklist(getDb(), user, projectId, parsed.data);
  } catch (err) {
    return toError(err);
  }
  revalidatePath(`/projects/${projectId}`, "page");
  for (const phase of PHASES) revalidatePath(`/projects/[id]/days/[date]/${phase}`, "page");
  redirect(`/projects/${projectId}?tab=checklist&saved=1`);
}

export async function addMemberAction(formData: FormData): Promise<void> {
  const user = await acting();
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = projectRoleSchema.safeParse(formData.get("roleInProject") ?? "crew");
  if (!projectId || !userId || !role.success) return;

  try {
    await addMember(getDb(), user, projectId, userId, role.data);
    revalidateProject(projectId);
  } catch (err) {
    console.error("[add member]", toError(err));
  }
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await acting();
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!projectId || !userId) return;

  try {
    await removeMember(getDb(), user, projectId, userId);
    revalidateProject(projectId);
  } catch (err) {
    console.error("[remove member]", toError(err));
  }
}

export async function setMemberRoleAction(formData: FormData): Promise<void> {
  const user = await acting();
  const parsed = setMemberRoleSchema.safeParse({
    projectId: formData.get("projectId"),
    userId: formData.get("userId"),
    roleInProject: formData.get("roleInProject"),
  });
  if (!parsed.success) return;

  try {
    await setMemberRole(
      getDb(),
      user,
      parsed.data.projectId,
      parsed.data.userId,
      parsed.data.roleInProject,
    );
    revalidateProject(parsed.data.projectId);
  } catch (err) {
    console.error("[member role]", toError(err));
  }
}

export async function setProjectStatusAction(formData: FormData): Promise<void> {
  const user = await acting();
  const parsed = setStatusSchema.safeParse({
    projectId: formData.get("projectId"),
    status: formData.get("status"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return;

  try {
    await setProjectStatus(
      getDb(),
      user,
      parsed.data.projectId,
      parsed.data.status,
      parsed.data.reason,
    );
    revalidateProject(parsed.data.projectId);
  } catch (err) {
    console.error("[project status]", toError(err));
  }
}

/** §4.6: assign the day's opening/closing officer. */
export async function assignOfficerAction(formData: FormData): Promise<void> {
  const user = await acting();
  const parsed = assignOfficerSchema.safeParse({
    projectDayId: formData.get("projectDayId"),
    userId: formData.get("userId") ?? "",
  });
  if (!parsed.success) return;

  try {
    const projectId = updateProjectDay(getDb(), user, parsed.data.projectDayId, { assignedUserId: parsed.data.userId });
    revalidateProject(projectId);
  } catch (err) {
    console.error("[assign officer]", toError(err));
  }
}

export async function setDayTypeAction(formData: FormData): Promise<void> {
  const user = await acting();
  const parsed = dayTypeUpdateSchema.safeParse({
    projectDayId: formData.get("projectDayId"),
    dayType: formData.get("dayType"),
  });
  if (!parsed.success) return;

  try {
    const projectId = updateProjectDay(getDb(), user, parsed.data.projectDayId, { dayType: parsed.data.dayType });
    revalidateProject(projectId);
  } catch (err) {
    console.error("[day type]", toError(err));
  }
}
