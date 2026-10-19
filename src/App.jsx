import { useCallback, useEffect, useRef, useState } from "react";
import { useIfcViewer } from "./hooks/useIfcViewer";
import Viewport from "./components/Viewport";
import Sidebar from "./components/Sidebar";
import { BrowserContext } from "./hooks/BrowserContext";
import DropOverlay from "./components/DropOverlay";
import LoadingOverlay from "./components/LoadingOverlay";
import StatusBanner from "./components/StatusBanner";
import { startupIntent } from "./reliability/recovery";
import { attemptText, withBackoff } from "./reliability/retry";
import ContextMenu from "./components/ContextMenu";
import RightPanel from "./components/RightPanel";
import MeasureDeleteButton from "./components/MeasureDeleteButton";
import MeasureLegEditPopup from "./components/MeasureLegEditPopup";
import ConfirmDialog from "./components/ConfirmDialog";
import useLeaveGuard from "./hooks/useLeaveGuard";
import Header from "./components/Header";
import { AccessProvider, useAccess } from "./access/AccessProvider";
import AccessUI from "./access/AccessUI";
import LegalRoute from "./legal/LegalPage";
import Toolbar from "./components/Toolbar";
import ViewTools from "./components/ViewTools";
import Compass from "./components/Compass";
import EmptyState from "./components/EmptyState";
import Toast from "./components/Toast";
import ModelsSheet from "./components/ModelsSheet";
import usePresence from "./usePresence";
import ToolHint from "./components/ToolHint";
import PlaneSwitch from "./components/PlaneSwitch";
import Hud from "./components/Hud";
import { GestureSheet } from "./components/ShortcutsHelp";
import { CameraClipPanel } from "./components/CameraClipControl";
import { announcePopover } from "./hooks/usePopoverGroup";
import FirstRunHint from "./components/FirstRunHint";
import { pageTitle } from "./a11y";
import { useLibrary } from "./library/useLibrary";
import { LibraryContext } from "./library/LibraryContext";
import TransferBar from "./library/TransferBar";
import CasesPanel from "./cases/CasesPanel";
import { useCases } from "./cases/useCases";
import { saveSnapshot } from "./cases/saveSnapshot";
import "./components/Library.css";

