import { useCallback, useEffect, useRef, useState } from "react";
import { useIfcViewer } from "./hooks/useIfcViewer";
import Viewport from "./components/Viewport";
import Sidebar from "./components/Sidebar";
import { BrowserContext } from "./hooks/BrowserContext";
import DropOverlay from "./components/DropOverlay";
import LoadingOverlay from "./components/LoadingOverlay";
import StatusBanner from "./components/StatusBanner";
import ContextMenu from "./components/ContextMenu";
import RightPanel from "./components/RightPanel";
import MeasureDeleteButton from "./components/MeasureDeleteButton";
import MeasureLegEditPopup from "./components/MeasureLegEditPopup";
import ConfirmDialog from "./components/ConfirmDialog";
import useLeaveGuard from "./hooks/useLeaveGuard";
import Header from "./components/Header";
import Toolbar from "./components/Toolbar";
import ViewTools from "./components/ViewTools";
import Compass from "./components/Compass";
import EmptyState from "./components/EmptyState";
import Toast from "./components/Toast";
import ToolHint from "./components/ToolHint";
import FirstRunHint from "./components/FirstRunHint";
import { useLibrary } from "./library/useLibrary";
import { LibraryContext } from "./library/LibraryContext";
import TransferBar from "./library/TransferBar";
import "./components/Library.css";

// iOS/Android file pickers grey out files with extensions they can't map
// to a known type (.ifc/.ifcZIP), making them unselectable, so on touch
// devices the filter is dropped; loadFiles reports unparseable files.
const COARSE_POINTER = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const SAMPLE_NAME = "Sample building";
import "./App.css";

