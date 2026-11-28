import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { AbiCoder, Interface, ZeroAddress, keccak256 } from 'ethers';
import { Window } from 'happy-dom';
import { claimedIncome, groupWaterfallEvents, incomeKeys, incomeTransfers, matchedPayout } from '../src/income-evidence.js';
import { createIncomeTrace } from '../src/income-trace.js';

const address = n => '0x' + String(n).padStart(40, '0');
const account = address(1);
const token = address(2);
const payer = address(3);
const payee = address(4);
const other = address(5);
const sourceHash = '0x' + 'ab'.repeat(32);
const callbackHash = '0x' + 'bc'.repeat(32);
const reactionHash = '0x' + 'cd'.repeat(32);
const transfer = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);

function log(index, { from = payer, to = account, amount = 1_000_000n, emitter = token } = {}) {
  return { ...transfer.encodeEventLog('Transfer', [from, to, amount]), address: emitter, index };
}

const receipt = {
  hash: sourceHash, status: 1, blockNumber: 8, blockHash: '0x' + 'c0'.repeat(32),
  logs: [log(4), log(7, { amount: 25_000_003n })],
};

test('income receipt scopes transfers to the wallet and token and uses the exact event index and amount', () => {
  const mixed = { ...receipt, logs: [
    log(5, { to: other }), log(6, { from: account }), log(8, { emitter: other }),
    log(9, { amount: 0n }), { ...log(10), removed: true }, ...receipt.logs,
  ] };
  const transfers = incomeTransfers(mixed, sourceHash, account, token);
  assert.deepEqual(transfers.map(({ logIndex, amount }) => [logIndex, amount]), [[4, 1_000_000n], [7, 25_000_003n]]);
  const keys = incomeKeys(account, token, transfers[1]);
  assert.equal(keys.destination, keccak256(AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint256', 'uint256'], [account, token, sourceHash, 7],
  )));
  assert.notEqual(incomeKeys(account, token, transfers[0]).reactive, keys.reactive);
  assert.throws(() => incomeTransfers({ ...receipt, status: 0 }, sourceHash, account, token), /did not succeed/);
  assert.throws(() => incomeTransfers(receipt, callbackHash, account, token), /does not match/);
});

test('test income claims identify the direct faucet mint instead of unrelated transfers', () => {
  const amount = 1_000_000_000n;
  const claim = { ...receipt, from: account, to: token, logs: [
    log(4, { amount }),
    log(6, { from: ZeroAddress, amount, emitter: other }),
    log(7, { from: ZeroAddress, amount }),
  ] };
  const expectedHash = '0x' + sourceHash.slice(2).toUpperCase();
  const income = claimedIncome(claim, expectedHash, account, token, amount);
  assert.equal(income.hash, sourceHash);
  assert.equal(income.logIndex, 7);
  assert.equal(income.amount, amount);
  assert.equal(income.from, ZeroAddress);
});

test('test income cannot be confirmed from a pending, reverted, unrelated or ambiguous claim receipt', () => {
  const amount = 1_000_000_000n;
  const mint = log(4, { from: ZeroAddress, amount });
  const claim = { ...receipt, from: account, to: token, logs: [mint] };
  const expectClaim = (result, hash = sourceHash) => claimedIncome(result, hash, account, token, amount);
  assert.throws(() => expectClaim(null), /receipt is unavailable/);
  assert.throws(() => expectClaim({ ...claim, status: 0 }), /did not succeed/);
  assert.throws(() => expectClaim(claim, callbackHash), /does not match/);
  assert.throws(() => expectClaim({ ...claim, from: other }), /not a direct test income claim/);
  assert.throws(() => expectClaim({ ...claim, to: other }), /not a direct test income claim/);
  assert.throws(() => expectClaim({ ...claim, logs: [log(4, { amount })] }), /exactly one mint/);
  assert.throws(() => expectClaim({ ...claim, logs: [log(4, { from: ZeroAddress, amount: amount - 1n })] }), /expected amount/);
  assert.throws(() => expectClaim({ ...claim, logs: [mint, log(5, { from: ZeroAddress, amount })] }), /exactly one mint/);
});

test('two incomes in one callback transaction stay separate, including a retained-only run', () => {
  function event(logIndex, amount) {
    return {
      transactionHash: callbackHash, blockNumber: 10, transactionIndex: 3,
      args: { originTxHash: BigInt(sourceHash), logIndex, version: 7n, amount },
    };
  }
  const split = event(7n, 10_000_000n);
  Object.assign(split.args, { payee, bucketIndex: 0n, paycheck: 25_000_003n });
  const groups = groupWaterfallEvents({
    splits: [split], retained: [event(4n, 1_000_000n), event(7n, 15_000_003n)], skipped: [event(7n, 0n)],
  });
  const [first, second] = incomeTransfers(receipt, sourceHash, account, token);
  assert.equal(groups.length, 2);
  assert.equal(matchedPayout(groups, first).version, 7);
  assert.equal(matchedPayout(groups, first).totalRouted, 0n);
  assert.equal(matchedPayout(groups, second).totalRouted, 10_000_000n);
  assert.equal(matchedPayout(groups, second).skipped, 1);
  assert.equal(matchedPayout(groups, { ...second, amount: 10_000_000n }), null);
});

