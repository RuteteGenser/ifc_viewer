import { useCallback, useEffect, useRef, useState } from "react";
import { useIfcViewer } from "./hooks/useIfcViewer";
import Viewport from "./components/Viewport";
import Sidebar from "./components/Sidebar";
import DropOverlay from "./components/DropOverlay";
import LoadingOverlay from "./components/LoadingOverlay";
import StatusBanner from "./components/StatusBanner";
import ContextMenu from "./components/ContextMenu";
import RightPanel from "./components/RightPanel";
import MeasureDeleteButton from "./components/MeasureDeleteButton";
import MeasureLegEditPopup from "./components/MeasureLegEditPopup";
import ConfirmDialog from "./components/ConfirmDialog";
import Header from "./components/Header";
import Toolbar from "./components/Toolbar";
import Compass from "./components/Compass";
import "./App.css";

// Matches the colors already used for each leg in the 3D dogleg
// (useIfcViewer.js's legRight/legUp/legDepth) and in MeasureControl.jsx's
// read-only display, so the edit popup reads as "the same leg" as
// whichever colored label was clicked.
const MEASURE_LEG_META = {
  depth: { label: "Depth", color: "#ef4444" },
  horizontal: { label: "Horizontal", color: "#3b82f6" },
  vertical: { label: "Vertical", color: "#22c55e" },
};

