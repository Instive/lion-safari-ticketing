"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type { StaffRole } from "@/db/schema";
import {
  createStaffAction,
  deleteStaffAction,
  editStaffAction,
  setStaffActiveAction,
  type StaffState,
} from "./actions";

type StaffRow = {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  active: boolean;
};

function Submit({ label, tone = "brand" }: { label: string; tone?: "brand" | "danger" | "plain" }) {
  const { pending } = useFormStatus();
  const toneClass =
    tone === "danger"
      ? "border border-danger/40 text-danger hover:bg-danger/5"
      : tone === "plain"
        ? "border border-line hover:bg-background"
        : "bg-brand text-white hover:bg-brand-strong";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`touch-target rounded-lg px-4 text-sm font-semibold disabled:opacity-60 ${toneClass}`}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

export function StaffManager({
  staff,
  currentStaffId,
}: {
  staff: StaffRow[];
  currentStaffId: string;
}) {
  const [createState, create] = useActionState<StaffState, FormData>(createStaffAction, {});

  return (
    <>
      <form action={create} className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Add a staff member</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            name="name"
            placeholder="Full name"
            required
            minLength={2}
            className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
          <input
            name="username"
            placeholder="Username"
            required
            autoCapitalize="none"
            className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
          <select
            name="role"
            defaultValue="COUNTER"
            className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          >
            <option value="COUNTER">Counter</option>
            <option value="SCANNER">Scanner</option>
            <option value="ADMIN">Admin</option>
          </select>
          <input
            name="password"
            type="password"
            placeholder="Password (min 10 characters)"
            required
            minLength={10}
            autoComplete="new-password"
            className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
        </div>

        {createState.error ? (
          <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
            {createState.error}
          </p>
        ) : null}
        {createState.success ? (
          <p className="rounded-lg bg-ok/5 px-3 py-2 text-sm text-ok">{createState.success}</p>
        ) : null}

        <Submit label="Add staff member" />
      </form>

      <ul className="mt-6 space-y-2">
        {staff.map((s) => (
          <StaffListItem key={s.id} staff={s} isSelf={s.id === currentStaffId} />
        ))}
      </ul>
    </>
  );
}

function StaffListItem({ staff, isSelf }: { staff: StaffRow; isSelf: boolean }) {
  const [editing, setEditing] = useState(false);
  const [toggleState, toggle] = useActionState<StaffState, FormData>(setStaffActiveAction, {});
  const [editState, edit] = useActionState<StaffState, FormData>(editStaffAction, {});
  const [deleteState, remove] = useActionState<StaffState, FormData>(deleteStaffAction, {});

  // A row-scoped success closes the edit form back up; an error leaves it open
  // so the mistake is still on screen to fix.
  if (editState.success && editing) setEditing(false);

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            {staff.name}
            {isSelf ? <span className="text-muted text-sm font-normal"> (you)</span> : null}
          </p>
          <p className="text-muted text-sm">
            {staff.username} · {staff.role.toLowerCase()}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-lg px-2 py-1 text-xs font-semibold ${
              staff.active ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
            }`}
          >
            {staff.active ? "Active" : "Deactivated"}
          </span>

          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="touch-target rounded-lg border border-line px-3 text-sm font-medium hover:bg-background"
          >
            {editing ? "Close" : "Edit"}
          </button>

          {isSelf ? null : (
            <form action={toggle}>
              <input type="hidden" name="staffId" value={staff.id} />
              <input type="hidden" name="active" value={staff.active ? "false" : "true"} />
              <Submit label={staff.active ? "Deactivate" : "Reactivate"} tone="plain" />
            </form>
          )}
        </div>
      </div>

      {toggleState.error ? (
        <p role="alert" className="mt-3 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {toggleState.error}
        </p>
      ) : null}
      {toggleState.success ? (
        <p className="mt-3 rounded-lg bg-ok/5 px-3 py-2 text-sm text-ok">{toggleState.success}</p>
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <form action={edit} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="staffId" value={staff.id} />
            <input
              name="name"
              defaultValue={staff.name}
              required
              minLength={2}
              placeholder="Full name"
              className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
            />
            {/*
              Username is not editable here — see the comment on
              editStaffAction in actions.ts. Shown for reference, disabled
              rather than omitted, so it is obvious which field this is.
            */}
            <input
              value={staff.username}
              disabled
              aria-label="Username (cannot be changed)"
              className="touch-target rounded-lg border border-line bg-background px-3 text-base text-muted outline-none"
            />
            <select
              name="role"
              defaultValue={staff.role}
              disabled={isSelf}
              title={isSelf ? "Ask another admin to change your own role" : undefined}
              className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand disabled:opacity-60"
            >
              <option value="COUNTER">Counter</option>
              <option value="SCANNER">Scanner</option>
              <option value="ADMIN">Admin</option>
            </select>
            <input
              name="password"
              type="password"
              placeholder="New password (leave blank to keep)"
              minLength={10}
              autoComplete="new-password"
              className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
            />

            {editState.error ? (
              <p role="alert" className="sm:col-span-2 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
                {editState.error}
              </p>
            ) : null}

            <div className="sm:col-span-2">
              <Submit label="Save changes" />
            </div>
          </form>

          {/*
            Delete is a separate form from Edit on purpose — the two must
            never be able to fire together from one Enter keypress, since one
            of them is irreversible and the other is not.
          */}
          {isSelf ? null : (
            <form
              action={remove}
              onSubmit={(e) => {
                if (
                  !confirm(
                    `Permanently delete ${staff.name} (${staff.username})? This cannot be undone. ` +
                      `Accounts with any sales or boarding history are refused automatically — ` +
                      `deactivate those instead.`,
                  )
                ) {
                  e.preventDefault();
                }
              }}
              className="border-t border-line pt-3"
            >
              <input type="hidden" name="staffId" value={staff.id} />
              <Submit label="Delete permanently" tone="danger" />
              {deleteState.error ? (
                <p role="alert" className="mt-2 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
                  {deleteState.error}
                </p>
              ) : null}
            </form>
          )}
        </div>
      ) : null}
    </li>
  );
}
