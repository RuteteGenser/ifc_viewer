import { useEffect, useRef } from "react";
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
  const ref = useRef(null);
  const visible = !!library && !!(library.download || library.upload || library.notice);
  // The bar's height is published as --transfer-h so the buttons at the bottom
  // of the view can sit above it on a phone.
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!visible || !el || typeof ResizeObserver === "undefined") {
      root.style.setProperty("--transfer-h", "0px");
      return undefined;
    }
    const publish = () => root.style.setProperty("--transfer-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--transfer-h", "0px");
    };
  }, [visible]);
  if (!visible) return null;
  const { download, upload, notice } = library;
  const short = (n) => (n.length > 30 ? `${n.slice(0, 27)}…` : n);
  return (
    <div className="lib-transfer" ref={ref}>
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
          {notice.retry && (
            <button type="button" className="lib-btn" onClick={() => { library.dismissNotice(); notice.retry(); }}>
              Retry
            </button>
          )}
          <button type="button" className="lib-btn" onClick={library.dismissNotice} aria-label="Dismiss message">
            OK
          </button>
        </div>
      )}
    </div>
  );
}
