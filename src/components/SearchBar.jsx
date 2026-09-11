import { useMemo, useRef, useState } from "react";

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

export default function SearchBar({
  query,
  onQueryChange,
  results,
  isolatedKeys,
  onToggleIsolate,
  onClearIsolation,
}) {
  const [open, setOpen] = useState(false);
  const [groupMode, setGroupMode] = useState("category");
  const isolatedCount = isolatedKeys.size;
  const containerRef = useRef(null);

  const groups = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      const category = r.category || "(uncategorized)";
      if (!map.has(category)) map.set(category, { category, keys: [] });
      map.get(category).keys.push(r.key);
    }
    return [...map.values()];
  }, [results]);

  return (
    <div className="search-bar" ref={containerRef}>
      <input
        type="text"
        className="search-bar__input"
        placeholder="Search elements by name…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
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

      {(open && query.trim().length >= 2) || isolatedCount > 0 ? (
        <div className="search-bar__dropdown">
          {open && query.trim().length >= 2 && (
            <div className="search-bar__results">
              <div className="search-bar__mode-toggle">
                <button
                  type="button"
                  className={groupMode === "category" ? "search-bar__mode-toggle-btn search-bar__mode-toggle-btn--active" : "search-bar__mode-toggle-btn"}
                  onClick={() => setGroupMode("category")}
                >
                  By category
                </button>
                <button
                  type="button"
                  className={groupMode === "items" ? "search-bar__mode-toggle-btn search-bar__mode-toggle-btn--active" : "search-bar__mode-toggle-btn"}
                  onClick={() => setGroupMode("items")}
                >
                  Individual items
                </button>
              </div>

              <ul className="search-bar__results-list">
                {results.length === 0 ? (
                  <li className="search-bar__hint">No matches</li>
                ) : groupMode === "category" ? (
                  groups.map((g) => {
                    const checkedCount = g.keys.filter((k) => isolatedKeys.has(k)).length;
                    return (
                      <li key={g.category} className="search-bar__result">
                        <label>
                          <GroupCheckbox
                            checked={checkedCount === g.keys.length}
                            indeterminate={checkedCount > 0 && checkedCount < g.keys.length}
                            onChange={() => onToggleIsolate(g.keys)}
                          />
                          <span className="search-bar__result-name">{g.category}</span>
                          <span className="search-bar__result-category">{g.keys.length}</span>
                        </label>
                      </li>
                    );
                  })
                ) : (
                  results.map((r) => (
                    <li key={r.key} className="search-bar__result">
                      <label>
                        <input
                          type="checkbox"
                          checked={isolatedKeys.has(r.key)}
                          onChange={() => onToggleIsolate(r.key)}
                        />
                        <span className="search-bar__result-name">{r.name}</span>
                        {r.category && <span className="search-bar__result-category">{r.category}</span>}
                      </label>
                    </li>
                  ))
                )}
              </ul>
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
