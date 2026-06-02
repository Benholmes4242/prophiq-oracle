// StickyBottomCTA — pinned to the bottom of the event detail page. Opens
// the chat sheet when tapped.

interface Props {
  onAskClick: () => void;
}

export function StickyBottomCTA({ onAskClick }: Props) {
  return (
    <div className="sticky-cta-wrapper">
      <button type="button" onClick={onAskClick} className="sticky-cta-btn">
        <span className="sticky-cta-text">Ask Prophiq about this prediction</span>
        <span className="sticky-cta-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
    </div>
  );
}
