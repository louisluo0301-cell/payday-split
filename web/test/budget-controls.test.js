import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createBudgetControls} from '../src/budget-controls.js';

test('live cycle display and identical save preserve anchor seconds and custom duration', async () => {
  const window=new Window();globalThis.document=window.document;
  document.body.innerHTML='<select id="allocation-mode"><option value="0">Waterfall</option></select><select id="cycle-duration"><option value="0">Manual</option></select><input type="datetime-local" step="1" id="cycle-anchor"><div id="budget-status"></div><button id="save-allocation"></button><button id="save-cycle"></button>';
  const $=s=>document.querySelector(s);
  const state={allocationMode:0,draftAllocationMode:0,cycleConfig:{anchor:1700000007,duration:90000,revision:1},buckets:[],signer:{},busy:false,demoMode:false};
  let saved,finish;
  const complete=new Promise(resolve=>{finish=resolve;});
  state.split={connect:()=>({setCycleConfig:async (...args)=>{saved=args;return {wait:async()=>{}};}})};
  try {
    createBudgetControls({state,deployment:{token:'token'},$,toast:()=>finish(),refresh:async()=>{},update:()=>{},planner:{preview:async()=>{}}}).wire();
    assert.equal($('#cycle-duration').value,'90000');
    assert.equal($('#cycle-anchor').value,new Date(1700000007000).toISOString().slice(0,19));
    $('#save-cycle').click();await complete;
    assert.deepEqual(saved,['token',1700000007,90000]);
  } finally {await window.happyDOM.abort();window.close();}
});
