// GPS <-> plan-coordinate conversion.
//
// A phone's GPS only knows latitude/longitude; the plan is in IFC model
// meters. They are tied together by calibration: standing somewhere, you tap
// that spot on the plan, which stores { plan point, GPS fix }. After that
// every new GPS fix is mapped by "offset from the calibration fix, rotated
// by the plan's north bearing". With two calibration points far enough
// apart the rotation is measured from them instead of assumed.

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;
const MIN_BASELINE_M = 3;

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function enuOffset(gps, origin) {
  return [
    (gps.lon - origin.lon) * Math.cos(toRad(origin.lat)) * M_PER_DEG_LON,
    (gps.lat - origin.lat) * M_PER_DEG_LAT,
  ];
}

// Bearing (deg clockwise from true north) of the plan's +Y axis.
export function effectiveNorthBearing(cal, fallbackDeg) {
  const pts = cal?.points ?? [];
  if (pts.length >= 2) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const enu = enuOffset(b.gps, a.gps);
    const dPlan = [b.plan[0] - a.plan[0], b.plan[1] - a.plan[1]];
    if (Math.hypot(...enu) >= MIN_BASELINE_M && Math.hypot(...dPlan) >= MIN_BASELINE_M) {
      // M rotates ENU CCW by theta onto plan axes, so theta = angle(plan) - angle(enu);
      // bearing of plan +Y from north equals that same theta.
      return toDeg(Math.atan2(dPlan[1], dPlan[0]) - Math.atan2(enu[1], enu[0]));
    }
  }
  return cal?.northDeg ?? fallbackDeg ?? 0;
}

export function isCalibrated(cal) {
  return (cal?.points?.length ?? 0) > 0;
}

export function gpsToPlan(cal, fallbackNorthDeg, gps) {
  if (!isCalibrated(cal)) return null;
  const anchor = cal.points[cal.points.length - 1];
  const th = toRad(effectiveNorthBearing(cal, fallbackNorthDeg));
  const [e, n] = enuOffset(gps, anchor.gps);
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [anchor.plan[0] + e * c - n * s, anchor.plan[1] + e * s + n * c];
}

export function planToGps(cal, fallbackNorthDeg, plan) {
  if (!isCalibrated(cal)) return null;
  const anchor = cal.points[cal.points.length - 1];
  const th = toRad(effectiveNorthBearing(cal, fallbackNorthDeg));
  const dx = plan[0] - anchor.plan[0];
  const dy = plan[1] - anchor.plan[1];
  const c = Math.cos(th);
  const s = Math.sin(th);
  const e = dx * c + dy * s; // inverse rotation
  const n = -dx * s + dy * c;
  return {
    lat: anchor.gps.lat + n / M_PER_DEG_LAT,
    lon: anchor.gps.lon + e / (M_PER_DEG_LON * Math.cos(toRad(anchor.gps.lat))),
  };
}

const storageKey = (modelNames) => `ifcviewer.geo.${[...modelNames].sort().join("|")}`;

export function loadCalibration(modelNames) {
  try {
    const raw = localStorage.getItem(storageKey(modelNames));
    return raw ? JSON.parse(raw) : { points: [], northDeg: null, floorKey: null };
  } catch {
    return { points: [], northDeg: null, floorKey: null };
  }
}

export function saveCalibration(modelNames, cal) {
  try {
    localStorage.setItem(storageKey(modelNames), JSON.stringify(cal));
  } catch {
    // Storage unavailable/full — calibration just won't persist across reloads.
  }
}
