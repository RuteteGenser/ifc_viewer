// Pure helpers for the view tools: the standard camera directions and the
// shareable "view link" hash. No three.js objects are created here, so the
// module is cheap to import and easy to test.

// Directions are from the model towards the camera, in the viewer's world
// frame (Y up). IFC north is -Z there, so "Front" looks at the south face.
export const STANDARD_VIEWS = [
  { id: "top", label: "Top", dir: [0, 1, 0.0001] },
  { id: "front", label: "Front", dir: [0, 0, 1] },
  { id: "right", label: "Right", dir: [1, 0, 0] },
  { id: "left", label: "Left", dir: [-1, 0, 0] },
  { id: "back", label: "Back", dir: [0, 0, -1] },
  { id: "iso", label: "Isometric", dir: [1, 0.85, 1] },
];

const round = (n) => Math.round(n * 10000) / 10000;

// Camera pose plus the model group's own pose (the model is what turns when
// the user drags), the field of view, and the model names so a link opened
// with a different model loaded can be recognised and ignored.
export function encodeViewHash({ position, target, groupQuat, groupPos, fov, modelNames }) {
  const nums = [...position, ...target, ...groupQuat, ...groupPos, fov].map(round).join(",");
  const names = modelNames.map(encodeURIComponent).join("|");
  return `#view=${nums}&m=${names}`;
}

export function decodeViewHash(hash) {
  const match = /^#?view=([^&]+)(?:&m=(.*))?$/.exec(hash || "");
  if (!match) return null;
  const nums = match[1].split(",").map(Number);
  if (nums.length !== 14 || nums.some((n) => !Number.isFinite(n))) return null;
  let modelNames = [];
  try {
    modelNames = match[2] ? match[2].split("|").map(decodeURIComponent) : [];
  } catch {
    return null;
  }
  return {
    position: nums.slice(0, 3),
    target: nums.slice(3, 6),
    groupQuat: nums.slice(6, 10),
    groupPos: nums.slice(10, 13),
    fov: nums[13],
    modelNames,
  };
}

export function sameNames(a, b) {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((name, i) => name === sorted[i]);
}

export function screenshotFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `argus-view-${stamp}.png`;
}
