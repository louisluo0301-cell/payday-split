import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZeroAddress } from 'ethers';
import { savingsSetupState } from '../src/income-modules.js';

const address = digit => '0x' + digit.repeat(40);
const pool = address('1');
const factory = address('2');
const adapter = address('3');
const config = { aavePool: pool, factory };

test('savings setup pays only through an adapter registered for the configured asset pool', () => {
  assert.deepEqual(savingsSetupState({ factory }), { step: 'unsupported' });
  assert.deepEqual(savingsSetupState(config, null), { step: 'unavailable' });
  assert.deepEqual(savingsSetupState(config, { aave: ZeroAddress }), { step: 'create' });
  assert.deepEqual(savingsSetupState(config, { aave: adapter, pool, registered: ZeroAddress }), { step: 'bind', address: adapter });
  assert.deepEqual(savingsSetupState(config, { aave: adapter, pool, registered: adapter }), { step: 'ready', address: adapter });
  assert.deepEqual(savingsSetupState(config, { aave: adapter, pool: address('4'), registered: adapter }), { step: 'unavailable', address: adapter });
});
