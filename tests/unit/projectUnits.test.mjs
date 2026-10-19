import test from "node:test";
import assert from "node:assert/strict";
import { readProjectUnits, parseUnitsText } from "../../src/ifc/projectUnits.js";
import { fixtureBytes, fixtureText } from "./helpers/fixtures.mjs";

const enc = (text) => new TextEncoder().encode(text);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12 * Math.max(1, Math.abs(b)), `${a} != ${b}`);

// A unit block in the shape every exporter writes.
const block = ({ length = ".LENGTHUNIT.,$,.METRE.", area = ".AREAUNIT.,$,.SQUARE_METRE.", volume = ".VOLUMEUNIT.,$,.CUBIC_METRE.", mass = "" } = {}) =>
  [
    `#1=IFCSIUNIT(*,${length});`,
    `#2=IFCSIUNIT(*,${area});`,
    `#3=IFCSIUNIT(*,${volume});`,
    mass ? `#4=IFCSIUNIT(*,${mass});` : "",
    `#9=IFCUNITASSIGNMENT((#1,#2,#3${mass ? ",#4" : ""}));`,
  ].join("\n");

test("metres, square metres, cubic metres", () => {
  const u = parseUnitsText(block());
  assert.equal(u.length, "m");
  assert.equal(u.area, "m²");
  assert.equal(u.volume, "m³");
  assert.equal(u.factorToMetre, 1);
  assert.equal(u.known, true);
});

test("MILLI metre: factor 0.001, label mm", () => {
  const u = parseUnitsText(block({ length: ".LENGTHUNIT.,.MILLI.,.METRE." }));
  assert.equal(u.length, "mm");
  near(u.factorToMetre, 0.001);
  near(u.toSI.length, 0.001);
});

test("CENTI and KILO prefixes", () => {
  const cm = parseUnitsText(block({ length: ".LENGTHUNIT.,.CENTI.,.METRE." }));
  assert.equal(cm.length, "cm");
  near(cm.factorToMetre, 0.01);
  const km = parseUnitsText(block({ length: ".LENGTHUNIT.,.KILO.,.METRE." }));
  assert.equal(km.length, "km");
  near(km.factorToMetre, 1000);
});

test("MILLI on SQUARE_METRE / CUBIC_METRE means mm2 / mm3 (Revit convention)", () => {
  const u = parseUnitsText(block({ length: ".LENGTHUNIT.,.MILLI.,.METRE.", area: ".AREAUNIT.,.MILLI.,.SQUARE_METRE.", volume: ".VOLUMEUNIT.,.MILLI.,.CUBIC_METRE." }));
  assert.equal(u.area, "mm²");
  assert.equal(u.volume, "mm³");
  near(u.toSI.area, 1e-6);
  near(u.toSI.volume, 1e-9);
});

test("mass in GRAM and KILO GRAM converts to kg", () => {
  const g = parseUnitsText(block({ mass: ".MASSUNIT.,$,.GRAM." }));
  assert.equal(g.mass, "g");
  near(g.toSI.mass, 0.001);
  const kg = parseUnitsText(block({ mass: ".MASSUNIT.,.KILO.,.GRAM." }));
  assert.equal(kg.mass, "kg");
  near(kg.toSI.mass, 1);
});

test("conversion-based FOOT with an IfcMeasureWithUnit factor", () => {
  const u = parseUnitsText(fixtureText("feet-ifc4.ifc"));
  assert.equal(u.length, "ft");
  near(u.factorToMetre, 0.3048);
});

test("conversion-based INCH from the named table when no measure is given", () => {
  const text = [
    "#1=IFCCONVERSIONBASEDUNIT($,.LENGTHUNIT.,'INCH',$);",
    "#9=IFCUNITASSIGNMENT((#1));",
  ].join("\n");
  const u = parseUnitsText(text);
  assert.equal(u.length, "in");
  near(u.factorToMetre, 0.0254);
});

test("conversion-based unit referencing a milli-metre base multiplies through", () => {
  const text = [
    "#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);",
    "#2=IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(25.4),#1);",
    "#3=IFCCONVERSIONBASEDUNIT($,.LENGTHUNIT.,'inch',#2);",
    "#9=IFCUNITASSIGNMENT((#3));",
  ].join("\n");
  near(parseUnitsText(text).factorToMetre, 0.0254);
});

