import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseUnits} from 'ethers';
import {Window} from 'happy-dom';
import {createPlanning} from '../src/planning.js';

test('restored goal drafts survive live bucket ID adoption without importing paid progress', async () => {
  const window=new Window();
  globalThis.document=window.document;
  document.body.innerHTML='<div id="goals-list"></div><div id="goals-status"></div><div id="execution-result"></div><button id="execution-refresh"></button><button id="plan-export"></button><button id="plan-import"></button><textarea id="plan-json"></textarea>';
  const $=s=>document.querySelector(s);
  const token='0x0000000000000000000000000000000000000001';
  const bucket={payee:'0x0000000000000000000000000000000000000002',label:'Savings',fixed:'0',bps:'20',active:true};
  const state={demoMode:false,account:'0x0000000000000000000000000000000000000003',signer:{},decimals:6,symbol:'USDC',buckets:[],dirty:false,ruleVersion:1,samplePaycheck:'1000',cycleConfig:{anchor:0,duration:0,revision:0},
    split:{bucketGoals:async()=>({target:0n,paid:0n,cycle:0n}),previewExecution:async()=>[[],1000000000n,0n]}};
  let planner;
  planner=createPlanning({state,deployment:{token},chainId:31337,$,toast:()=>{},
    bucketFromEditor:b=>({payee:b.payee,fixedAmount:parseUnits(b.fixed,6),bps:Math.round(Number(b.bps)*100),active:b.active}),
    writeBudget:()=>{},writePolicy:()=>{},renderBuckets:()=>planner.sync(),updateSummary:()=>{}});
  try {
    planner.wire();
    $('#plan-json').value=JSON.stringify({schema:'paydaysplit.plan',version:1,chainId:31337,token,decimals:6,buckets:[bucket],
      policy:{reserve:'0',maxPerRun:'0',dailyLimit:'0',minIncome:'0',validUntil:'0',paused:false},goalTargets:['75']});
    $('#plan-import').click();
    assert.equal($('[data-goal="0"]').value,'75');
    // Freshly saved rules return a chain identity and normalized base-unit formatting.
    state.dirty=false;state.ruleVersion=2;
    state.buckets=[{...bucket,id:'12',identityPayee:bucket.payee,fixed:'0.0'}];
    planner.sync();await planner.load();
    assert.equal($('[data-goal="0"]').value,'75');
    assert.match($('.goal-progress').textContent,/0\.0 \/ 0\.0/);
    assert.equal(planner.getGoals()[0].paid,0n);
    // Replacing the payee is a new identity and must discard the old target draft.
    state.buckets[0].payee='0x0000000000000000000000000000000000000004';
    planner.sync();
    assert.equal($('[data-goal="0"]').value,'0.0');
  } finally {await window.happyDOM.abort();window.close();}
});