// iOS/Android file pickers grey out files with extensions they can't map
// to a known type (.ifc/.ifcZIP), making them unselectable, so on touch
// devices the filter is dropped; loadFiles reports unparseable files.
const COARSE_POINTER = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const SAMPLE_NAME = "Sample building";
const DRAWER_QUERY = "(max-width: 768px), (max-height: 500px) and (pointer: coarse)";
import "./App.css";
// Test builds only (VITE_TEST_HOOK=1): exposes window.__annotations. Removed from production builds.
if (import.meta.env.VITE_TEST_HOOK) import("./annotations/mountForTests");

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
  const access = useAccess();
  const accessRef = useRef(access);
  accessRef.current = access;
  const leaveGuard = useLeaveGuard();
  const {
    containerRef,
    models,
    isLoading,
    loadingLabel,
    error,
    loadFiles: rawLoadFiles,
    saveAsIfcZip,
    confirmReplace,
    confirmReplaceAnswer,
    setVisible,
    setModelColor,
    removeModel,
    removeAllModels,
    renameLoadedModel,
    resetView,
    resetVisibility,
    clearError,
    setError,
    clipPlanes,
    setClipPlaneEnabled,
    setClipPlaneGizmoVisible,
    flipClipPlane,
    removeClipPlane,
    setActiveClipPlane,
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
    clipMoveMode,
    setClipMoveMode,
    toast,
    showToast,
    zoomToElementHere,
    isolateElementHere,
    copyGuidHere,
    hoverLabelRef,
    loadFailed,
    errorInfo,
    retryLoad,
    cancelLoad,
    viewFeatures,
    spaceControl,
    cases: casesViewer,
  } = useIfcViewer();

  const hasNoModels = models.length === 0;
  const mainRef = useRef(null);
  // The tab and history entry name the open model.
  const modelNames = models.map((m) => m.name).join("\u0000");
  useEffect(() => {
    document.title = pageTitle(modelNames ? modelNames.split("\u0000") : []);
  }, [modelNames]);
  // The control that opened a file picker (or a library row) can disappear or go disabled while the model loads, which
  // drops focus to the page start. Put a keyboard user back on it, or in the viewer when it is gone.
  const pickerOpenerRef = useRef(null);
  useEffect(() => {
    if (isLoading || confirmReplace) return undefined;
    const raf = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && a !== document.body && a.isConnected && !a.closest(".confirm-dialog-backdrop")) return;
      const back = pickerOpenerRef.current;
      pickerOpenerRef.current = null;
      if (back?.isConnected && !back.disabled) back.focus({ preventScroll: true });
      else if (models.length > 0) mainRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [isLoading, confirmReplace, models.length]);
  const [isDragging, setIsDragging] = useState(false);
  const [dropShift, setDropShift] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [casesOpen, setCasesOpen] = useState(false);
  const casesState = useCases();
  const casesStateRef = useRef(casesState);
  casesStateRef.current = casesState;
  const handleSaveSnapshot = useCallback(
    (title) => saveSnapshot({ viewer: casesViewer, controller: casesStateRef.current, currentId: casesStateRef.current.currentId, title, showToast }),
    [casesViewer, showToast],
  );
  const openCases = useCallback(() => {
    setSidebarOpen(false);
    setModelsOpen(false);
    setCasesOpen(true);
  }, []);
  const backdrop = usePresence(sidebarOpen, 160);
  const [multiNotice, setMultiNotice] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // On narrow screens the model list is a drawer over the view: while it is
  // open the view behind it takes no taps and no focus.
  const [drawerLayout, setDrawerLayout] = useState(() => !!window.matchMedia?.(DRAWER_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(DRAWER_QUERY);
    if (!mq) return undefined;
    const update = () => setDrawerLayout(mq.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
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

  // Soft gate: while access is expired, files from this device (and the sample) still open;
  // only opening a model from the server library shows the paywall instead.
  const loadFiles = useCallback(
    (files, options) => {
      const a = accessRef.current;
      if (a?.expired && options?.fromLibrary) {
        a.setOverlayHidden(false);
        return undefined;
      }
      const { fromLibrary, ...rest } = options || {};
      return rawLoadFiles(files, rest);
    },
    [rawLoadFiles],
  );

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
      // A failed download starts over by itself (0 s, 1 s, 3 s), past every cache.
      const fresh = () => read(fetch(`${url}?fresh=${Date.now()}`, { cache: "reload" }));
      const blob = await withBackoff(
        async (attempt) => {
          let b = attempt === 1 ? await read(early ?? fetch(url)) : await fresh();
          if (!(await isIfc(b)) && attempt === 1) b = await fresh();
          if (!(await isIfc(b))) throw new Error("the server did not return an IFC file");
          return b;
        },
        { onRetry: (e, next, total) => showToast(attemptText("Loading the sample", next, total)) },
      );
      const file = new File([blob], "demo-building.ifc");
      file.displayName = SAMPLE_NAME;
      file.argusIntent = { type: "sample" }; // reopened by itself if Argus reloads to update (see reliability/recovery.js)
      loadFiles([file]);
    } catch (err) {
      setError(`Could not load the sample building (${err.message}) after trying again. Check your connection and open it once more.`);
    }
  }, [loadFiles, setError, showToast]);

  const library = useLibrary({ loadFiles, models, onLoadSample: handleLoadSample, onOpened: () => setSidebarOpen(false), onRenamed: renameLoadedModel, canSave: () => !accessRef.current?.expired });

  const autoSampleRef = useRef(false);
  useEffect(() => {
    if (autoSampleRef.current) return;
    if (new URLSearchParams(window.location.search).get("demo") !== "1" && startupIntent()?.type !== "sample") return;
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
  const pickAddRef = useRef(false);
  const multiNoticeShownRef = useRef(false);
  // Opening replaces what is loaded; "Add another model" is the explicit way to add.
  const openFilePicker = useCallback(() => {
    pickAddRef.current = false;
    pickerOpenerRef.current = document.activeElement;
    fileInputRef.current?.click();
  }, []);
  const addFilePicker = useCallback(() => {
    pickAddRef.current = true;
    pickerOpenerRef.current = document.activeElement;
    fileInputRef.current?.click();
  }, []);

  // Nothing left in the list: close it. Phones always show the Models chip; a wide
  // screen shows it from two models on (the sidebar lists them there).
  useEffect(() => {
    if (models.length === 0) setModelsOpen(false);
  }, [models.length]);
  useEffect(() => {
    if (modelsOpen) setMultiNotice(false);
  }, [modelsOpen]);
  // First time two models are loaded together this session: say how to remove one.
  useEffect(() => {
    if (models.length < 2) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem("ifcViewer.multiNotice") === "1";
      sessionStorage.setItem("ifcViewer.multiNotice", "1");
    } catch {
      // no session storage: the notice shows once per page load instead
      seen = multiNoticeShownRef.current;
    }
    if (seen || multiNoticeShownRef.current) return;
    multiNoticeShownRef.current = true;
    setMultiNotice(true);
  }, [models.length]);
  useEffect(() => {
    if (!multiNotice) return undefined;
    const t = setTimeout(() => setMultiNotice(false), 15000);
    return () => clearTimeout(t);
  }, [multiNotice]);
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
  // Arming a tool closes any open popover.
  useEffect(() => {
    if (armedTool) announcePopover("tool");
  }, [armedTool]);
  // On a phone the details sheet drops to its peek bar while the views panel
  // is open, so the panel has the room.
  const handleViewToolsOpen = useCallback((open) => {
    if (open !== "views") return;
    if (!window.matchMedia?.("(max-width: 768px), (max-height: 500px) and (pointer: coarse)").matches) return;
    setPanelOpen(false);
    setPanelExpanded(false);
  }, []);
  // "Start measuring" / "Start tagging" in the details sheet: arm the tool and
  // drop the sheet away so the model is in view.
  const startMeasuring = useCallback(() => {
    if (!measureModeActive) toggleMeasureMode();
    setPanelOpen(false);
    setPanelExpanded(false);
  }, [measureModeActive, toggleMeasureMode]);
  const startTagging = useCallback(() => {
    if (!tagToolActive) toggleTagTool();
    setPanelOpen(false);
    setPanelExpanded(false);
  }, [tagToolActive, toggleTagTool]);
  const notifyBlocked = useCallback((text) => showToast(text || "Open a model first"), [showToast]);


  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
    setDropShift(!!e.shiftKey);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDropShift((was) => (was === !!e.shiftKey ? was : !!e.shiftKey));
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
        // A plain drop replaces the loaded model(s); Shift, or the "Add to view" zone, adds.
        const add = e.shiftKey || !!e.target?.closest?.("[data-drop-add]");
        library.openLocal(e.dataTransfer.files, { add });
      }
    },
    [library.openLocal],
  );

  return (
    <BrowserContext.Provider value={browser}>
    <LibraryContext.Provider value={library}>
    <div className="app">
      <a
        className="skip-link"
        href="#viewer"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to the viewer
      </a>
      <input
        ref={fileInputRef}
        type="file"
        accept={COARSE_POINTER ? undefined : ".ifc,.ifczip,.zip"}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            library.openLocal(e.target.files, { add: pickAddRef.current });
            setSidebarOpen(false);
          }
          pickAddRef.current = false;
          e.target.value = "";
        }}
      />
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        modelCount={models.length}
        showModelsChip={drawerLayout || models.length > 1}
        modelsOpen={modelsOpen}
        onToggleModels={() => {
          setSidebarOpen(false);
          setModelsOpen((v) => !v);
        }}
      />
      <AccessUI hasWork={models.length > 0} />
      <LegalRoute />

      <div
        className={`app-body${sidebarCollapsed ? " app-body--no-sidebar" : ""}${panelCollapsed ? " app-body--no-panel" : ""}`}
        style={{ "--panel-w": `${panelWidth}px` }}
        data-sheet={hasNoModels ? "none" : sheetMode === "hidden" ? "hidden" : sheetMode === "full" ? "full" : "open"}
      >
        <div className="sheet-inset-probe" ref={insetProbeRef} aria-hidden="true" />
        <div className="panel-inset-probe" ref={insetProbeRightRef} aria-hidden="true" />
        {backdrop.mounted && (
          <button
            type="button"
            className="sidebar-backdrop"
            data-state={backdrop.state}
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar
          className={sidebarOpen ? "sidebar--open" : ""}
          models={models}
          onAddFiles={models.length > 0 ? addFilePicker : openFilePicker}
          onToggleVisible={setVisible}
          onSetModelColor={setModelColor}
          onRemove={removeModel}
          onSaveIfcZip={saveAsIfcZip}
          onResetVisibility={resetVisibility}
          spaceControl={spaceControl}
          isLoading={isLoading}
          loadingLabel={loadingLabel}
          clipPlanes={clipPlanes}
          onSetClipPlaneEnabled={setClipPlaneEnabled}
          onSetClipPlaneGizmoVisible={setClipPlaneGizmoVisible}
          onFlipClipPlane={flipClipPlane}
          onRemoveClipPlane={removeClipPlane}
          onSelectClipPlane={setActiveClipPlane}
          hiddenCategories={hiddenCategories}
          onShowCategory={(category) => setCategoryHidden(category, false)}
          browser={browser}
          selectedId={browser.selectedId}
          onPickElement={() => setSidebarOpen(false)}
          onRequestClose={() => setSidebarOpen(false)}
          onOpenHelp={() => {
            setSidebarOpen(false);
            setHelpOpen(true);
          }}
          onOpenCases={openCases}
        />

        <main
          id="viewer"
          tabIndex={-1}
          ref={mainRef}
          className="viewport-wrapper"
          inert={sidebarOpen && drawerLayout ? true : undefined}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {models.length > 0 && <h1 className="sr-only">{models.length === 1 ? models[0].name : `${models.length} models`}</h1>}
          <Viewport containerRef={containerRef} reveal={models.length > 0} />
          <DropOverlay visible={isDragging} hasModels={models.length > 0} shift={dropShift} />
          {models.length === 0 && !isLoading && <EmptyState onOpenFiles={openFilePicker} onLoadSample={handleLoadSample} />}
          <LoadingOverlay visible={isLoading && !confirmReplace} label={loadingLabel} onCancel={cancelLoad} />
          <Toolbar
            hasModels={models.length > 0}
            onResetView={resetView}
            measureModeActive={measureModeActive}
            onToggleMeasureMode={toggleMeasureMode}
            cameraClipEnabled={cameraClipEnabled}
            onSetCameraClipEnabled={setCameraClipEnabled}
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
            helpOpen={helpOpen}
            onHelpOpenChange={setHelpOpen}
          />
          <ViewTools views={viewFeatures} spaceControl={spaceControl} onOpenChange={handleViewToolsOpen} onSaveSnapshot={handleSaveSnapshot} onOpenCases={openCases} />
          <Hud>
            <ToolHint tool={armedTool} onDone={exitArmedTool} plane={clipPlanes.length > 1 ? (clipPlanes.find((p) => p.active)?.index ?? 0) + 1 : 0} />
            <CameraClipPanel
              enabled={cameraClipEnabled}
              distance={cameraClipDistance}
              max={cameraClipMax}
              onChange={setCameraClipDistance}
              onDone={() => setCameraClipEnabled(false)}
            />
          </Hud>
          <PlaneSwitch planes={clipPlanes} onSelect={setActiveClipPlane} />
          <FirstRunHint visible={models.length > 0 && !isLoading} />
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
          <StatusBanner error={error} errorInfo={errorInfo} onDismissError={clearError} onRetry={loadFailed ? retryLoad : undefined} onChooseFile={openFilePicker} idle={!isLoading && !armedTool} />
          <Toast toast={toast} />
          {multiNotice && models.length > 1 && (
            <div className="multi-notice" role="status">
              <span>{models.length} models are loaded together. Use Models to remove one.</span>
              <button
                type="button"
                onClick={() => {
                  setMultiNotice(false);
                  setModelsOpen(true);
                }}
              >
                Models
              </button>
              <button type="button" aria-label="Dismiss" onClick={() => setMultiNotice(false)}>
                OK
              </button>
            </div>
          )}
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
        </main>

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
          onStartMeasure={startMeasuring}
          onStartTagging={startTagging}
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

        {models.length > 0 && (
          <ModelsSheet
            open={modelsOpen}
            models={models}
            isLoading={isLoading}
            onClose={() => setModelsOpen(false)}
            onToggleVisible={setVisible}
            onSetColor={setModelColor}
            onRemove={removeModel}
            onRemoveAll={removeAllModels}
            onAdd={() => {
              setModelsOpen(false);
              addFilePicker();
            }}
            onOpenCases={openCases}
          />
        )}

        <CasesPanel open={casesOpen} onClose={() => setCasesOpen(false)} cases={casesState} viewer={casesViewer} models={models} showToast={showToast} onSaveSnapshot={handleSaveSnapshot} />

        {helpOpen && COARSE_POINTER && <GestureSheet onClose={() => setHelpOpen(false)} />}

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

export default function AccessApp() {
  return (
    <AccessProvider>
      <App />
    </AccessProvider>
  );
}
