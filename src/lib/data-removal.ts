export const REMOVAL_ENTITIES = ["user", "division", "checklist_item", "checklist_category", "issue_category", "template"] as const;
export type RemovalEntity = typeof REMOVAL_ENTITIES[number];
export type RemovalMode = "delete" | "archive";
export interface RemovalPreview {
  entity: RemovalEntity;
  id: string;
  name: string;
  mode: RemovalMode;
  references: number;
}
export interface RemovalState {
  error?: string;
  message?: string;
  ok?: boolean;
}