function App() {
  const {
    containerRef,
    models,
    isLoading,
    loadingLabel,
    error,
    loadFiles,
    saveAsIfcZip,
    confirmReplace,
    confirmReplaceAnswer,
    setVisible,
    setModelColor,
    removeModel,
    resetView,
    resetVisibility,
    clearError,
    clipPlanes,
    setClipPlaneEnabled,
    setClipPlaneGizmoVisible,
    flipClipPlane,
    removeClipPlane,
    contextMenu,
    closeContextMenu,
    createClipPlaneHere,
    hideElementHere,
    cameraClipEnabled,
    setCameraClipEnabled,
    cameraClipDistance,
    setCameraClipDistance,
    selectedElement,
    selectedElementLoading,
    clearSelection,
    measurements,
    measureModeActive,
    toggleMeasureMode,
    removeMeasurement,
    setMeasurementLeg,
    measureDeletePopup,
    closeMeasureDeletePopup,
    measureLegEditPopup,
    closeMeasureLegEditPopup,
    searchQuery,
    setSearchQuery,
    searchResults,
    isolatedKeys,
    toggleIsolate,
    clearIsolation,
    northOffsetDeg,
    setNorthOffset,
    compassAngleDeg,
    tagToolActive,
    toggleTagTool,
    tagsVisible,
    toggleTagsVisibility,
    categoryHideModeActive,
    toggleCategoryHideMode,
    hiddenCategories,
    setCategoryHidden,
    pinnedDimensionTags,
    unpinDimensionTag,
    clearAllDimensionPins,
    undo,
    redo,
    canUndo,
    canRedo,
    hideSelectedElement,
    setViewInsets,
  } = useIfcViewer();

  const [isDragging, setIsDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState("info");
  // Only meaningful on narrow screens, where the right panel is a bottom
  // sheet that starts collapsed to a peek bar; on desktop it's always shown.
  const [panelOpen, setPanelOpen] = useState(false);
  const dragDepthRef = useRef(0);
  const lastAutoSwitchGuidRef = useRef(null);

  // Jump to the Info tab whenever a genuinely new element is selected
  // (not on the later async ifcInfo merge, which keeps the same guid) so
  // clicking something in the view is never silently hidden behind the
  // Measurements tab.
  useEffect(() => {
    const guid = selectedElement?.guid ?? null;
    if (guid && guid !== lastAutoSwitchGuidRef.current) {
      setActiveRightTab("info");
      setPanelOpen(true);
    }
    lastAutoSwitchGuidRef.current = guid;
  }, [selectedElement?.guid]);

  // Tell the 3D view how much of its edges the info panel covers (the
  // bottom sheet on a phone, the right-hand column on desktop), read from
  // probe elements whose size CSS sets per layout, so the model stays
  // centred in the part that is still visible instead of hiding behind it.
  const insetProbeRef = useRef(null);
  const insetProbeRightRef = useRef(null);
  useEffect(() => {
    const bottom = insetProbeRef.current;
    const right = insetProbeRightRef.current;
    if (!bottom || !right) return undefined;
    const update = () => setViewInsets({ bottom: bottom.offsetHeight, right: right.offsetWidth });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [panelOpen, setViewInsets]);

  const handleTabChange = useCallback(
    (tab) => {
      // Tapping the already-open tab folds the sheet back down.
      setPanelOpen((open) => !(open && tab === activeRightTab));
      setActiveRightTab(tab);
    },
    [activeRightTab],
  );

  const handleClosePanel = useCallback(() => {
    clearSelection();
    setPanelOpen(false);
  }, [clearSelection]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files?.length) {
        loadFiles(e.dataTransfer.files);
      }
    },
    [loadFiles],
  );

  return (
    <div className="app">
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />

      <div className="app-body" data-sheet={panelOpen ? "open" : "peek"}>
        <div className="sheet-inset-probe" ref={insetProbeRef} aria-hidden="true" />
        <div className="panel-inset-probe" ref={insetProbeRightRef} aria-hidden="true" />
        {sidebarOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar
          className={sidebarOpen ? "sidebar--open" : ""}
          models={models}
          onFilesSelected={(files) => {
            loadFiles(files);
            setSidebarOpen(false);
          }}
          onToggleVisible={setVisible}
          onSetModelColor={setModelColor}
          onRemove={removeModel}
          onSaveIfcZip={saveAsIfcZip}
          onResetVisibility={resetVisibility}
          isLoading={isLoading}
          loadingLabel={loadingLabel}
          clipPlanes={clipPlanes}
          onSetClipPlaneEnabled={setClipPlaneEnabled}
          onSetClipPlaneGizmoVisible={setClipPlaneGizmoVisible}
          onFlipClipPlane={flipClipPlane}
          onRemoveClipPlane={removeClipPlane}
          hiddenCategories={hiddenCategories}
          onShowCategory={(category) => setCategoryHidden(category, false)}
        />

        <div
          className="viewport-wrapper"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Viewport containerRef={containerRef} />
          <DropOverlay visible={isDragging} />
          {models.length === 0 && !isLoading && (
            <div className="empty-hint">
              <p>No model loaded yet</p>
              <button type="button" className="empty-hint__button" onClick={() => setSidebarOpen(true)}>
                Add a model
              </button>
            </div>
          )}
          <LoadingOverlay visible={isLoading} label={loadingLabel} />
          <Toolbar
            hasModels={models.length > 0}
            onResetView={resetView}
            measureModeActive={measureModeActive}
            onToggleMeasureMode={toggleMeasureMode}
            cameraClipEnabled={cameraClipEnabled}
            onSetCameraClipEnabled={setCameraClipEnabled}
            cameraClipDistance={cameraClipDistance}
            onSetCameraClipDistance={setCameraClipDistance}
            tagToolActive={tagToolActive}
            onToggleTagTool={toggleTagTool}
            categoryHideModeActive={categoryHideModeActive}
            onToggleCategoryHideMode={toggleCategoryHideMode}
            tagsVisible={tagsVisible}
            onToggleTagsVisibility={toggleTagsVisibility}
            hasPinnedTags={pinnedDimensionTags.length > 0}
            hasMeasurements={measurements.length > 0}
            hasModelColors={models.some((m) => m.color)}
            searchQuery={searchQuery}
            onQueryChange={setSearchQuery}
            searchResults={searchResults}
            isolatedKeys={isolatedKeys}
            onToggleIsolate={toggleIsolate}
            onClearIsolation={clearIsolation}
          />
          <div className="history-buttons">
            <button
              type="button"
              className="history-buttons__button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
              </svg>
            </button>
            <button
              type="button"
              className="history-buttons__button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H10a6 6 0 0 0 0 12h3" />
              </svg>
            </button>
          </div>
          <Compass
            angleDeg={compassAngleDeg}
            offsetDeg={northOffsetDeg}
            onOffsetChange={setNorthOffset}
            disabled={models.length === 0}
          />
          <StatusBanner error={error} onDismissError={clearError} />
        </div>

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            touch={contextMenu.touch}
            onCreateClipPlane={createClipPlaneHere}
            onHideElement={hideElementHere}
            onClose={closeContextMenu}
          />
        )}

        <RightPanel
          activeTab={activeRightTab}
          open={panelOpen}
          onTabChange={handleTabChange}
          onToggleOpen={() => setPanelOpen((open) => !open)}
          onClose={handleClosePanel}
          onHideElement={hideSelectedElement}
          element={selectedElement}
          loading={selectedElementLoading}
          measurements={measurements}
          onRemoveMeasurement={removeMeasurement}
          pinnedDimensionTags={pinnedDimensionTags}
          onUnpinDimensionTag={unpinDimensionTag}
          onClearAllDimensionPins={clearAllDimensionPins}
        />

        {measureDeletePopup && (
          <MeasureDeleteButton
            x={measureDeletePopup.x}
            y={measureDeletePopup.y}
            onDelete={() => {
              removeMeasurement(measureDeletePopup.entryId);
              closeMeasureDeletePopup();
            }}
            onClose={closeMeasureDeletePopup}
          />
        )}

        {measureLegEditPopup && (
          <MeasureLegEditPopup
            x={measureLegEditPopup.x}
            y={measureLegEditPopup.y}
            label={MEASURE_LEG_META[measureLegEditPopup.which].label}
            color={MEASURE_LEG_META[measureLegEditPopup.which].color}
            valueMm={(measurements.find((m) => m.id === measureLegEditPopup.entryId)?.[measureLegEditPopup.which] ?? 0) * 1000}
            onCommit={(value) => {
              setMeasurementLeg(measureLegEditPopup.entryId, measureLegEditPopup.which, value);
              closeMeasureLegEditPopup();
            }}
            onClose={closeMeasureLegEditPopup}
          />
        )}

        {confirmReplace && (
          <ConfirmDialog
            title="Replace existing model?"
            message={`"${confirmReplace.name}" is already loaded. Replace it with the new file?`}
            confirmLabel="Replace"
            cancelLabel="Cancel"
            onConfirm={() => confirmReplaceAnswer(true)}
            onCancel={() => confirmReplaceAnswer(false)}
          />
        )}
      </div>
    </div>
  );
}

export default App;
