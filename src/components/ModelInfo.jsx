import { useState } from "react";
import { prettyCategory } from "../ifc/elementDetails";
import ModelName from "./ModelName";
import "./dataPanels.css";

const TOP = 8;

function formatBytes(n) {
  if (n == null) return "unknown";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Card({ model, tree, showName }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const s = tree?.summary;
  const id = `mi-${model.id}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const max = s?.byCategory?.[0]?.[1] ?? 1;
  const cats = s ? (all ? s.byCategory : s.byCategory.slice(0, TOP)) : [];
  return (
    <div className="mi__card">
      <button type="button" className="mi__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none", flex: "none" }}>
          <path d="m9 6 6 6-6 6" />
        </svg>
        {showName ? (
          <span className="mi__name" title={`Info: ${model.name}`}>
            <span className="mi__prefix">Info: </span>
            <ModelName name={model.name} />
          </span>
        ) : (
          <span className="mi__name">Model info</span>
        )}
        {s?.schema && <span className="dp-group__count">{s.schema}</span>}
      </button>
      {open && (
        <div className="mi__body" id={id}>
          {!s ? (
            <p className="sidebar__empty">Reading model info…</p>
          ) : (
            <>
              <dl className="mi__facts">
                <dt>Schema</dt>
                <dd>{s.schema ?? "unknown"}</dd>
                <dt>Elements</dt>
                <dd>{s.elementCount.toLocaleString()}</dd>
                <dt>Storeys</dt>
                <dd>{s.storeyCount}</dd>
                <dt>Length unit</dt>
                <dd>{s.units.length}{s.units.known ? "" : " (assumed)"}</dd>
                <dt>File size</dt>
                <dd>{formatBytes(s.sizeBytes)}</dd>
              </dl>
              <ul className="mi__cats" aria-label="Elements by category">
                {cats.map(([cat, n]) => (
                  <li key={cat} className="mi__cat">
                    <span className="mi__cat-name" title={cat}>{prettyCategory(cat)}</span>
                    <span className="mi__cat-n">{n.toLocaleString()}</span>
                    <span className="mi__bar" aria-hidden="true"><span style={{ width: `${Math.max(3, (n / max) * 100)}%` }} /></span>
                  </li>
                ))}
              </ul>
              {s.byCategory.length > TOP && (
                <button type="button" className="mi__more" onClick={() => setAll((a) => !a)}>
                  {all ? "Show fewer" : `Show all ${s.byCategory.length} categories`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ModelInfo({ models, trees }) {
  if (models.length === 0) return null;
  return (
    <div className="mi">
      {models.map((m) => (
        <Card key={m.id} model={m} tree={trees[m.id]} showName={models.length > 1} />
      ))}
    </div>
  );
}
