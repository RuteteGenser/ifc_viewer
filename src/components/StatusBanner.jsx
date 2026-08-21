export default function StatusBanner({ isLoading, loadingLabel, error, onDismissError }) {
  return (
    <div className="status-stack">
      {isLoading && (
        <div className="status-banner status-banner--loading">
          <span className="spinner" aria-hidden="true" />
          {loadingLabel || "Loading…"}
        </div>
      )}
      {error && (
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
      )}
    </div>
  );
}
