import test from "node:test";
import assert from "node:assert/strict";
import { buildPriceBands } from "./build-price-bands.mjs";

const row = (i, u, extra = {}) => ({ i, as: `11110-${i}`, a: 85, r: 1, g: "종로구", d: "동", lp: 12, u, ...extra });
const index = d => ({ meta: { years: [2024, 2025], updated: "2026-10-20" }, d });

test("households weight price and turnover without copying complex totals or unknown rows", () => {
  const output = buildPriceBands(index([row(1, 100), row(2, undefined, {tu: 900}), row(3, 20, {up:true})]),
    {1:[8,12],2:[2,3],3:[5,6]}, {1:[10,20],2:[100,200],3:[5,6]});
  const scope = output.scopes.all;
  assert.equal(scope.current.units,100);
  assert.equal(scope.current.marketCapEok,1200);
  assert.deepEqual(scope.liquidity.transactionsByYear,[10,20]);
  assert.deepEqual(scope.coverage.allTransactionsByYear,[115,226]);
  assert.equal(scope.coverage.missingUnitsRows,2);
  assert.equal(output.meta.unitCoverage.unknownRows,2);
  assert.deepEqual(output.scopes["d:종로구|동"].trend.unitsByYear,[100,100]);
});
test("all-unknown household evidence remains explicit and does not discard raw trade coverage", () => {
  const output = buildPriceBands(index([row(1,null)]),{1:[0,12]},{1:[0,5]});
  assert.equal(output.meta.unitCoverage.knownRows,0);
  assert.equal(output.meta.unitCoverage.missingIsZero,false);
  assert.equal(output.scopes.all.coverage.missingUnitsRows,1);
  assert.deepEqual(output.scopes.all.coverage.allTransactionsByYear,[0,5]);
});
