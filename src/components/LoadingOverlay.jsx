// The label may end in a percentage ("... 40%"): it is mirrored as a thin bar under the text.
const percentOf = (label) => {
  const m = /(\d{1,3})\s?%/.exec(label || "");
  return m ? Math.min(100, Number(m[1])) / 100 : null;
};

export default function LoadingOverlay({ visible, label, onCancel }) {
  if (!visible) return null;
  const pct = percentOf(label);
  return (
    <div className="loading-overlay" role="status">
      <div className="loading-overlay__box">
        <span className="loading-overlay__spinner" aria-hidden="true" />
        <span className="loading-overlay__text">
          <span>{label || "Loading…"}</span>
          {pct !== null && (
            <span className="loading-overlay__bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(0.02, pct)})` }} />
            </span>
          )}
        </span>
        {onCancel && (
          <button type="button" className="loading-overlay__cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
