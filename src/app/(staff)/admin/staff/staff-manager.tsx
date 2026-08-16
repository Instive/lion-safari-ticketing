"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { StaffRole } from "@/db/schema";
import { createStaffAction, setStaffActiveAction, type StaffState } from "./actions";

type StaffRow = {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  active: boolean;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
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
  const [toggleState, toggle] = useActionState<StaffState, FormData>(setStaffActiveAction, {});

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

      {toggleState.success ? (
        <p className="mt-4 rounded-lg bg-ok/5 px-3 py-2 text-sm text-ok">{toggleState.success}</p>
      ) : null}
      {toggleState.error ? (
        <p role="alert" className="mt-4 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {toggleState.error}
        </p>
      ) : null}

      <ul className="mt-6 space-y-2">
        {staff.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4"
          >
            <div>
              <p className="font-medium">
                {s.name}
                {s.id === currentStaffId ? (
                  <span className="text-muted text-sm font-normal"> (you)</span>
                ) : null}
              </p>
              <p className="text-muted text-sm">
                {s.username} · {s.role.toLowerCase()}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                  s.active ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
                }`}
              >
                {s.active ? "Active" : "Deactivated"}
              </span>

              {s.id === currentStaffId ? null : (
                <form action={toggle}>
                  <input type="hidden" name="staffId" value={s.id} />
                  <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                  <button
                    type="submit"
                    className="touch-target rounded-lg border border-line px-3 text-sm font-medium hover:bg-background"
                  >
                    {s.active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
