export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12" role="status" aria-live="polite" aria-busy="true">
      <p className="font-medium text-brand">Getting your safari page ready…</p>
      <div aria-hidden="true" className="mt-6 grid gap-5 motion-safe:animate-pulse md:grid-cols-2">
        <div className="h-64 rounded-2xl border border-line bg-surface" />
        <div className="h-64 rounded-2xl border border-line bg-surface" />
      </div>
    </main>
  );
}
