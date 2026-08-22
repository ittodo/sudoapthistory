import assert from "node:assert/strict";

function indexRelations(relations) {
  const bySite = new Map();
  for (const relation of relations) {
    for (const ref of relation.predecessors) {
      if (!bySite.has(ref.siteKey)) bySite.set(ref.siteKey, []);
      bySite.get(ref.siteKey).push({ role: "predecessor", relation, ref });
    }
    for (const ref of relation.successors) {
      if (!bySite.has(ref.siteKey)) bySite.set(ref.siteKey, []);
      bySite.get(ref.siteKey).push({ role: "successor", relation, ref });
    }
  }
  return bySite;
}

const relation = {
  id: "many-to-many-fixture",
  predecessors: [
    { siteKey: "old-a", scope: "all" },
    { siteKey: "old-b", scope: "partial" },
  ],
  successors: [{ siteKey: "new-a" }, { siteKey: "new-b" }],
};
const indexed = indexRelations([relation]);
assert.equal(indexed.get("old-a")[0].relation.successors.length, 2);
assert.equal(indexed.get("new-a")[0].relation.predecessors.length, 2);
assert.equal(indexed.get("old-b")[0].ref.scope, "partial");
assert.equal(indexed.size, 4);
const shouldHide = (status, scopes) => ["demolished", "rebuilding", "rebuilt"].includes(status) && !scopes.some((scope) => scope === "partial" || scope === "unknown");
assert.equal(shouldHide("rebuilt", ["all"]), true);
assert.equal(shouldHide("rebuilt", ["partial"]), false);
assert.equal(shouldHide("partial_closed", []), false);
console.log("[redevelopment] many-to-many model verified");
