import LibrarySection from "../library/LibrarySection";
import { useLibraryContext } from "../library/LibraryContext";
import { SaveToggle } from "../library/SaveControls";
import { CodeLink } from "../access/AccessUI";

// The one screen shown before any model is open: a single primary action
// (also a drop zone with a mouse). The sample building is a row in the Samples list below it
// (the library's own, or the same single row when there is no library).
export default function EmptyState({ onOpenFiles, onLoadSample }) {
  const library = useLibraryContext();
  return (
    <div className="empty-state">
      <div className="empty-state__card" onClick={onOpenFiles}>
        <svg className="empty-state__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M24 5 41 14v20L24 43 7 34V14L24 5Z" />
          <path d="M7 14l17 9 17-9M24 23v20" />
        </svg>
        <h1 className="empty-state__title">Open a building model</h1>
        <p className="empty-state__text">View, section and measure IFC files. {library?.available ? "Your files stay on your device unless you save them to My models." : "Everything stays on your device."}</p>
        <button type="button" className="empty-state__primary" onClick={(e) => { e.stopPropagation(); onOpenFiles(); }}>
          Open IFC file
        </button>
        <SaveToggle />
        <p className="empty-state__drop">Drop an IFC file here or click to browse</p>
        {!library?.available && (
          <ul className="lib-list empty-state__samples" aria-label="Samples">
            <li className="lib-row">
              <div className="lib-row__line">
                <button type="button" className="lib-row__main" aria-label="Open Sample building" onClick={(e) => { e.stopPropagation(); onLoadSample(); }}>
                  <span className="lib-row__name">Sample building</span>
                  <span className="lib-row__meta">Built in</span>
                </button>
              </div>
            </li>
          </ul>
        )}
        <CodeLink />
        <LibrarySection variant="empty" />
      </div>
    </div>
  );
}
