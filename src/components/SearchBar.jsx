import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import usePopoverGroup from "../hooks/usePopoverGroup";
import { prettyCategory } from "../ifc/elementDetails";
import { useBrowser } from "../hooks/BrowserContext";
import "./dataPanels.css";

function GroupCheckbox({ checked, indeterminate, onChange }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={onChange}
    />
  );
}

// Wraps every case-insensitive occurrence of a query term in <mark>.
function Highlight({ text, terms }) {
  if (!text || terms.length === 0) return text;
  const lower = text.toLowerCase();
  const spans = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(term, from);
      if (i < 0) break;
      spans.push([i, i + term.length]);
      from = i + term.length;
    }
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const out = [];
  let pos = 0;
  merged.forEach(([a, b], k) => {
    if (a > pos) out.push(text.slice(pos, a));
    out.push(<mark key={k} className="sb-mark">{text.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="search-bar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

// Landscape phones are short and wide: a shorter prompt keeps the field readable.
const SHORT_PLACEHOLDER_QUERY = "(max-height: 500px) and (pointer: coarse)";
function useShortPlaceholder() {
  const [short, setShort] = useState(() => !!window.matchMedia?.(SHORT_PLACEHOLDER_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(SHORT_PLACEHOLDER_QUERY);
    if (!mq) return undefined;
    const update = () => setShort(mq.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return short;
}

export default function SearchBar({
  query,
  onQueryChange,
  results,
  isolatedKeys,
  onToggleIsolate,
  onClearIsolation,
}) {
  const browser = useBrowser();
  const shortPlaceholder = useShortPlaceholder();
  const [open, setOpen] = useState(false);
  const closeResults = useCallback(() => {
    setOpen(false);
    if (document.activeElement?.closest?.(".search-bar")) document.activeElement.blur();
  }, []);
  usePopoverGroup("search", open, closeResults);
  const [groupMode, setGroupMode] = useState("category");
  const [catFilter, setCatFilter] = useState(() => new Set());
  const [active, setActive] = useState(0);
  const isolatedCount = isolatedKeys.size;
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2), [query]);

  // Category chips are built from the full result set; the filter narrows the list.
  const chips = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      const c = r.category || "";
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [results]);

  // A chip that no longer matches any result must not silently hide everything.
  const activeCats = useMemo(() => new Set([...catFilter].filter((c) => chips.some(([k]) => k === c))), [catFilter, chips]);
  const shown = useMemo(
    () => (activeCats.size === 0 ? results : results.filter((r) => activeCats.has(r.category || ""))),
    [results, activeCats],
  );

  const groups = useMemo(() => {
    const map = new Map();
    for (const r of shown) {
      const category = r.category || "(uncategorized)";
      if (!map.has(category)) map.set(category, { category, keys: [] });
      map.get(category).keys.push(r.key);
    }
    return [...map.values()];
  }, [shown]);

  const storeyOf = (r) => {
    const nodes = browser?.trees?.[r.modelId]?.nodes;
    let node = nodes?.get(`${r.modelId}/${r.localId}`);
    while (node && !(node.kind === "spatial" && node.category === "IFCBUILDINGSTOREY")) node = node.parentId ? nodes.get(node.parentId) : null;
    return node ? browser.nameOf(node) || "" : "";
  };

  const rowCount = groupMode === "category" ? groups.length : shown.length;
  const activeIdx = Math.min(active, Math.max(rowCount - 1, 0));
  const shownKeys = shown.map((r) => r.key);
  const allShownIsolated = shownKeys.length > 0 && shownKeys.every((k) => isolatedKeys.has(k));
  const showList = open && query.trim().length >= 2;

  const toggleChip = (cat) => {
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
    setActive(0);
  };

  const goTo = (r) => {
    browser?.selectElement(r.modelId, r.localId);
    // A touch screen drops its keyboard; with a keyboard, focus stays in the field so the next search is one key away.
    if (window.matchMedia?.("(pointer: coarse)").matches) inputRef.current?.blur();
    else setOpen(false);
  };

  const move = (delta) => {
    const next = Math.max(0, Math.min(rowCount - 1, activeIdx + delta));
    setActive(next);
    requestAnimationFrame(() => containerRef.current?.querySelector(`#sb-opt-${next}`)?.scrollIntoView({ block: "nearest" }));
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") return; // handled by the container, wherever focus is inside it
    if (!showList || rowCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (groupMode === "category") {
        const g = groups[activeIdx];
        if (g) onToggleIsolate(g.keys);
      } else {
        const r = shown[activeIdx];
        if (!r) return;
        if (e.shiftKey) onToggleIsolate(r.key);
        else goTo(r);
      }
    }
  };

  return (
    <div
      className="search-bar"
      ref={containerRef}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Esc backs out of search entirely: text, isolation, focus.
        if (query) onQueryChange("");
        if (isolatedCount > 0) onClearIsolation();
        setOpen(false);
        inputRef.current?.blur();
        if (containerRef.current?.contains(document.activeElement)) document.activeElement.blur();
      }}
    >
      <SearchIcon />
      <input
        ref={inputRef}
        type="text"
        className="search-bar__input"
        placeholder={shortPlaceholder ? "Search" : "Search elements by name or type…"}
        value={query}
        role="combobox"
        aria-label="Search elements"
        aria-expanded={showList}
        aria-controls="sb-listbox"
        aria-activedescendant={showList && rowCount > 0 ? `sb-opt-${activeIdx}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Clicking a checkbox/button in the dropdown blurs this input
          // immediately on mousedown — often with relatedTarget still null,
          // since a mousedown on a non-focusable target (e.g. the row's
          // name text, next to the checkbox) has no definite next focus
          // target yet. Closing synchronously here would unmount the
          // control before the click's default action (including the
          // label's delegated focus+toggle of its checkbox) has happened.
          // Deferring one tick lets that settle, so the check below sees
          // where focus actually ended up.
          window.setTimeout(() => {
            if (!containerRef.current?.contains(document.activeElement)) setOpen(false);
          }, 0);
        }}
      />

      {showList || isolatedCount > 0 ? (
        <div
          className="search-bar__dropdown"
          onMouseDown={(e) => {
            // Keep focus in the input while pressing list controls (Safari does not focus buttons).
            if (e.target.tagName !== "INPUT") e.preventDefault();
          }}
        >
          {showList && (
            <div className="search-bar__results">
              <div className="search-bar__mode-toggle">
                <button
                  type="button"
                  className={groupMode === "category" ? "search-bar__mode-toggle-btn search-bar__mode-toggle-btn--active" : "search-bar__mode-toggle-btn"}
                  onClick={() => {
                    setGroupMode("category");
                    setActive(0);
                  }}
                >
                  By category
                </button>
                <button
                  type="button"
                  className={groupMode === "items" ? "search-bar__mode-toggle-btn search-bar__mode-toggle-btn--active" : "search-bar__mode-toggle-btn"}
                  onClick={() => {
                    setGroupMode("items");
                    setActive(0);
                  }}
                >
                  Individual items
                </button>
              </div>

              {chips.length > 1 && (
                <div className="sb-chips" role="group" aria-label="Filter results by category">
                  {chips.map(([cat, n]) => (
                    <button
                      key={cat || "none"}
                      type="button"
                      className={`sb-chip${activeCats.has(cat) ? " sb-chip--on" : ""}`}
                      aria-pressed={activeCats.has(cat)}
                      onClick={() => toggleChip(cat)}
                    >
                      {cat ? prettyCategory(cat) : "Other"} <span className="sb-chip__n">{n}</span>
                    </button>
                  ))}
                </div>
              )}

              {shown.length > 0 && (
                <div className="sb-actions">
                  <span className="sb-actions__count" aria-live="polite">
                    {shown.length} result{shown.length === 1 ? "" : "s"}
                  </span>
                  <button type="button" className="sb-actions__btn" onClick={() => onToggleIsolate(shownKeys)}>
                    {allShownIsolated ? "Remove from isolation" : `Isolate ${shown.length === results.length ? "all" : "these"} ${shown.length}`}
                  </button>
                </div>
              )}

              <ul className="search-bar__results-list" id="sb-listbox" role="listbox" aria-label="Search results">
                {shown.length === 0 ? (
                  <li className="search-bar__hint" role="presentation">No matches</li>
                ) : groupMode === "category" ? (
                  groups.map((g, i) => {
                    const checkedCount = g.keys.filter((k) => isolatedKeys.has(k)).length;
                    return (
                      <li
                        key={g.category}
                        id={`sb-opt-${i}`}
                        role="option"
                        aria-selected={i === activeIdx}
                        className={`search-bar__result${i === activeIdx ? " sb-row--active" : ""}`}
                      >
                        <label>
                          <GroupCheckbox
                            checked={checkedCount === g.keys.length}
                            indeterminate={checkedCount > 0 && checkedCount < g.keys.length}
                            onChange={() => onToggleIsolate(g.keys)}
                          />
                          <span className="search-bar__result-name">
                            <Highlight text={prettyCategory(g.category)} terms={terms} />
                          </span>
                          <span className="search-bar__result-category">{g.keys.length}</span>
                        </label>
                      </li>
                    );
                  })
                ) : (
                  shown.map((r, i) => {
                    const storey = storeyOf(r);
                    return (
                      <li
                        key={r.key}
                        id={`sb-opt-${i}`}
                        role="option"
                        aria-selected={i === activeIdx}
                        className={`search-bar__result sb-row${i === activeIdx ? " sb-row--active" : ""}`}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={isolatedKeys.has(r.key)}
                            onChange={() => onToggleIsolate(r.key)}
                          />
                          <span className="sb-row__main">
                            <span className="search-bar__result-name">
                              <Highlight text={r.name} terms={terms} />
                            </span>
                            <span className="sb-row__meta">
                              {r.category && (
                                <Fragment>
                                  <Highlight text={prettyCategory(r.category)} terms={terms} />
                                </Fragment>
                              )}
                              {storey && <span> · {storey}</span>}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="sb-go"
                          aria-label={`Select ${r.name}`}
                          title="Select this element"
                          onClick={() => goTo(r)}
                        >
                          <TargetIcon />
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              {shown.length > 0 && (
                <div className="sb-hint" aria-hidden="true">
                  Up and Down to move, Enter to {groupMode === "category" ? "isolate" : "select"}
                  {groupMode === "items" ? ", Shift+Enter to isolate" : ""}
                </div>
              )}
            </div>
          )}

          {isolatedCount > 0 && (
            <div className="search-bar__isolate-banner">
              Isolating {isolatedCount} element{isolatedCount === 1 ? "" : "s"}
              <button type="button" onClick={onClearIsolation}>
                Show all
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
