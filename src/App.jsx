import { useCallback, useRef, useState } from "react";
import { useIfcViewer } from "./hooks/useIfcViewer";
import Viewport from "./components/Viewport";
import Sidebar from "./components/Sidebar";
import DropOverlay from "./components/DropOverlay";
import StatusBanner from "./components/StatusBanner";
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
    clipInverted,
    setClipInverted,
    clipHeight,
    setClipHeight,
    clipRange,
  } = useIfcViewer();

  const [isDragging, setIsDragging] = useState(false);
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
      <Sidebar
        models={models}
        onFilesSelected={loadFiles}
        onToggleVisible={setVisible}
        onRemove={removeModel}
        isLoading={isLoading}
        loadingLabel={loadingLabel}
        clipEnabled={clipEnabled}
        onSetClipEnabled={setClipEnabled}
        clipInverted={clipInverted}
        onSetClipInverted={setClipInverted}
        clipHeight={clipHeight}
        onSetClipHeight={setClipHeight}
        clipRange={clipRange}
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
    </div>
  );
}

export default App;
