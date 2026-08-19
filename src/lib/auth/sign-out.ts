"use server";

import { redirect } from "next/navigation";

import { destroyCurrentSession } from "./session";

/**
 * Ends the staff session and returns to the sign-in screen.
 *
 * Lives here rather than in the (staff) route group because the scanner needs
 * it too, and the scanner sits outside that group so it can keep its own
 * full-screen dark chrome.
 *
 * This clears the staff session only. A scanner's device key is separate — it
 * authorises the terminal, not the person — so signing out does not unenrol the
 * device, and the next person can sign in without an admin re-issuing a key.
 */
export async function signOutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
