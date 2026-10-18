// Generates public/demo/demo-building.ifc: a small three-storey IFC4 mock
// building (walls, slabs, columns, doors, windows, a roof) with names,
// colours and property sets, so every viewer feature has something to act on.
// Run: node scripts/gen-demo-ifc.mjs
import { writeFileSync } from "node:fs";

const lines = [];
let nextId = 0;
const add = (body) => {
  nextId += 1;
  lines.push(`#${nextId}=${body};`);
  return `#${nextId}`;
};
const num = (n) => (Number.isInteger(n) ? `${n}.` : String(+n.toFixed(4)));
const str = (s) => `'${s.replace(/'/g, "''")}'`;
const list = (items) => `(${items.join(",")})`;

// 22-character IFC GlobalIds, deterministic so regenerating gives a stable file.
const GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
let guidCounter = 1000;
const guid = () => {
  let n = BigInt(guidCounter++) * 2654435761n * 40503n;
  let out = "";
  for (let i = 0; i < 22; i += 1) {
    out = GUID_CHARS[Number(n % 64n)] + out;
    n /= 64n;
  }
  return `'${"0" + out.slice(1)}'`;
};

const point = (x, y, z) => add(`IFCCARTESIANPOINT(${list([num(x), num(y), num(z)])})`);
const point2 = (x, y) => add(`IFCCARTESIANPOINT(${list([num(x), num(y)])})`);
const dir = (x, y, z) => add(`IFCDIRECTION(${list([num(x), num(y), num(z)])})`);
const place3 = (x, y, z, ref) =>
  add(`IFCAXIS2PLACEMENT3D(${point(x, y, z)},$,${ref ? dir(ref[0], ref[1], 0) : "$"})`);
const localPlacement = (parent, x, y, z, ref) =>
  add(`IFCLOCALPLACEMENT(${parent ?? "$"},${place3(x, y, z, ref)})`);

const person = add("IFCPERSON($,'Demo','Demo',$,$,$,$,$)");
const organization = add("IFCORGANIZATION($,'Demo',$,$,$)");
const owner = add(`IFCPERSONANDORGANIZATION(${person},${organization},$)`);
const application = add(`IFCAPPLICATION(${organization},'1.0','Demo generator','demo')`);
const history = add(`IFCOWNERHISTORY(${owner},${application},$,.NOCHANGE.,$,$,$,0)`);
const units = add(
  `IFCUNITASSIGNMENT(${list([
    add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"),
    add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
    add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
    add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)"),
  ])})`,
);
const context = add(
  `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${place3(0, 0, 0)},$)`,
);
const bodyContext = add(
  `IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`,
);
const project = add(
  `IFCPROJECT(${guid()},${history},'Demo Building',$,$,$,$,${list([context])},${units})`,
);

// One surface style per element class so the model reads at a glance.
const styleFor = {};
const makeStyle = (key, r, g, b) => {
  const colour = add(`IFCCOLOURRGB($,${num(r)},${num(g)},${num(b)})`);
  const rendering = add(
    `IFCSURFACESTYLERENDERING(${colour},$,$,$,$,$,$,$,.NOTDEFINED.)`,
  );
  styleFor[key] = add(`IFCSURFACESTYLE($,.BOTH.,${list([rendering])})`);
};
makeStyle("wall", 0.93, 0.89, 0.8);
makeStyle("slab", 0.62, 0.62, 0.64);
makeStyle("column", 0.45, 0.47, 0.52);
makeStyle("window", 0.55, 0.78, 0.92);
makeStyle("door", 0.55, 0.36, 0.2);
makeStyle("roof", 0.7, 0.3, 0.24);

