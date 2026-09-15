import { useState } from "react";

// Categories the app can fetch extra geometry/system/material data for
// (see isEligibleCategoryName in src/ifc/rawIfcQuery.js — duplicated here
// as a plain list to avoid pulling the web-ifc-dependent module into a
// component that only needs the category names for display logic).
const IFC_INFO_CATEGORIES = new Set([
  "IFCFLOWSEGMENT",
  "IFCFLOWFITTING",
  "IFCFLOWTERMINAL",
  "IFCFLOWCONTROLLER",
  "IFCFLOWTREATMENTDEVICE",
  "IFCBUILDINGELEMENTPROXY",
]);

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// A dd value with a copy-to-clipboard button right-aligned on the same
// line — used for GUID/Tag, the two fields someone's actually likely to
// paste elsewhere (a search, an IFC exporter's own lookup, a bug report).
function CopyableValue({ value, className }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error("Failed to copy to clipboard", err);
    }
  };

  return (
    <span className="element-panel__copyable">
      <span className={className}>{value}</span>
      <button
        type="button"
        className="element-panel__copy-button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        title={copied ? "Copied" : "Copy to clipboard"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  );
}

// Renders only the Info tab's own content — the surrounding
// aside/tab-bar/close-button chrome lives in RightPanel, shared with the
// Measurements tab.
export default function ElementInfoPanel({ element, loading }) {
  const showIfcInfoSection = element && IFC_INFO_CATEGORIES.has(element.category?.toUpperCase());

  return (
    <>
      <div className="element-panel__info-header">
        <div className="element-panel__category">
          {element?.category ?? (loading ? "Loading…" : "No selection")}
        </div>
        {element?.name && (
          <div className="element-panel__name">{element.name}</div>
        )}
      </div>

      {loading && !element && (
        <p className="element-panel__hint">Loading properties…</p>
      )}

      {!loading && !element && (
        <p className="element-panel__hint">
          No element selected — click an element to see its properties.
        </p>
      )}

      {element && (
        <>
          <dl className="element-panel__attrs">
            {element.modelName && (
              <>
                <dt>Model</dt>
                <dd>{element.modelName}</dd>
              </>
            )}
            {element.typeName && (
              <>
                <dt>Type</dt>
                <dd>{element.typeName}</dd>
              </>
            )}
            {element.objectType && (
              <>
                <dt>Object type</dt>
                <dd>{element.objectType}</dd>
              </>
            )}
            {element.tag && (
              <>
                <dt>Tag</dt>
                <dd>
                  <CopyableValue value={element.tag} />
                </dd>
              </>
            )}
            {element.guid && (
              <>
                <dt>GUID</dt>
                <dd>
                  <CopyableValue value={element.guid} className="element-panel__guid" />
                </dd>
              </>
            )}
          </dl>

          <div className="element-panel__pset">
            <div className="element-panel__pset-title">Bounding Box</div>
            {element.boundingBox === undefined ? (
              <p className="element-panel__hint">Loading bounding box…</p>
            ) : element.boundingBox === null ? (
              <p className="element-panel__hint">Bounding box unavailable.</p>
            ) : (
              <dl className="element-panel__attrs">
                <dt>Height</dt>
                <dd>{element.boundingBox.height.toFixed(1)} mm</dd>
                <dt>Length</dt>
                <dd>{element.boundingBox.length.toFixed(1)} mm</dd>
                <dt>Width</dt>
                <dd>{element.boundingBox.width.toFixed(1)} mm</dd>
              </dl>
            )}
          </div>

          {showIfcInfoSection && element.ifcInfo === undefined && (
            <p className="element-panel__hint">Loading extended data…</p>
          )}

          {element.ifcInfo && (
            <div className="element-panel__pset">
              <div className="element-panel__pset-title">Geometry</div>
              <dl className="element-panel__attrs">
                {element.ifcInfo.shape && (
                  <>
                    <dt>Shape</dt>
                    <dd>{element.ifcInfo.shape}</dd>
                  </>
                )}
                {element.ifcInfo.shape === "circular" && (
                  <>
                    <dt>Diameter</dt>
                    <dd>{element.ifcInfo.diameter.toFixed(1)} mm</dd>
                  </>
                )}
                {element.ifcInfo.shape === "rectangular" && (
                  <>
                    <dt>Width × Height</dt>
                    <dd>
                      {element.ifcInfo.width.toFixed(1)} × {element.ifcInfo.height.toFixed(1)} mm
                    </dd>
                  </>
                )}
                {element.ifcInfo.length != null && (
                  <>
                    <dt>Length</dt>
                    <dd>{element.ifcInfo.length.toFixed(1)} mm</dd>
                  </>
                )}
                <dt>Systems</dt>
                <dd>{element.ifcInfo.systems.length > 0 ? element.ifcInfo.systems.join(", ") : "None"}</dd>
                <dt>Material</dt>
                <dd>{element.ifcInfo.material ?? "—"}</dd>
              </dl>
            </div>
          )}

          {element.propertySets.length === 0 ? (
            <p className="element-panel__hint">No property sets found.</p>
          ) : (
            element.propertySets.map((pset, i) => (
              <div className="element-panel__pset" key={`${pset.name}-${i}`}>
                <div className="element-panel__pset-title">{pset.name}</div>
                <dl className="element-panel__attrs">
                  {pset.properties.map((prop, j) => (
                    <div className="element-panel__prop-row" key={`${prop.name}-${j}`}>
                      <dt>{prop.name}</dt>
                      <dd>{String(prop.value ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))
          )}
        </>
      )}
    </>
  );
}
