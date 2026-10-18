// Turns FragmentsModel.getSpatialStructure() into a browsable tree.
//
// The loader returns alternating layers: a "category" node (category set,
// localId null) whose children are the instances of that category (localId
// set, category null), each of which may again have category-node children.
// Example: IFCPROJECT > [project] > IFCSITE > [site] > IFCBUILDING > [building]
// > IFCBUILDINGSTOREY > [storey 1, storey 2] > IFCWALL > [wall, wall, ...].
//
// We flatten that into: Project > Site > Building > Storey > Category group >
// element. The spatial categories below are folded away (their instances sit
// directly under the parent); every other category becomes a group node.
// Pure functions, no React, no async.

export const SPATIAL_CATEGORIES = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
]);

// Node kinds: "spatial" (project/site/building/storey), "group" (a category
// under a spatial node) and "element" (a placed product).
export function buildTree(modelId, raw) {
  const nodes = new Map(); // id -> node
  const make = (partial) => {
    const node = { children: [], leafCount: 0, ...partial, modelId };
    nodes.set(node.id, node);
    return node;
  };

  const instanceNode = (item, category, parentId) => {
    const id = `${modelId}/${item.localId}`;
    const kids = item.children ?? [];
    const node = make({
      id,
      kind: SPATIAL_CATEGORIES.has(category) ? "spatial" : "element",
      category,
      localId: item.localId,
      parentId,
    });
    addCategoryChildren(node, kids);
    return node;
  };

  // `kids` are category nodes. Spatial categories are folded; others make groups.
  const addCategoryChildren = (parent, kids) => {
    const spatial = [];
    const groups = [];
    for (const catNode of kids) {
      const category = catNode.category ?? "";
      const instances = (catNode.children ?? []).filter((c) => c.localId != null);
      if (SPATIAL_CATEGORIES.has(category)) {
        for (const inst of instances) spatial.push(instanceNode(inst, category, parent.id));
      } else if (instances.length > 0) {
        const group = make({
          id: `${modelId}/g/${parent.id}/${category}`,
          kind: "group",
          category,
          localId: null,
          parentId: parent.id,
        });
        for (const inst of instances) group.children.push(instanceNode(inst, category, group.id));
        groups.push(group);
      }
    }
    groups.sort((a, b) => b.children.length - a.children.length || a.category.localeCompare(b.category));
    parent.children.push(...spatial, ...groups);
  };

  // raw is the project category node.
  const rootInstance = raw?.children?.find((c) => c.localId != null);
  let root;
  if (rootInstance) {
    root = instanceNode(rootInstance, raw.category ?? "IFCPROJECT", null);
    root.kind = "spatial";
  } else {
    root = make({ id: `${modelId}/root`, kind: "spatial", category: "IFCPROJECT", localId: null, parentId: null });
    addCategoryChildren(root, raw?.children ?? []);
  }

  // Leaf counts (elements only) and per-group counts, bottom-up.
  const count = (node) => {
    if (node.kind === "element" && node.children.length === 0) {
      node.leafCount = 1;
      return 1;
    }
    let n = node.kind === "element" ? 1 : 0; // an element that also has children counts itself
    for (const c of node.children) n += count(c);
    node.leafCount = n;
    return n;
  };
  count(root);
  return { root, nodes };
}

// Every element localId under a node (the node's own id included when it is an
// element), for hide/show of a whole branch.
export function elementIds(node) {
  const out = [];
  const walk = (n) => {
    if (n.kind === "element" && n.localId != null) out.push(n.localId);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

// For each node id: how many of its elements are currently hidden. One pass.
export function hiddenCounts(root, hiddenSet) {
  const map = new Map();
  const walk = (n) => {
    let h = n.kind === "element" && n.localId != null && hiddenSet.has(n.localId) ? 1 : 0;
    for (const c of n.children) h += walk(c);
    map.set(n.id, h);
    return h;
  };
  walk(root);
  return map;
}

// Element counts per category across the whole model, largest first.
export function categoryCounts(root) {
  const counts = new Map();
  const storeys = [];
  const walk = (n) => {
    if (n.kind === "element") counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
    if (n.kind === "spatial" && n.category === "IFCBUILDINGSTOREY") storeys.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return {
    byCategory: [...counts.entries()].sort((a, b) => b[1] - a[1]),
    storeyCount: storeys.length,
    elementCount: [...counts.values()].reduce((a, b) => a + b, 0),
  };
}
