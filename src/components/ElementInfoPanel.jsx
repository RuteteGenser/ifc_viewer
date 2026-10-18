import { useMemo, useState } from "react";
import { copyText } from "./copyText";
import { filterGroups, prettyCategory } from "../ifc/elementDetails";
import "./dataPanels.css";

// Categories the app can fetch extra geometry/system/material data for
// (see isEligibleCategoryName in src/ifc/rawIfcQuery.js, duplicated here
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

// Show the filter box once there are this many property rows.
const FILTER_THRESHOLD = 12;
// Collapse every group but the first when there are more rows than this.
const OPEN_ALL_LIMIT = 24;

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

// A value you can tap/click/press Enter on to copy. Shows a check briefly
// and raises a toast, so the result is visible even on a phone sheet.
function CopyValue({ label, value, unit, mono, middle, onToast }) {
  const [copied, setCopied] = useState(false);
  const text = unit ? `${value} ${unit}` : String(value);
  // A long id keeps its start and end on screen; the whole value is the tooltip.
  const shown = middle && String(value).length > 20 ? `${String(value).slice(0, 8)}…${String(value).slice(-8)}` : value;
  const copy = async () => {
    const ok = await copyText(String(value));
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1200);
    onToast?.(ok ? `${label} copied` : "Could not copy. Select the text instead.");
  };
  return (
    <button
      type="button"
      className={`dp-value${mono ? " dp-value--mono" : ""}`}
      onClick={copy}
      aria-label={`${label}: ${text}. Copy value`}
      title={middle ? `${value} (click to copy)` : "Click to copy"}
    >
      <span className="dp-value__text">
        {shown}
        {unit ? <span className="dp-value__unit"> {unit}</span> : null}
      </span>
      <span className={`dp-value__icon${copied ? " dp-value__icon--done" : ""}`}>
        {copied ? (
          <>
            <CheckIcon />
            <span className="dp-value__done">Copied</span>
          </>
        ) : (
          <CopyIcon />
        )}
      </span>
    </button>
  );
}

