import { colorCss, isoProject } from "../ifc/sectionPlanes";
import "./PlaneSwitch.css";

const CUBE = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const pt = (p) => isoProject(p).map((n) => n.toFixed(3)).join(",");
const KIND_LABEL = { plan: "Plan", side: "Side", front: "Front", tilted: "Tilted" };

// Phone corner widget: a tiny model with the cut plane(s) drawn as translucent
// slabs, and one pill per plane to say which one is active (the one that
// dragging and "Move section" act on). Colours match the 3D sheets.
export default function PlaneSwitch({ planes, onSelect }) {
  if (planes.length === 0 || planes.length > 2) return null;
  const active = planes.find((p) => p.active) ?? planes[planes.length - 1];
  const ordered = [...planes.filter((p) => p !== active), active]; // the active slab is drawn on top
  return (
    <div className="plane-switch" role="group" aria-label={`Active cut plane: Plane ${active.index + 1}`}>
      <svg className="plane-switch__model" viewBox="-1.9 -1.8 3.8 3.6" aria-hidden="true" focusable="false">
        {EDGES.map(([a, b]) => (
          <polyline key={`${a}-${b}`} points={`${pt(CUBE[a])} ${pt(CUBE[b])}`} className="plane-switch__edge" />
        ))}
        {ordered.map((p) =>
          p.slab ? (
            <polygon
              key={p.id}
              points={p.slab.map(pt).join(" ")}
              fill={colorCss(p.color)}
              fillOpacity={p.active ? 0.55 : 0.28}
              stroke={colorCss(p.color)}
              strokeOpacity={p.active ? 1 : 0.55}
              strokeWidth={p.active ? 0.09 : 0.05}
              className="plane-switch__slab"
              onClick={() => onSelect(p.id)}
            />
          ) : null,
        )}
      </svg>
      <div className="plane-switch__pills">
        {planes.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`plane-switch__pill${p.active ? " is-active" : ""}`}
            style={{ "--plane-color": colorCss(p.color) }}
            aria-pressed={p.active}
            aria-label={`Plane ${p.index + 1}, ${KIND_LABEL[p.kind]}${p.active ? ", active" : ""}`}
            onClick={() => onSelect(p.id)}
          >
            <span className="plane-switch__dot" aria-hidden="true" />
            <span>Plane {p.index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
