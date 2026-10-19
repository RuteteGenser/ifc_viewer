export default function Viewport({ containerRef, reveal = false }) {
  return <div className={`viewport${reveal ? " viewport--reveal" : ""}`} ref={containerRef} />;
}
