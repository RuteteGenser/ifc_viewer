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
import EmptyState from "./components/EmptyState";
import Toast from "./components/Toast";
import ToolHint from "./components/ToolHint";
import FirstRunHint from "./components/FirstRunHint";

// iOS/Android file pickers grey out files with extensions they can't map
// to a known type (.ifc/.ifcZIP), making them unselectable, so on touch
// devices the filter is dropped; loadFiles reports unparseable files.
const COARSE_POINTER = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const SAMPLE_NAME = "Sample building";
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
    ready,
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
    setError,
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
    cameraClipMax,
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
    focusSelection,
    toast,
    showToast,
    zoomToElementHere,
    isolateElementHere,
    copyGuidHere,
    loadFailed,
    retryLoad,
    cancelLoad,
  } = useIfcViewer();

  const hasNoModels = models.length === 0;
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
  }, [panelOpen, hasNoModels, setViewInsets]);

  // Bring a newly selected element into the middle of the visible area once
  // the sheet has taken its size (after the inset effect above has run).
  const selectedGuid = selectedElement?.guid ?? null;
  useEffect(() => {
    if (!selectedGuid) return undefined;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => focusSelection()));
    return () => cancelAnimationFrame(id);
  }, [selectedGuid, focusSelection]);

  const handleTabChange = useCallback(
    (tab) => {
      // Tapping the already-open tab folds the sheet back down.
      setPanelOpen((open) => !(open && tab === activeRightTab));
      setActiveRightTab(tab);
    },
    [activeRightTab],
  );

  // The sample is an ordinary .ifc served with the app and pushed through
  // the same loadFiles path as a user-picked file; only its display name
  // differs. The landing page deep-links to it with ?demo=1.
  const handleLoadSample = useCallback(async () => {
    setSidebarOpen(false);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}demo/demo-building.ifc`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], "demo-building.ifc");
      file.displayName = SAMPLE_NAME;
      loadFiles([file]);
    } catch (err) {
      setError(`Could not load the sample building (${err.message}). Check your connection and try again.`);
    }
  }, [loadFiles, setError]);

  const autoSampleRef = useRef(false);
  useEffect(() => {
    if (autoSampleRef.current || !ready) return;
    if (new URLSearchParams(window.location.search).get("demo") !== "1") return;
    autoSampleRef.current = true;
    handleLoadSample();
  }, [ready, handleLoadSample]);

  const fileInputRef = useRef(null);
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
  const armedTool = measureModeActive ? "measure" : tagToolActive ? "tag" : categoryHideModeActive ? "category" : null;
  const exitArmedTool = useCallback(() => {
    if (measureModeActive) toggleMeasureMode();
    else if (tagToolActive) toggleTagTool();
    else if (categoryHideModeActive) toggleCategoryHideMode();
  }, [measureModeActive, tagToolActive, categoryHideModeActive, toggleMeasureMode, toggleTagTool, toggleCategoryHideMode]);
  const notifyBlocked = useCallback((text) => showToast(text || "Open a model first"), [showToast]);

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
      <input
        ref={fileInputRef}
        type="file"
        accept={COARSE_POINTER ? undefined : ".ifc,.ifczip"}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            loadFiles(e.target.files);
            setSidebarOpen(false);
          }
          e.target.value = "";
        }}
      />
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />

      <div className="app-body" data-sheet={hasNoModels ? "none" : panelOpen ? "open" : "peek"}>
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
          onAddFiles={openFilePicker}
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
          {models.length === 0 && !isLoading && <EmptyState onOpenFiles={openFilePicker} onLoadSample={handleLoadSample} />}
          <LoadingOverlay visible={isLoading} label={loadingLabel} onCancel={cancelLoad} />
          <Toolbar
            hasModels={models.length > 0}
            onResetView={resetView}
            measureModeActive={measureModeActive}
            onToggleMeasureMode={toggleMeasureMode}
            cameraClipEnabled={cameraClipEnabled}
            onSetCameraClipEnabled={setCameraClipEnabled}
            cameraClipDistance={cameraClipDistance}
            cameraClipMax={cameraClipMax}
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
            onBlocked={notifyBlocked}
          />
          <ToolHint tool={armedTool} onDone={exitArmedTool} />
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
          <StatusBanner error={error} onDismissError={clearError} onRetry={loadFailed ? retryLoad : undefined} />
          <Toast toast={toast} />
          <FirstRunHint visible={models.length > 0 && !isLoading} />
        </div>

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            touch={contextMenu.touch}
            onCreateClipPlane={createClipPlaneHere}
            onHideElement={hideElementHere}
            onZoomTo={zoomToElementHere}
            onIsolate={isolateElementHere}
            onCopyGuid={copyGuidHere}
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
