import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFaucet, readWalletSnapshot } from '../src/wallet-snapshot.js';

test('all wallet reads use one block and include an already confirmed write', async () => {
  const tags = [];
  const value = result => (...args) => { tags.push(args.at(-1).blockTag); return result; };
  const request = [];
  const provider = { async send(method, [block]) {
    assert.equal(method, 'eth_getBlockByNumber');
    request.push(block);
    return { number: block === 'latest' ? '0x64' : block, timestamp: '0x15180' };
  } };
  const split = {
    getBuckets: value([{ active: true }]), ruleVersion: value(3n), getBucketIds: value([12n]),
    allocationModes: value(0n), cycleConfigs: value({}), policies: value({ paused: true }),
    dailySpend: value([1n, 25n]),
  };
  const token = { balanceOf: value(77n), allowance: value(13n) };
  const snapshot = await readWalletSnapshot({ provider, account: 'wallet', token, split, tokenAddress: 'asset', splitAddress: 'split' }, 101);
  assert.deepEqual(request, ['latest', '0x65']);
  assert.deepEqual(tags, Array(9).fill('0x65'));
  assert.equal(snapshot.version, 3n);
  assert.equal(snapshot.allowance, 13n);
  assert.equal(snapshot.timestamp, 86_400);
});

test('a missing receipt block cannot appear as an updated wallet snapshot', async () => {
  const provider = { send: async (_method, [block]) => block === 'latest'
    ? { number: '0x5', timestamp: '0x1' } : null };
  await assert.rejects(readWalletSnapshot({ provider }, 6), /has not reached the confirmed block/);
});

test('the faucet needs readable contract data and uses its actual cooldown', async () => {
  const at = { blockTag: '0x1' };
  const token = { lastFaucetAt: async () => 130n, FAUCET_AMOUNT: async () => 25n, FAUCET_COOLDOWN: async () => 300n };
  assert.deepEqual(await readFaucet(token, 'wallet', at), { amount: 25n, next: 430 });
  assert.equal(await readFaucet({ ...token, FAUCET_COOLDOWN: async () => { throw new Error('No faucet'); } }, 'wallet', at), null);
});