// Spatial structure: site > building > three storeys.
const sitePlacement = localPlacement(null, 0, 0, 0);
const site = add(
  `IFCSITE(${guid()},${history},'Demo Site',$,$,${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`,
);
const buildingPlacement = localPlacement(sitePlacement, 0, 0, 0);
const building = add(
  `IFCBUILDING(${guid()},${history},'Demo House',$,$,${buildingPlacement},$,$,.ELEMENT.,$,$,$)`,
);
add(`IFCRELAGGREGATES(${guid()},${history},$,$,${project},${list([site])})`);
add(`IFCRELAGGREGATES(${guid()},${history},$,$,${site},${list([building])})`);

const STOREY_H = 3;
const W = 12; // building footprint, metres (x)
const D = 8; // (y)
const T = 0.3; // wall thickness
const storeyNames = ["Ground floor", "First floor", "Second floor"];
const storeys = storeyNames.map((name, i) => {
  const placement = localPlacement(buildingPlacement, 0, 0, i * STOREY_H);
  const id = add(
    `IFCBUILDINGSTOREY(${guid()},${history},${str(name)},$,$,${placement},$,$,.ELEMENT.,${num(i * STOREY_H)})`,
  );
  return { id, placement, members: [], name };
});
add(`IFCRELAGGREGATES(${guid()},${history},$,$,${building},${list(storeys.map((s) => s.id))})`);

const PSET_NAMES = { IFCWALL: "Wall", IFCSLAB: "Slab", IFCCOLUMN: "Column", IFCWINDOW: "Window", IFCDOOR: "Door", IFCROOF: "Roof" };

// A box element: `at` is the corner of its local frame, `axis` its local x
// direction in plan, and the box spans length (x) x width (y, centred) x height.
function box(storey, ifcClass, styleKey, name, props, { at, axis = [1, 0], length, width, height, predefined = ".NOTDEFINED." }) {
  const profile = add(
    `IFCRECTANGLEPROFILEDEF(.AREA.,$,${add(`IFCAXIS2PLACEMENT2D(${point2(length / 2, 0)},$)`)},${num(length)},${num(width)})`,
  );
  const solid = add(
    `IFCEXTRUDEDAREASOLID(${profile},${place3(0, 0, 0)},${dir(0, 0, 1)},${num(height)})`,
  );
  add(`IFCSTYLEDITEM(${solid},${list([styleFor[styleKey]])},$)`);
  const shape = add(
    `IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',${list([solid])})`,
  );
  const definition = add(`IFCPRODUCTDEFINITIONSHAPE($,$,${list([shape])})`);
  const placement = localPlacement(storey.placement, at[0], at[1], at[2] ?? 0, axis);
  const extra = ifcClass === "IFCDOOR" || ifcClass === "IFCWINDOW" ? `,${num(height)},${num(length)}` : "";
  const predefinedArg = ifcClass === "IFCROOF" || ifcClass === "IFCSLAB" || ifcClass === "IFCCOLUMN" || ifcClass === "IFCWALL" ? `,${predefined}` : "";
  const entity = add(
    `${ifcClass}(${guid()},${history},${str(name)},$,$,${placement},${definition},$${extra}${predefinedArg}${ifcClass === "IFCDOOR" || ifcClass === "IFCWINDOW" ? ",$,$,$" : ""})`,
  );
  const propertyIds = Object.entries(props).map(([key, value]) => {
    const wrapped =
      typeof value === "boolean"
        ? `IFCBOOLEAN(${value ? ".T." : ".F."})`
        : typeof value === "number"
          ? `IFCLENGTHMEASURE(${num(value)})`
          : `IFCLABEL(${str(value)})`;
    return add(`IFCPROPERTYSINGLEVALUE(${str(key)},$,${wrapped},$)`);
  });
  const pset = add(
    `IFCPROPERTYSET(${guid()},${history},${str(`Pset_${PSET_NAMES[ifcClass]}Common`)},$,${list(propertyIds)})`,
  );
  add(`IFCRELDEFINESBYPROPERTIES(${guid()},${history},$,$,${list([entity])},${pset})`);
  storey.members.push(entity);
  return entity;
}

