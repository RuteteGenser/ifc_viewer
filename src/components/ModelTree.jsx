import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prettyCategory } from "../ifc/elementDetails";
import "./dataPanels.css";

const PAGE = 100; // children shown per node before "Show more"
const MIN_FILTER = 2;

function EyeIcon({ state }) {
  if (state === "hidden") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.9 17.9A10.5 10.5 0 0 1 12 19.5C6.5 19.5 3 12 3 12a17 17 0 0 1 4.1-5.2M9.9 4.6A9.7 9.7 0 0 1 12 4.5C17.5 4.5 21 12 21 12a17 17 0 0 1-2.2 3.2" />
        <path d="m3 3 18 18" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" opacity={state === "partial" ? 0.55 : 1}>
      <path d="M3 12s3.5-7.5 9-7.5S21 12 21 12s-3.5 7.5-9 7.5S3 12 3 12Z" />
      <circle cx="12" cy="12" r="3" fill={state === "partial" ? "currentColor" : "none"} />
    </svg>
  );
}

function Chevron({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none" }}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function labelOf(node, name) {
  if (node.kind === "group") return prettyCategory(node.category);
  if (name) return name;
  if (node.kind === "spatial") return prettyCategory(node.category);
  return `${prettyCategory(node.category)} ${node.localId}`;
}

export default function ModelTree({ browser, selectedId, onPick }) {
  const { trees, nameOf, nameVersion, hiddenState, hiddenVersion, loadNames, setNodeVisible, selectElement, indexAllNames, indexing } = browser;
  const roots = useMemo(() => Object.values(trees).filter((t) => t.root), [trees]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [limits, setLimits] = useState({});
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState(null);
  const seen = useRef(new Set());
  const listRef = useRef(null);
  const q = query.trim().toLowerCase();
  const filtering = q.length >= MIN_FILTER;

  // Open the spatial chain (project, site, building) of each new model by default.
  useEffect(() => {
    const add = [];
    for (const t of roots) {
      if (seen.current.has(t.root.id)) continue;
      seen.current.add(t.root.id);
      const walk = (n, depth) => {
        if (n.kind === "spatial" && depth < 3) {
          add.push(n.id);
          n.children.forEach((c) => walk(c, depth + 1));
        }
      };
      walk(t.root, 0);
    }
    if (add.length) setExpanded((prev) => new Set([...prev, ...add]));
  }, [roots]);

  useEffect(() => {
    if (filtering) indexAllNames();
  }, [filtering, indexAllNames]);

  const rows = useMemo(() => {
    const out = [];
    const nameFor = (n) => labelOf(n, n.kind === "group" ? null : nameOf(n)).toLowerCase();
    const matchesSelf = (n) => nameFor(n).includes(q);
    // memo of "this node or a descendant matches" for the filter
    const cache = new Map();
    const hasMatch = (n) => {
      if (cache.has(n.id)) return cache.get(n.id);
      let r = matchesSelf(n);
      if (!r) for (const c of n.children) if (hasMatch(c)) { r = true; break; }
      cache.set(n.id, r);
      return r;
    };
    const walk = (n, depth, ancestorMatched) => {
      const selfMatch = filtering && matchesSelf(n);
      if (filtering && !ancestorMatched && !hasMatch(n)) return;
      out.push({ type: "node", node: n, depth });
      const isOpen = filtering ? true : expanded.has(n.id);
      if (!isOpen || n.children.length === 0) return;
      const sub = ancestorMatched || selfMatch;
      const kids = filtering && !sub ? n.children.filter(hasMatch) : n.children;
      const limit = limits[n.id] ?? PAGE;
      for (const c of kids.slice(0, limit)) walk(c, depth + 1, sub);
      if (kids.length > limit) out.push({ type: "more", node: n, depth: depth + 1, remaining: kids.length - limit });
    };
    for (const t of roots) walk(t.root, 0, false);
    return out;
    // nameVersion: names load lazily and rows read them through a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, expanded, limits, filtering, q, nameVersion]);

  // Load names for element rows that are on screen.
  useEffect(() => {
    const need = new Map();
    for (const r of rows) {
      if (r.type !== "node" || r.node.kind !== "element") continue;
      if (nameOf(r.node) !== undefined) continue;
      if (!need.has(r.node.modelId)) need.set(r.node.modelId, []);
      need.get(r.node.modelId).push(r.node.localId);
    }
    for (const [modelId, ids] of need) loadNames(modelId, ids);
  }, [rows, nameOf, loadNames]);

  const toggle = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const activate = useCallback(
    (node) => {
      if (node.kind === "element" && node.localId != null) {
        selectElement(node.modelId, node.localId);
        onPick?.();
      } else {
        toggle(node.id);
      }
    },
    [selectElement, onPick, toggle],
  );

  const focusRow = (id) => {
    setFocusId(id);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus());
  };

  const onKeyDown = (e) => {
    const rowEl = e.target.closest?.("[role=treeitem]");
    if (!rowEl) return;
    const idx = rows.findIndex((r) => r.type === "node" && r.node.id === rowEl.dataset.id);
    const moreIdx = rowEl.dataset.more;
    if (moreIdx && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setLimits((l) => ({ ...l, [moreIdx]: (l[moreIdx] ?? PAGE) + PAGE }));
      return;
    }
    if (idx < 0 && !moreIdx) return;
    const cur = rows[idx]?.node;
    const stepTo = (i) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!r) return;
      focusRow(r.type === "node" ? r.node.id : `more:${r.node.id}`);
    };
    const at = idx >= 0 ? idx : rows.findIndex((r) => r.type === "more" && r.node.id === moreIdx);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        stepTo(at + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        stepTo(at - 1);
        break;
      case "Home":
        e.preventDefault();
        stepTo(0);
        break;
      case "End":
        e.preventDefault();
        stepTo(rows.length - 1);
        break;
      case "ArrowRight":
        if (!cur) break;
        e.preventDefault();
        if (cur.children.length > 0 && !expanded.has(cur.id) && !filtering) toggle(cur.id);
        else if (cur.children.length > 0) stepTo(at + 1);
        break;
      case "ArrowLeft":
        if (!cur) break;
        e.preventDefault();
        if (expanded.has(cur.id) && cur.children.length > 0 && !filtering) toggle(cur.id);
        else if (cur.parentId) {
          const pid = cur.parentId;
          if (rows.some((r) => r.type === "node" && r.node.id === pid)) focusRow(pid);
        }
        break;
      case "Enter":
        if (!cur) break;
        e.preventDefault();
        activate(cur);
        break;
      case " ":
        if (!cur) break;
        e.preventDefault();
        setNodeVisible(cur, hiddenState(cur) === "hidden");
        break;
      default:
    }
  };

  if (roots.length === 0) {
    const loading = browser && Object.keys(trees).length === 0;
    return loading ? null : <p className="sidebar__empty">No structure available for this model.</p>;
  }

  const firstFocusable = focusId && rows.some((r) => r.type === "node" && r.node.id === focusId) ? focusId : rows.find((r) => r.type === "node")?.node.id;

  return (
    <div className="mt">
      <div className="dp-filter">
        <input
          type="search"
          className="dp-input"
          placeholder="Filter structure"
          aria-label="Filter model structure"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            if (e.key === "ArrowDown") {
              e.preventDefault();
              const first = rows.find((r) => r.type === "node");
              if (first) focusRow(first.node.id);
            }
          }}
        />
      </div>
      {filtering && indexing && <p className="mt__note" role="status">Reading element names…</p>}
      {filtering && !indexing && rows.length === 0 && <p className="mt__note">Nothing matches "{query}".</p>}
      <div className="mt__list" role="tree" aria-label="Model structure" ref={listRef} onKeyDown={onKeyDown} data-hv={hiddenVersion}>
        {rows.map((r) => {
          if (r.type === "more") {
            return (
              <div
                key={`more:${r.node.id}`}
                role="treeitem"
                data-id={`more:${r.node.id}`}
                data-more={r.node.id}
                aria-level={r.depth + 1}
                tabIndex={-1}
                className="mt-more"
                style={{ paddingLeft: 8 + r.depth * 14 }}
              >
                <button
                  type="button"
                  className="mt-more__button"
                  onClick={() => setLimits((l) => ({ ...l, [r.node.id]: (l[r.node.id] ?? PAGE) + PAGE }))}
                >
                  Show more ({r.remaining} left)
                </button>
              </div>
            );
          }
          const n = r.node;
          const name = n.kind === "group" ? null : nameOf(n);
          const label = labelOf(n, name);
          const hasKids = n.children.length > 0;
          const open = filtering || expanded.has(n.id);
          const vis = hiddenState(n);
          const selected = selectedId === n.id;
          return (
            <div
              key={n.id}
              role="treeitem"
              data-id={n.id}
              aria-level={r.depth + 1}
              aria-expanded={hasKids ? open : undefined}
              aria-selected={selected}
              tabIndex={n.id === firstFocusable ? 0 : -1}
              className={`mt-row mt-row--${n.kind}${selected ? " mt-row--selected" : ""}${vis === "hidden" ? " mt-row--hidden" : ""}`}
              style={{ paddingLeft: 4 + r.depth * 14 }}
              onFocus={() => setFocusId(n.id)}
            >
              {hasKids ? (
                <button type="button" className="mt-row__chev" tabIndex={-1} aria-label={`${open ? "Collapse" : "Expand"} ${label}`} onClick={() => toggle(n.id)}>
                  <Chevron open={open} />
                </button>
              ) : (
                <span className="mt-row__chev mt-row__chev--none" />
              )}
              <button type="button" className="mt-row__label" tabIndex={-1} onClick={() => activate(n)} title={n.kind === "spatial" ? `${label} (${prettyCategory(n.category)})` : label}>
                <span className="mt-row__text">{name === undefined && n.kind === "element" ? "…" : label}</span>
              </button>
              {(n.kind !== "element" || hasKids) && <span className="mt-row__count" aria-label={`${n.leafCount} elements`}>{n.leafCount}</span>}
              <button
                type="button"
                className="mt-row__eye"
                tabIndex={-1}
                aria-label={`${vis === "hidden" ? "Show" : "Hide"} ${label}`}
                aria-pressed={vis === "hidden"}
                title={vis === "hidden" ? "Show" : "Hide"}
                onClick={() => setNodeVisible(n, vis === "hidden")}
              >
                <EyeIcon state={vis} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
