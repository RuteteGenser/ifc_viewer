import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LIMITS, newAnnotation } from "../cases/schema";
import { MIN_ARROW_PX, arrowGeometry, clampToViewport, placeLabels, projectPathVisibleSegments, rdpSimplify, smoothPathD } from "./geometry";
import ActionBar from "./ActionBar";
import AnnotationEditor from "./AnnotationEditor";
import "./annotations.css";

const COARSE = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const TEXT_TYPES = ["comment", "pin", "text"];
const MISS = { comment: "Nothing there. Tap on the model.", pin: "Nothing there. Tap on the model.", text: "Nothing there. Tap on the model.", arrow: "Start the arrow on the model.", freehand: "Draw on the model." };
const noPoint = { x: 0, y: 0, visible: false, depth: 0 };

export const inkFor = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#1f1b16" : "#fff";
};

function Pin() {
  return (
    <svg viewBox="0 0 24 28" width="28" height="32" aria-hidden="true">
      <path d="M12 27C12 27 3 16.5 3 10.5a9 9 0 0 1 18 0C21 16.5 12 27 12 27Z" fill="currentColor" stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="10.5" r="3.2" fill="#fff" />
    </svg>
  );
}

// Overlay above the 3D canvas. Props: viewer (see README), annotations, tool, color, selectedId, onSelect,
// onCreate(annotation), onUpdate(id, patch), onRemove(id), author.
export default function AnnotationLayer({ viewer, annotations, tool = null, color, selectedId = null, onSelect, onCreate, onUpdate, onRemove, author = "", readOnly = false }) {
  const rootRef = useRef(null);
  const rubberRef = useRef(null);
  const barRef = useRef(null);
  const reg = useRef(new Map());
  const raf = useRef(0);
  const live = useRef({});
  live.current = { annotations, selectedId, viewer };
  const coarse = useMemo(COARSE, []);
  const [editor, setEditor] = useState(null);
  const [note, setNote] = useState("");
  const gesture = useRef(null);

  const rec = (id) => {
    let r = reg.current.get(id);
    if (!r) reg.current.set(id, (r = {}));
    return r;
  };

  // ---- projection: one rAF per change; read everything, then write everything.
  const frame = useCallback(() => {
    raf.current = 0;
    const { annotations: list, selectedId: sel, viewer: v } = live.current;
    const root = rootRef.current;
    if (!root || !v) return;
    const size = v.getSize?.() || { width: root.clientWidth, height: root.clientHeight };
    const proj = (p) => v.project(p) || noPoint;
    const occluded = (p) => { try { return !!v.isOccluded?.(p); } catch { return false; } };
    const rows = [];
    for (const a of list) {
      const r = reg.current.get(a.id);
      if (!r) continue;
      const row = { a, r, vis: false, occ: false, x: 0, y: 0 };
      if (a.type === "arrow") {
        const s = proj(a.anchor.point), e = proj(a.target.point);
        row.vis = s.visible && e.visible;
        row.x = s.x; row.y = s.y; row.s = s; row.e = e;
        row.occ = occluded(a.anchor.point) && occluded(a.target.point);
      } else if (a.type === "freehand") {
        const pts = a.path.map(proj);
        row.segs = projectPathVisibleSegments(pts);
        row.vis = row.segs.length > 0;
        if (row.vis) { row.x = row.segs[0][0].x; row.y = row.segs[0][0].y; }
        const idx = [0, a.path.length >> 2, a.path.length >> 1, (3 * a.path.length) >> 2, a.path.length - 1];
        row.occ = idx.every((i) => occluded(a.path[i]));
      } else {
        const p = proj(a.anchor.point);
        row.vis = p.visible; row.x = p.x; row.y = p.y;
        row.occ = occluded(a.anchor.point);
        if (r.card && row.vis) { row.cw = r.card.offsetWidth; row.ch = r.card.offsetHeight; }
      }
      rows.push(row);
    }
    const bar = barRef.current;
    const barSize = bar ? { w: bar.offsetWidth, h: bar.offsetHeight } : null;
    const cardRows = rows.filter((x) => x.cw);
    const dys = placeLabels(cardRows.map((x) => ({ l: x.x + 22, r: x.x + 22 + x.cw, t: x.y - 12, b: x.y - 12 + x.ch })));
    cardRows.forEach((x, i) => { x.dy = dys[i]; x.flip = x.x + 22 + x.cw > size.width - 4; });

    // ---- write
    for (const row of rows) {
      const { a, r } = row;
      const flags = (el) => { if (el) { el.dataset.vis = row.vis ? "1" : "0"; el.dataset.occ = row.occ ? "1" : "0"; } };
      flags(r.shape); flags(r.item);
      if (r.item) r.item.style.transform = `translate(${row.x.toFixed(1)}px,${row.y.toFixed(1)}px)`;
      if (r.card && row.cw) r.card.style.transform = `translate(${row.flip ? -(row.cw + 44) : 0}px,${-row.dy}px)`;
      if (!row.vis) continue;
      if (a.type === "arrow") {
        const g = arrowGeometry(row.s, row.e);
        r.shaft.setAttribute("d", `M${row.s.x.toFixed(1)} ${row.s.y.toFixed(1)}L${g.shaftEnd.x.toFixed(1)} ${g.shaftEnd.y.toFixed(1)}`);
        r.head.setAttribute("d", `M${g.head.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L")}Z`);
      } else if (a.type === "freehand") {
        r.shaft.setAttribute("d", row.segs.map((s) => smoothPathD(s)).join(""));
      }
    }
    if (bar) {
      const row = rows.find((x) => x.a.id === sel);
      bar.dataset.vis = row && row.vis ? "1" : "0";
      if (row && row.vis) {
        const below = row.y + 30 + barSize.h < size.height;
        const pos = clampToViewport({ x: row.x - barSize.w / 2, y: below ? row.y + 30 : row.y - 40 - barSize.h, w: barSize.w, h: barSize.h }, size, 6);
        bar.style.transform = `translate(${pos.x.toFixed(1)}px,${pos.y.toFixed(1)}px)`;
      }
    }
  }, []);

  const schedule = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(frame); }, [frame]);

  useLayoutEffect(schedule); // new/changed items get placed in the next frame
  useEffect(() => {
    const off = viewer.subscribeCamera?.(schedule);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(rootRef.current);
    schedule();
    return () => { off?.(); ro?.disconnect(); if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [viewer, schedule]);

  // ---- tool gestures
  const say = useCallback((text) => { setNote(text); clearTimeout(say.t); say.t = setTimeout(() => setNote(""), 2200); }, []);
  const local = (g, e) => ({ x: e.clientX - g.rect.left, y: e.clientY - g.rect.top });
  const setRubber = (d) => { if (rubberRef.current) rubberRef.current.setAttribute("d", d); };

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (gesture.current) { gesture.current.cancelled = true; return; } // second finger
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = rootRef.current.getBoundingClientRect();
    gesture.current = { id: e.pointerId, rect, x0: e.clientX, y0: e.clientY, pts: [[e.clientX - rect.left, e.clientY - rect.top]], moved: 0, cancelled: false, tool };
    if (tool === "arrow") gesture.current.start = viewer.pick(e.clientX, e.clientY);
  };
  const onMove = (e) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const p = local(g, e);
    g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x0, e.clientY - g.y0));
    if (g.tool === "arrow") {
      const geo = arrowGeometry({ x: g.pts[0][0], y: g.pts[0][1] }, p);
      setRubber(`M${g.pts[0][0]} ${g.pts[0][1]}L${geo.shaftEnd.x} ${geo.shaftEnd.y}M${geo.head.map((q) => `${q.x} ${q.y}`).join("L")}Z`);
      g.last = p;
    } else if (g.tool === "freehand") {
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) >= 3 && g.pts.length < 1500) {
        g.pts.push([p.x, p.y]);
        setRubber(smoothPathD(g.pts.map(([x, y]) => ({ x, y }))));
      }
    }
  };
  const finish = async (e) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    setRubber("");
    if (g.cancelled || e.type === "pointercancel") { gesture.current = null; return; }
    g.last = local(g, e);
    try {
      if (g.tool === "arrow") await finishArrow(g, e);
      else if (g.tool === "freehand") await finishFreehand(g, e);
      else if (g.moved <= 10) await finishPoint(g, e);
    } finally { gesture.current = null; }
  };
  const finishPoint = async (g, e) => {
    const hit = await viewer.pick(e.clientX, e.clientY);
    if (!hit) return say(MISS[g.tool]);
    setEditor({ mode: "create", type: g.tool, anchor: { point: hit.point, guid: hit.guid ?? null, storey: hit.storey ?? null }, at: g.last });
  };
  const finishArrow = async (g, e) => {
    const [x0, y0] = g.pts[0];
    if (Math.hypot(g.last.x - x0, g.last.y - y0) < MIN_ARROW_PX) return say("Drag a little further to draw an arrow.");
    const start = await g.start;
    if (!start) return say(MISS.arrow);
    let end = await viewer.pick(e.clientX, e.clientY);
    if (!end) {
      const point = viewer.unprojectOnPlane?.(e.clientX, e.clientY, start.point);
      if (!point) return say("End the arrow on the model.");
      end = { point, guid: null };
    }
    onCreate(newAnnotation("arrow", { color, author, anchor: { point: start.point, guid: start.guid ?? null, storey: start.storey ?? null }, target: { point: end.point, guid: end.guid ?? null } }));
  };
  const finishFreehand = async (g, e) => {
    const screen = rdpSimplify(g.pts, 1.5, LIMITS.freehandPoints);
    if (screen.length < 2) return say("Draw a longer line.");
    const hits = [];
    for (let i = 0; i < screen.length; i += 16) {
      const batch = screen.slice(i, i + 16).map(([x, y]) => viewer.pick(x + g.rect.left, y + g.rect.top));
      hits.push(...(await Promise.all(batch)));
    }
    const first = hits.find(Boolean);
    if (!first) return say(MISS.freehand);
    const path = [];
    screen.forEach(([x, y], i) => {
      const point = hits[i]?.point || viewer.unprojectOnPlane?.(x + g.rect.left, y + g.rect.top, first.point);
      if (point) path.push(point);
    });
    if (path.length < 2) return say(MISS.freehand);
    onCreate(newAnnotation("freehand", { color, author, anchor: { point: path[0], guid: first.guid ?? null, storey: first.storey ?? null }, path }));
  };

  const saveEditor = (text) => {
    if (editor.mode === "edit") onUpdate(editor.id, { text });
    else onCreate(newAnnotation(editor.type, { color, author, text, anchor: editor.anchor }));
    setEditor(null);
  };

  let comments = 0;
  const selected = annotations.find((a) => a.id === selectedId);
  const editing = editor?.mode === "edit" ? annotations.find((a) => a.id === editor.id) : null;
  return (
    <div ref={rootRef} className="ann-layer" data-testid="ann-layer" data-tool={tool || ""}>
      <svg className="ann-svg" aria-hidden="true">
        {annotations.map((a) => (a.type === "arrow" || a.type === "freehand") && (
          <g key={a.id} ref={(el) => { rec(a.id).shape = el; if (!el) delete rec(a.id).shape; }} className={`ann-shape ann-shape--${a.type}${a.id === selectedId ? " is-selected" : ""}`} data-ann={a.id} style={{ color: a.color }}>
            <path ref={(el) => { rec(a.id).shaft = el; }} className="ann-stroke" fill="none" />
            {a.type === "arrow" && <path ref={(el) => { rec(a.id).head = el; }} className="ann-head" />}
          </g>
        ))}
        <path ref={rubberRef} className="ann-rubber" fill="none" style={{ color }} />
      </svg>
      {tool && <div className="ann-capture" data-testid="ann-capture" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={finish} onPointerCancel={finish} />}
      {annotations.map((a) => {
        const num = a.type === "comment" ? ++comments : 0;
        const open = !coarse || a.id === selectedId;
        const sel = a.id === selectedId;
        const label = `${a.type === "comment" ? `Comment ${num}` : a.type[0].toUpperCase() + a.type.slice(1)}${a.text ? `: ${a.text.slice(0, 80)}` : ""}`;
        return (
          <div key={a.id} ref={(el) => { rec(a.id).item = el; if (!el) { delete rec(a.id).item; delete rec(a.id).card; } }} className={`ann-item ann-item--${a.type}${sel ? " is-selected" : ""}`} data-ann={a.id}>
            <button type="button" className="ann-handle" aria-label={label} aria-pressed={sel} aria-expanded={TEXT_TYPES.includes(a.type) && a.type !== "text" ? open : undefined}
              onClick={() => onSelect(sel ? null : a.id)} style={{ "--c": a.color, "--ink": inkFor(a.color) }}>
              {a.type === "comment" && <span className="ann-badge">{num}</span>}
              {a.type === "pin" && <span className="ann-pin" style={{ color: a.color }}><Pin /></span>}
              {a.type === "text" && <span className="ann-label" style={{ color: a.color }}>{a.text}</span>}
              {(a.type === "arrow" || a.type === "freehand") && <span className="ann-dot" />}
            </button>
            {(a.type === "comment" || a.type === "pin") && a.text && (
              <div ref={(el) => { rec(a.id).card = el; }} className={`ann-card${open ? " is-open" : ""}${sel ? " is-selected" : ""}`} style={{ borderColor: a.color }}>{a.text}</div>
            )}
          </div>
        );
      })}
      {selected && !editor && !readOnly && (
        <ActionBar ref={barRef} annotation={selected} colors={null}
          onEdit={TEXT_TYPES.includes(selected.type) ? () => setEditor({ mode: "edit", id: selected.id }) : null}
          onColor={(c) => onUpdate(selected.id, { color: c })}
          onDelete={() => { onRemove(selected.id); onSelect(null); }}
          onClose={() => onSelect(null)} />
      )}
      {editor && (
        <AnnotationEditor key={editor.id || "new"} type={editor.type || editing?.type} initial={editing?.text || ""} at={editor.at} getSize={() => viewer.getSize?.() || { width: rootRef.current.clientWidth, height: rootRef.current.clientHeight }}
          onSave={saveEditor} onCancel={() => setEditor(null)} />
      )}
      <div className="ann-note" role="status" aria-live="polite">{note}</div>
    </div>
  );
}
