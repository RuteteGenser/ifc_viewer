// ULID-like ids: 10 chars of time (ms, 48 bit) + 16 chars of randomness, Crockford base32.
// 26 chars, uppercase, sorts by creation time as a plain string. Monotonic within one generator
// (same millisecond -> the random part is incremented), so ids made in a burst still sort in order.
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ID_LENGTH = 26;
const ID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isId(v) {
  return typeof v === "string" && ID_RE.test(v);
}

function encodeTime(ms) {
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

// now: () => ms since epoch. random: () => float in [0,1) (Math.random-like).
export function createIdGenerator({ now = Date.now, random = Math.random } = {}) {
  let lastTime = -1;
  let lastRand = null;
  return function nextId() {
    const t = Math.min(Math.max(Math.floor(now()), 0), 2 ** 48 - 1);
    if (t === lastTime && lastRand) {
      // increment the 16-digit base32 number by one (carry from the right)
      const d = [...lastRand];
      let i = 15;
      while (i >= 0) {
        const v = ALPHABET.indexOf(d[i]) + 1;
        if (v < 32) { d[i] = ALPHABET[v]; break; }
        d[i] = ALPHABET[0];
        i--;
      }
      lastRand = i < 0 ? lastRand : d.join("");
    } else {
      let r = "";
      for (let i = 0; i < 16; i++) r += ALPHABET[Math.min(31, Math.floor(random() * 32))];
      lastRand = r;
    }
    lastTime = t;
    return encodeTime(t) + lastRand;
  };
}

export const newId = createIdGenerator();

// Time part decoded back to ms (for display or tests).
export function idTime(id) {
  if (!isId(id)) return null;
  let ms = 0;
  for (let i = 0; i < 10; i++) ms = ms * 32 + ALPHABET.indexOf(id[i]);
  return ms;
}
