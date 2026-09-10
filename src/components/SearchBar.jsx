import { useMemo, useState } from "react";

function GroupCheckbox({ checked, indeterminate, onChange }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      // Mousedown fires before the input's own blur, so the dropdown
      // doesn't close before the click lands.
      onMouseDown={(e) => e.preventDefault()}
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
    <div className="search-bar">
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
        onBlur={() => setOpen(false)}
      />

      {(open && query.trim().length >= 2) || isolatedCount > 0 ? (
        <div className="search-bar__dropdown">
          {open && query.trim().length >= 2 && (
            <div className="search-bar__results">
              <div className="search-bar__mode-toggle">
                <button
                  type="button"
                  className={groupMode === "category" ? "search-bar__mode-toggle-btn search-bar__mode-toggle-btn--active" : "search-bar__mode-toggle-btn"}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setGroupMode("category")}
                >
                  By category
                </button>
                <button
                  type="button"
                  className={groupMode === "items" ? "search-bar__mode-toggle-btn search-bar__mode-toggle-btn--active" : "search-bar__mode-toggle-btn"}
                  onMouseDown={(e) => e.preventDefault()}
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
                          onMouseDown={(e) => e.preventDefault()}
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
              <button
                type="button"
                // Without this, mousedown here blurs the search input first,
                // which closes the results dropdown above and shifts this
                // button up before mouseup/click fire at the original
                // (now-stale) coordinates — losing the click entirely.
                onMouseDown={(e) => e.preventDefault()}
                onClick={onClearIsolation}
              >
                Show all
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
