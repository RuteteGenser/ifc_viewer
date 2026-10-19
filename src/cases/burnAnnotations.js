// Draws a snapshot's annotations onto its picture (for the PDF). Pure projection from the snapshot's own saved
// camera, so it needs neither the viewer nor the model. Numbers match the list the PDF prints under the picture.
import * as THREE from "three";

// Pixel position of a world point seen from view.camera on a w x h picture, or null when behind the camera / off the near-far range.
export function projectAtCapture(view, w, h, point) {
  const c = view?.camera;
  if (!c) return null;
  const cam = new THREE.PerspectiveCamera(c.fov || 50, w / h, 0.01, 1e6);
  cam.position.set(...c.position);
  cam.quaternion.set(...c.quaternion);
  cam.updateMatrixWorld(true);
  const ndc = new THREE.Vector3(...point).project(cam);
  if (!(ndc.z > -1 && ndc.z < 1)) return null;
  return { x: (ndc.x * 0.5 + 0.5) * w, y: (-ndc.y * 0.5 + 0.5) * h };
}

export function drawAnnotations(g, w, h, view, annotations) {
  const k = Math.max(1, w / 900); // line and badge size follow the picture size
  const project = (p) => projectAtCapture(view, w, h, p);
  const stroke = (a, pts, width) => {
    g.strokeStyle = a.color; g.lineWidth = width; g.lineCap = g.lineJoin = "round";
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
  };
  const badge = (a, p, n) => {
    g.beginPath(); g.arc(p.x, p.y, 11 * k, 0, Math.PI * 2);
    g.fillStyle = a.color; g.fill(); g.lineWidth = 2 * k; g.strokeStyle = "#fff"; g.stroke();
    g.fillStyle = "#fff"; g.font = `bold ${12 * k}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(n), p.x, p.y + 0.5 * k);
  };
  annotations.forEach((a, i) => {
    const n = i + 1;
    try {
      if (a.type === "arrow") {
        const s = project(a.anchor.point), e = project(a.target.point);
        if (!s || !e) return;
        const ang = Math.atan2(e.y - s.y, e.x - s.x), head = 14 * k;
        const tip = { x: e.x, y: e.y }, base = { x: e.x - Math.cos(ang) * head * 0.8, y: e.y - Math.sin(ang) * head * 0.8 };
        stroke(a, [s, base], 3.5 * k);
        g.fillStyle = a.color;
        g.beginPath(); g.moveTo(tip.x, tip.y);
        g.lineTo(e.x - Math.cos(ang - 0.4) * head, e.y - Math.sin(ang - 0.4) * head);
        g.lineTo(e.x - Math.cos(ang + 0.4) * head, e.y - Math.sin(ang + 0.4) * head);
        g.closePath(); g.fill();
        badge(a, s, n);
      } else if (a.type === "freehand") {
        const pts = a.path.map(project);
        let run = [];
        for (const p of [...pts, null]) { if (p) run.push(p); else { if (run.length > 1) stroke(a, run, 3.5 * k); run = []; } }
        const first = pts.find(Boolean);
        if (first) badge(a, first, n);
      } else {
        const p = project(a.anchor.point);
        if (!p) return;
        if (a.type === "text" && a.text) {
          g.font = `bold ${15 * k}px sans-serif`; g.textAlign = "left"; g.textBaseline = "middle";
          g.lineWidth = 4 * k; g.strokeStyle = "#fff"; g.strokeText(a.text, p.x + 14 * k, p.y);
          g.fillStyle = a.color; g.fillText(a.text, p.x + 14 * k, p.y);
        }
        badge(a, p, n);
      }
    } catch { /* one bad mark must not lose the picture */ }
  });
}

// JPEG data URL of `image` with the annotations on it; the original when there is nothing to draw or anything fails.
export async function burnAnnotations(image, snapshot, quality = 0.85) {
  const list = snapshot?.annotations || [];
  if (!image || !list.length || !snapshot.view?.camera) return image;
  try {
    const img = await new Promise((ok, no) => { const el = new Image(); el.onload = () => ok(el); el.onerror = no; el.src = image; });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0);
    drawAnnotations(g, cv.width, cv.height, snapshot.view, list);
    return cv.toDataURL("image/jpeg", quality);
  } catch { return image; }
}
