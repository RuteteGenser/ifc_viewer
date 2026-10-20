// One place for how a length (in metres) is written, so the 3D labels and
// the measurement list always agree: metres with two decimals from a metre
// up, whole millimetres below. Decided on the ROUNDED millimetres, so 0.9996 m
// reads "1.00 m", never "1000 mm". Called on every edit, so crossing a metre
// in either direction switches unit.
export function formatLength(meters) {
  const mm = Math.round(meters * 1000);
  return Math.abs(mm) >= 1000 ? `${meters.toFixed(2)} m` : `${mm} mm`;
}
