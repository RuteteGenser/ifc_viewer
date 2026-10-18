import { useRef } from "react";
import ElementInfoPanel from "./ElementInfoPanel";
import MeasureControl from "./MeasureControl";
import DimensionTagsPanel from "./DimensionTagsPanel";

function TabUnderline() {
  return (
    <svg className="element-panel__tab-underline" viewBox="0 0 40 6" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M1 2.5C8 1 16 4 20 2.3C26 0.5 33 3 39 1.8"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function RightPanel({
  activeTab,
  open,
  onTabChange,
  onToggleOpen,
  onClose,
  onHideElement,
  element,
  loading,
  measurements,
  onRemoveMeasurement,
  pinnedDimensionTags,
  onUnpinDimensionTag,
  onClearAllDimensionPins,
  collapsed,
  onCollapse,
  width,
  onResize,
}) {
  // Swipe the handle / tab bar up to open the sheet and down to fold it
  // away (a plain tap still toggles via the buttons' click handlers).
  const swipeRef = useRef(null);
  const swipedRef = useRef(false);
  const swipe = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse") return;
      swipeRef.current = { y: e.clientY, x: e.clientX };
      swipedRef.current = false;
    },
    onPointerMove: (e) => {
      const s = swipeRef.current;
      if (!s) return;
      const dy = e.clientY - s.y;
      if (Math.abs(dy) > 28 && Math.abs(dy) > Math.abs(e.clientX - s.x)) {
        swipeRef.current = null;
        swipedRef.current = true;
        if (dy < 0 && !open) onToggleOpen();
        if (dy > 0 && open) onToggleOpen();
      }
    },
    onPointerUp: () => { swipeRef.current = null; },
    onPointerCancel: () => { swipeRef.current = null; },
    onClickCapture: (e) => {
      if (swipedRef.current) {
        swipedRef.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
  // Drag the left edge (or use the arrow keys) to resize on wide layouts.
  const startResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev) => onResize(startW + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const resizeKey = (e) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") onResize(width + step);
    else if (e.key === "ArrowRight") onResize(width - step);
    else if (e.key === "Home") onResize(9999);
    else if (e.key === "End") onResize(0);
    else return;
    e.preventDefault();
  };
  return (
    <aside className={`element-panel${open ? " element-panel--open" : ""}`} aria-hidden={collapsed ? "true" : undefined} inert={collapsed ? "" : undefined}>
      <div
        className="element-panel__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details panel"
        aria-valuemin={260}
        aria-valuemax={560}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeKey}
      />
      <button
        type="button"
        className="element-panel__grabber"
        {...swipe}
        onClick={onToggleOpen}
        aria-label={open ? "Collapse details panel" : "Expand details panel"}
        aria-expanded={open}
      >
        <span />
      </button>
      <div className="element-panel__tabbar" {...swipe}>
        <button
          type="button"
          className={`element-panel__tab${activeTab === "info" ? " element-panel__tab--active" : ""}`}
          onClick={() => onTabChange("info")}
        >
          Info
          {activeTab === "info" && <TabUnderline />}
        </button>
        <button
          type="button"
          className={`element-panel__tab${activeTab === "measurements" ? " element-panel__tab--active" : ""}`}
          onClick={() => onTabChange("measurements")}
        >
          Measurements
          {activeTab === "measurements" && <TabUnderline />}
        </button>
        <button
          type="button"
          className={`element-panel__tab${activeTab === "dimensions" ? " element-panel__tab--active" : ""}`}
          onClick={() => onTabChange("dimensions")}
        >
          Dimensions
          {activeTab === "dimensions" && <TabUnderline />}
        </button>
        <button
          type="button"
          className="element-panel__collapse"
          aria-label="Hide details panel"
          title="Hide details panel"
          onClick={onCollapse}
        >
          <span aria-hidden="true">&rsaquo;</span>
        </button>
        <button
          type="button"
          className="element-panel__close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="element-panel__body">
        {activeTab === "info" ? (
          <ElementInfoPanel element={element} loading={loading} onHide={onHideElement} />
        ) : activeTab === "measurements" ? (
          <MeasureControl
            measurements={measurements}
            onRemoveMeasurement={onRemoveMeasurement}
          />
        ) : (
          <DimensionTagsPanel
            pinnedTags={pinnedDimensionTags}
            onUnpin={onUnpinDimensionTag}
            onClearAllPins={onClearAllDimensionPins}
          />
        )}
      </div>
    </aside>
  );
}
