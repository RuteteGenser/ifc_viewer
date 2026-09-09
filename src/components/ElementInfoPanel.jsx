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

export default function ElementInfoPanel({ element, loading, onClose }) {
  const showIfcInfoSection = element && IFC_INFO_CATEGORIES.has(element.category?.toUpperCase());

  return (
    <aside className="element-panel">
      <div className="element-panel__header">
        <div>
          <div className="element-panel__category">
            {element?.category ?? (loading ? "Loading…" : "No selection")}
          </div>
          {element?.name && (
            <div className="element-panel__name">{element.name}</div>
          )}
        </div>
        <button
          type="button"
          className="element-panel__close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="element-panel__body">
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
                  <dd>{element.tag}</dd>
                </>
              )}
              {element.guid && (
                <>
                  <dt>GUID</dt>
                  <dd className="element-panel__guid">{element.guid}</dd>
                </>
              )}
            </dl>

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
      </div>
    </aside>
  );
}
