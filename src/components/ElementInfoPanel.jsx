export default function ElementInfoPanel({ element, loading, onClose }) {
  if (!loading && !element) return null;

  return (
    <aside className="element-panel">
      <div className="element-panel__header">
        <div>
          <div className="element-panel__category">
            {element?.category ?? "Loading…"}
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

        {element && (
          <>
            <dl className="element-panel__attrs">
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
