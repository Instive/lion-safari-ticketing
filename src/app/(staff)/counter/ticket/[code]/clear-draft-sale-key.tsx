"use client";

import { useEffect } from "react";

const DRAFT_KEY_STORAGE = "ls_counter_draft_key";

/**
 * Reaching this page is the reliable signal that a counter sale succeeded —
 * whether via the redirect right after the sale, or by revisiting/reprinting
 * an existing ticket later. Either way there is no unfinished draft anymore,
 * so this is the correct, single place to retire the sessionStorage key that
 * lets `/counter` survive a reload without risking a duplicate sale (see
 * counter-form.tsx).
 */
export function ClearDraftSaleKey() {
  useEffect(() => {
    sessionStorage.removeItem(DRAFT_KEY_STORAGE);
  }, []);

  return null;
}
