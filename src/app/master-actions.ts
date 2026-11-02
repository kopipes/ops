"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import {
  checklistItemInputSchema,
  categoryInputSchema,
  checkbox,
  duplicateTemplateSchema,
  issueCategoryInputSchema,
  reorderSchema,
  templateFromProjectSchema,
  templateInputSchema,
} from "@/lib/schemas";
import {
  createChecklistItem,
  deactivateChecklistItem,
  reactivateChecklistItem,
  reorderChecklistItems,
  updateChecklistItem,
  ForbiddenError,
  ValidationError,
} from "@/server/services/checklist-items";
import {
  createTemplate,
  createTemplateFromProject,
  deactivateTemplate,
  duplicateTemplate,
  updateTemplate,
} from "@/server/services/templates";
import {
  createChecklistCategory,
  createIssueCategory,
  deactivateChecklistCategory,
  deactivateIssueCategory,
  updateChecklistCategory,
  updateIssueCategory,
} from "@/server/services/categories";
import { eq } from "drizzle-orm";
import { projects } from "@/server/db/schema";

export interface ActionState {
  ok?: boolean;
  error?: string;
  createdId?: string;
}

/**
 * Every action resolves the acting user server-side and never trusts a role
 * sent from the client (§9.3). Errors are mapped to friendly messages so a
 * crafted request cannot distinguish "forbidden" from "not found" details.
 */
async function acting() {
  const session = await requireUser();
  return session.user;
}

function toError(err: unknown): ActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof ValidationError) return { error: err.message };
  console.error("[master-data action]", err);
  return { error: "Terjadi kesalahan. Coba lagi." };
}

const revalidateMaster = () => {
  revalidatePath("/master/checklist-items");
  revalidatePath("/master/templates");
  revalidatePath("/master/issue-categories");
};

function itemFromForm(formData: FormData) {
  return checklistItemInputSchema.safeParse({
    label: formData.get("label"),
    description: formData.get("description") ?? "",
    phase: formData.get("phase"),
    categoryId: formData.get("categoryId"),
    divisionId: formData.get("divisionId") ?? "",
    isRequired: checkbox(formData.get("isRequired")),
    requiresPhoto: checkbox(formData.get("requiresPhoto")),
    sortOrder: formData.get("sortOrder") ?? 0,
    isActive: checkbox(formData.get("isActive")),
  });
}

// ---------------------------------------------------------------------------
// Checklist items
// ---------------------------------------------------------------------------

export async function saveChecklistItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await acting();
  const parsed = itemFromForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  const id = String(formData.get("id") ?? "").trim();

  try {
    const db = getDb();
    if (id) {
      await updateChecklistItem(db, user, id, parsed.data);
    } else {
      await createChecklistItem(db, user, parsed.data);
    }
    revalidateMaster();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deactivateChecklistItemAction(formData: FormData): Promise<void> {
  const user = await acting();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deactivateChecklistItem(getDb(), user, id);
    revalidateMaster();
  } catch (err) {
    console.error("[deactivate item]", toError(err));
  }
}

export async function reactivateChecklistItemAction(formData: FormData): Promise<void> {
  const user = await acting();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await reactivateChecklistItem(getDb(), user, id);
    revalidateMaster();
  } catch (err) {
    console.error("[reactivate item]", toError(err));
  }
}

export async function reorderChecklistItemsAction(formData: FormData): Promise<void> {
  const user = await acting();
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const parsed = reorderSchema.safeParse({ ids });
  if (!parsed.success) return;

  try {
    await reorderChecklistItems(getDb(), user, parsed.data.ids);
    revalidateMaster();
  } catch (err) {
    console.error("[reorder items]", toError(err));
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function templateFromForm(formData: FormData) {
  const itemIds = formData.getAll("itemIds").map(String);
  return templateInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    divisionId: formData.get("divisionId") ?? "",
    items: itemIds.map((id, index) => ({
      checklistItemId: id,
      sortOrder: index,
      isRequiredOverride: (formData.get(`req_${id}`) as string) ?? "inherit",
      requiresPhotoOverride: (formData.get(`photo_${id}`) as string) ?? "inherit",
    })),
  });
}

export async function saveTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await acting();
  const parsed = templateFromForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  const id = String(formData.get("id") ?? "").trim();
  try {
    const db = getDb();
    if (id) {
      await updateTemplate(db, user, id, parsed.data);
      revalidateMaster();
      return { ok: true, createdId: id };
    }
    const createdId = await createTemplate(db, user, parsed.data);
    revalidateMaster();
    return { ok: true, createdId };
  } catch (err) {
    return toError(err);
  }
}

export async function duplicateTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await acting();
  const parsed = duplicateTemplateSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nama tidak valid" };
  }

  const sourceId = String(formData.get("sourceId") ?? "");
  try {
    const createdId = await duplicateTemplate(getDb(), user, sourceId, parsed.data.name);
    revalidateMaster();
    return { ok: true, createdId };
  } catch (err) {
    return toError(err);
  }
}

export async function templateFromProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await acting();
  const parsed = templateFromProjectSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  try {
    const db = getDb();
    const project = await db
      .select({ id: projects.id, name: projects.name, ownerDivisionId: projects.ownerDivisionId })
      .from(projects)
      .where(eq(projects.id, parsed.data.projectId))
      .get();

    if (!project) return { error: "Project tidak ditemukan" };

    const res = await createTemplateFromProject(db, user, parsed.data, {
      projectDivisionId: project.ownerDivisionId,
      projectName: project.name,
    });
    revalidateMaster();
    return {
      ok: true,
      createdId: res.templateId,
    };
  } catch (err) {
    return toError(err);
  }
}

export async function deactivateTemplateAction(formData: FormData): Promise<void> {
  const user = await acting();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deactivateTemplate(getDb(), user, id);
    revalidateMaster();
  } catch (err) {
    console.error("[deactivate template]", toError(err));
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function saveChecklistCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await acting();
  const parsed = categoryInputSchema.safeParse({
    name: formData.get("name"),
    sortOrder: formData.get("sortOrder") ?? 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };

  const id = String(formData.get("id") ?? "").trim();
  try {
    const db = getDb();
    if (id) await updateChecklistCategory(db, user, id, parsed.data);
    else await createChecklistCategory(db, user, parsed.data);
    revalidateMaster();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deactivateChecklistCategoryAction(formData: FormData): Promise<void> {
  const user = await acting();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deactivateChecklistCategory(getDb(), user, id);
    revalidateMaster();
  } catch (err) {
    console.error("[deactivate category]", toError(err));
  }
}

export async function saveIssueCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await acting();
  const parsed = issueCategoryInputSchema.safeParse({
    name: formData.get("name"),
    sortOrder: formData.get("sortOrder") ?? 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };

  const id = String(formData.get("id") ?? "").trim();
  try {
    const db = getDb();
    if (id) await updateIssueCategory(db, user, id, parsed.data);
    else await createIssueCategory(db, user, parsed.data);
    revalidateMaster();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deactivateIssueCategoryAction(formData: FormData): Promise<void> {
  const user = await acting();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deactivateIssueCategory(getDb(), user, id);
    revalidateMaster();
  } catch (err) {
    console.error("[deactivate issue category]", toError(err));
  }
}
