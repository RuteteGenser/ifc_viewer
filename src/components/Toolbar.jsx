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

function ShowAllDimensionsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="7" width="7" height="4" rx="0.5" />
      <rect x="13" y="13" width="7" height="4" rx="0.5" />
      <path d="M4 15.5h5M15.5 7v3.5" />
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
  cameraClipDistance,
  onSetCameraClipDistance,
  tagToolActive,
  onToggleTagTool,
  showAllDimensions,
  onToggleShowAllDimensions,
  searchQuery,
  onQueryChange,
  searchResults,
  isolatedKeys,
  onToggleIsolate,
  onClearIsolation,
}) {
  return (
    <div className="toolbar">
      <Tooltip description="Reset to the default view">
        <button
          type="button"
          className="top-bar__home-button"
          onClick={onResetView}
          disabled={!hasModels}
        >
          Home
        </button>
      </Tooltip>
      <Tooltip description="Measure — click two points in the view" hotkey="M">
        <button
          type="button"
          className={`top-bar__icon-button${measureModeActive ? " top-bar__icon-button--active" : ""}`}
          onClick={onToggleMeasureMode}
          disabled={!hasModels}
          aria-label="Toggle measure mode"
        >
          <MeasureIcon />
        </button>
      </Tooltip>
      <CameraClipControl
        cameraClipEnabled={cameraClipEnabled}
        onSetCameraClipEnabled={onSetCameraClipEnabled}
        cameraClipDistance={cameraClipDistance}
        onSetCameraClipDistance={onSetCameraClipDistance}
        disabled={!hasModels}
      />
      <Tooltip description="Tag tool — click a hovered dimension tag to pin it" hotkey="T">
        <button
          type="button"
          className={`top-bar__icon-button${tagToolActive ? " top-bar__icon-button--active" : ""}`}
          onClick={onToggleTagTool}
          disabled={!hasModels}
          aria-label="Toggle tag tool"
        >
          <TagIcon />
        </button>
      </Tooltip>
      <Tooltip description="Show dimension tags on every visible segment">
        <button
          type="button"
          className={`top-bar__icon-button${showAllDimensions ? " top-bar__icon-button--active" : ""}`}
          onClick={onToggleShowAllDimensions}
          disabled={!hasModels}
          aria-label="Toggle show all dimensions"
        >
          <ShowAllDimensionsIcon />
        </button>
      </Tooltip>
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
