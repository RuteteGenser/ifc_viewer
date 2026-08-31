import { useCallback, useRef, useState } from "react";
import { useIfcViewer } from "./hooks/useIfcViewer";
import Viewport from "./components/Viewport";
import Sidebar from "./components/Sidebar";
import DropOverlay from "./components/DropOverlay";
import StatusBanner from "./components/StatusBanner";
import ContextMenu from "./components/ContextMenu";
import ElementInfoPanel from "./components/ElementInfoPanel";
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
    clearError,
    clipEnabled,
    setClipEnabled,
    hasClipPlane,
    flipClipPlane,
    clearClipPlane,
    contextMenu,
    closeContextMenu,
    createClipPlaneHere,
    cameraClipEnabled,
    setCameraClipEnabled,
    cameraClipDistance,
    setCameraClipDistance,
    selectedElement,
    selectedElementLoading,
    clearSelection,
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
        isLoading={isLoading}
        loadingLabel={loadingLabel}
        clipEnabled={clipEnabled}
        onSetClipEnabled={setClipEnabled}
        hasClipPlane={hasClipPlane}
        onFlipClipPlane={flipClipPlane}
        onClearClipPlane={clearClipPlane}
        cameraClipEnabled={cameraClipEnabled}
        onSetCameraClipEnabled={setCameraClipEnabled}
        cameraClipDistance={cameraClipDistance}
        onSetCameraClipDistance={setCameraClipDistance}
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
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onCreateClipPlane={createClipPlaneHere}
          onClose={closeContextMenu}
        />
      )}

      <ElementInfoPanel
        element={selectedElement}
        loading={selectedElementLoading}
        onClose={clearSelection}
      />
    </div>
  );
}

export default App;
