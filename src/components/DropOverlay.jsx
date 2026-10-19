// While a file is dragged over the viewer. With nothing loaded one message; with
// a model loaded two zones: the drop replaces it, or adds to it when it lands on
// "Add to view" or Shift is held (App.jsx reads data-drop-add and the Shift key).
export default function DropOverlay({ visible, hasModels = false, shift = false }) {
  if (!visible) return null;
  if (!hasModels) {
    return (
      <div className="drop-overlay">
        <div className="drop-overlay__box">Drop .ifc or .ifcZIP file(s) to load</div>
      </div>
    );
  }
  return (
    <div className="drop-overlay">
      <div className="drop-zones">
        <div className={`drop-zone${shift ? "" : " drop-zone--active"}`} data-drop-replace>
          Replace this model
          <small>Drop here</small>
        </div>
        <div className={`drop-zone${shift ? " drop-zone--active" : ""}`} data-drop-add>
          Add to view
          <small>Drop here, or hold Shift</small>
        </div>
      </div>
    </div>
  );
}
