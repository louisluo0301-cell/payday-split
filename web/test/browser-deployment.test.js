import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTestnetDeployment, verifyTestnetDeployment } from '../src/browser-deployment.js';

const address = n => '0x' + String(n).padStart(40, '0');
const input = {
  chainId: 84532,
  proxy: '0x476F44b11F5C942c58f4c8E3d0300E5710743585',
  token: address(5), split: address(6), reactive: address(7),
  rpcUrl: 'https://example.invalid',
  key: 'example secret field',
};
const parse = values => parseTestnetDeployment(JSON.stringify({ ...input, ...values }));

test('browser import uses configured testnets and known RPC endpoints', () => {
  const config = parse();
  assert.equal(config.rpcUrl, 'https://sepolia.base.org');
  assert.equal(config.chainId, 84532);
  assert.equal(config.key, undefined);
  assert.throws(() => parse({ chainId: 1 }), /choose .*sepolia/i);
  assert.throws(() => parse({ proxy: address(12) }), /proxy does not match/);
  assert.throws(() => parse({ token: address(0) }), /valid default token/);
});

test('browser import requires readable contracts and the matching Reactive and proxy bindings', async () => {
  const config = parse();
  const snapshot = { codes: { token: true, reactive: true, system: true, split: true, proxy: true },
    boundReactive: config.reactive, destinationService: config.proxy,
    reactiveService: '0x8888888888888888888888888888888888888888' };
  await verifyTestnetDeployment(config, async () => ({ complete: true, snapshot }));
  await assert.rejects(verifyTestnetDeployment(config, async () => ({ complete: false, snapshot })), /could not be verified/);
  await assert.rejects(verifyTestnetDeployment(config, async () => ({
    complete: true, snapshot: { ...snapshot, boundReactive: address(8) },
  })), /bindings do not match/);
});
