import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePlan} from '../src/plan-backup.js';
const context={chainId:11155111,token:'0x0000000000000000000000000000000000000000',decimals:6};
const plan=()=>({schema:'paydaysplit.plan',version:1,...context,
  buckets:[{label:'Rent',payee:'0x0000000000000000000000000000000000000001',fixed:'300',bps:'0',active:true}],
  policy:{reserve:'200',maxPerRun:'1000',dailyLimit:'3000',minIncome:'10',validUntil:'0',paused:false},goalTargets:['3000']});
test('plan round-trip preserves amounts and strips unrecognized sensitive fields',()=>{
  const p=plan(); p.privateKey='do-not-import'; p.paid='99999'; p.policy.allowance='9999';
  const r=parsePlan(JSON.stringify(p),context);
  assert.equal(r.buckets[0].fixed,'300'); assert.equal(r.goalTargets[0],'3000');
  assert.equal(r.privateKey,undefined); assert.equal(r.paid,undefined); assert.equal(r.policy.allowance,undefined);
});
test('rejects mismatched network, token, precision and unsupported schema',()=>{
  for(const patch of [{chainId:1},{token:'0x0000000000000000000000000000000000000001'},{decimals:18},{version:99}]) {
    assert.throws(()=>parsePlan(JSON.stringify({...plan(),...patch}),context));
  }
});
test('rejects numeric amounts, excessive precision, negative amounts and uint96 overflow',()=>{
  for(const bad of [300,'0.0000001','-1',String(2n**96n),'NaN']) {
    const p=plan(); p.buckets[0].fixed=bad;
    assert.throws(()=>parsePlan(JSON.stringify(p),context));
  }
});
test('rejects excessive allocations, invalid flags, expiry and oversized input',()=>{
  const percentage=plan(); percentage.buckets[0].bps='100.01';
  const flags=plan(); flags.buckets[0].active='true';
  const total=plan(); total.buckets[0].bps='60'; total.buckets.push({...total.buckets[0]}); total.goalTargets.push('0');
  const expiry=plan(); expiry.policy.validUntil='999999999999999';
  const goals=plan(); goals.goalTargets=[];
  for(const p of [percentage,flags,total,expiry,goals]) assert.throws(()=>parsePlan(JSON.stringify(p),context));
  assert.throws(()=>parsePlan(' '.repeat(50001),context));
});
