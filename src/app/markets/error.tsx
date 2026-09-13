"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="app">
      <main className="markets-main">
        <div className="research-unavailable">
          <span>MARKETS</span>
          <h2>Unable to load verified markets</h2>
          <button onClick={reset}>Try again</button>
        </div>
      </main>
    </div>
  );
}
