import ElementInfoPanel from "./ElementInfoPanel";
import MeasureControl from "./MeasureControl";

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
  onTabChange,
  onClose,
  element,
  loading,
  measurements,
  pendingMeasurePreview,
  onRemoveMeasurement,
}) {
  return (
    <aside className="element-panel">
      <div className="element-panel__tabbar">
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
          className="element-panel__close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="element-panel__body">
        {activeTab === "info" ? (
          <ElementInfoPanel element={element} loading={loading} />
        ) : (
          <MeasureControl
            measurements={measurements}
            pendingMeasurePreview={pendingMeasurePreview}
            onRemoveMeasurement={onRemoveMeasurement}
          />
        )}
      </div>
    </aside>
  );
}
