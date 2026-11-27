import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceJourney } from '../src/workspace-journey.js';
import { paymentQuoteKey } from '../src/manual-payment.js';

const live = {
  configured: true, hasWallet: true, connected: true, savedActive: 3,
  allowance: 1n, symbol: 'WETH', network: 'Base Sepolia',
};
const checked = { complete: true, status: 'ready', alerts: [] };
const next = changes => workspaceJourney({ ...live, ...changes });

test('the workspace directs users through wallet, destinations and allowance before receiving', () => {
  assert.equal(next({ configured: false, connected: false }).action, 'connect');
  assert.equal(next({ configured: false, connected: false, walletLinked: true }).action, 'deployment');
  assert.equal(next({ demo: true, configured: false, walletLinked: true }).action, 'sample');
  assert.equal(next({ invalidAsset: true, configured: false }).action, 'asset');
  assert.equal(next({ connected: false }).action, 'connect');
  assert.equal(next({ savedActive: 0, allowance: 0n }).action, 'plan');
  assert.equal(next({ dirty: true, report: checked }).action, 'plan');
  assert.equal(next({ policyDirty: true, report: checked }).action, 'spending');
  assert.equal(next({ modeDirty: true, report: checked }).action, 'budget');
  assert.equal(next({ allowance: 0n, report: checked }).action, 'allowance');
  assert.equal(next({ report: checked }).action, 'receive');
});

test('the receive action requires verifiable automation readiness', () => {
  assert.equal(next({ report: null }).action, 'health');
  assert.equal(next({ report: { ...checked, complete: false } }).action, 'health');
  assert.equal(next({ report: { status: 'attention', alerts: [{ id: 'mirror', severity: 'warning' }] } }).action, 'health');
  assert.equal(next({ report: { status: 'blocked', alerts: [{ id: 'plan-paused', severity: 'blocked' }] } }).action, 'spending');
  assert.equal(next({ report: checked, nativeReceiver: true }).action, 'native');
});

test('payment review changes when a raw-unit amount, recipient or plan version changes', () => {
  const quote = { version: 4n, retained: 2n, payouts: [{ payee: '0x1', amount: 1000000000000000001n }] };
  assert.notEqual(paymentQuoteKey(quote), paymentQuoteKey({ ...quote, version: 5n }));
  assert.notEqual(paymentQuoteKey(quote), paymentQuoteKey({ ...quote, payouts: [{ payee: '0x2', amount: quote.payouts[0].amount }] }));
  assert.notEqual(paymentQuoteKey(quote), paymentQuoteKey({ ...quote, payouts: [{ payee: '0x1', amount: 1000000000000000000n }] }));
});
