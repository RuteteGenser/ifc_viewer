import { formatDimensionTag } from "../ifc/dimensionTagFormat";

export default function DimensionTagsPanel({ pinnedTags, onUnpin, onClearAllPins }) {
  return (
    <div className="measure-control">
      <button
        type="button"
        className="sidebar__reset-visibility-button"
        onClick={onClearAllPins}
        disabled={pinnedTags.length === 0}
      >
        Clear all pins
      </button>
      {pinnedTags.length === 0 ? (
        <p className="clip-control__hint">
          Turn on the Tag tool, then click a hovered element to pin its dimension tag.
        </p>
      ) : (
        pinnedTags.map((tag) => (
          <div className="clip-control__plane" key={tag.key}>
            <div className="measure-control__length">{tag.name || "(unnamed)"}</div>
            <div className="measure-control__values">
              <span>{tag.category}</span>
              <span>{formatDimensionTag(tag.category, tag.dimData) ?? "—"}</span>
            </div>
            <div className="clip-control__buttons">
              <button
                type="button"
                className="clip-control__remove"
                aria-label="Unpin dimension tag"
                title="Unpin dimension tag"
                onClick={() => onUnpin(tag.guid)}
              >
                ✕
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
