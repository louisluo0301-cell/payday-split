import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateRun} from '../src/waterfall.js';
const buckets = [
  {payee:'rent', fixedAmount:300000000n, bps:0, active:true},
  {payee:'tax', fixedAmount:0n, bps:2500, active:true},
  {payee:'save', fixedAmount:0n, bps:1500, active:true},
];
test('default paycheck and retained amount', () => {
  const r = calculateRun(buckets, 1000000000n, 2000000000n, 1000000000n);
  assert.deepEqual(r.splits.map(x=>x.amount),[300000000n,250000000n,150000000n]);
  assert.equal(r.retained,300000000n);
});
test('integer rounding, inactive indices and values beyond JS precision', () => {
  const r = calculateRun([{...buckets[0],active:false}, {...buckets[1],bps:3333}],9007199254740993n,10n**20n,10n**20n);
  assert.equal(r.splits[0].bucketIndex,1);
  assert.equal(r.paid,9007199254740993n*3333n/10000n);
  assert.equal(r.paid+r.retained,9007199254740993n);
});
test('daily, per-run and reserve caps compose with priority', () => {
  const r = calculateRun(buckets,1000000000n,1200000000n,10n**20n,
    {reserve:800000000n,maxPerRun:500000000n,dailyLimit:600000000n},250000000n);
  assert.deepEqual(r.splits.map(x=>x.amount),[300000000n,50000000n]);
});
test('pause, minimum and exact expiry block all payments', () => {
  for(const p of [{paused:true},{minIncome:1000000001n},{validUntil:100n}]) {
    assert.equal(calculateRun(buckets,1000000000n,10n**20n,10n**20n,p,0n,100).paid,0n);
  }
});
test('insufficient allowance skips rent then pays later smaller buckets', () => {
  const r = calculateRun(buckets,1000000000n,10n**20n,250000000n);
  assert.equal(r.splits.length,1);
  assert.equal(r.splits[0].payee,'tax');
});
test('daily limit already exhausted, and reserve above balance', () => {
  assert.equal(calculateRun(buckets,1000n,10n**20n,10n**20n,{dailyLimit:100n},101n).paid,0n);
  assert.equal(calculateRun(buckets,1000n,1000n,10n**20n,{reserve:1001n}).paid,0n);
});
test('funding target partially pays, then skips without blocking later destinations', () => {
  const goals=[{target:350000000n,paid:300000000n}];
  const r=calculateRun(buckets,1000000000n,10n**20n,10n**20n,{},0n,100,goals);
  assert.deepEqual(r.splits.map(x=>x.amount),[50000000n,250000000n,150000000n]);
  assert.equal(goals[0].paid,300000000n,'preview must not mutate progress');
  goals[0].paid=350000000n;
  const funded=calculateRun(buckets,1000000000n,10n**20n,10n**20n,{},0n,100,goals);
  assert.equal(funded.splits[0].bucketIndex,1);
  assert.equal(funded.retained,600000000n);
});
test('goal and spending caps compose without shifting bucket indices', () => {
  const r=calculateRun(buckets,1000000000n,10n**20n,10n**20n,{maxPerRun:100000000n},0n,100,[{target:350000000n,paid:300000000n}]);
  assert.deepEqual(r.splits.map(x=>[x.bucketIndex,x.amount]),[[0,50000000n],[1,50000000n]]);
});
