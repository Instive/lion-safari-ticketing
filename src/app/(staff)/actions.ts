"use server";

import { redirect } from "next/navigation";

import { destroyCurrentSession } from "@/lib/auth/session";

export async function signOutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
