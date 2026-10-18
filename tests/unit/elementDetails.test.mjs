import test from "node:test";
import assert from "node:assert/strict";
import { buildElementDetails, filterGroups, prettyName, prettyCategory, UNIT_UNKNOWN } from "../../src/ifc/elementDetails.js";
import { parseUnitsText } from "../../src/ifc/projectUnits.js";

const MM = parseUnitsText("#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);\n#2=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);\n#3=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);\n#9=IFCUNITASSIGNMENT((#1,#2,#3));");
const UNKNOWN = parseUnitsText("");
const v = (value, type) => ({ value, type });
const pset = (name, props) => ({ Name: v(name), HasProperties: props });
const qto = (name, qs) => ({ Name: v(name), Quantities: qs });
const prop = (name, nominal) => ({ Name: v(name), NominalValue: nominal });
const quantity = (name, category, key, value) => ({ Name: v(name), _category: v(category), [key]: v(value) });

test("prettyName splits camel case and drops Pset_/Qto_", () => {
  assert.equal(prettyName("Pset_WallCommon"), "Wall Common");
  assert.equal(prettyName("Qto_SlabBaseQuantities"), "Slab Base Quantities");
  assert.equal(prettyName("AcmeFireData"), "Acme Fire Data");
  assert.equal(prettyName(null), "");
});

test("prettyCategory", () => {
  assert.equal(prettyCategory("IFCBUILDINGELEMENTPROXY"), "Building element proxy");
  assert.equal(prettyCategory("IFCWALL"), "Wall");
  assert.equal(prettyCategory(""), "");
});

test("lengths show in the file unit, area and volume convert to SI", () => {
  const d = buildElementDetails({
    IsDefinedBy: [
      qto("Qto_WallBaseQuantities", [
        quantity("Length", "IFCQUANTITYLENGTH", "LengthValue", 4000),
        quantity("NetSideArea", "IFCQUANTITYAREA", "AreaValue", 11.2),
        quantity("NetVolume", "IFCQUANTITYVOLUME", "VolumeValue", 2.24),
        quantity("Openings", "IFCQUANTITYCOUNT", "CountValue", 2),
      ]),
    ],
  }, MM);
  const rows = Object.fromEntries(d.groups[0].rows.map((r) => [r.name, [r.value, r.unit]]));
  assert.deepEqual(rows.Length, ["4000", "mm"]);
  assert.deepEqual(rows.NetSideArea, ["11.2", "m²"]);
  assert.deepEqual(rows.NetVolume, ["2.24", "m³"]);
  assert.deepEqual(rows.Openings, ["2", ""]);
});

test("an undeclared area unit is flagged instead of guessed", () => {
  const d = buildElementDetails({ IsDefinedBy: [qto("Q", [quantity("A", "IFCQUANTITYAREA", "AreaValue", 5)])] }, UNKNOWN);
  assert.equal(d.groups[0].rows[0].unit, UNIT_UNKNOWN);
});

test("booleans read Yes / No; text stays text; 0 and false are kept, empty is dropped", () => {
  const d = buildElementDetails({
    IsDefinedBy: [pset("Pset_WallCommon", [
      prop("IsExternal", v(true, "IFCBOOLEAN")),
      prop("LoadBearing", v(false, "IFCBOOLEAN")),
      prop("Reference", v("Basic Wall:200", "IFCIDENTIFIER")),
      prop("FireRating", v("", "IFCLABEL")),
      prop("Count", v(0, "IFCINTEGER")),
    ])],
  }, MM);
  const rows = Object.fromEntries(d.groups[0].rows.map((r) => [r.name, r.value]));
  assert.equal(rows.IsExternal, "Yes");
  assert.equal(rows.LoadBearing, "No");
  assert.equal(rows.Reference, "Basic Wall:200");
  assert.equal(rows.Count, "0");
  assert.ok(!("FireRating" in rows), "empty value row is hidden");
});

test("property measures: length in file unit, angle in degrees, trimmed decimals", () => {
  const d = buildElementDetails({
    IsDefinedBy: [pset("P", [
      prop("Width", v(200, "IFCPOSITIVELENGTHMEASURE")),
      prop("Slope", v(Math.PI / 6, "IFCPLANEANGLEMEASURE")),
      prop("Ratio", v(0.123456789, "IFCREAL")),
    ])],
  }, MM);
  const rows = Object.fromEntries(d.groups[0].rows.map((r) => [r.name, [r.value, r.unit]]));
  assert.deepEqual(rows.Width, ["200", "mm"]);
  assert.deepEqual(rows.Slope, ["30", "°"]);
  assert.deepEqual(rows.Ratio, ["0.1235", ""]);
});

