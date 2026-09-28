export default function StatusBanner({ error, onDismissError }) {
  if (!error) return null;
  return (
    <div className="status-stack">
      <div className="status-banner status-banner--error">
        <span>{error}</span>
        <button
          type="button"
          className="status-banner__close"
          aria-label="Dismiss error"
          onClick={onDismissError}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