test('the recovery UI requires an explicit transfer and rechecks processing and the quote', async () => {
  const window = new Window();
  window.document.write(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
  globalThis.document = window.document;
  const $ = selector => document.querySelector(selector);
  let processed = false;
  let quoteAmount = 10_000_000n;
  let reaction = null;
  let groups = [];
  let retryHistoryUnavailable = false;
  const sent = [];
  const notifications = [];
  const provider = {
    send: async method => ({ eth_chainId: '0xaa36a7', eth_blockNumber: '0x10' })[method],
    getBlockNumber: async () => 16,
    getTransactionReceipt: async () => receipt,
  };
  const split = {
    processed: async () => processed,
    ruleVersion: async () => 9n,
    previewExecution: async (_, __, amount) => [[quoteAmount], amount - quoteAmount, 0n],
    getBuckets: async () => [{ payee }],
  };
  const ctx = {
    account, token, chainId: 11155111, decimals: 6, symbol: 'dUSDC', split, provider,
    txLink: hash => `https://sepolia.etherscan.io/tx/${hash}`,
    reactiveTxLink: hash => `https://lasna.reactscan.net/tx/${hash}`,
  };
  const panel = createIncomeTrace({
    $, context: () => ctx,
    readReactive: async () => {
      if (!reaction) throw new Error('reaction unavailable');
      return reaction;
    },
    readActivity: async () => {
      if (!groups) throw new Error('payout logs unavailable');
      return groups;
    },
    readRetries: async () => {
      if (retryHistoryUnavailable) throw new Error('retry logs unavailable');
      return null;
    },
    recover: async (_, income) => { sent.push(income); processed = true; },
    toast: message => notifications.push(message),
  });
  async function until(predicate) {
    for (let i = 0; i < 20; i++) {
      if (predicate()) return;
      await wait(5);
    }
    assert.fail('Income trace did not reach the expected state.');
  }

  try {
    panel.wire();
    $('#trace-hash').value = sourceHash;
    $('#trace-form').dispatchEvent(new window.Event('submit'));
    await until(() => !$('#trace-transfer-row').hidden);
    assert.match($('#trace-status').textContent, /Found 2/);
    assert.equal($('#trace-recover').hidden, true);
    $('#trace-transfer').value = '7';
    $('#trace-transfer').dispatchEvent(new window.Event('change'));
    await until(() => !$('#trace-recover').disabled);
    assert.match($('#trace-steps').textContent, /Could not read callback status/);
    assert.match($('#trace-steps').textContent, /25\.000003 dUSDC/);
    assert.equal($('#trace-steps').children[1].dataset.status, 'unknown');
    assert.equal($('#trace-steps').children[2].dataset.status, 'unprocessed');

    quoteAmount = 12_000_000n;
    reaction = { requested: false };
    $('#trace-recover').click();
    await until(() => !$('#trace-recover').disabled && notifications.length === 1);
    assert.equal(sent.length, 0);
    assert.match($('#trace-preview').textContent, /12\.0 dUSDC routed/);
    assert.match($('#trace-steps').children[1].textContent, /No callback request is recorded/);
    assert.equal($('#trace-steps').children[1].dataset.status, 'unrequested');

    reaction = { requested: true, txHash: null };
    groups = null;
    $('#trace-recover').click();
    await until(() => $('#trace-steps').textContent.includes('marked processed'));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].logIndex, 7);
    assert.equal(sent[0].amount, 25_000_003n);
    assert.equal($('#trace-recover').hidden, true);
    assert.match($('#trace-steps').children[1].textContent, /Callback requested.*link is unavailable/);
    assert.equal($('#trace-steps').children[1].dataset.status, 'done');
    assert.equal($('#trace-steps').children[1].querySelector('a'), null);
    assert.equal($('#trace-steps').children[2].dataset.status, 'incomplete');
    assert.match($('#trace-steps').children[2].textContent, /did not verify payout amounts/);

    reaction = { requested: true, txHash: reactionHash };
    groups = [{
      originHash: sourceHash, logIndex: 7, blockNumber: 10, paycheck: 25_000_003n,
      totalRouted: 12_000_000n, retained: 13_000_003n, skipped: 1, txHash: callbackHash,
    }];
    retryHistoryUnavailable = true;
    panel.open(sourceHash, 7);
    await until(() => $('#trace-steps').children[2]?.dataset.status === 'partial');
    assert.equal($('#trace-steps').children[1].querySelector('a').href, ctx.reactiveTxLink(reactionHash));
    assert.equal($('#trace-steps').children[2].querySelector('a').href, ctx.txLink(callbackHash));
    assert.match($('#trace-steps').children[2].textContent, /12\.0 dUSDC routed.*1 bucket skipped/);
    assert.match($('#trace-steps').children[3].textContent, /Retry history is limited or unavailable/);
    assert.equal($('#trace-recover').hidden, true);
    assert.equal(sent.length, 1);
  } finally {
    await window.close();
    delete globalThis.document;
  }
});
