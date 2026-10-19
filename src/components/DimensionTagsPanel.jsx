const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

import { useAddedKeys } from "../usePresence";
import { formatDimensionTag } from "../ifc/dimensionTagFormat";

export default function DimensionTagsPanel({ pinnedTags, onUnpin, onClearAllPins, onStartTagging }) {
  const added = useAddedKeys(pinnedTags.map((t) => t.key));
  return (
    <div className="measure-control">
      {pinnedTags.length === 0 ? (
        <>
          <p className="clip-control__hint">No tags yet. {COARSE ? "Tap" : "Hover and click"} an element to pin a tag with its name and size.</p>
          <button type="button" className="sidebar__reset-visibility-button sidebar__reset-visibility-button--primary" onClick={onStartTagging}>
            Start tagging
          </button>
        </>
      ) : (
        <button type="button" className="sidebar__reset-visibility-button" onClick={onClearAllPins}>
          Clear all tags
        </button>
      )}
      {pinnedTags.length > 0 &&
        pinnedTags.map((tag) => (
          <div className={`clip-control__plane${added.has(tag.key) ? " row-new" : ""}`} key={tag.key}>
            <div className="measure-control__length">{tag.name || "(unnamed)"}</div>
            <div className="measure-control__values">
              <span>{tag.dimData?.familyName || tag.name || tag.category}</span>
              <span>{formatDimensionTag(tag.category, tag.dimData)?.join(" / ") ?? "-"}</span>
            </div>
            <div className="clip-control__buttons">
              <button
                type="button"
                className="clip-control__remove"
                aria-label="Remove tag"
                title="Remove tag"
                onClick={() => onUnpin(tag.guid)}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
