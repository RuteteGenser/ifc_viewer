import { SORT_KEYS, DEFAULT_DIR, dirLabel } from "./organize";

export const SEARCH_MIN_MODELS = 5; // the search box shows above this many models

function Chip({ label, on, onClick }) {
  return (
    <button type="button" className={`lib-chip${on ? " lib-chip--on" : ""}`} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
}

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

// One slim, wrapping row: search, sort, direction, filter chips, count.
export default function OrganizeBar({ id, state, setState, result, canOpenNow, searchTotal }) {
  const { options, total, count, filtering } = result;
  const s = state;
  const set = (patch) => setState((prev) => ({ ...prev, ...patch }));
  const showSearch = (searchTotal ?? total) > SEARCH_MIN_MODELS;
  const chips = options.formats.length + options.disciplines.length > 0 || canOpenNow || s.openNow;
  return (
    <div className="lib-org" role="group" aria-label="Sort and filter my models">
      {showSearch && (
        <div className="lib-org__search">
          <label className="lib-visually-hidden" htmlFor={`${id}-q`}>Search my models</label>
          <input
            id={`${id}-q`}
            className="lib-org__input"
            type="search"
            placeholder="Search name, note or tag"
            value={s.query}
            autoComplete="off"
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" && s.query) {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopPropagation();
                set({ query: "" });
              }
            }}
          />
        </div>
      )}
      <div className="lib-org__sort">
        <label className="lib-visually-hidden" htmlFor={`${id}-sort`}>Sort by</label>
        <select id={`${id}-sort`} className="lib-org__select" value={s.sort} onChange={(e) => set({ sort: e.target.value, dir: DEFAULT_DIR[e.target.value] })}>
          {SORT_KEYS.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="lib-btn lib-org__dir"
          aria-label={`Order: ${dirLabel(s.sort, s.dir)}. Switch order`}
          onClick={() => set({ dir: s.dir === "asc" ? "desc" : "asc" })}
        >
          <span aria-hidden="true">{s.dir === "asc" ? "↑" : "↓"} </span>
          {dirLabel(s.sort, s.dir)}
        </button>
      </div>
      {chips && (
        <div className="lib-org__chips" role="group" aria-label="Filters">
          {options.formats.map((f) => (
            <Chip key={f} label={f} on={s.formats.includes(f)} onClick={() => set({ formats: toggle(s.formats, f) })} />
          ))}
          {options.disciplines.map((d) => (
            <Chip key={d} label={d} on={s.disciplines.includes(d)} onClick={() => set({ disciplines: toggle(s.disciplines, d) })} />
          ))}
          {(canOpenNow || s.openNow) && <Chip label="Open now" on={s.openNow} onClick={() => set({ openNow: !s.openNow })} />}
        </div>
      )}
      <p className="lib-org__count" role="status" data-testid="lib-count">
        {filtering ? `${count} of ${total}` : `${total} ${total === 1 ? "model" : "models"}`}
      </p>
    </div>
  );
}
