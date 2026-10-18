import { useLibraryContext } from "./LibraryContext";

function Progress({ label, percent, onCancel, cancelLabel }) {
  const known = typeof percent === "number";
  return (
    <div className="lib-transfer__item" role="status">
      <div className="lib-transfer__text">
        <span className="lib-transfer__label">{label}</span>
        {known && <span className="lib-transfer__pct">{percent}%</span>}
      </div>
      <div className="lib-transfer__track" aria-hidden="true">
        <div className={`lib-transfer__fill${known ? "" : " lib-transfer__fill--busy"}`} style={known ? { width: `${percent}%` } : undefined} />
      </div>
      <button type="button" className="lib-btn" aria-label={cancelLabel} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// Progress for downloads and uploads, plus short notices. Never modal,
// so the model stays usable while a save runs.
export default function TransferBar() {
  const library = useLibraryContext();
  if (!library) return null;
  const { download, upload, notice } = library;
  if (!download && !upload && !notice) return null;
  const short = (n) => (n.length > 30 ? `${n.slice(0, 27)}…` : n);
  return (
    <div className="lib-transfer">
      {download && (
        <Progress
          label={`Downloading ${short(download.name)}`}
          percent={download.percent}
          cancelLabel={`Cancel download of ${download.name}`}
          onCancel={library.cancelDownload}
        />
      )}
      {upload && (
        <Progress
          label={`Saving ${short(upload.name)}${upload.more ? ` (+${upload.more} more)` : ""}`}
          percent={upload.percent}
          cancelLabel={`Cancel saving ${upload.name}`}
          onCancel={library.cancelUpload}
        />
      )}
      {notice && (
        <div className={`lib-notice lib-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" className="lib-btn" onClick={library.dismissNotice} aria-label="Dismiss message">
            OK
          </button>
        </div>
      )}
    </div>
  );
}
