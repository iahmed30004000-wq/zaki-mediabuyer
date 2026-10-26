/** While a place loads: the shape of the page, quietly. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="عم يحمّل">
      <div className="h-24 animate-pulse rounded-card bg-surface-2" />
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-card bg-surface-2" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-card bg-surface-2" />
    </div>
  );
}
