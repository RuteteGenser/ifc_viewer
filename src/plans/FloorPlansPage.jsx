import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cutStorey, DEFAULT_CUT_HEIGHT, KINDS, segmentsBounds } from "./floorPlans";
import { gpsToPlan, isCalibrated, loadCalibration, planToGps, saveCalibration } from "./geo";

const KIND_STYLE = {
  wall: { color: "#2a2622", width: 1.6 },
  door: { color: "#96652f", width: 1.3 },
  window: { color: "#4f6d8a", width: 1.3 },
  mep: { color: "#4f7f5f", width: 1.1 },
  other: { color: "#8a8172", width: 1 },
};
const FLOOR_MATCH_M = 0.25;
const isCoarsePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
const isPhoneLayout = () => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
const CLICK_SLOP_PX = 6;

export default function FloorPlansPage({
  active,
  hasModels,
  plans, // result of usePlans
  cases,
  focusRequest, // { caseId, nonce } | null
  onCreateCase, // ({ floor, plan, gps, modelNames }) => void
  onOpenCase, // (caseId) => void
}) {
  const { floors, planNorthBearing, modelNames, busy, error } = plans;
  const [floorKey, setFloorKey] = useState(null);
  const [cutHeight, setCutHeight] = useState(DEFAULT_CUT_HEIGHT);
  const [mode, setMode] = useState("none"); // "none" | "addCase" | "calibrate"
  const [tracking, setTracking] = useState(false);
  const [fix, setFix] = useState(null); // { lat, lon, accuracy, t }
  const [geoError, setGeoError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calibration, setCalibration] = useState({ points: [], northDeg: null, floorKey: null });

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const viewRef = useRef({ cx: 0, cy: 0, scale: 10 });
  const drawRef = useRef(() => {});
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);

  // ---- floor selection -------------------------------------------------
  const floor = floors.find((f) => f.key === floorKey) ?? floors[0] ?? null;
  const maxCut = floor ? Math.max(0.5, Math.min(3.4, floor.height - 0.1)) : 3.4;
  const effectiveCut = Math.min(cutHeight, maxCut);

  // ---- calibration persistence ----------------------------------------
  const namesKey = modelNames.join("|");
  useEffect(() => {
    if (modelNames.length) setCalibration(loadCalibration(modelNames));
  }, [namesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCalibration = useCallback(
    (next) => {
      setCalibration(next);
      saveCalibration(modelNames, next);
    },
    [modelNames],
  );

  // ---- section lines for the shown floor -------------------------------
  const segments = useMemo(() => {
    if (!floor) return null;
    const perKind = KINDS.map(() => []);
    for (const { storey } of floor.storeys) {
      cutStorey(storey, effectiveCut).forEach((seg, i) => perKind[i].push(seg));
    }
    return perKind.map((parts) => {
      const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      return out;
    });
  }, [floor, effectiveCut]);

  const fitToFloor = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !segments) return;
    const b = segmentsBounds(segments);
    if (!b) return;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const scale = Math.min(w / Math.max(b.maxX - b.minX, 1), h / Math.max(b.maxY - b.minY, 1)) * 0.85;
    viewRef.current = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale };
    drawRef.current();
  }, [segments]);

  // Re-fit when the floor itself changes (not on every cut-height tweak).
  const floorId = floor?.key;
  useEffect(() => {
    fitToFloor();
  }, [floorId, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- GPS ---------------------------------------------------------------
  useEffect(() => {
    if (!tracking) return undefined;
    if (!navigator.geolocation) {
      setGeoError("This browser has no geolocation support.");
      setTracking(false);
      return undefined;
    }
    setGeoError(null);
    const watchId = navigator.geolocation.watchPosition(
      (pos) =>
        setFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, t: pos.timestamp }),
      (err) => {
        setGeoError(
          err.code === 1
            ? "Location permission denied. Allow location for this site in the browser."
            : `Location error: ${err.message}`,
        );
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [tracking]);

  const calibrated = isCalibrated(calibration);
  const northFallback = calibration.northDeg ?? planNorthBearing ?? 0;
  const userPlan = useMemo(
    () => (fix && calibrated ? gpsToPlan(calibration, planNorthBearing, fix) : null),
    [fix, calibration, calibrated, planNorthBearing],
  );
  const userOnThisFloor = !!floor && calibration.floorKey === floor.key;

  // ---- drawing -------------------------------------------------------------
  const floorCases = useMemo(
    () => (floor ? cases.filter((c) => c.floor && Math.abs(c.floor.elevation - floor.elevation) <= FLOOR_MATCH_M) : []),
    [cases, floor],
  );
  const caseNumber = useMemo(() => new Map(cases.map((c, i) => [c.id, cases.length - i])), [cases]);

  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fbfaf6";
    ctx.fillRect(0, 0, w, h);
    const { cx, cy, scale } = viewRef.current;
    const sx = (x) => w / 2 + (x - cx) * scale;
    const sy = (y) => h / 2 - (y - cy) * scale;

    if (segments) {
      ctx.lineCap = "round";
      KINDS.forEach((kind, k) => {
        const seg = segments[k];
        if (!seg.length) return;
        ctx.strokeStyle = KIND_STYLE[kind].color;
        ctx.lineWidth = KIND_STYLE[kind].width;
        ctx.beginPath();
        for (let i = 0; i < seg.length; i += 4) {
          ctx.moveTo(sx(seg[i]), sy(seg[i + 1]));
          ctx.lineTo(sx(seg[i + 2]), sy(seg[i + 3]));
        }
        ctx.stroke();
      });
    }

    // calibration reference points on this floor
    ctx.strokeStyle = "#4f6d8a";
    ctx.lineWidth = 1.5;
    for (const p of calibration.points) {
      if (p.floorKey !== floor?.key) continue;
      const x = sx(p.plan[0]);
      const y = sy(p.plan[1]);
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x, y + 7);
      ctx.stroke();
    }

    // case pins
    const pinRadius = isCoarsePointer() ? 15 : 12;
    for (const c of floorCases) {
      const x = sx(c.plan[0]);
      const y = sy(c.plan[1]);
      ctx.fillStyle = "#96652f";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, pinRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${pinRadius}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(caseNumber.get(c.id) ?? ""), x, y + 0.5);
    }

    // "you are here"
    if (userPlan && userOnThisFloor) {
      const x = sx(userPlan[0]);
      const y = sy(userPlan[1]);
      const r = Math.max((fix?.accuracy ?? 0) * scale, 0);
      if (r > 8) {
        ctx.fillStyle = "rgba(37, 99, 235, 0.06)";
        ctx.strokeStyle = "rgba(37, 99, 235, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = "#2563eb";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // north arrow (plan +Y is "up" on screen; arrow shows true north)
    const nb = (northFallback * Math.PI) / 180;
    // true north direction on screen: rotate plan-up by -bearing(+Y)
    const ax = w - 40;
    const ay = 44;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(-nb);
    ctx.fillStyle = "#2a2622";
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#2a2622";
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", ax, ay + 24);

    // scale bar
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100].find((m) => m * scale >= 70) ?? 100;
    ctx.strokeStyle = "#2a2622";
    ctx.lineWidth = 2;
    const barY = h - (isPhoneLayout() ? 84 : 20);
    ctx.beginPath();
    ctx.moveTo(16, barY);
    ctx.lineTo(16 + nice * scale, barY);
    ctx.stroke();
    ctx.fillStyle = "#2a2622";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${nice} m`, 16, barY - 8);
  };
  // redraw after every render (all drawn inputs live in this render's closure)
  useEffect(() => {
    drawRef.current();
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ---- focus request from the photo page -------------------------------
  const lastFocusNonce = useRef(null);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastFocusNonce.current) return;
    const c = cases.find((x) => x.id === focusRequest.caseId);
    if (!c?.floor || floors.length === 0) return;
    const f = floors.find((fl) => Math.abs(fl.elevation - c.floor.elevation) <= FLOOR_MATCH_M);
    if (!f) return;
    lastFocusNonce.current = focusRequest.nonce;
    setFloorKey(f.key);
    viewRef.current = { ...viewRef.current, cx: c.plan[0], cy: c.plan[1], scale: Math.max(viewRef.current.scale, 25) };
    drawRef.current();
  }, [focusRequest, cases, floors]);

  // ---- pointer interaction -------------------------------------------------
  const canvasToPlan = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const { cx, cy, scale } = viewRef.current;
    return [cx + (clientX - rect.left - rect.width / 2) / scale, cy - (clientY - rect.top - rect.height / 2) / scale];
  };

  const handleClick = (clientX, clientY) => {
    if (!floor) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { cx, cy, scale } = viewRef.current;
    // existing pin?
    for (const c of floorCases) {
      const px = rect.width / 2 + (c.plan[0] - cx) * scale;
      const py = rect.height / 2 - (c.plan[1] - cy) * scale;
      if (Math.hypot(clientX - rect.left - px, clientY - rect.top - py) <= (isCoarsePointer() ? 28 : 16)) {
        onOpenCase(c.id);
        return;
      }
    }
    const plan = canvasToPlan(clientX, clientY);
    if (mode === "addCase") {
      onCreateCase({
        floor: { name: floor.name, elevation: floor.elevation },
        plan,
        gps: planToGps(calibration, planNorthBearing, plan),
        modelNames,
      });
      setMode("none");
    } else if (mode === "calibrate") {
      if (!fix) {
        setNotice("No GPS fix yet — start tracking and wait for a position, then tap where you stand.");
        return;
      }
      const points = [...calibration.points, { plan, gps: { lat: fix.lat, lon: fix.lon }, floorKey: floor.key }];
      updateCalibration({ ...calibration, points: points.slice(-4), floorKey: floor.key });
      setNotice("Position set. Your blue dot now follows your GPS.");
      setMode("none");
    }
  };

  const onPointerDown = (e) => {
    canvasRef.current.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointersRef.current.values()];
    gestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      multi: pts.length > 1,
      lastDist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
    };
  };
  const onPointerMove = (e) => {
    const prev = pointersRef.current.get(e.pointerId);
    if (!prev) return;
    const g = gestureRef.current;
    const next = { x: e.clientX, y: e.clientY };
    pointersRef.current.set(e.pointerId, next);
    const pts = [...pointersRef.current.values()];
    const v = viewRef.current;
    if (pts.length >= 2) {
      g.multi = true;
      g.moved = true;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (g.lastDist > 0) viewRef.current = { ...v, scale: Math.min(Math.max(v.scale * (dist / g.lastDist), 0.5), 400) };
      g.lastDist = dist;
    } else if (g) {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > CLICK_SLOP_PX) g.moved = true;
      if (g.moved && !g.multi) {
        viewRef.current = { ...v, cx: v.cx - (next.x - prev.x) / v.scale, cy: v.cy + (next.y - prev.y) / v.scale };
      }
    }
    drawRef.current();
  };
  const onPointerUp = (e) => {
    const g = gestureRef.current;
    pointersRef.current.delete(e.pointerId);
    if (g && !g.moved && !g.multi && e.type === "pointerup") handleClick(e.clientX, e.clientY);
    if (pointersRef.current.size === 0) gestureRef.current = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const v = viewRef.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(Math.max(v.scale * factor, 0.5), 400);
    // keep the plan point under the cursor fixed
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    const px = v.cx + mx / v.scale;
    const py = v.cy - my / v.scale;
    viewRef.current = { cx: px - mx / scale, cy: py + my / scale, scale };
    drawRef.current();
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  });

  // ---- actions ------------------------------------------------------------
  const addCaseAtMyLocation = () => {
    if (!userPlan || !userOnThisFloor || !floor) return;
    onCreateCase({
      floor: { name: floor.name, elevation: floor.elevation },
      plan: userPlan,
      gps: fix ? { lat: fix.lat, lon: fix.lon } : null,
      modelNames,
    });
  };

  const hasFloors = floors.length > 0;
  let hint = null;
  if (mode === "addCase") hint = "Tap the plan where the case is.";
  else if (mode === "calibrate") hint = fix ? "Tap the plan exactly where you are standing right now." : "Waiting for a GPS fix…";
  else if (notice) hint = notice;

  return (
    <div className="plans" ref={wrapRef}>
      <div className={`plans__bar${settingsOpen ? " plans__bar--settings-open" : ""}`}>
        <select
          className="plans__select"
          value={floor?.key ?? ""}
          onChange={(e) => setFloorKey(e.target.value)}
          disabled={!hasFloors}
          aria-label="Floor"
        >
          {floors.map((f) => (
            <option key={f.key} value={f.key}>
              {f.name} ({f.elevation.toFixed(1)} m)
            </option>
          ))}
        </select>

        <button type="button" className="plans__btn" onClick={fitToFloor} disabled={!hasFloors}>
          Fit
        </button>
        <button
          type="button"
          className={`plans__btn plans__settings-toggle${settingsOpen ? " plans__btn--active" : ""}`}
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          Settings
        </button>

        <div className="plans__settings">
          <label className="plans__cut" title="Height above the floor where the plan is cut">
            Cut {effectiveCut.toFixed(1)} m
            <input
              type="range"
              min="0.3"
              max={maxCut}
              step="0.1"
              value={effectiveCut}
              disabled={!hasFloors}
              onChange={(e) => setCutHeight(Number(e.target.value))}
            />
          </label>
          <label className="plans__north" title="Bearing of the plan's up direction, clockwise from true north. Read from the IFC when available.">
            Plan north
            <input
              type="number"
              inputMode="decimal"
              step="1"
              value={Math.round(northFallback * 10) / 10}
              onChange={(e) => updateCalibration({ ...calibration, northDeg: e.target.value === "" ? null : Number(e.target.value) })}
            />
            °
          </label>
        </div>

        <span className="plans__sep" />

        <div className="plans__actions">
          <button
            type="button"
            className={`plans__btn${mode === "addCase" ? " plans__btn--active" : ""}`}
            disabled={!hasFloors}
            onClick={() => {
              setNotice(null);
              setMode((m) => (m === "addCase" ? "none" : "addCase"));
            }}
          >
            + Case
          </button>
          <button
            type="button"
            className="plans__btn"
            disabled={!userPlan || !userOnThisFloor}
            title={userPlan && userOnThisFloor ? "Create a case at your GPS position" : "Needs GPS tracking, a set position and this floor selected as yours"}
            onClick={addCaseAtMyLocation}
          >
            + Case here
          </button>
          <button
            type="button"
            className={`plans__btn${tracking ? " plans__btn--active" : ""}`}
            onClick={() => setTracking((t) => !t)}
            disabled={!hasFloors}
          >
            {tracking ? "GPS on" : "GPS off"}
          </button>
          <button
            type="button"
            className={`plans__btn${mode === "calibrate" ? " plans__btn--active" : ""}`}
            disabled={!hasFloors || !tracking}
            title="Stand somewhere you can identify on the plan, then tap that spot"
            onClick={() => {
              setNotice(null);
              setMode((m) => (m === "calibrate" ? "none" : "calibrate"));
            }}
          >
            Set position
          </button>
          {calibrated && floor && calibration.floorKey !== floor.key && (
            <button
              type="button"
              className="plans__btn plans__btn--active"
              onClick={() => updateCalibration({ ...calibration, floorKey: floor.key })}
            >
              I&rsquo;m on this floor
            </button>
          )}
        </div>
      </div>

      {(hint || geoError) && (
        <div className={`plans__hint${geoError ? " plans__hint--error" : ""}`}>{geoError ?? hint}</div>
      )}
      {tracking && fix && (
        <div className="plans__gps">
          GPS ±{Math.round(fix.accuracy)} m
          {!calibrated ? " · tap “Set my position” to place yourself on the plan" : ""}
          {calibrated && !userOnThisFloor ? " · you are on another floor" : ""}
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`plans__canvas${mode !== "none" ? " plans__canvas--pick" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {!hasModels && <div className="plans__empty">Load an IFC model in the 3D view to see its floors here.</div>}
      {hasModels && busy && <div className="plans__empty">Building floor plans…</div>}
      {hasModels && !busy && !hasFloors && !error && (
        <div className="plans__empty">No building storeys found in the loaded model(s).</div>
      )}
      {error && <div className="plans__empty plans__empty--error">{error}</div>}
    </div>
  );
}