storeys.forEach((storey, level) => {
  const tag = `L${level + 1}`;
  const material = level === 0 ? "Brick" : "Plasterboard";
  const wallProps = { IsExternal: true, FireRating: "REI60", Material: "Brick", Thickness: T };
  const innerProps = { IsExternal: false, FireRating: "EI30", Material: material, Thickness: 0.1 };

  box(storey, "IFCSLAB", "slab", `Floor slab ${tag}`, { IsExternal: false, Thickness: 0.25, Material: "Concrete C30" }, {
    at: [0, D / 2, -0.25], length: W, width: D, height: 0.25, predefined: ".FLOOR.",
  });

  box(storey, "IFCWALL", "wall", `South wall ${tag}`, wallProps, { at: [0, 0, 0], axis: [1, 0], length: W, width: T, height: STOREY_H, predefined: ".STANDARD." });
  box(storey, "IFCWALL", "wall", `North wall ${tag}`, wallProps, { at: [0, D, 0], axis: [1, 0], length: W, width: T, height: STOREY_H, predefined: ".STANDARD." });
  box(storey, "IFCWALL", "wall", `West wall ${tag}`, wallProps, { at: [0, 0, 0], axis: [0, 1], length: D, width: T, height: STOREY_H, predefined: ".STANDARD." });
  box(storey, "IFCWALL", "wall", `East wall ${tag}`, wallProps, { at: [W, 0, 0], axis: [0, 1], length: D, width: T, height: STOREY_H, predefined: ".STANDARD." });
  box(storey, "IFCWALL", "wall", `Partition ${tag}`, innerProps, { at: [6, 0, 0], axis: [0, 1], length: D, width: 0.1, height: STOREY_H, predefined: ".PARTITIONING." });

  [[1, 1], [W - 1, 1], [1, D - 1], [W - 1, D - 1]].forEach(([x, y], i) => {
    box(storey, "IFCCOLUMN", "column", `Column ${tag}-${i + 1}`, { Material: "Steel S355", Section: "HEA 200", LoadBearing: true }, {
      at: [x, y, 0], length: 0.4, width: 0.4, height: STOREY_H, predefined: ".COLUMN.",
    });
  });

  [[2, 0], [8, 0]].forEach(([x], i) => {
    box(storey, "IFCWINDOW", "window", `Window ${tag}-${i + 1}`, { GlazingType: "Double", UValue: 1.1, IsExternal: true }, {
      at: [x, 0, 1], axis: [1, 0], length: 2, width: T + 0.06, height: 1.3,
    });
  });
  box(storey, "IFCWINDOW", "window", `Window ${tag}-3`, { GlazingType: "Double", UValue: 1.1, IsExternal: true }, {
    at: [W, 2, 1], axis: [0, 1], length: 2, width: T + 0.06, height: 1.3,
  });
  box(storey, "IFCDOOR", "door", `Door ${tag}`, { FireRating: "EI30", IsExternal: level === 0, Material: "Oak" }, {
    at: [6, 3, 0], axis: [0, 1], length: 1, width: 0.16, height: 2.1,
  });
});

// Flat roof on top of the last storey.
box(storeys[2], "IFCROOF", "roof", "Roof", { IsExternal: true, Thickness: 0.3, Material: "Bitumen membrane" }, {
  at: [-0.3, D / 2, STOREY_H], length: W + 0.6, width: D + 0.6, height: 0.3, predefined: ".FLAT_ROOF.",
});

storeys.forEach((storey) => {
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},${history},$,$,${list(storey.members)},${storey.id})`);
});

const header = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME('demo-building.ifc','2026-01-01T00:00:00',(''),(''),'','Demo generator','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
`;
writeFileSync(new URL("../public/demo/demo-building.ifc", import.meta.url), `${header}${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`);
console.log(`wrote ${lines.length} entities`);
