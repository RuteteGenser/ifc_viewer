export default function LoadingOverlay({ visible, label }) {
  if (!visible) return null;
  return (
    <div className="loading-overlay">
      <div className="loading-overlay__box">
        <span className="loading-overlay__spinner" aria-hidden="true" />
        <span>{label || "Loading…"}</span>
      </div>
    </div>
  );
}
