import { useCallback, useEffect, useRef, useState } from "react";
import { useIfcViewer } from "./hooks/useIfcViewer";
import Viewport from "./components/Viewport";
import Sidebar from "./components/Sidebar";
import DropOverlay from "./components/DropOverlay";
import StatusBanner from "./components/StatusBanner";
import ContextMenu from "./components/ContextMenu";
import RightPanel from "./components/RightPanel";
import MeasureDeleteButton from "./components/MeasureDeleteButton";
import ConfirmDialog from "./components/ConfirmDialog";
import Header from "./components/Header";
import Toolbar from "./components/Toolbar";
import Compass from "./components/Compass";
import "./App.css";

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
    pendingMeasurePreview,
    measureModeActive,
    toggleMeasureMode,
    removeMeasurement,
    measureDeletePopup,
    closeMeasureDeletePopup,
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
    showAllDimensions,
    toggleShowAllDimensions,
    pinnedDimensionTags,
    unpinDimensionTag,
    clearAllDimensionPins,
  } = useIfcViewer();

  const [isDragging, setIsDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState("info");
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
    }
    lastAutoSwitchGuidRef.current = guid;
  }, [selectedElement?.guid]);

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

      <div className="app-body">
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
            showAllDimensions={showAllDimensions}
            onToggleShowAllDimensions={toggleShowAllDimensions}
            searchQuery={searchQuery}
            onQueryChange={setSearchQuery}
            searchResults={searchResults}
            isolatedKeys={isolatedKeys}
            onToggleIsolate={toggleIsolate}
            onClearIsolation={clearIsolation}
          />
          <Compass
            angleDeg={compassAngleDeg}
            offsetDeg={northOffsetDeg}
            onOffsetChange={setNorthOffset}
            disabled={models.length === 0}
          />
          <StatusBanner
            isLoading={isLoading}
            loadingLabel={loadingLabel}
            error={error}
            onDismissError={clearError}
          />
        </div>

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onCreateClipPlane={createClipPlaneHere}
            onHideElement={hideElementHere}
            onClose={closeContextMenu}
          />
        )}

        <RightPanel
          activeTab={activeRightTab}
          onTabChange={setActiveRightTab}
          onClose={clearSelection}
          element={selectedElement}
          loading={selectedElementLoading}
          measurements={measurements}
          pendingMeasurePreview={pendingMeasurePreview}
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
