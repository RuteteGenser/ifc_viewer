export default function LoadingOverlay({ visible, label, onCancel }) {
  if (!visible) return null;
  return (
    <div className="loading-overlay" role="status">
      <div className="loading-overlay__box">
        <span className="loading-overlay__spinner" aria-hidden="true" />
        <span>{label || "Loading…"}</span>
        {onCancel && (
          <button type="button" className="loading-overlay__cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
