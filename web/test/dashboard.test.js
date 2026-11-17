import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';

test('demo dashboard boots, saves controls, respects pause and manages allowance', async () => {
  const window = new Window({url:'http://localhost/?demo=1'});
  window.document.write(await readFile(new URL('../index.html', import.meta.url),'utf8'));
  for (const key of ['window','document','location','localStorage','navigator','HTMLElement']) {
    Object.defineProperty(globalThis,key,{value: key === 'window' ? window : window[key], configurable:true});
  }
  globalThis.fetch = async () => ({ok:false});
  const originalInterval = globalThis.setInterval;
  const intervals = [];
  globalThis.setInterval = (...args) => { const id = originalInterval(...args); id.unref(); intervals.push(id); return id; };
  try {
    await import('../src/main.js');
    const $ = s => window.document.querySelector(s);
    assert.match($('#network-label').textContent,/Demo/);
    assert.equal($('#buckets-list').children.length,3);
    assert.ok($('.activity-group'), 'initial sample run renders');
    $('#policy-paused').checked = true;
    $('#save-policy').click();
    assert.match($('#policy-status').textContent,/Demo controls saved/);
    $('#faucet-btn').click();
    assert.match($('.activity-group').textContent,/1,000|1000/);
    $('#policy-paused').checked = false;
    $('#policy-maxPerRun').value = '400';
    $('#save-policy').click();
    $('#faucet-btn').click();
    assert.match($('.activity-group').textContent,/\+300\.00/);
    assert.match($('.activity-group').textContent,/\+100\.00/);
    assert.match($('.activity-group').textContent,/600\.00retained/);
    $('#approval-amount').value = '123.45';
    $('#approve-btn').click();
    assert.match($('#allowance-pill').textContent,/123.45/);
    $('#revoke-allowance').click();
    assert.match($('#allowance-pill').textContent,/Allowance —/);
  } finally {
    intervals.forEach(clearInterval);
    globalThis.setInterval = originalInterval;
    await window.happyDOM.abort();
    window.close();
  }
});
