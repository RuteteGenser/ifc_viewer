// Two non-interactive rings drawn over the 3D view (DOM, pointer-events none, moved with transform only):
//  - the charge ring follows a finger held on the model and fills over the long-press time;
//  - the pin ring marks the point the open context menu belongs to, and stays there until the menu closes.
const SIZE = 52;
const svg = (kind) =>
  `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" aria-hidden="true" focusable="false">` +
  `<circle class="press-ring__fill" cx="26" cy="26" r="24"/>` +
  `<circle class="press-ring__shade" cx="26" cy="26" r="26.5"/>` +
  `<circle class="press-ring__halo" cx="26" cy="26" r="25.5"/>` +
  `<circle class="press-ring__track" cx="26" cy="26" r="22"/>` +
  (kind === "charge" ? `<circle class="press-ring__arc" cx="26" cy="26" r="22" pathLength="100"/>` : `<circle class="press-ring__dot" cx="26" cy="26" r="3"/>`) +
  `</svg>`;

export function createPressRings(container, chargeMs) {
  const make = (kind) => {
    const el = document.createElement("div");
    el.className = `press-ring press-ring--${kind}`;
    el.setAttribute("aria-hidden", "true");
    el.style.setProperty("--press-ms", `${chargeMs}ms`);
    el.innerHTML = svg(kind);
    container.appendChild(el);
    return el;
  };
  const charge = make("charge");
  const pin = make("pin");
  const place = (el, x, y) => {
    const r = container.getBoundingClientRect();
    el.style.transform = `translate(${(x - r.left - SIZE / 2).toFixed(1)}px, ${(y - r.top - SIZE / 2).toFixed(1)}px)`;
  };
  return {
    startCharge(x, y) {
      place(charge, x, y);
      charge.classList.remove("is-on");
      void charge.offsetWidth; // restart the fill animation
      charge.classList.add("is-on");
    },
    stopCharge: () => charge.classList.remove("is-on"),
    showPin(x, y) {
      place(pin, x, y);
      pin.classList.remove("is-hidden");
      pin.classList.add("is-on");
    },
    movePin: (x, y) => place(pin, x, y),
    setPinHidden: (hidden) => pin.classList.toggle("is-hidden", hidden),
    hidePin: () => pin.classList.remove("is-on"),
    isPinOn: () => pin.classList.contains("is-on"),
    dispose() {
      charge.remove();
      pin.remove();
    },
  };
}
