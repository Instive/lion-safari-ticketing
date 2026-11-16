"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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
export function FilterBar({ filters, counters }: { filters: BookingFilters; counters: { id: string; username: string }[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const activeFilters =
    Number(filters.channel !== "ALL") +
    Number(Boolean(filters.counterId)) +
    Number(filters.status !== "ALL");
  const [showMore, setShowMore] = useState(activeFilters > 0);

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
          className={`flex w-full flex-col gap-1.5 rounded-lg border px-2 py-1 text-sm sm:w-auto sm:flex-row sm:items-center ${
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
            className="min-w-0 w-full bg-transparent text-sm outline-none sm:w-auto"
          />
          <span className="text-muted text-xs">to</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            aria-label="To date"
            onChange={(event) => apply({ range: "custom", to: event.target.value })}
            className="min-w-0 w-full bg-transparent text-sm outline-none sm:w-auto"
          />
        </span>
      </div>

      <div className="flex min-w-0 gap-2">
        <input
          name="q"
          aria-label="Search bookings"
          defaultValue={filters.q}
          placeholder="Code, phone, name or email"
          className="min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          Search
        </button>
      </div>

      <button
        type="button"
        aria-expanded={showMore}
        aria-controls="booking-more-filters"
        onClick={() => setShowMore((open) => !open)}
        className="flex w-full items-center justify-between rounded-lg border border-line bg-background px-3 py-2 text-sm font-medium sm:hidden"
      >
        <span>
          {showMore ? "Fewer filters" : "More filters"}
          {activeFilters > 0 ? ` (${activeFilters} active)` : ""}
        </span>
        <span aria-hidden="true">{showMore ? "−" : "+"}</span>
      </button>

      <div
        id="booking-more-filters"
        className={`${showMore ? "flex" : "hidden"} flex-col gap-2 sm:flex sm:flex-row sm:flex-wrap`}
      >
        <Select
          name="channel"
          label="Payment / channel"
          value={filters.channel}
          onChange={(value) => apply({ channel: value === "ALL" ? "" : value, ...(value === "ONLINE" ? { counter: "" } : {}) })}
          options={[
            ["ALL", "All channels"],
            ["ONLINE", "Online"],
            ["COUNTER", "Counter"],
            ["COUNTER_UPI", "UPI"],
            ["COUNTER_CASH", "Cash"],
          ]}
        />
        <Select
          name="counter"
          label="Counter"
          value={filters.counterId ?? ""}
          onChange={(value) => apply({ counter: value, ...(value && filters.channel === "ONLINE" ? { channel: "COUNTER" } : {}) })}
          options={[["", "All counters"], ...counters.map(c => [c.id, c.username] as [string, string])]}
        />
        <Select
          name="status"
          label="Status"
          value={filters.status}
          onChange={(value) => apply({ status: value === "ALL" ? "" : value })}
          options={STATUS_FILTERS.map((s) => [s, STATUS_LABELS[s]] as [string, string])}
        />
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
    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-background px-3 py-2 text-sm">
      <span className="text-muted shrink-0 text-xs uppercase tracking-wide">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
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
