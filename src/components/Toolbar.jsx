import { useEffect, useRef } from "react";
import CameraClipControl from "./CameraClipControl";
import Tooltip from "./Tooltip";
import SearchBar from "./SearchBar";
import ShortcutsHelp from "./ShortcutsHelp";

function MeasureIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="9" width="18" height="6" rx="1" transform="rotate(-30 12 12)" />
      <path d="M8.5 12.6 L9.7 10.6 M11.3 14.2 L12.5 12.2 M14 15.8 L15.2 13.8" transform="rotate(-30 12 12)" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 3.5H5.5a2 2 0 0 0-2 2v7l10 10a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8l-10-10Z" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg className="top-bar__home-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v10h13V10" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a13.4 13.4 0 0 1-3.1 3.9M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4.4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function HideCategoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M4 7.5l8 4.5 8-4.5" />
      <path d="M12 12v9" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export default function Toolbar({
  hasModels,
  onResetView,
  measureModeActive,
  onToggleMeasureMode,
  cameraClipEnabled,
  onSetCameraClipEnabled,
  tagToolActive,
  onToggleTagTool,
  categoryHideModeActive,
  onToggleCategoryHideMode,
  tagsVisible,
  onToggleTagsVisibility,
  hasPinnedTags,
  hasMeasurements,
  hasModelColors,
  searchQuery,
  onQueryChange,
  searchResults,
  isolatedKeys,
  onToggleIsolate,
  onClearIsolation,
  onBlocked,
}) {
  const rootRef = useRef(null);

  // On narrow screens the toolbar wraps to two or three rows, so its height
  // isn't a constant; publish it so anything anchored beneath it (status
  // banners) can follow.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const publish = () => document.documentElement.style.setProperty("--toolbar-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const eyeUsable = hasModels && (hasPinnedTags || hasMeasurements || hasModelColors);
  const locked = (text) => (hasModels ? text : "Open a model first");

  return (
    <div className="toolbar" ref={rootRef}>
      <Tooltip description={locked("Fit the whole model in view")}>
        <button
          type="button"
          className={`top-bar__home-button${hasModels ? "" : " is-blocked"}`}
          onClick={hasModels ? onResetView : onBlocked}
          aria-disabled={!hasModels}
          aria-label="Home: fit the whole model in view"
        >
          <HomeIcon />
          <span className="top-bar__home-text">Home</span>
        </button>
      </Tooltip>
      <Tooltip description={locked("Measure: click two points")} hotkey="M">
        <button
          type="button"
          className={`top-bar__icon-button${measureModeActive ? " top-bar__icon-button--active" : ""}${hasModels ? "" : " is-blocked"}`}
          onClick={hasModels ? onToggleMeasureMode : onBlocked}
          aria-disabled={!hasModels}
          aria-label="Toggle measure mode"
        >
          <MeasureIcon />
          <span className="top-bar__caption" aria-hidden="true">Measure</span>
        </button>
      </Tooltip>
      <CameraClipControl
        cameraClipEnabled={cameraClipEnabled}
        onSetCameraClipEnabled={onSetCameraClipEnabled}
        disabled={!hasModels}
        onBlocked={onBlocked}
      />
      <Tooltip description={locked("Tag: pin a tag with an element's name and size")} hotkey="T">
        <button
          type="button"
          className={`top-bar__icon-button${tagToolActive ? " top-bar__icon-button--active" : ""}${hasModels ? "" : " is-blocked"}`}
          onClick={hasModels ? onToggleTagTool : onBlocked}
          aria-disabled={!hasModels}
          aria-label="Toggle tag tool"
        >
          <TagIcon />
          <span className="top-bar__caption" aria-hidden="true">Tag</span>
        </button>
      </Tooltip>
      <Tooltip description={locked("Hide a whole category of elements")} hotkey="G">
        <button
          type="button"
          className={`top-bar__icon-button${categoryHideModeActive ? " top-bar__icon-button--active" : ""}${hasModels ? "" : " is-blocked"}`}
          onClick={hasModels ? onToggleCategoryHideMode : onBlocked}
          aria-disabled={!hasModels}
          aria-label="Toggle hide-category tool"
        >
          <HideCategoryIcon />
          <span className="top-bar__caption" aria-hidden="true">Hide</span>
        </button>
      </Tooltip>
      {eyeUsable && (
        <Tooltip description="Show or hide tags and measurements" hotkey="V">
          <button
            type="button"
            className={`top-bar__icon-button${tagsVisible ? "" : " top-bar__icon-button--active"}`}
            onClick={onToggleTagsVisibility}
            aria-pressed={!tagsVisible}
            aria-label="Notes"
          >
            {tagsVisible ? <EyeIcon /> : <EyeOffIcon />}
            <span className="top-bar__caption" aria-hidden="true">Notes</span>
          </button>
        </Tooltip>
      )}
      <SearchBar
        query={searchQuery}
        onQueryChange={onQueryChange}
        results={searchResults}
        isolatedKeys={isolatedKeys}
        onToggleIsolate={onToggleIsolate}
        onClearIsolation={onClearIsolation}
      />
      <ShortcutsHelp />
    </div>
  );
}
