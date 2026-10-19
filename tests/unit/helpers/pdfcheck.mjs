import assert from "node:assert/strict";

const latin = (u8) => Buffer.from(u8).toString("latin1");

/** Parse our own PDF output: every xref entry must point at "N 0 obj"; Size, Count and EOF must agree. */
export function checkStructure(bytes) {
  const s = latin(bytes);
  assert.ok(s.startsWith("%PDF-1.4\n"));
  assert.ok(s.endsWith("%%EOF\n"));
  const sx = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)[1]);
  assert.ok(s.startsWith("xref\n", sx));
  const m = /^xref\n0 (\d+)\n/.exec(s.slice(sx));
  const n = Number(m[1]);
  assert.equal(Number(/\/Size (\d+)/.exec(s.slice(sx))[1]), n);
  const rows = s.slice(sx + m[0].length, sx + m[0].length + 20 * n);
  assert.equal(rows.slice(0, 20), "0000000000 65535 f \n");
  for (let k = 1; k < n; k++) {
    const row = rows.slice(k * 20, k * 20 + 20);
    assert.match(row, /^\d{10} 00000 n \n$/);
    assert.ok(s.startsWith(`${k} 0 obj\n`, Number(row.slice(0, 10))), `xref entry ${k}`);
  }
  const pages = (s.match(/\/Type \/Page /g) || []).length;
  assert.equal(Number(/\/Type \/Pages \/Count (\d+)/.exec(s)[1]), pages);
  return { pages, objects: n, text: s };
}

