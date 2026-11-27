import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updateWalletAllowance } from '../src/wallet-allowance.js';

const receipt = blockNumber => ({ status: 1, blockNumber });

function fixture(allowances, receipts, { requested = 17n, afterBlock = 100 } = {}) {
  const calls = [];
  const provider = {
    async send(method, [block]) {
      assert.equal(method, 'eth_getBlockByNumber');
      return { number: block === 'latest' ? '0x63' : block, timestamp: '0x1' };
    },
  };
  const token = {
    async allowance(account, spender, { blockTag }) {
      assert.equal(account, 'wallet');
      assert.equal(spender, 'split');
      calls.push(['allowance', Number(blockTag)]);
      return allowances.shift();
    },
  };
  const update = () => updateWalletAllowance({
    provider, token, account: 'wallet', splitAddress: 'split', requested, afterBlock,
    onReset: () => calls.push(['reset']),
    submit: async amount => { calls.push(['submit', amount]); return receipts.shift(); },
  });
  return { update, calls };
}

test('replacing a current allowance verifies its reset and reports the amount visible after confirmation', async () => {
  const { update, calls } = fixture([12n, 0n, 14n], [receipt(101), receipt(102)]);
  assert.deepEqual(await update(), { allowance: 14n, blockNumber: 102, receipt: receipt(102) });
  assert.deepEqual(calls, [
    ['allowance', 100], ['reset'], ['submit', 0n], ['allowance', 101], ['submit', 17n], ['allowance', 102],
  ]);
});

test('a successful zero-reset receipt alone cannot enable a replacement approval', async () => {
  const { update, calls } = fixture([12n, 12n], [receipt(101)]);
  await assert.rejects(update, /current allowance is still nonzero/);
  assert.deepEqual(calls, [['allowance', 100], ['reset'], ['submit', 0n], ['allowance', 101]]);
});

test('an equal current allowance needs no signature and revocation checks the mined state', async () => {
  const equal = fixture([17n], []);
  assert.deepEqual(await equal.update(), { allowance: 17n, blockNumber: 100, receipt: null });
  assert.deepEqual(equal.calls, [['allowance', 100]]);

  const revoke = fixture([17n, 17n], [receipt(101)], { requested: 0n });
  assert.deepEqual(await revoke.update(), { allowance: 17n, blockNumber: 101, receipt: receipt(101) });
  assert.deepEqual(revoke.calls, [['allowance', 100], ['submit', 0n], ['allowance', 101]]);
});
