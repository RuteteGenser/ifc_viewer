import LibrarySection from "../library/LibrarySection";
import { useLibraryContext } from "../library/LibraryContext";
import { SaveToggle } from "../library/SaveControls";
import { CodeLink } from "../access/AccessUI";

// The one screen shown before any model is open: a single primary action
// (also a drop zone with a mouse) and a quiet link to a sample building.
export default function EmptyState({ onOpenFiles, onLoadSample }) {
  const library = useLibraryContext();
  // When "My models" lists the sample as its first row, phones drop the extra link.
  const sampleListed = !!library && library.available && library.status === "ready";
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
        <button type="button" className={`empty-state__link${sampleListed ? " empty-state__link--listed" : ""}`} onClick={(e) => { e.stopPropagation(); onLoadSample(); }}>
          or try a sample building
        </button>
        <CodeLink />
        <LibrarySection variant="empty" />
      </div>
    </div>
  );
}