function Row({ label, title, children }) {
  return (
    // The label is part of the copy target too: pressing anywhere on the row copies the value.
    <div
      className="dp-row"
      onClick={(e) => {
        if (!e.target.closest("button")) e.currentTarget.querySelector("button.dp-value")?.click();
      }}
    >
      <dt title={title}>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Group({ group, open, onToggle, onToast }) {
  const id = `dp-group-${group.kind}-${group.name}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return (
    <section className="dp-group">
      <h3 className="dp-group__heading">
        <button
          type="button"
          className="dp-group__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          title={group.name}
        >
          <span className={`dp-group__chevron${open ? " dp-group__chevron--open" : ""}`}>
            <ChevronIcon />
          </span>
          <span className="dp-group__title">{group.label}</span>
          <span className="dp-group__kind">{group.kind === "qto" ? "Quantities" : "Properties"}</span>
          <span className="dp-group__count">{group.rows.length}</span>
        </button>
      </h3>
      {open && (
        <dl className="dp-rows" id={id}>
          {group.rows.map((row, i) => (
            <Row key={`${row.name}-${i}`} label={row.label} title={row.name}>
              <CopyValue label={row.label} value={row.value} unit={row.unit} onToast={onToast} />
            </Row>
          ))}
        </dl>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="dp-skeleton" role="status" aria-label="Loading element properties">
      <div className="dp-skeleton__bar dp-skeleton__bar--title" />
      <div className="dp-skeleton__bar dp-skeleton__bar--sub" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div className="dp-skeleton__line" key={i}>
          <div className="dp-skeleton__bar dp-skeleton__bar--k" />
          <div className="dp-skeleton__bar dp-skeleton__bar--v" />
        </div>
      ))}
    </div>
  );
}

function formatMetres(mm) {
  const m = mm / 1000;
  return `${(Math.round(m * 100) / 100).toString()}`;
}

// Renders only the Info tab's own content; the surrounding
// aside/tab-bar/close-button chrome lives in RightPanel, shared with the
// Measurements tab.
export default function ElementInfoPanel({ element, loading, onHide, onToast }) {
  const [query, setQuery] = useState("");
  // Per-group open state, keyed by group name; undefined falls back to the default.
  const [openState, setOpenState] = useState({});
  const details = element?.details;
  const groups = useMemo(() => details?.groups ?? [], [details]);
  const totalRows = useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);
  const filtered = useMemo(() => filterGroups(groups, query), [groups, query]);
  const filtering = query.trim().length > 0;

  const showIfcInfoSection = element && IFC_INFO_CATEGORIES.has(element.category?.toUpperCase());

  // Reset the filter and the manual open/close choices when another element is selected.
  const [lastGuid, setLastGuid] = useState(null);
  const currentId = element ? `${element.guid ?? ""}|${element.name ?? ""}|${element.category}` : null;
  if (currentId !== lastGuid) {
    setLastGuid(currentId);
    if (query) setQuery("");
    if (Object.keys(openState).length) setOpenState({});
  }

  const isOpen = (g, index) => {
    if (filtering) return true;
    const key = `${g.kind}:${g.name}`;
    if (key in openState) return openState[key];
    return totalRows <= OPEN_ALL_LIMIT || index === 0;
  };
  const toggle = (g, index) => {
    const key = `${g.kind}:${g.name}`;
    setOpenState((s) => ({ ...s, [key]: !isOpen(g, index) }));
  };

  if (!element) {
    if (loading) return <Skeleton />;
    return (
      <>
        <div className="element-panel__info-header">
          <div className="element-panel__category">No selection</div>
        </div>
        <p className="element-panel__hint">
          No element selected, tap or click an element to see its properties.
        </p>
      </>
    );
  }

  const bb = element.boundingBox;
  return (
    <div className="dp-info">
      <div className="element-panel__info-header">
        <div className="element-panel__category" title={element.category}>
          {prettyCategory(element.category)}
        </div>
        {element.name && <div className="element-panel__name">{element.name}</div>}
        {onHide && (
          <button type="button" className="element-panel__hide-button" onClick={onHide}>
            Hide this element
          </button>
        )}
      </div>

      <dl className="dp-rows dp-rows--summary">
        {element.typeName && (
          <Row label="Type">
            <CopyValue label="Type" value={element.typeName} onToast={onToast} />
          </Row>
        )}
        {details?.storey && (
          <Row label="Storey">
            <CopyValue
              label="Storey"
              value={details.storey}
              unit={details.storeyElevation ? `at ${details.storeyElevation.text} ${details.storeyElevation.unit}` : ""}
              onToast={onToast}
            />
          </Row>
        )}
        {details?.materials?.length > 0 && (
          <Row label={details.materials.length > 1 ? "Materials" : "Material"}>
            <CopyValue label="Material" value={details.materials.join(", ")} onToast={onToast} />
          </Row>
        )}
        {details?.classifications?.map((c, i) => (
          <Row key={`${c.text}-${i}`} label="Classification" title={c.source}>
            <CopyValue label="Classification" value={c.text} unit={c.source ? `(${c.source})` : ""} onToast={onToast} />
          </Row>
        ))}
        {element.objectType && (
          <Row label="Object type">
            <CopyValue label="Object type" value={element.objectType} onToast={onToast} />
          </Row>
        )}
        {element.tag && (
          <Row label="Tag">
            <CopyValue label="Tag" value={element.tag} onToast={onToast} />
          </Row>
        )}
        {element.guid && (
          <Row label="GUID">
            <CopyValue label="GUID" value={element.guid} mono middle onToast={onToast} />
          </Row>
        )}
        {element.modelName && (
          <Row label="Model">
            <span className="dp-plain">{element.modelName}</span>
          </Row>
        )}
      </dl>

      <section className="dp-group">
        <h3 className="dp-group__heading dp-group__heading--static">Size</h3>
        {bb === undefined ? (
          <div className="dp-skeleton dp-skeleton--inline" aria-hidden="true">
            <div className="dp-skeleton__line">
              <div className="dp-skeleton__bar dp-skeleton__bar--k" />
              <div className="dp-skeleton__bar dp-skeleton__bar--v" />
            </div>
          </div>
        ) : bb === null ? (
          <p className="element-panel__hint">Bounding box unavailable.</p>
        ) : (
          <dl className="dp-rows">
            <Row label="Height">
              <CopyValue label="Height" value={formatMetres(bb.height)} unit="m" onToast={onToast} />
            </Row>
            <Row label="Length">
              <CopyValue label="Length" value={formatMetres(bb.length)} unit="m" onToast={onToast} />
            </Row>
            <Row label="Width">
              <CopyValue label="Width" value={formatMetres(bb.width)} unit="m" onToast={onToast} />
            </Row>
          </dl>
        )}
      </section>

      {showIfcInfoSection && element.ifcInfo === undefined && (
        <div className="dp-skeleton dp-skeleton--inline" role="status" aria-label="Loading extended data">
          <div className="dp-skeleton__line">
            <div className="dp-skeleton__bar dp-skeleton__bar--k" />
            <div className="dp-skeleton__bar dp-skeleton__bar--v" />
          </div>
        </div>
      )}

      {element.ifcInfo && (
        <section className="dp-group">
          <h3 className="dp-group__heading dp-group__heading--static">Geometry</h3>
          <dl className="dp-rows">
            {element.ifcInfo.shape && (
              <Row label="Shape">
                <span className="dp-plain">{element.ifcInfo.shape}</span>
              </Row>
            )}
            {element.ifcInfo.shape === "circular" && (
              <Row label="Diameter">
                <CopyValue label="Diameter" value={element.ifcInfo.diameter.toFixed(1)} unit="mm" onToast={onToast} />
              </Row>
            )}
            {element.ifcInfo.shape === "rectangular" && (
              <Row label="Width × Height">
                <CopyValue
                  label="Width × Height"
                  value={`${element.ifcInfo.width.toFixed(1)} × ${element.ifcInfo.height.toFixed(1)}`}
                  unit="mm"
                  onToast={onToast}
                />
              </Row>
            )}
            {element.ifcInfo.length != null && (
              <Row label="Length">
                <CopyValue label="Length" value={element.ifcInfo.length.toFixed(1)} unit="mm" onToast={onToast} />
              </Row>
            )}
            <Row label="Systems">
              <span className="dp-plain">{element.ifcInfo.systems.length > 0 ? element.ifcInfo.systems.join(", ") : "None"}</span>
            </Row>
            <Row label="Material">
              <span className="dp-plain">{element.ifcInfo.material ?? "-"}</span>
            </Row>
          </dl>
        </section>
      )}

      {groups.length === 0 ? (
        <p className="element-panel__hint">No property sets found.</p>
      ) : (
        <>
          {totalRows >= FILTER_THRESHOLD && (
            <div className="dp-filter">
              <input
                type="search"
                className="dp-filter__input"
                placeholder="Filter properties"
                aria-label="Filter properties"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
              {filtering && (
                <span className="dp-filter__count" aria-live="polite">
                  {filtered.reduce((n, g) => n + g.rows.length, 0)} of {totalRows}
                </span>
              )}
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="element-panel__hint">No properties match "{query}".</p>
          ) : (
            filtered.map((g, i) => (
              <Group key={`${g.kind}:${g.name}:${i}`} group={g} open={isOpen(g, i)} onToggle={() => toggle(g, i)} onToast={onToast} />
            ))
          )}
        </>
      )}
    </div>
  );
}
