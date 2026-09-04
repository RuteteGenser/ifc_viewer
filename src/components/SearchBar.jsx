import { useState } from "react";

export default function SearchBar({
  query,
  onQueryChange,
  results,
  isolatedKeys,
  onToggleIsolate,
  onClearIsolation,
}) {
  const [open, setOpen] = useState(false);
  const isolatedCount = isolatedKeys.size;

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
            <ul className="search-bar__results">
              {results.length === 0 ? (
                <li className="search-bar__hint">No matches</li>
              ) : (
                results.map((r) => (
                  <li key={r.key} className="search-bar__result">
                    <label>
                      <input
                        type="checkbox"
                        checked={isolatedKeys.has(r.key)}
                        // Mousedown fires before the input's own blur, so
                        // the dropdown doesn't close before the click lands.
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