test("empty property sets and sets with only empty rows are hidden", () => {
  const d = buildElementDetails({
    IsDefinedBy: [pset("Empty", []), pset("OnlyBlank", [prop("A", v("", "IFCLABEL"))]), pset("Good", [prop("A", v("x", "IFCLABEL"))]), { Name: v("Odd") }],
  }, MM);
  assert.deepEqual(d.groups.map((g) => g.name), ["Good"]);
});

test("quantity sets are listed before property sets", () => {
  const d = buildElementDetails({
    IsDefinedBy: [pset("P", [prop("A", v("x", "IFCLABEL"))]), qto("Q", [quantity("L", "IFCQUANTITYLENGTH", "LengthValue", 1)])],
  }, MM);
  assert.deepEqual(d.groups.map((g) => g.kind), ["qto", "pset"]);
});

test("enumeration, list and bounded values", () => {
  const d = buildElementDetails({
    IsDefinedBy: [pset("P", [
      { Name: v("Finish"), EnumerationValues: [v("A"), v("B")] },
      { Name: v("Sizes"), ListValues: [v(1, "IFCINTEGER"), v(2, "IFCINTEGER")] },
      { Name: v("Range"), LowerBoundValue: v(1, "IFCINTEGER"), UpperBoundValue: v(5, "IFCINTEGER") },
    ])],
  }, MM);
  const rows = Object.fromEntries(d.groups[0].rows.map((r) => [r.name, r.value]));
  assert.equal(rows.Finish, "A, B");
  assert.equal(rows.Sizes, "1, 2");
  assert.equal(rows.Range, "1 to 5");
});

test("storey name and elevation in metres, from the file unit", () => {
  const d = buildElementDetails({ ContainedInStructure: [{ Name: v("First"), Elevation: v(3000) }] }, MM);
  assert.equal(d.storey, "First");
  assert.deepEqual(d.storeyElevation, { text: "+3", unit: "m" });
  const neg = buildElementDetails({ ContainedInStructure: [{ Name: v("Basement"), Elevation: v(-2500) }] }, MM);
  assert.equal(neg.storeyElevation.text, "-2.5");
  const none = buildElementDetails({}, MM);
  assert.equal(none.storey, null);
  assert.equal(none.storeyElevation, null);
});

test("materials and classifications", () => {
  const d = buildElementDetails({
    HasAssociations: [
      { _category: v("IFCMATERIAL"), Name: v("Concrete") },
      { _category: v("IFCMATERIALLAYERSETUSAGE"), ForLayerSet: { _category: v("IFCMATERIALLAYERSET"), MaterialLayers: [{ Material: { _category: v("IFCMATERIAL"), Name: v("Brick") } }] } },
      { _category: v("IFCCLASSIFICATIONREFERENCE"), Identification: v("21.1"), Name: v("Walls") },
    ],
  }, MM);
  assert.deepEqual(d.materials.sort(), ["Brick", "Concrete"]);
  assert.deepEqual(d.classifications, [{ text: "21.1 Walls", source: "" }]); // a reference shows id + name
  assert.equal(buildElementDetails({ HasAssociations: [{ _category: v("IFCDOCUMENTREFERENCE"), Name: v("x") }] }, MM).classifications.length, 0);
  const c = buildElementDetails({ HasAssociations: [{ _category: v("IFCCLASSIFICATION"), Name: v("Uniclass"), Source: v("NBS") }] }, MM);
  assert.deepEqual(c.classifications, [{ text: "Uniclass", source: "NBS" }]);
});

test("no data at all gives an empty, valid structure", () => {
  const d = buildElementDetails({}, MM);
  assert.deepEqual([d.groups, d.materials, d.classifications], [[], [], []]);
});

test("filterGroups: by group label, by row label, by value; blank query returns all", () => {
  const groups = buildElementDetails({
    IsDefinedBy: [
      pset("Pset_WallCommon", [prop("FireRating", v("REI60", "IFCLABEL")), prop("Acoustic", v("Rw 45", "IFCLABEL"))]),
      pset("Pset_Other", [prop("Colour", v("Red", "IFCLABEL"))]),
    ],
  }, MM).groups;
  assert.equal(filterGroups(groups, "  ").length, 2);
  assert.equal(filterGroups(groups, "wall")[0].rows.length, 2, "group match keeps all rows");
  const byRow = filterGroups(groups, "fire");
  assert.equal(byRow.length, 1);
  assert.deepEqual(byRow[0].rows.map((r) => r.name), ["FireRating"]);
  assert.equal(filterGroups(groups, "RED")[0].rows[0].name, "Colour");
  assert.equal(filterGroups(groups, "nonsense").length, 0);
});
