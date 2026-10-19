import { useEffect, useRef, useState } from "react";
import { PALETTE } from "../cases/schema";
import Hud from "../components/Hud";

const I = (d) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const TOOLS = [
  { id: "comment", label: "Comment", key: "C", hint: "Tap on the model to place a comment", icon: I(<path d="M4 5h16v11H9l-5 4z" />) },
  { id: "pin", label: "Pin", key: "P", hint: "Tap on the model to drop a pin", icon: I(<><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>) },
  { id: "arrow", label: "Arrow", key: "A", hint: "Drag from the start to the end of the arrow", icon: I(<path d="M5 19L19 5M9 5h10v10" />) },
  { id: "text", label: "Text", key: "T", hint: "Tap on the model to place a text label", icon: I(<path d="M5 6V4h14v2M12 4v16M9 20h6" />) },
  { id: "freehand", label: "Draw", key: "F", hint: "Draw on the model with your finger", icon: I(<path d="M4 17c3-9 5-9 6-4s3 4 6-3l4-3" />) },
];
const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// Tool buttons (44px), colour, undo/redo/delete, the armed-tool hint and the keyboard shortcuts.
export default function AnnotationToolbar({ tool, onTool, color, onColor, canUndo, canRedo, onUndo, onRedo, hasSelection, onDelete, onCancel }) {
  const [palette, setPalette] = useState(false);
  const live = useRef({});
  live.current = { tool, onTool, canUndo, canRedo, onUndo, onRedo, hasSelection, onDelete, onCancel };

  useEffect(() => {
    const onKey = (e) => {
      const l = live.current;
      if (typing(e.target) || e.altKey) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "y")) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) l.onRedo(); else l.onUndo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) { e.preventDefault(); l.onTool(l.tool === t.id ? null : t.id); }
      else if (k === "escape") { setPalette(false); l.onCancel(); }
      else if ((k === "delete" || k === "backspace") && l.hasSelection) { e.preventDefault(); l.onDelete(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const armed = TOOLS.find((t) => t.id === tool);
  return (
    <>
      {armed && (
        <Hud>
          <div className="tool-hint" role="status">
            <span className="tool-hint__text">{armed.hint}</span>
            <button type="button" className="tool-hint__done" onClick={() => onTool(null)}>Done</button>
          </div>
        </Hud>
      )}
      <div className="ann-dock" role="toolbar" aria-label="Annotation tools">
        <div className="ann-dock__row">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className="ann-tool" aria-pressed={tool === t.id} aria-label={`${t.label} (${t.key})`} title={`${t.label} (${t.key})`} onClick={() => onTool(tool === t.id ? null : t.id)}>
              {t.icon}<span className="ann-tool__cap">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="ann-dock__row">
          <div className="ann-colorwrap">
            <button type="button" className="ann-tool" aria-label="Colour" aria-expanded={palette} title="Colour" onClick={() => setPalette((v) => !v)}>
              <span className="ann-cur" style={{ background: color }} /><span className="ann-tool__cap">Colour</span>
            </button>
            {palette && (
              <div className="ann-palette" role="group" aria-label="Annotation colour">
                {PALETTE.map((c) => (
                  <button key={c} type="button" className="ann-swatch" aria-label={`Colour ${c}`} aria-pressed={c === color} onClick={() => { onColor(c); setPalette(false); }}><span style={{ background: c }} /></button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="ann-tool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>{I(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />)}<span className="ann-tool__cap">Undo</span></button>
          <button type="button" className="ann-tool" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>{I(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />)}<span className="ann-tool__cap">Redo</span></button>
          <button type="button" className="ann-tool" aria-label="Delete selected" title="Delete (Del)" disabled={!hasSelection} onClick={onDelete}>{I(<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" />)}<span className="ann-tool__cap">Delete</span></button>
        </div>
      </div>
    </>
  );
}
