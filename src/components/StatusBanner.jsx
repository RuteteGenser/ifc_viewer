export default function StatusBanner({ error, onDismissError, onRetry }) {
  if (!error) return null;
  return (
    <div className="status-stack">
      <div className="status-banner status-banner--error" role="alert">
        <span>{error}</span>
        {onRetry && (
          <button type="button" className="status-banner__retry" onClick={onRetry}>
            Retry
          </button>
        )}
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
