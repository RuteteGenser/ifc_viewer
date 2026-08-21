export default function DropOverlay({ visible }) {
  if (!visible) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-overlay__box">Drop .ifc file(s) to load</div>
    </div>
  );
}
