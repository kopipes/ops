export const PROJECT_ROLES = ["crew", "lead", "admin_project"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const projectRoleLabel: Record<ProjectRole, string> = {
  crew: "Crew",
  lead: "Head Crew",
  admin_project: "Admin Project",
};

export const projectRoleOptionLabel: Record<ProjectRole, string> = {
  crew: "Crew · Isi laporan",
  lead: "Head Crew · Isi opening dan closing",
  admin_project: "Admin Project · Lihat dan unduh laporan",
};
