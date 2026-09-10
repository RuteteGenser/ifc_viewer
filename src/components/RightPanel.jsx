import ElementInfoPanel from "./ElementInfoPanel";
import MeasureControl from "./MeasureControl";

export default function RightPanel({
  activeTab,
  onTabChange,
  onClose,
  element,
  loading,
  measurements,
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
        </button>
        <button
          type="button"
          className={`element-panel__tab${activeTab === "measurements" ? " element-panel__tab--active" : ""}`}
          onClick={() => onTabChange("measurements")}
        >
          Measurements
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
          <MeasureControl measurements={measurements} onRemoveMeasurement={onRemoveMeasurement} />
        )}
      </div>
    </aside>
  );
}
