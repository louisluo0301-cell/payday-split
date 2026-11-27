import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { Interface } from 'ethers';
import { Window } from 'happy-dom';
import { SPLIT_ABI } from '../src/contract-abi.generated.js';
import { createManualPayment } from '../src/manual-payment.js';

const address = digit => '0x' + digit.repeat(40);
const account = address('1');
const token = address('2');
const splitAddress = address('3');
const payee = address('4');
const hash = '0x' + 'ab'.repeat(32);
const replacementHash = '0x' + 'cd'.repeat(32);
const quote = { version: 4n, paid: 7_000_000n, retained: 3_000_000n, payouts: [{ payee, amount: 7_000_000n }] };
const iface = new Interface(SPLIT_ABI);
const log = (name, args, emitter = splitAddress) => ({ ...iface.encodeEventLog(name, args), address: emitter });
const receipt = { hash, from: account, to: splitAddress, status: 1, blockNumber: 12, logs: [
  log('Split', [account, token, payee, 10_000_000n, 5_000_001n, 0n, 4n, 0n, 0n]),
  log('Retained', [account, token, 4_999_999n, 4n, 0n, 0n]),
  log('BucketSkipped', [account, token, 1n, 10_000_000n, 1_000_000n, 1, 4n, 0n, 0n]),
  log('Split', [account, token, payee, 10_000_000n, 4_000_000n, 1n, 4n, 1n, 0n]),
  log('Split', [account, token, payee, 10_000_000n, 1_000_000n, 1n, 4n, 0n, 0n], address('5')),
] };

async function until(predicate) {
  for (let i = 0; i < 30; i++) {
    if (predicate()) return;
    await wait(5);
  }
  assert.fail('Payment dialog did not reach the expected state.');
}

