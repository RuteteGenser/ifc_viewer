// WCAG contrast helpers. The maths are pure (unit-tested); `collectText` runs in the page and only reads
// computed styles, so the ratios are computed on the node side from the real, composited colours.

export function parseColor(s) {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)/.exec(s || "");
  if (!m) return null;
  let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a };
}
// `top` over `under` (both opaque result when under is opaque)
export function over(top, under) {
  const a = top.a + under.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t, u) => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}
export function luminance({ r, g, b }) {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function ratio(c1, c2) {
  const a = luminance(c1), b = luminance(c2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// Colours listed top (element itself) to bottom (root); composited over white as a last resort.
export function flatten(chain) {
  let acc = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = parseColor(chain[i]);
    if (c && c.a > 0) acc = over(c, acc);
  }
  return acc;
}
// WCAG "large": >= 24 px, or >= 18.66 px and bold.
export const isLarge = (px, weight) => px >= 24 || (px >= 18.66 && Number(weight) >= 700);

// In the page: every visible element that directly owns text, with the colour chain behind it.
export function collectText() {
  const out = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const path = (el) => {
    const parts = [];
    for (let e = el; e && parts.length < 3 && e !== document.body; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + (e.classList[0] ? "." + e.classList[0] : ""));
    return parts.join(" > ");
  };
  for (const el of document.querySelectorAll("body *")) {
    if (["SCRIPT", "STYLE", "CANVAS", "svg", "path"].includes(el.tagName)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    const isField = el.matches("input:not([type=checkbox]):not([type=radio]):not([type=color]), textarea");
    const placeholder = isField && !el.value ? el.getAttribute("placeholder") : "";
    if (!own && !placeholder) continue;
    if (!visible(el)) continue;
    if (el.closest("[aria-hidden=true]") && !el.closest(".top-bar__caption")) { /* decorative duplicates are still read by sighted users */ }
    const cs = getComputedStyle(el);
    const chain = [];
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) {
      const c = getComputedStyle(e);
      chain.push(c.backgroundColor);
      opacity *= Number(c.opacity);
      if (e === document.documentElement) break;
    }
    const target = el.closest("button, a, input, [role=button], [role=tab]");
    out.push({
      text: (placeholder || own).slice(0, 40),
      where: path(el),
      fg: placeholder ? getComputedStyle(el, "::placeholder").color : cs.color,
      chain,
      opacity,
      size: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      disabled: !!(target && (target.disabled || target.getAttribute("aria-disabled") === "true")),
      placeholder: !!placeholder,
    });
  }
  return out;
}

// Ratios for everything collectText found; returns rows sorted worst first.
export function rate(rows) {
  return rows
    .map((r) => {
      const bg = flatten(r.chain);
      let fg = parseColor(r.fg) || { r: 0, g: 0, b: 0, a: 1 };
      fg = { ...fg, a: fg.a * r.opacity };
      const eff = over(fg, bg);
      const need = isLarge(r.size, r.weight) ? 3 : 4.5;
      return { ...r, ratio: ratio(eff, bg), need };
    })
    .sort((a, b) => a.ratio - b.ratio);
}
