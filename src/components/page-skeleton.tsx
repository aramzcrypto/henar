import { AppHeader } from "./app-header";

/**
 * The frame a route shows while its server render is in flight.
 *
 * Next renders `loading.tsx` the instant a link is clicked, so this is what
 * decides whether navigation feels immediate. It has to carry the header:
 * `AppHeader` lives in each page rather than in the layout, so a skeleton
 * without one blanks the chrome on every navigation and reads as a page
 * reload rather than a transition.
 *
 * `rows` is a shape hint, not a pixel match. A skeleton that pretends to be
 * the finished page is worse than one that clearly says "loading" — it makes
 * the real content look like it moved when it arrives.
 */
export function PageSkeleton({ active, rows = 4 }: { active: string; rows?: number }) {
  return (
    <div className="app">
      <AppHeader active={active} />
      <main className="markets-main">
        <div className="markets-page-loading" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading…</span>
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} aria-hidden="true" />
          ))}
        </div>
      </main>
    </div>
  );
}
