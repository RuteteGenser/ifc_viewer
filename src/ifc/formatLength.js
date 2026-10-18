// One place for how a length (in metres) is written, so the 3D labels and
// the measurement list always agree: metres with two decimals from a metre
// up, whole millimetres below.
export function formatLength(meters) {
  return Math.abs(meters) >= 1 ? `${meters.toFixed(2)} m` : `${Math.round(meters * 1000)} mm`;
}
