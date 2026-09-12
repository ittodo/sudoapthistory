import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetLevel} from './cloudflare-health-check.mjs';
test('budget estimate is validated and never mistaken for automatic billing',()=>{
  assert.equal(budgetLevel(''),'unavailable');assert.equal(budgetLevel('6.99'),'normal');
  assert.equal(budgetLevel('7'),'warning');assert.equal(budgetLevel('9'),'critical');
  assert.throws(()=>budgetLevel('-1'));assert.throws(()=>budgetLevel('unknown'));
});
