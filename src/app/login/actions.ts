"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { attemptLogin } from "@/lib/auth/login";
import { createSession, clientIpFrom } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/guards";
import { db } from "@/db";
import { staffUsers } from "@/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Please enter your username and password." };
  }

  const ip = clientIpFrom(await headers());
  const result = await attemptLogin(parsed.data.username, parsed.data.password, ip);

  if (!result.ok) {
    // Deliberately vague: never reveal whether the username exists.
    if (result.reason === "LOCKED") {
      return { error: "Too many failed attempts. Please wait 15 minutes and try again." };
    }
    return { error: "Incorrect username or password." };
  }

  const userAgent = (await headers()).get("user-agent");
  await createSession(result.staffId, { userAgent, ip });

  const [user] = await db
    .select({ role: staffUsers.role })
    .from(staffUsers)
    .where(eq(staffUsers.id, result.staffId))
    .limit(1);

  redirect(homeFor(user!.role));
}
