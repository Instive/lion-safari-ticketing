export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8" role="status" aria-live="polite" aria-busy="true">
      <p className="font-medium text-brand">Loading your workspace…</p>
      <div aria-hidden="true" className="mt-5 grid grid-cols-2 gap-4 motion-safe:animate-pulse lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 rounded-xl border border-line bg-surface" />)}
      </div>
    </main>
  );
}
