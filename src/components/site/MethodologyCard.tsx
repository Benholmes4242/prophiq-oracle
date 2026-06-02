// MethodologyCard — "How Prophiq Sees This". Renamed from the old "Why this
// forecast" section. Generic copy for now; can be personalized per
// prediction once backend exposes the actual signals used.

export function MethodologyCard() {
  return (
    <>
      <div className="section-row">
        <span className="section-eyebrow">HOW PROPHIQ SEES THIS</span>
        <span className="section-rule" />
      </div>
      <section className="methodology-card">
        <p className="methodology-text">
          Recent form, historical tournament patterns, real-time signals from
          qualifier matches, and a domain-specific statistical fit. Confidence
          above reflects how cleanly the evidence converged.
        </p>
      </section>
    </>
  );
}
