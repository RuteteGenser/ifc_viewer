import { useCallback, useRef, useState } from "react";
import { useIfcViewer } from "./hooks/useIfcViewer";
import Viewport from "./components/Viewport";
import Sidebar from "./components/Sidebar";
import DropOverlay from "./components/DropOverlay";
import StatusBanner from "./components/StatusBanner";
import ContextMenu from "./components/ContextMenu";
import ElementInfoPanel from "./components/ElementInfoPanel";
import MeasureDeleteButton from "./components/MeasureDeleteButton";
import SearchBar from "./components/SearchBar";
import "./App.css";

function App() {
  const {
    containerRef,
    models,
    isLoading,
    loadingLabel,
    error,
    loadFiles,
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
  } = useIfcViewer();

  const [isDragging, setIsDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dragDepthRef = useRef(0);

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
      <button
        type="button"
        className="menu-toggle"
        aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        {sidebarOpen ? "✕" : "☰"}
      </button>

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
        onResetView={resetView}
        onResetVisibility={resetVisibility}
        isLoading={isLoading}
        loadingLabel={loadingLabel}
        clipPlanes={clipPlanes}
        onSetClipPlaneEnabled={setClipPlaneEnabled}
        onSetClipPlaneGizmoVisible={setClipPlaneGizmoVisible}
        onFlipClipPlane={flipClipPlane}
        onRemoveClipPlane={removeClipPlane}
        cameraClipEnabled={cameraClipEnabled}
        onSetCameraClipEnabled={setCameraClipEnabled}
        cameraClipDistance={cameraClipDistance}
        onSetCameraClipDistance={setCameraClipDistance}
        measurements={measurements}
        onRemoveMeasurement={removeMeasurement}
        measureModeActive={measureModeActive}
        onToggleMeasureMode={toggleMeasureMode}
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
        <StatusBanner
          isLoading={isLoading}
          loadingLabel={loadingLabel}
          error={error}
          onDismissError={clearError}
        />
        <SearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          results={searchResults}
          isolatedKeys={isolatedKeys}
          onToggleIsolate={toggleIsolate}
          onClearIsolation={clearIsolation}
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

      <ElementInfoPanel
        element={selectedElement}
        loading={selectedElementLoading}
        onClose={clearSelection}
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
    </div>
  );
}

export default App;
