// Generates the tiny IFC fixtures the tests use. Deterministic (same bytes on
// every run) and download-free: `node tests/fixtures/generate.mjs`.
// Every storey carries two walls, so each file renders and has selectable parts.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function guid(n) {
  let s = "";
  let v = n * 2654435761 + 12345;
  for (let i = 0; i < 22; i++) {
    s += B64[Math.abs(v) % 64];
    v = Math.floor(v / 64) + (i + 1) * 977 + n;
  }
  return "0123"[n % 4] + s.slice(1); // a valid IFC GUID starts with 0-3
}
const f = (n) => (Number.isInteger(n) ? `${n}.` : String(n));

// opts: schema "IFC2X3"|"IFC4", unit "mm"|"m"|"feet", storeys [{name, elevation}] (in the file's unit),
// wall [length, thickness, height] in the file's unit, geometry (default true), unitsAtEnd, noUnits.
export function buildIfc(opts) {
  const { schema, unit, storeys, wall, geometry = true, unitsAtEnd = false, noUnits = false, name = "Fixture" } = opts;
  const lines = [];
  const tail = [];
  let n = 0;
  const id = () => ++n;
  const add = (text, toTail = false) => {
    const i = id();
    (toTail ? tail : lines).push(`#${i}=${text};`);
    return `#${i}`;
  };

  // Reserve nothing: forward references are legal STEP, so units can be written last.
  const person = add("IFCPERSON($,'Test','Fixture',$,$,$,$,$)");
  const org = add("IFCORGANIZATION($,'Argus tests',$,$,$)");
  const pao = add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = add(`IFCAPPLICATION(${org},'1.0','Argus fixture generator','AFG')`);
  const owner = add(`IFCOWNERHISTORY(${pao},${app},$,.ADDED.,$,$,$,0)`);

  const origin = add("IFCCARTESIANPOINT((0.,0.,0.))");
  const zAxis = add("IFCDIRECTION((0.,0.,1.))");
  const xAxis = add("IFCDIRECTION((1.,0.,0.))");
  const world = add(`IFCAXIS2PLACEMENT3D(${origin},${zAxis},${xAxis})`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},$)`);
  const body = geometry
    ? add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`)
    : null;

  const unitRefs = [];
  if (!noUnits) {
    const toTail = unitsAtEnd;
    if (unit === "feet") {
      const dims = add("IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0)", toTail);
      const metre = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)", toTail);
      const mwu = add(`IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),${metre})`, toTail);
      unitRefs.push(add(`IFCCONVERSIONBASEDUNIT(${dims},.LENGTHUNIT.,'FOOT',${mwu})`, toTail));
    } else {
      unitRefs.push(add(`IFCSIUNIT(*,.LENGTHUNIT.,${unit === "mm" ? ".MILLI." : "$"},.METRE.)`, toTail));
    }
    unitRefs.push(add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)", toTail));
    unitRefs.push(add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)", toTail));
    unitRefs.push(add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)", toTail));
  }
  const assignment = noUnits ? "$" : add(`IFCUNITASSIGNMENT((${unitRefs.join(",")}))`, unitsAtEnd);
  const project = add(`IFCPROJECT('${guid(1)}',${owner},'${name} project',$,$,$,$,(${context}),${assignment})`, unitsAtEnd);

  const placement = (rel, x, y, z) => {
    const p = add(`IFCCARTESIANPOINT((${f(x)},${f(y)},${f(z)}))`);
    const a = add(`IFCAXIS2PLACEMENT3D(${p},$,$)`);
    return add(`IFCLOCALPLACEMENT(${rel},${a})`);
  };
  const sitePl = placement("$", 0, 0, 0);
  const site = add(`IFCSITE('${guid(2)}',${owner},'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = placement(sitePl, 0, 0, 0);
  const building = add(`IFCBUILDING('${guid(3)}',${owner},'Building',$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES('${guid(4)}',${owner},$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES('${guid(5)}',${owner},$,$,${site},(${building}))`);

  const storeyRefs = [];
  let g = 10;
  storeys.forEach((s, i) => {
    const pl = placement(bldPl, 0, 0, s.elevation);
    const st = add(`IFCBUILDINGSTOREY('${guid(g++)}',${owner},'${s.name}',$,$,${pl},$,$,.ELEMENT.,${f(s.elevation)})`);
    storeyRefs.push(st);
    const walls = [];
    for (let w = 0; w < 2; w++) {
      const wallPl = placement(pl, 0, w * wall[0] * 0.75, 0);
      let shape = "$";
      if (geometry) {
        const p2 = add(`IFCCARTESIANPOINT((${f(wall[0] / 2)},${f(wall[1] / 2)}))`);
        const a2 = add(`IFCAXIS2PLACEMENT2D(${p2},$)`);
        const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${a2},${f(wall[0])},${f(wall[1])})`);
        const pos = add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
        const solid = add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zAxis},${f(wall[2])})`);
        const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solid}))`);
        shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
      }
      const type = schema === "IFC4" ? "IFCWALL" : "IFCWALLSTANDARDCASE";
      const extra = schema === "IFC4" ? ",.NOTDEFINED." : "";
      walls.push(add(`${type}('${guid(g++)}',${owner},'Wall ${i + 1}.${w + 1}',$,$,${wallPl},${shape},$${extra})`));
    }
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid(g++)}',${owner},$,$,(${walls.join(",")}),${st})`);
  });
  add(`IFCRELAGGREGATES('${guid(6)}',${owner},$,$,${building},(${storeyRefs.join(",")}))`);

  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('${name}.ifc','2026-01-01T00:00:00',('Argus tests'),('Argus'),'fixture generator','Argus','');`,
    `FILE_SCHEMA(('${schema}'));`,
    "ENDSEC;",
    "DATA;",
    ...lines,
    ...tail,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

export const FIXTURES = {
  "mm-ifc2x3.ifc": buildIfc({ schema: "IFC2X3", unit: "mm", name: "mm", storeys: [{ name: "Ground", elevation: 0 }, { name: "First", elevation: 3000 }, { name: "Roof", elevation: 6250 }], wall: [4000, 200, 2800] }),
  "m-ifc4.ifc": buildIfc({ schema: "IFC4", unit: "m", name: "m", storeys: [{ name: "Ground", elevation: 0 }, { name: "First", elevation: 3.2 }, { name: "Roof", elevation: 6.4 }], wall: [4, 0.2, 2.8] }),
  "feet-ifc4.ifc": buildIfc({ schema: "IFC4", unit: "feet", name: "feet", storeys: [{ name: "Ground", elevation: 0 }, { name: "First", elevation: 10 }, { name: "Roof", elevation: 20 }], wall: [13, 0.65, 9] }),
  "units-at-end-ifc2x3.ifc": buildIfc({ schema: "IFC2X3", unit: "mm", name: "end", unitsAtEnd: true, storeys: [{ name: "Ground", elevation: 0 }, { name: "Upper", elevation: 2800 }], wall: [4000, 200, 2800] }),
  "no-units-ifc2x3.ifc": buildIfc({ schema: "IFC2X3", unit: "mm", name: "nounits", noUnits: true, storeys: [{ name: "Ground", elevation: 0 }], wall: [4, 0.2, 2.8] }),
  "no-geometry-ifc4.ifc": buildIfc({ schema: "IFC4", unit: "m", name: "nogeo", geometry: false, storeys: [{ name: "Ground", elevation: 0 }, { name: "First", elevation: 3 }], wall: [4, 0.2, 2.8] }),
  "empty.ifc": "",
  "not-ifc.txt": "This is just a text file.\nIt has no building in it.\n",
  "not-ifc.ifc": "Hello, this is a plain text note that was named .ifc by mistake.\n",
};
FIXTURES["truncated.ifc"] = FIXTURES["mm-ifc2x3.ifc"].slice(0, 1400);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [file, text] of Object.entries(FIXTURES)) writeFileSync(join(OUT, file), text);
  console.log(`wrote ${Object.keys(FIXTURES).length} fixtures to ${OUT}`);
}
