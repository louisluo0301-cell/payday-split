import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectDeploymentAsset } from '../src/deployment-assets.js';
import { exportLedger, importRecipients } from '../src/ledger-csv.js';
import { reconcileRetryEvents } from '../src/retry-evidence.js';
import { switchWalletChain, verifyWalletContext } from '../src/wallet-context.js';
import { localAnvilURL } from '../script/local-rpc.mjs';

const address = id => '0x' + id.toString(16).padStart(40, '0');
const hash = id => '0x' + id.toString(16).padStart(64, '0');

test('one legacy deployment can add WETH without sharing the primary asset’s Aave pool', () => {
  const base = { token: address(1), split: address(2), modules: { aavePool: address(3), wrappedNative: address(4) } };
  assert.equal(selectDeploymentAsset(base, null).deployment.modules.aavePool, address(3));
  base.assets = [
    { id: 'weth', token: address(4), label: 'Wrapped ETH' },
    { id: 'duplicate', token: address(4) },
    { id: 'default', token: address(5) },
    { id: 'broken', token: 'not-an-address' },
  ];
  const result = selectDeploymentAsset(base, 'weth');
  assert.deepEqual(result.assets.map(asset => asset.id), ['default', 'weth']);
  assert.equal(result.deployment.token, address(4));
  assert.equal(result.deployment.modules.wrappedNative, address(4));
  assert.equal(result.deployment.modules.aavePool, '');
  const invalid = selectDeploymentAsset(base, 'misspelled');
  assert.equal(invalid.invalid, true);
  assert.equal(invalid.deployment.token, '');
});

test('wallet chain addition still verifies the network and selected account', async () => {
  let chain = '0x1', known = false, accounts = [address(1)];
  const wallet = { async request({ method, params }) {
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_accounts') return accounts;
    if (method === 'wallet_addEthereumChain') { known = true; return; }
    if (method === 'wallet_switchEthereumChain') {
      if (!known) throw { data: { originalError: { code: 4902 } } };
      chain = params[0].chainId;
      return;
    }
    throw new Error('Unexpected request');
  } };
  await assert.rejects(verifyWalletContext(wallet, 31337), /configured network/);
  await switchWalletChain(wallet, 31337, { chainId: '0x7a69' });
  assert.equal(await verifyWalletContext(wallet, 31337), address(1));
  accounts = [address(2)];
  await assert.rejects(verifyWalletContext(wallet, 31337, address(1)), /account changed/);
  accounts = [];
  await assert.rejects(verifyWalletContext(wallet, 31337), /active account/);
});

test('recipient import preserves 18-place amounts and handles commas and quotes', () => {
  const [bucket] = importRecipients('label,address,amount\r\n"Rent, ""Q4""",' + address(1)
    + ',"1,234.000000000000000001"\r\n', 18, 8);
  assert.equal(bucket.label, 'Rent, "Q4"');
  assert.equal(bucket.fixed, '1234.000000000000000001');
  assert.throws(() => importRecipients(address(1) + ',1e3', 18, 8), /amount on line 1/);
  assert.throws(() => importRecipients('address,amount\n"bad,' + address(1) + ',1', 18, 8), /quotes on line 2/);
  assert.throws(() => importRecipients([address(1) + ',1', address(2) + ',1'].join('\n'), 18, 1), /At most 1/);
});

test('ledger records exact units and initial payout identity with spreadsheet-safe labels', () => {
  const csv = exportLedger([{
    txHash: hash(1), blockNumber: 18, version: 2, originHash: hash(2), logIndex: 0,
    splits: [{ payee: address(3), amount: 1_000000000000000001n }], retained: 1n,
  }], { decimals: 18, chainId: 31337, token: address(4), labelFor: () => ' =SUM(1,2)' });
  const [header, payout, remainder] = csv.split('\r\n');
  assert.match(header, /originTxHash,originLogIndex,entry$/);
  assert.ok(payout.includes("\"' =SUM(1,2)\",1.000000000000000001,,chain,31337," + address(4) + ',' + hash(2) + ',0,initial-payout'));
  assert.match(remainder, /0\.000000000000000001,chain,.+,0,initial-retained$/);
});

test('paid retries reconcile only the exact income event and its original callback', () => {
  const income = { hash: hash(1), logIndex: 7, block: 10 };
  const payout = { txHash: hash(2), retained: 40n, totalRouted: 60n };
  const queued = (id, logIndex = 7n, transactionHash = payout.txHash) => ({
    transactionHash, blockNumber: 12,
    args: { id, logIndex, originTxHash: 1n, amount: 20n, bucketIndex: 0n, due: 100n },
  });
  const closed = (id, result, amount = 20n) => ({
    transactionHash: hash(3), blockNumber: 20, args: { id, result, amount },
  });
  const jobs = [queued(1n), queued(2n), queued(3n, 8n), queued(4n, 7n, hash(4))];
  const outcome = reconcileRetryEvents(jobs, [closed(1n, 1n), closed(2n, 4n), closed(3n, 1n)], income, payout);
  assert.deepEqual(outcome.jobs.map(job => job.result), ['paid', 'cancelled']);
  assert.equal(outcome.jobs[0].resultTx, hash(3));
  assert.deepEqual(outcome.totals, { routed: 80n, retained: 20n });
  assert.equal(reconcileRetryEvents(jobs, [closed(1n, 1n, 30n)], income, payout).totals, null);
  assert.equal(reconcileRetryEvents(jobs, [closed(1n, 1n)], income, { ...payout, retained: 10n }).totals, null);
});

test('local relay refuses non-loopback endpoints and path or credential overrides', () => {
  assert.equal(localAnvilURL('http://127.0.0.1:18673/'), 'http://127.0.0.1:18673');
  for (const invalid of ['https://127.0.0.1:8545', 'http://example.com:8545', 'http://a@127.0.0.1:8545',
    'http://127.0.0.1:8545/rpc', 'http://127.0.0.1:8545/?fork=1']) {
    assert.throws(() => localAnvilURL(invalid), /loopback/);
  }
});
