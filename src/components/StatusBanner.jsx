import { reloadNow } from "../reliability/recovery";
import { useUpdateNotice } from "../reliability/useUpdateNotice";
import { copyText } from "./copyText";

// Buttons appear only after Argus's own automatic attempts have all failed.
// `errorInfo` ({ details, intent, reload, chooseAnother }) comes with load failures: Details is
// text for a bug report, Reload reopens the page and then the same model.
// `idle` is true when nothing is loading and no tool is armed: only then is the
// "new version" notice shown (it never reloads by itself while the user works).
export default function StatusBanner({ error, errorInfo, onDismissError, onRetry, onChooseFile, idle = true }) {
  const updateAvailable = useUpdateNotice();
  const showUpdate = updateAvailable && idle && !error;
  if (!error && !showUpdate) return null;
  if (!error) {
    return (
      <div className="status-stack">
        <div className="status-banner status-banner--info" role="status">
          <span>A new version is ready.</span>
          <button type="button" className="status-banner__retry" onClick={() => reloadNow()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="status-stack">
      <div className="status-banner status-banner--error" role="alert">
        <span>
          {error}
          {errorInfo?.details && (
            <details className="status-banner__details">
              <summary>Details</summary>
              <pre>{errorInfo.details}</pre>
              <button type="button" className="status-banner__retry" onClick={() => copyText(errorInfo.details)}>
                Copy
              </button>
            </details>
          )}
        </span>
        {onRetry && (
          <button type="button" className="status-banner__retry" onClick={onRetry}>
            Retry
          </button>
        )}
        {errorInfo?.chooseAnother && onChooseFile && (
          <button type="button" className="status-banner__retry" onClick={() => { onDismissError(); onChooseFile(); }}>
            Choose another file
          </button>
        )}
        {errorInfo?.reload && (
          <button type="button" className="status-banner__retry" onClick={() => reloadNow(errorInfo.intent)}>
            Reload
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
