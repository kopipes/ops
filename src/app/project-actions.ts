"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import {
  assignOfficerSchema,
  checkbox,
  dayTypeUpdateSchema,
  projectInputSchema,
  setMemberRoleSchema,
  setStatusSchema,
} from "@/lib/schemas";
import {
  createProject,
  generateProjectCode,
  loadFacts,
  setProjectStatus,
  updateProject,
} from "@/server/services/projects";
import {
  addMember,
  removeMember,
  setMemberRole,
  setMembers,
} from "@/server/services/members";
import {
  buildChecklistFromProject,
  buildChecklistFromTemplates,
  syncProjectChecklist,
} from "@/server/services/project-checklist";
import { projectDays, divisions } from "@/server/db/schema";
import { canManageProject } from "@/server/permissions";
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

function parseProjectForm(formData: FormData) {
  const additional = formData.getAll("additionalDivisionIds").map(String).filter(Boolean);

  const memberIds = formData.getAll("memberIds").map(String).filter(Boolean);
  const members = memberIds.map((userId) => ({
    userId,
    roleInProject: (formData.get(`role_${userId}`) as "lead" | "crew") ?? "crew",
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
  const db = getDb();
  const source = (formData.get("checklistSource") as string) ?? "empty";
  const templateIds = formData.getAll("templateIds").map(String).filter(Boolean);
  const sourceProjectId = String(formData.get("sourceProjectId") ?? "").trim();

  let base: Awaited<ReturnType<typeof buildChecklistFromTemplates>> = [];
  if (source === "template") base = await buildChecklistFromTemplates(db, templateIds);
  else if (source === "project" && sourceProjectId) {
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
    const { rows } = await resolveWizardChecklist(formData);
    const saveCustom = formData.get("saveCustomToMaster") === "on";

    if (rows.length > 0) {
      await syncProjectChecklist(db, projectId, {
        rows,
        saveCustomToMaster: saveCustom,
        actor: user,
        divisionId: parsed.data.ownerDivisionId,
      });
    }

    // Members from step 4.
    if (parsed.data.members.length > 0) {
      await setMembers(db, user, projectId, parsed.data.members);
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

/** Persists the project checklist from the Checklist tab. */
export async function saveProjectChecklistAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const user = await acting();
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Project tidak valid" };

  try {
    const db = getDb();
    const facts = await loadFacts(db, projectId);
    if (!canManageProject(user, facts)) throw new ForbiddenError();

    // Single source of truth again: resolveWizardChecklist already includes the
    // custom rows carried in cl_*, so only the free-text extras are appended.
    const { rows } = await resolveWizardChecklist(formData);
    const manual = String(formData.get("manualItems") ?? "");
    const extraRows = manual
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((label, i) => ({
        sourceItemId: null,
        phase: (String(formData.get("manualPhase") ?? "opening") as "opening"),
        categoryName: "Umum",
        label,
        description: null,
        isRequired: true,
        requiresPhoto: false,
        sortOrder: rows.length + i,
        isActive: true,
      }));

    await syncProjectChecklist(db, projectId, {
      rows: [...rows, ...extraRows],
      saveCustomToMaster: formData.get("saveCustomToMaster") === "on",
      actor: user,
      divisionId: facts.ownerDivisionId,
    });

    revalidateProject(projectId);
    return { ok: true, projectId };
  } catch (err) {
    return toError(err);
  }
}

export async function addMemberAction(formData: FormData): Promise<void> {
  const user = await acting();
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = (formData.get("roleInProject") as "lead" | "crew") ?? "crew";
  if (!projectId || !userId) return;

  try {
    await addMember(getDb(), user, projectId, userId, role);
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
    const db = getDb();
    const day = await db
      .select({ projectId: projectDays.projectId })
      .from(projectDays)
      .where(eq(projectDays.id, parsed.data.projectDayId))
      .get();
    if (!day) return;

    const facts = await loadFacts(db, day.projectId);
    if (!canManageProject(user, facts)) throw new ForbiddenError();

    // Only project members may be officers; otherwise the assignment is dead weight.
    if (parsed.data.userId) {
      const isMember = facts.memberIds.includes(parsed.data.userId);
      if (!isMember) throw new ValidationError("Petugas harus member project");
    }

    await db
      .update(projectDays)
      .set({ assignedUserId: parsed.data.userId, updatedAt: Date.now() })
      .where(eq(projectDays.id, parsed.data.projectDayId));

    revalidateProject(day.projectId);
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
    const db = getDb();
    const day = await db
      .select({ projectId: projectDays.projectId })
      .from(projectDays)
      .where(eq(projectDays.id, parsed.data.projectDayId))
      .get();
    if (!day) return;

    const facts = await loadFacts(db, day.projectId);
    if (!canManageProject(user, facts)) throw new ForbiddenError();

    await db
      .update(projectDays)
      .set({ dayType: parsed.data.dayType, updatedAt: Date.now() })
      .where(eq(projectDays.id, parsed.data.projectDayId));

    revalidateProject(day.projectId);
  } catch (err) {
    console.error("[day type]", toError(err));
  }
}
