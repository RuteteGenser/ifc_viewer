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
        {/* An abstract building in wireframe: three storeys, one cut by a section plane, and a height dimension. */}
        <svg className="empty-state__art" viewBox="0 0 160 128" fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
          <path className="empty-state__art-hidden" d="M80 14v56M80 70 45.4 90M80 70l48.5 28" />
          <path className="empty-state__art-cut" d="M80 42l48.5 28-34.6 20-48.5-28z" />
          <path className="empty-state__art-line" d="M80 14l48.5 28-34.6 20L45.4 34z" />
          <path className="empty-state__art-line" d="M45.4 34v56l48.5 28 34.6-20V42M93.9 62v56" />
          <path className="empty-state__art-floor" d="M45.4 52.7l48.5 28 34.6-20M45.4 71.3l48.5 28 34.6-20" />
          <path className="empty-state__art-dim" d="M140 48v56M136.5 46l7 4M136.5 102l7 4" />
          <circle className="empty-state__art-node" cx="80" cy="42" r="2.2" />
          <circle className="empty-state__art-node" cx="128.5" cy="70" r="2.2" />
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
