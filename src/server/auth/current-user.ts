import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { getSession } from "@/server/auth/session";
import type { SessionContext } from "@/server/auth/session";

/**
 * Server-side session access. Every page and server action must call this
 * (or `requireUser`) rather than trusting anything from the client.
 */
export async function currentSession(): Promise<SessionContext | null> {
  return getSession(getDb());
}

/** Redirects to /login when there is no session (§9.3: enforce on the server). */
export async function requireUser(): Promise<SessionContext> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * §4.1: accounts flagged `must_change_password` may only reach the password form.
 */
export async function requireUserWithoutPasswordChange(): Promise<SessionContext> {
  const session = await requireUser();
  if (session.mustChangePassword) redirect("/me/password");
  return session;
}
