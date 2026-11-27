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
    assert.match($('#network-label').textContent,/Simulation/);
    assert.equal($('#hero-demo').hash, '#proof');
    assert.equal($('#workspace-next-action').dataset.action, 'sample');
    const sample = $('#sample-input');
    sample.value = '0';
    sample.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(sample.getAttribute('aria-invalid'), 'true');
    const initialActivity = $('.activity-group').textContent;
    $('#workspace-next-action').click();
    assert.equal($('.activity-group').textContent, initialActivity);
    sample.value = '1000';
    sample.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal($('#sample-error').hidden, true);
    assert.equal($('#buckets-list').children.length,3);
    assert.ok($('.activity-group'), 'initial sample run renders');
    assert.match($('#health-summary').textContent,/Demo checks/);
    $('#trace-sample').click();
    assert.match($('#trace-status').textContent, /simulated/);
    assert.match($('#trace-preview').textContent, /700\.0 dUSDC routed/);
    assert.equal($('#trace-recover').hidden, true);
    assert.match($('#modules-status').textContent, /require a connected wallet/);
    assert.equal($('#retry-toggle').disabled, true);
    assert.equal($('#bridge-burn').disabled, true);
    $('#policy-paused').checked = true;
    $('#save-policy').click();
    assert.match($('#policy-status').textContent,/Demo controls saved/);
    assert.match($('#health-items').textContent,/Sample spending plan is paused/);
    $('#faucet-btn').click();
    assert.match($('.activity-group').textContent,/1,000|1000/);
    $('#policy-paused').checked = false;
    $('#policy-maxPerRun').value = '400';
    $('#save-policy').click();
    assert.doesNotMatch($('#health-items').textContent,/Sample spending plan is paused/);
    $('#faucet-btn').click();
    assert.match($('.activity-group').textContent,/\+300\.00/);
    assert.match($('.activity-group').textContent,/\+100\.00/);
    assert.match($('.activity-group').textContent,/600\.00retained/);
    $('#approval-amount').value = '123.45';
    $('#approve-btn').click();
    assert.match($('#allowance-pill').textContent,/123.45/);
    $('#revoke-allowance').click();
    assert.match($('#allowance-pill').textContent,/Allowance —/);
    assert.match($('#health-items').textContent,/Sample allowance is zero/);
    // Targets count payouts from activation, then prevent repeated bill payments.
    $('#approval-amount').value='10000'; $('#approve-btn').click();
    $('#policy-maxPerRun').value='0'; $('#save-policy').click();
    $('[data-goal="0"]').value='350'; $('[data-save-goal="0"]').click();
    await Promise.resolve();
    $('#faucet-btn').click(); $('#faucet-btn').click(); $('#faucet-btn').click();
    assert.match($('.goal-progress').textContent,/350\.0 \/ 350\.0.*Funded/);
    assert.doesNotMatch($('.activity-group').textContent,/Rentbucket/);
    $('[data-cycle="0"]').checked=true; $('[data-save-goal="0"]').click();
    await Promise.resolve(); $('#faucet-btn').click();
    assert.match($('.goal-progress').textContent,/300\.0 \/ 350\.0.*cycle 2/);
    // Restoring a backup stages new rules and targets without importing paid history.
    $('#plan-json').value=JSON.stringify({schema:'paydaysplit.plan',version:1,chainId:11155111,decimals:6,
      token:'0x0000000000000000000000000000000000000000',
      buckets:[{label:'New savings',payee:'0x0000000000000000000000000000000000000001',fixed:'0',bps:'10',active:true}],
      policy:{reserve:'0',maxPerRun:'200',dailyLimit:'0',minIncome:'0',validUntil:'0',paused:false},goalTargets:['75']});
    $('#plan-import').click();
    assert.equal($('#buckets-list').children.length,1);
    assert.equal($('[data-goal="0"]').value,'75');
    // Equivalent chain formatting must not discard the imported target draft.
    const fixedInput = $('[data-f="fixed"]');
    fixedInput.value='0.0'; fixedInput.dispatchEvent(new window.Event('input',{bubbles:true}));
    assert.equal($('[data-goal="0"]').value,'75');
    assert.match($('.goal-progress').textContent,/0\.0 \/ 0\.0/);
    $('#save-policy').click(); $('[data-save-goal="0"]').click();
    await Promise.resolve(); $('#faucet-btn').click();
    assert.match($('.activity-group').textContent,/\+75\.00/);
    // New templates, pro-rata budgets, stable UI identities and automatic weekly rollover.
    $('[data-preset="balanced"]').click();
    $('#policy-maxPerRun').value='600'; $('#save-policy').click();
    $('#save-allocation').click(); await Promise.resolve();
    $('#faucet-btn').click();
    assert.match($('.activity-group').textContent,/\+300\.00/);
    assert.match($('.activity-group').textContent,/\+180\.00/);
    assert.match($('.activity-group').textContent,/\+120\.00/);
    const realNow=Date.now;
    const anchor=Math.floor(realNow()/60000)*60000;
    try {
      Date.now=()=>anchor;
      $('#cycle-duration').value='604800';
      $('#cycle-anchor').value=new Date(anchor).toISOString().slice(0,16);
      $('#save-cycle').click(); await Promise.resolve();
      $('[data-goal="0"]').value='350'; $('[data-save-goal="0"]').click(); await Promise.resolve();
      $('#faucet-btn').click(); $('#faucet-btn').click(); $('#faucet-btn').click();
      assert.match($('.goal-progress').textContent,/350\.0 \/ 350\.0/);
      assert.equal($('[data-cycle="0"]').disabled,true);
      Date.now=()=>anchor+604800000;
      $('#faucet-btn').click();
      assert.match($('.goal-progress').textContent,/300\.0 \/ 350\.0.*cycle 2/);
      $('[data-down="0"]').click();
      assert.match(window.document.querySelectorAll('.goal-progress')[1].textContent,/300\.0 \/ 350\.0/);
    } finally {Date.now=realNow;}
  } finally {
    intervals.forEach(clearInterval);
    globalThis.setInterval = originalInterval;
    await window.happyDOM.abort();
    window.close();
  }
});
