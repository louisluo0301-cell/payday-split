import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createHealthPanel} from '../src/health-panel.js';

test('health notifications deduplicate repeated issues, retain stale failures and announce real recovery',()=>{
  const window=new Window();globalThis.document=window.document;
  document.body.innerHTML='<div id="health-summary"></div><div id="health-scope"></div><div id="health-checked"></div><ul id="health-items"></ul><ol id="health-history"></ol><div id="health-metrics"></div><button id="health-refresh"></button><button id="health-export"></button>';
  const $=s=>document.querySelector(s),messages=[];
  const panel=createHealthPanel({$,toast:message=>messages.push(message),now:()=>1700000000000});
  const issue={id:'reactive-debt',severity:'blocked',title:'Reactive fees are overdue',action:'Fund and settle debt.'};
  const report={status:'blocked',complete:true,scope:'saved-plan',alerts:[issue],snapshot:{checkedAt:'2026-11-18T00:00:00Z'}};
  panel.apply(report);panel.apply(report);panel.apply(report);
  assert.equal(messages.length,1);assert.equal(panel.getHistory().length,1);
  const outage={...report,status:'unavailable',complete:false,alerts:[{id:'read-debt',severity:'warning',title:'Could not read debt',action:'Retry.'}]};
  panel.apply(outage);panel.apply(outage);
  assert.equal(messages.length,2);assert.match($('#health-items').textContent,/Last confirmed: Reactive fees are overdue/);
  assert.ok(!panel.getHistory().some(entry=>entry.message.includes('Resolved')));
  panel.apply({...report,status:'ready',alerts:[]});
  assert.equal(messages.length,3);assert.match(messages[2],/Resolved/);assert.doesNotMatch($('#health-items').textContent,/overdue/);
  panel.apply({...report,status:'ready',alerts:[]});assert.equal(messages.length,3);
  assert.equal($('#health-summary').textContent,'Saved plan checks passed');
  panel.reset();assert.equal(panel.getHistory().length,0);
  window.close();
});
