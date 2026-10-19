import { useEffect, useRef } from "react";
import ElementInfoPanel from "./ElementInfoPanel";
import { nextIndex } from "../a11y";
import MeasureControl from "./MeasureControl";
import DimensionTagsPanel from "./DimensionTagsPanel";

const TABS = [
  { id: "info", label: "Properties", short: "Info" },
  { id: "measurements", label: "Measurements", short: "Measure" },
  { id: "dimensions", label: "Tags", short: "Tags" },
];

// One underline for all tabs. It is a fixed 100px box moved with transform (translate + scaleX), so
// sliding between tabs never touches layout. Re-placed on tab change and whenever the bar or a tab
// resizes (rotation, the short "Info/Measure" labels, the resizable panel).
function TabIndicator({ barRef, active }) {
  const ref = useRef(null);
  useEffect(() => {
    const bar = barRef.current;
    const el = ref.current;
    if (!bar || !el) return undefined;
    const place = () => {
      const tab = bar.querySelector(".element-panel__tab--active");
      if (!tab || !tab.offsetWidth) {
        el.classList.remove("element-panel__tab-indicator--on");
        return;
      }
      const w = Math.max(0, tab.offsetWidth - 16);
      el.style.transform = `translate(${tab.offsetLeft + 8}px, ${tab.offsetTop + tab.offsetHeight - 8}px) scaleX(${w / 100})`;
      if (!el.classList.contains("element-panel__tab-indicator--on")) {
        // First placement: appear in place (draw-in), slide from then on.
        el.classList.remove("element-panel__tab-indicator--ready");
        el.classList.add("element-panel__tab-indicator--on");
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("element-panel__tab-indicator--ready")));
      }
    };
    place();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(place);
    ro.observe(bar);
    bar.querySelectorAll(".element-panel__tab").forEach((t) => ro.observe(t));
    return () => ro.disconnect();
  }, [barRef, active]);
  return (
    <span ref={ref} className="element-panel__tab-indicator" aria-hidden="true">
      <svg className="element-panel__tab-underline" viewBox="0 0 40 6" preserveAspectRatio="none">
        <path d="M1 2.5C8 1 16 4 20 2.3C26 0.5 33 3 39 1.8" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

export default function RightPanel({
  activeTab,
  mode,
  onTabChange,
  onToggleOpen,
  onModeChange,
  onClose,
  onHideElement,
  onToast,
  element,
  loading,
  measurements,
  onRemoveMeasurement,
  pinnedDimensionTags,
  onUnpinDimensionTag,
  onClearAllDimensionPins,
  onStartMeasure,
  onStartTagging,
  collapsed,
  onCollapse,
  width,
  onResize,
}) {
  // Narrow layouts: the panel is a sheet that is fully hidden until needed,
  // with a compact and an expanded height (a side drawer on landscape phones).
  // The handle and tab bar follow the finger and snap on release; everything
  // is a transform, so a drag can be interrupted at any point.
  const asideRef = useRef(null);
  const tabbarRef = useRef(null);
  const compactProbeRef = useRef(null);
  const dragRef = useRef(null);
  const swipedRef = useRef(false);
  const sideways = () => !!window.matchMedia?.("(max-height: 500px) and (pointer: coarse)").matches;
  // Offsets (px) of each snap point along the drag axis, 0 = fully shown.
  const offsets = () => {
    const el = asideRef.current;
    const side = sideways();
    const size = side ? el.offsetWidth : el.offsetHeight;
    const compact = side ? 0 : size - (compactProbeRef.current?.offsetHeight ?? size);
    return { side, full: 0, compact, hidden: size + 24 };
  };
  const modeOffset = (o, m) => (m === "full" ? o.full : m === "compact" ? o.compact : o.hidden);
  const swipe = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" || mode === "hidden") return;
      const o = offsets();
      dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, o, start: modeOffset(o, mode), cur: modeOffset(o, mode), t: performance.now(), v: 0, moved: false };
      swipedRef.current = false;
    },
    onPointerMove: (e) => {
      const d = dragRef.current;
      if (!d || d.id !== e.pointerId) return;
      const delta = d.o.side ? e.clientX - d.x : e.clientY - d.y;
      const cross = d.o.side ? e.clientY - d.y : e.clientX - d.x;
      if (!d.moved) {
        if (Math.abs(delta) < 8 || Math.abs(cross) > Math.abs(delta)) return;
        d.moved = true;
        swipedRef.current = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        asideRef.current.classList.add("element-panel--dragging");
      }
      const minOff = d.o.full;
      const maxOff = d.o.hidden;
      const next = Math.min(maxOff, Math.max(minOff, d.start + delta));
      const now = performance.now();
      d.v = (next - d.cur) / Math.max(1, now - d.t);
      d.cur = next;
      d.t = now;
      asideRef.current.style.transform = d.o.side ? `translateX(${next}px)` : `translateY(${next}px)`;
    },
    onPointerUp: () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || !d.moved) return;
      const el = asideRef.current;
      el.classList.remove("element-panel--dragging");
      el.style.transform = "";
      const projected = d.cur + d.v * 160;
      const modes = d.o.side ? ["compact", "hidden"] : ["full", "compact", "hidden"];
      let best = modes[0];
      for (const m of modes) {
        if (Math.abs(modeOffset(d.o, m) - projected) < Math.abs(modeOffset(d.o, best) - projected)) best = m;
      }
      if (best !== mode) onModeChange(best);
    },
    onPointerCancel: () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.moved) {
        asideRef.current.classList.remove("element-panel--dragging");
        asideRef.current.style.transform = "";
      }
    },
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
  // Arrow keys move between the tabs (automatic activation); only the selected tab is in the Tab order.
  const tabKeys = (e) => {
    const i = TABS.findIndex((t) => t.id === activeTab);
    const next = nextIndex(e.key, i, TABS.length);
    if (next < 0) return;
    e.preventDefault();
    onTabChange(TABS[next].id);
    requestAnimationFrame(() => document.getElementById(`rp-tab-${TABS[next].id}`)?.focus());
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
    <aside
      ref={asideRef}
      className={`element-panel${mode !== "hidden" ? " element-panel--open" : ""}${mode === "full" ? " element-panel--full" : ""}`}
      aria-label="Details"
      aria-hidden={collapsed ? "true" : undefined} inert={collapsed ? "" : undefined}>
      <div className="element-panel__compact-probe" ref={compactProbeRef} aria-hidden="true" />
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
        aria-label={mode === "full" ? "Make details panel smaller" : "Make details panel larger"}
        aria-expanded={mode === "full"}
      >
        <span />
      </button>
      <div className="element-panel__tabbar" ref={tabbarRef} {...swipe}>
        <TabIndicator barRef={tabbarRef} active={activeTab} />
        <div className="element-panel__tablist" role="tablist" aria-label="Details sections" onKeyDown={tabKeys}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`rp-tab-${t.id}`}
              aria-selected={activeTab === t.id}
              aria-controls="rp-tabpanel"
              tabIndex={activeTab === t.id ? 0 : -1}
              className={`element-panel__tab${activeTab === t.id ? " element-panel__tab--active" : ""}`}
              aria-label={t.label}
              onClick={() => onTabChange(t.id)}
            >
              <span className="tab-label tab-label--full">{t.label}</span>
              <span className="tab-label tab-label--short" aria-hidden="true">{t.short}</span>
            </button>
          ))}
        </div>
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

      <div className="element-panel__body" role="tabpanel" id="rp-tabpanel" aria-labelledby={`rp-tab-${activeTab}`}>
        {activeTab === "info" ? (
          <ElementInfoPanel element={element} loading={loading} onHide={onHideElement} onToast={onToast} />
        ) : activeTab === "measurements" ? (
          <MeasureControl
            measurements={measurements}
            onRemoveMeasurement={onRemoveMeasurement}
            onStartMeasure={onStartMeasure}
          />
        ) : (
          <DimensionTagsPanel
            pinnedTags={pinnedDimensionTags}
            onUnpin={onUnpinDimensionTag}
            onClearAllPins={onClearAllDimensionPins}
            onStartTagging={onStartTagging}
          />
        )}
      </div>
    </aside>
  );
}
