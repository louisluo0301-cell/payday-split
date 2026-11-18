import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concat, toBeHex, zeroPadValue, ZeroHash } from 'ethers';
import { CCTP_TESTNET as route, decodeCollection, selectCollection } from '../src/cctp-collection.js';

const wallet = '0x' + '11'.repeat(20);
const otherWallet = '0x' + '22'.repeat(20);
const nonce = '0x' + 'ee'.repeat(32);
const padded = address => zeroPadValue(address, 32);

function message({ destination = route.destinationDomain, payee = wallet, sender = wallet, sourceAsset = route.sourceUsdc, fee = 132n, finality = route.finality } = {}) {
  return concat([
    toBeHex(1, 4), toBeHex(route.sourceDomain, 4), toBeHex(destination, 4), nonce,
    padded(route.messenger), padded(route.messenger), ZeroHash, toBeHex(route.finality, 4), toBeHex(finality, 4),
    toBeHex(1, 4), padded(sourceAsset), padded(payee), toBeHex(10_001_234, 32), padded(sender),
    toBeHex(200, 32), toBeHex(fee, 32), ZeroHash,
  ]);
}

test('CCTP collection reads the exact nonce and net USDC from the signed-message format', () => {
  const result = decodeCollection(message(), wallet);
  assert.deepEqual(result, { nonce, amount: 10_001_234n, fee: 132n, received: 10_001_102n, expiration: 0n });
  const envelope = { messages: [
    { status: 'complete', cctpVersion: 2, message: message({ payee: otherWallet }), attestation: '0x12' },
    { status: 'complete', cctpVersion: 2, message: message(), attestation: '0x34' },
  ] };
  assert.equal(selectCollection(envelope, wallet).attestation, '0x34');
});

test('CCTP collection rejects another wallet, asset, network, finality mode or excess fee', () => {
  for (const options of [
    { sender: otherWallet }, { payee: otherWallet }, { sourceAsset: route.destinationUsdc },
    { destination: 6 }, { fee: 201n }, { finality: 1000 },
  ]) {
    assert.throws(() => decodeCollection(message(options), wallet), /does not match|invalid nonce, amount or fee/);
  }
  assert.throws(() => decodeCollection(message() + 'ff', wallet), /standard CCTP/);
});

test('pending and ambiguous Circle responses leave minting disabled', () => {
  const entry = { status: 'complete', cctpVersion: 2, message: message(), attestation: '0x1234' };
  assert.equal(selectCollection({ messages: [{ ...entry, status: 'pending_confirmations' }] }, wallet), null);
  assert.throws(() => selectCollection({ messages: [entry, entry] }, wallet), /exactly one/);
  assert.throws(() => selectCollection({}, wallet), /invalid message response/);
});
