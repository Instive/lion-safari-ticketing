"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

// Import from the pure filter module, never from `./bookings` — that one
// reaches the database and the server environment.
import {
  PRESET_LABELS,
  RANGE_PRESETS,
  STATUS_FILTERS,
  STATUS_LABELS,
  type BookingFilters,
} from "@/domain/reports/filter-options";


/**
 * The filter state lives entirely in the URL — every control just navigates.
 * That makes a filtered view shareable and bookmarkable, lets the browser's
 * back button undo a filter, and means the CSV download is a plain link
 * carrying the same query string rather than a second, drifting definition of
 * what is on screen.
 */
export function FilterBar({ filters }: { filters: BookingFilters }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  function apply(overrides: Record<string, string>) {
    const form = formRef.current;
    const params = new URLSearchParams();

    if (form) {
      for (const [key, value] of new FormData(form).entries()) {
        if (typeof value === "string" && value) params.set(key, value);
      }
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Any change of filter invalidates the page number.
    params.delete("page");

    router.push(`/admin/bookings?${params.toString()}`);
  }

  return (
    <form
      ref={formRef}
      className="space-y-3 rounded-xl border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        apply({});
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {RANGE_PRESETS.filter((p) => p !== "custom").map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => apply({ range: preset, from: "", to: "" })}
            aria-pressed={filters.preset === preset}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              filters.preset === preset
                ? "border-brand bg-brand text-white"
                : "border-line bg-background hover:border-brand"
            }`}
          >
            {PRESET_LABELS[preset]}
          </button>
        ))}
        <span
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm ${
            filters.preset === "custom" ? "border-brand" : "border-line"
          }`}
        >
          <input type="hidden" name="range" value={filters.preset} />
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            aria-label="From date"
            onChange={(event) => apply({ range: "custom", from: event.target.value })}
            className="bg-transparent text-sm outline-none"
          />
          <span className="text-muted text-xs">to</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            aria-label="To date"
            onChange={(event) => apply({ range: "custom", to: event.target.value })}
            className="bg-transparent text-sm outline-none"
          />
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          name="on"
          label="Dates mean"
          value={filters.dateField}
          onChange={(value) => apply({ on: value })}
          options={[
            ["visit", "Visit date"],
            ["booked", "Booking date"],
          ]}
        />
        <Select
          name="channel"
          label="Channel"
          value={filters.channel}
          onChange={(value) => apply({ channel: value === "ALL" ? "" : value })}
          options={[
            ["ALL", "All channels"],
            ["ONLINE", "Online"],
            ["COUNTER", "Counter"],
          ]}
        />
        <Select
          name="status"
          label="Status"
          value={filters.status}
          onChange={(value) => apply({ status: value === "ALL" ? "" : value })}
          options={STATUS_FILTERS.map((s) => [s, STATUS_LABELS[s]] as [string, string])}
        />

        <div className="flex min-w-[14rem] flex-1 gap-2">
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Code, phone, name or email"
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Search
          </button>
        </div>
      </div>
    </form>
  );
}

function Select({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-line bg-background px-3 py-2 text-sm">
      <span className="text-muted text-xs uppercase tracking-wide">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-sm font-medium outline-none"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
