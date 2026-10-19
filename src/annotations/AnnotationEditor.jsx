import { useEffect, useRef, useState } from "react";
import { LIMITS } from "../cases/schema";
import { clampToViewport } from "./geometry";

const COARSE = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const PHONE = () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 768px)").matches;

// Inline text editor. Phones: a bottom sheet that rides above the keyboard (visualViewport).
// Desktop: a card next to the tap point.
export default function AnnotationEditor({ type, initial, at, getSize, onSave, onCancel }) {
  const [text, setText] = useState(initial);
  const [sheet] = useState(PHONE);
  const [kb, setKb] = useState(0);
  const ta = useRef(null);
  const needText = type !== "pin" && !!type;

  useEffect(() => {
    if (!COARSE()) ta.current?.focus();
    const vv = window.visualViewport;
    if (!vv || !sheet) return undefined;
    const update = () => setKb(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, [sheet]);

  const canSave = !needText || text.trim().length > 0;
  const save = () => canSave && onSave(text.trim());
  let style;
  if (sheet) style = { bottom: kb };
  else {
    const p = clampToViewport({ x: (at?.x ?? 0) + 14, y: (at?.y ?? 0) + 14, w: 320, h: 190 }, getSize(), 8);
    style = { left: p.x, top: p.y };
  }
  const title = { comment: "Comment", pin: "Pin note", text: "Text label" }[type] || "Note";
  return (
    <div className={`ann-editor${sheet ? " ann-editor--sheet" : ""}`} style={style} role="dialog" aria-label={title}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}>
      <label className="ann-editor__title" htmlFor="ann-text">{title}{type === "pin" ? " (optional)" : ""}</label>
      <textarea id="ann-text" ref={ta} value={text} maxLength={LIMITS.textChars} rows={3} placeholder="Write here" onChange={(e) => setText(e.target.value)} />
      <div className="ann-editor__foot">
        <span className="ann-editor__count">{text.length}/{LIMITS.textChars}</span>
        <button type="button" className="ann-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="ann-btn ann-btn--primary" disabled={!canSave} onClick={save}>Save</button>
      </div>
    </div>
  );
}