const PANEL_MIN = 260;
const PANEL_MAX = 560;
function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // private mode: the choice just isn't remembered
  }
}

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
  const leaveGuard = useLeaveGuard();
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
    browser,
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
    clipMoveMode,
    setClipMoveMode,
    toast,
    showToast,
    zoomToElementHere,
    isolateElementHere,
    copyGuidHere,
    hoverLabelRef,
    loadFailed,
    retryLoad,
    cancelLoad,
    viewFeatures,
  } = useIfcViewer();

  const hasNoModels = models.length === 0;
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Wide layouts only: fold the model list / details panel away, and resize the panel.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readPref("ifcViewer.sidebarCollapsed", "0") === "1");
  const [panelCollapsed, setPanelCollapsed] = useState(() => readPref("ifcViewer.panelCollapsed", "0") === "1");
  const [panelWidth, setPanelWidth] = useState(() => {
    const n = Number(readPref("ifcViewer.panelWidth", "320"));
    return Number.isFinite(n) ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, n)) : 320;
  });
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((v) => {
      writePref("ifcViewer.sidebarCollapsed", v ? "0" : "1");
      return !v;
    });
  }, []);
  const setPanelCollapsedSaved = useCallback((value) => {
    writePref("ifcViewer.panelCollapsed", value ? "1" : "0");
    setPanelCollapsed(value);
  }, []);
  const changePanelWidth = useCallback((w) => {
    const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));
    writePref("ifcViewer.panelWidth", next);
    setPanelWidth(next);
  }, []);
  const [activeRightTab, setActiveRightTab] = useState("info");
  // Only meaningful on narrow screens, where the right panel is a bottom
  // sheet that starts collapsed to a peek bar; on desktop it's always shown.
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const dragDepthRef = useRef(0);
  const lastAutoSwitchGuidRef = useRef(null);
  const hadSelectionRef = useRef(false);

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
    // Selection cleared (tap on empty space, Escape): drop the sheet back to
    // its peek bar so it stops covering the model, unless another tab is in use.
    if (!guid && hadSelectionRef.current && activeRightTab === "info") {
      setPanelOpen(false);
      setPanelExpanded(false);
    }
    hadSelectionRef.current = !!guid;
    lastAutoSwitchGuidRef.current = guid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [panelOpen, panelExpanded, hasNoModels, setViewInsets, panelCollapsed, panelWidth]);

  // Bring a newly selected element into the middle of the visible area once
  // the sheet has taken its size (after the inset effect above has run).
  const selectedGuid = selectedElement?.guid ?? null;
  useEffect(() => {
    if (!selectedGuid) return undefined;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => focusSelection()));
    return () => cancelAnimationFrame(id);
  }, [selectedGuid, focusSelection]);

  const handleClosePanel = useCallback(() => {
    clearSelection();
    setPanelOpen(false);
    setPanelExpanded(false);
  }, [clearSelection]);

  const handleTabChange = useCallback(
    (tab) => {
      // Tapping the tab that is already showing switches between the compact
      // and the expanded sheet; any other tab just shows that tab.
      if (!panelOpen) setPanelOpen(true);
      else if (tab === activeRightTab) setPanelExpanded((x) => !x);
      setActiveRightTab(tab);
    },
    [activeRightTab, panelOpen],
  );

  const sheetMode = !panelOpen ? "hidden" : panelExpanded ? "full" : "compact";
  const setSheetMode = useCallback(
    (mode) => {
      if (mode === "hidden") handleClosePanel();
      else {
        setPanelOpen(true);
        setPanelExpanded(mode === "full");
      }
    },
    [handleClosePanel],
  );

  // On narrow layouts Esc folds the sheet away again.
  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!window.matchMedia?.("(max-width: 768px), (max-height: 500px) and (pointer: coarse)").matches) return;
      if (document.querySelector(".context-menu, .confirm-dialog-backdrop, .measure-leg-edit-popup")) return;
      handleClosePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, handleClosePanel]);

  // Something to look at that the sheet holds even with nothing selected.
  const detailsCount = measurements.length + pinnedDimensionTags.length;
  const openDetails = useCallback(() => {
    setActiveRightTab(measurements.length > 0 ? "measurements" : "dimensions");
    setPanelOpen(true);
    setPanelExpanded(false);
  }, [measurements.length]);

  // The sample is an ordinary .ifc served with the app and pushed through
  // the same loadFiles path as a user-picked file; only its display name
  // differs. The landing page deep-links to it with ?demo=1.
  const handleLoadSample = useCallback(async () => {
    setSidebarOpen(false);
    try {
      // index.html starts this request at page load when the URL has ?demo=1.
      const url = `${import.meta.env.BASE_URL}demo/demo-building.ifc`;
      const early = window.__demoIfc;
      window.__demoIfc = null;
      const read = async (request) => {
        const response = await request;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      };
      // A cache (browser or service worker) can hold something that is not the
      // file, such as a page saved under its address; check the bytes, and
      // if they are wrong ask again past every cache.
      const isIfc = async (blob) => (await blob.slice(0, 16).text()).startsWith("ISO-10303-21");
      let blob = await read(early ?? fetch(url));
      if (!(await isIfc(blob))) blob = await read(fetch(`${url}?fresh=${Date.now()}`, { cache: "reload" }));
      if (!(await isIfc(blob))) throw new Error("the server did not return an IFC file");
      const file = new File([blob], "demo-building.ifc");
      file.displayName = SAMPLE_NAME;
      loadFiles([file]);
    } catch (err) {
      setError(`Could not load the sample building (${err.message}). Check your connection and try again.`);
    }
  }, [loadFiles, setError]);

  const library = useLibrary({ loadFiles, models, onLoadSample: handleLoadSample, onOpened: () => setSidebarOpen(false) });

  const autoSampleRef = useRef(false);
  useEffect(() => {
    if (autoSampleRef.current) return;
    if (new URLSearchParams(window.location.search).get("demo") !== "1") return;
    autoSampleRef.current = true;
    handleLoadSample();
  }, [handleLoadSample]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector(".confirm-dialog-backdrop")) setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const fileInputRef = useRef(null);
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
  const sectionHint = COARSE_POINTER && clipPlanes.length > 0 ? (clipMoveMode ? "sectionMove" : "sectionIdle") : null;
  const armedTool = measureModeActive ? "measure" : tagToolActive ? "tag" : categoryHideModeActive ? "category" : sectionHint;
  useEffect(() => {
    if (clipPlanes.length === 0 && clipMoveMode) setClipMoveMode(false);
  }, [clipPlanes.length, clipMoveMode, setClipMoveMode]);
  const exitArmedTool = useCallback(() => {
    if (armedTool === "sectionIdle") setClipMoveMode(true);
    else if (armedTool === "sectionMove") setClipMoveMode(false);
    else if (measureModeActive) toggleMeasureMode();
    else if (tagToolActive) toggleTagTool();
    else if (categoryHideModeActive) toggleCategoryHideMode();
  }, [armedTool, setClipMoveMode, measureModeActive, tagToolActive, categoryHideModeActive, toggleMeasureMode, toggleTagTool, toggleCategoryHideMode]);
  const notifyBlocked = useCallback((text) => showToast(text || "Open a model first"), [showToast]);


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
        library.openLocal(e.dataTransfer.files);
      }
    },
    [library.openLocal],
  );

  return (
    <BrowserContext.Provider value={browser}>
    <LibraryContext.Provider value={library}>
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept={COARSE_POINTER ? undefined : ".ifc,.ifczip"}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            library.openLocal(e.target.files);
            setSidebarOpen(false);
          }
          e.target.value = "";
        }}
      />
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
      />

      <div
        className={`app-body${sidebarCollapsed ? " app-body--no-sidebar" : ""}${panelCollapsed ? " app-body--no-panel" : ""}`}
        style={{ "--panel-w": `${panelWidth}px` }}
        data-sheet={hasNoModels ? "none" : sheetMode === "hidden" ? "hidden" : sheetMode === "full" ? "full" : "open"}
      >
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
          browser={browser}
          selectedId={browser.selectedId}
          onPickElement={() => setSidebarOpen(false)}
          onRequestClose={() => setSidebarOpen(false)}
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
          <LoadingOverlay visible={isLoading && !confirmReplace} label={loadingLabel} onCancel={cancelLoad} />
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
          <ViewTools views={viewFeatures} />
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
          {!panelOpen && detailsCount > 0 && (
            <button type="button" className="details-fab" aria-label={`Show details, ${detailsCount} item${detailsCount === 1 ? "" : "s"}`} onClick={openDetails}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              <span className="details-fab__count">{detailsCount}</span>
            </button>
          )}
          <div className="hover-label" ref={hoverLabelRef} hidden aria-hidden="true" />
          {panelCollapsed && !hasNoModels && (
            <button type="button" className="panel-reveal" aria-label="Show details panel" onClick={() => setPanelCollapsedSaved(false)}>
              <span aria-hidden="true">&lsaquo;</span>
            </button>
          )}
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
          mode={sheetMode}
          onModeChange={setSheetMode}
          onTabChange={handleTabChange}
          onToggleOpen={() => setSheetMode(sheetMode === "full" ? "compact" : "full")}
          collapsed={panelCollapsed}
          onCollapse={() => setPanelCollapsedSaved(true)}
          width={panelWidth}
          onResize={changePanelWidth}
          onClose={handleClosePanel}
          onHideElement={hideSelectedElement}
          onToast={showToast}
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

        {leaveGuard.asking && (
          <ConfirmDialog
            title="Leave the viewer?"
            message="You will go back to the previous page and lose your current view and measurements."
            confirmLabel="Leave"
            cancelLabel="Stay"
            initialFocus="cancel"
            onConfirm={leaveGuard.leave}
            onCancel={leaveGuard.stay}
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
    <TransferBar />
    </LibraryContext.Provider>
    </BrowserContext.Provider>
  );
}

export default App;
