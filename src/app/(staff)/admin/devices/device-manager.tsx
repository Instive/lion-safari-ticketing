"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  registerDeviceAction,
  setDeviceActiveAction,
  type DeviceState,
} from "./actions";

type DeviceRow = {
  id: string;
  name: string;
  type: "SCANNER" | "COUNTER";
  active: boolean;
  lastSync: string | null;
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

export function DeviceManager({ devices }: { devices: DeviceRow[] }) {
  const [registerState, register] = useActionState<DeviceState, FormData>(
    registerDeviceAction,
    {},
  );
  const [toggleState, toggle] = useActionState<DeviceState, FormData>(setDeviceActiveAction, {});

  return (
    <>
      <form action={register} className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-3 font-semibold">Register a device</h2>
        <div className="flex flex-wrap gap-2">
          <input
            name="name"
            placeholder="e.g. Gate Scanner 1"
            required
            minLength={2}
            className="touch-target min-w-48 flex-1 rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
          <select
            name="type"
            defaultValue="SCANNER"
            className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          >
            <option value="SCANNER">Scanner</option>
            <option value="COUNTER">Counter</option>
          </select>
          <Submit label="Register" />
        </div>

        {registerState.error ? (
          <p role="alert" className="mt-3 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
            {registerState.error}
          </p>
        ) : null}

        {registerState.apiKey ? (
          <div className="mt-4 rounded-lg border border-ok/40 bg-ok/5 p-4">
            <p className="text-sm font-semibold text-ok">{registerState.success}</p>
            <p className="mt-2 rounded-lg bg-surface px-3 py-2 font-mono text-sm break-all select-all">
              {registerState.apiKey}
            </p>
            <p className="text-muted mt-2 text-xs">
              Enter this on the scanner device at /scanner. It is stored only as a hash, so it
              cannot be shown again — register the device afresh if it is lost.
            </p>
          </div>
        ) : null}
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
        {devices.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4"
          >
            <div>
              <p className="font-medium">
                {d.name}{" "}
                <span className="text-muted text-sm font-normal">({d.type.toLowerCase()})</span>
              </p>
              <p className="text-muted text-sm">
                {d.lastSync ? `Last sync ${d.lastSync}` : "Never synced"}
              </p>
            </div>

            <form action={toggle} className="flex items-center gap-3">
              <input type="hidden" name="deviceId" value={d.id} />
              <input type="hidden" name="active" value={d.active ? "false" : "true"} />
              <span
                className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                  d.active ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
                }`}
              >
                {d.active ? "Active" : "Deactivated"}
              </span>
              <button
                type="submit"
                className="touch-target rounded-lg border border-line px-3 text-sm font-medium hover:bg-background"
              >
                {d.active ? "Deactivate" : "Reactivate"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
