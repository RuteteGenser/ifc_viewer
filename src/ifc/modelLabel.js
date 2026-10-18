// How a loaded model's file name is shown in the lists. The full name stays
// in the title and the accessible name; only the display is shortened.

const EXTENSION = /\.(ifc|ifczip|zip)$/i;
const TRAILING_NOTE = /\s*\(([^()]*)\)\s*$/;

// "Duplex apartment - MEP (buildingSMART sample, CC BY 4.0).ifc"
//   -> { title: "Duplex apartment - MEP", note: "buildingSMART sample, CC BY 4.0" }
export function splitModelName(name) {
  let rest = String(name ?? "").replace(EXTENSION, "").trim();
  let note = "";
  const match = TRAILING_NOTE.exec(rest);
  if (match && match.index > 0) {
    note = match[1].trim();
    rest = rest.slice(0, match.index).trim();
  }
  return { title: rest || String(name ?? ""), note };
}

// Head and tail of a long title, so the end of the name (often the part
// that tells two files apart) stays visible when the head is cut with "...".
export function splitForMiddleEllipsis(title, tailMax = 14) {
  if (title.length <= tailMax + 6) return { head: title, tail: "" };
  const cut = title.lastIndexOf(" ", title.length - 2);
  const at = cut > 0 && title.length - cut <= tailMax + 1 ? cut : title.length - 10;
  return { head: title.slice(0, at), tail: title.slice(at) };
}

const DISCIPLINES = [
  // The second pattern catches names like "duplexMEP", where the code is glued to a word.
  { code: "MEP", label: "Mechanical, electrical and plumbing", test: /\b(mep|hvac|plumbing|electrical|mechanical|riv|rie|vvs)\b|elektro/i, caseTest: /[a-z](MEP|HVAC)(?![A-Za-z])/ },
  { code: "STR", label: "Structure", test: /\b(structur\w*|struct|str|rib)\b|konstruksjon/i },
  { code: "ARC", label: "Architecture", test: /\b(arc|arch|architecture|architectural|ark|arkitekt\w*)\b/i },
];

// ARC, MEP or STR when the file name says so, otherwise nothing.
export function disciplineOf(name) {
  const text = String(name ?? "").replace(EXTENSION, "").replace(/[_]+/g, " ");
  return DISCIPLINES.find((d) => d.test.test(text) || d.caseTest?.test(text)) ?? null;
}