async function createHarness(t, persisted, options = {}) {
  const window = new Window();
  t.after(() => window.close());
  window.document.write(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
  const $ = selector => window.document.querySelector(selector);
  const ctx = {
    account, token, splitAddress, chainId: 11155111, decimals: 6, symbol: 'dUSDC', network: 'Sepolia',
    signer: {},
    txLink: hash => 'https://sepolia.etherscan.io/tx/' + hash,
    provider: { send: async () => '0xaa36a7', getTransactionReceipt: async () => null },
    ...options.context,
  };
  const panel = createManualPayment({
    $, context: () => ctx, readQuote: async () => quote, labelFor: () => 'Rent',
    errorMessage: error => error.message, jumpToTrace() {}, jumpToHistory() {},
    onConfirmation() {}, onTrackingChange() {},
    storage: {
      getItem: key => persisted.get(key), setItem: (key, value) => persisted.set(key, value),
      removeItem: key => persisted.delete(key),
    },
    ...options.actions,
  });
  return { $, ctx, panel, review: () => $('#manual-form').dispatchEvent(new window.Event('submit')) };
}

test('broadcast tracking survives opening the dialog again and a reload, then shows actual receipt amounts', async t => {
  const persisted = new Map();
  let walletCalls = 0;
  const { $, panel, review } = await createHarness(t, persisted, {
    actions: {
      pay: async (_, __, signing) => {
        signing();
        walletCalls++;
        return { transaction: { hash, wait: async () => { throw new Error('RPC unavailable'); } } };
      },
    },
  });
  panel.open('10');
  review();
  await until(() => !$('#manual-send').disabled);
  assert.match($('#manual-totals').textContent, /7\.0 dUSDC to pay/);
  $('#manual-send').click();
  await until(() => $('#manual-status').textContent.includes('Confirmation is unavailable'));
  assert.equal(walletCalls, 1);
  assert.equal(panel.hasPending(), true);
  assert.equal($('#manual-amount').disabled, true);
  assert.equal($('a[href$="' + hash + '"]').textContent, hash);
  panel.close();
  panel.open('10');
  assert.equal($('#manual-send').textContent, 'Check confirmation');

  const confirmed = [];
  let openedHistory = false;
  const reloaded = await createHarness(t, persisted, {
    context: { provider: { send: async () => '0xaa36a7', getTransactionReceipt: async () => receipt } },
    actions: {
      pay: () => assert.fail('Rechecking a payment cannot send funds'),
      onConfirmation: (_, result) => confirmed.push(result.hash),
      jumpToHistory: () => { openedHistory = true; },
    },
  });
  const page = reloaded.$;
  reloaded.panel.open('10');
  assert.equal(page('#manual-send').textContent, 'Check confirmation');
  page('#manual-send').click();
  await until(() => page('#manual-send').textContent === 'Open history');
  assert.match(page('#manual-totals').textContent, /5\.000001 dUSDC paid · 4\.999999 dUSDC unallocated · 1 bucket skipped/);
  assert.equal(page('#manual-payouts').children.length, 1);
  assert.deepEqual(confirmed, [hash]);
  assert.equal(reloaded.panel.hasPending(), false);
  assert.equal(persisted.size, 0);
  page('#manual-send').click();
  assert.equal(openedHistory, true);
});

test('a changed quote needs a second review, and a wallet cancellation is not shown as a payout', async t => {
  const persisted = new Map();
  let attempts = 0;
  const { $, panel, review } = await createHarness(t, persisted, {
    actions: {
      pay: async () => {
        attempts++;
        if (attempts === 1) return { quote: { ...quote, version: 5n } };
        return { transaction: { hash, wait: async () => {
          throw Object.assign(new Error('Replaced'), {
            code: 'TRANSACTION_REPLACED', reason: 'cancelled', cancelled: true,
            receipt: { ...receipt, hash: replacementHash },
          });
        } } };
      },
      onConfirmation: () => assert.fail('Cancelled payment cannot be confirmed'),
    },
  });
  panel.open('10');
  review();
  await until(() => !$('#manual-send').disabled);
  $('#manual-send').click();
  await until(() => $('#manual-status').textContent.includes('Review the updated payment'));
  assert.equal(attempts, 1);
  assert.equal(panel.hasPending(), false);
  $('#manual-send').click();
  await until(() => $('#manual-status').textContent.includes('replaced or cancelled'));
  assert.equal($('#manual-totals').hidden, true);
  assert.equal($('a[href$="' + replacementHash + '"]').textContent, replacementHash);
  assert.equal($('#manual-send').textContent, 'Review a new payment');
  assert.equal(persisted.size, 0);
});

test('a reverted receipt keeps its reference and cannot erase a newer payment from another tab', async t => {
  const persisted = new Map();
  let reverted = false;
  const { $, panel, review } = await createHarness(t, persisted, {
    context: { provider: {
      send: async () => '0xaa36a7',
      getTransactionReceipt: async () => reverted ? { ...receipt, status: 0, logs: [] } : null,
    } },
    actions: {
      pay: async () => ({ transaction: { hash, wait: async () => null } }),
      onConfirmation: () => assert.fail('Reverted payment cannot be confirmed'),
    },
  });
  panel.open('10');
  review();
  await until(() => !$('#manual-send').disabled);
  $('#manual-send').click();
  await until(() => $('#manual-status').textContent.includes('Confirmation is unavailable'));
  const [key] = persisted.keys();
  persisted.set(key, replacementHash);
  reverted = true;
  $('#manual-send').click();
  await until(() => $('#manual-status').textContent.includes('transaction reverted'));
  assert.equal($('a[href$="' + hash + '"]').textContent, hash);
  assert.equal($('#manual-totals').hidden, true);
  assert.equal(persisted.get(key), replacementHash);
  panel.close();
  panel.open('10');
  assert.equal($('a[href$="' + replacementHash + '"]').textContent, replacementHash);
  assert.equal($('#manual-send').textContent, 'Check confirmation');
});