test("missing unit assignment: assume metres but say it is not known", () => {
  const u = parseUnitsText("#1=IFCWALL('x');");
  assert.equal(u.known, false);
  assert.equal(u.length, "m");
  assert.equal(u.toSI.length, null);
  assert.equal(u.toSI.area, null);
});

test("no bytes at all gives the same unknown-metre answer", () => {
  assert.equal(readProjectUnits(null).known, false);
  assert.equal(readProjectUnits(enc("")).known, false);
});

test("area declared but length missing: area label stays declared, length falls back", () => {
  const u = parseUnitsText("#2=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);\n#9=IFCUNITASSIGNMENT((#2));");
  assert.equal(u.known, false);
  assert.equal(u.area, "m²");
  assert.equal(u.toSI.length, null);
});

test("CRLF line endings and extra whitespace parse the same", () => {
  const text = block({ length: ".LENGTHUNIT.,.MILLI.,.METRE." }).replace(/\n/g, "\r\n");
  const u = parseUnitsText(text.replace("IFCUNITASSIGNMENT((", "IFCUNITASSIGNMENT ( ("));
  assert.equal(u.length, "mm");
});

test("the first unit assignment of a federated file wins", () => {
  const text = block({ length: ".LENGTHUNIT.,.MILLI.,.METRE." }) + "\n" + block({ length: ".LENGTHUNIT.,$,.METRE." }).replace(/#(\d)/g, "#2$1");
  assert.equal(parseUnitsText(text).length, "mm");
});

test("fixtures: mm, m, and units written at the END of the file", () => {
  assert.equal(readProjectUnits(fixtureBytes("mm-ifc2x3.ifc")).length, "mm");
  assert.equal(readProjectUnits(fixtureBytes("m-ifc4.ifc")).length, "m");
  const end = readProjectUnits(fixtureBytes("units-at-end-ifc2x3.ifc"));
  assert.equal(end.length, "mm");
  near(end.factorToMetre, 0.001);
  assert.equal(readProjectUnits(fixtureBytes("no-units-ifc2x3.ifc")).known, false);
});

// A file bigger than two 3 MB slices, with the whole unit block as the last lines
// (as the Clinic samples do). Bytes are passed the way ifczip extraction returns them.
function bigFile(unitText, megabytes = 7) {
  const filler = "#100=IFCCARTESIANPOINT((0.,0.,0.));\n".repeat(Math.ceil((megabytes * 1024 * 1024) / 38));
  return enc(`ISO-10303-21;\nDATA;\n${filler}${unitText}\nENDSEC;\nEND-ISO-10303-21;\n`);
}

test("units at the end of a 7 MB file are found (head+tail slices)", () => {
  const bytes = bigFile(block({ length: ".LENGTHUNIT.,.MILLI.,.METRE." }));
  assert.ok(bytes.length > 6 * 1024 * 1024);
  const u = readProjectUnits(bytes);
  assert.equal(u.length, "mm");
  assert.equal(u.known, true);
});

test("a big file whose unit definitions sit far from the assignment falls back to a full scan", () => {
  // The definition (#1) is at the start, the assignment at the end, filler between.
  const head = "#1=IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.);\n";
  const filler = "#100=IFCCARTESIANPOINT((0.,0.,0.));\n".repeat(Math.ceil((7 * 1024 * 1024) / 38));
  const bytes = enc(`${head}${filler}#9=IFCUNITASSIGNMENT((#1));\n`);
  const u = readProjectUnits(bytes);
  assert.equal(u.length, "cm");
  near(u.factorToMetre, 0.01);
});

test("a big file without any assignment is unknown, not an error", () => {
  const u = readProjectUnits(bigFile(""));
  assert.equal(u.known, false);
});

test("the answer is cached per byte array", () => {
  const bytes = fixtureBytes("mm-ifc2x3.ifc");
  assert.equal(readProjectUnits(bytes), readProjectUnits(bytes));
});

test("garbage bytes never throw", () => {
  assert.equal(readProjectUnits(new Uint8Array([0, 255, 1, 2, 3, 200])).known, false);
});
