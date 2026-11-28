import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Interface } from 'ethers';
import { DEPLOYMENT_SESSION, parseTestnetDeployment, verifyTestnetDeployment } from '../src/browser-deployment.js';

const address = n => '0x' + String(n).padStart(40, '0');
const input = {
  chainId: 84532,
  proxy: '0x476F44b11F5C942c58f4c8E3d0300E5710743585',
  token: address(5), split: address(6), reactive: address(7),
  rpcUrl: 'https://example.invalid',
  key: 'example secret field',
};
const parse = values => parseTestnetDeployment(JSON.stringify({ ...input, ...values }));

function health(config) {
  return {
    complete: true,
    snapshot: {
      codes: { token: true, reactive: true, system: true, split: true, proxy: true },
      boundReactive: config.reactive, destinationService: config.proxy,
      reactiveService: '0x8888888888888888888888888888888888888888',
    },
  };
}

function workspaceRPC(config, { answers = {}, noCode = [] } = {}) {
  const opened = [];
  const closed = [];
  const reads = [];
  const outputs = {
    CHAIN_ID: [BigInt(config.chainId)],
    DEST_CHAIN_ID: [BigInt(config.chainId)],
    CONFIG_CONTRACT: [config.split],
    CALLBACK_CONTRACT: [config.split],
    getBuckets: [[]],
    getBucketIds: [[]],
    previewExecution: [[], 0n, 0n],
    allocationModes: [0n],
    ruleVersion: [0n],
    cycleConfigs: [0n, 0n, 0n],
    policies: [0n, 0n, 0n, 0n, 0n, false],
    dailySpend: [0n, 0n],
    getRule: [[], [], [], [], 0n, false],
    userRemaining: [0n],
    decimals: [6n],
    balanceOf: [0n],
    allowance: [0n],
    ...answers,
  };
  function makeReader(url, chainId) {
    opened.push({ url, chainId });
    return {
      code: async token => noCode.includes(token) ? '0x' : '0x6000',
      async call(target, abi, method, args) {
        reads.push({ target, method, args, chainId });
        const codec = new Interface(abi);
        const fragment = codec.getFunction(method);
        assert.ok(['view', 'pure'].includes(fragment.stateMutability));
        codec.encodeFunctionData(fragment, args);
        const output = outputs[method];
        if (output instanceof Error) throw output;
        assert.ok(output, 'Unexpected verification call: ' + method);
        const result = codec.decodeFunctionResult(fragment, codec.encodeFunctionResult(fragment, output));
        return result.length === 1 ? result[0] : result;
      },
      close: () => closed.push(chainId),
    };
  }
  return { makeReader, opened, closed, reads };
}

test('browser import uses configured testnets and known RPC endpoints', () => {
  const config = parse();
  assert.equal(config.rpcUrl, 'https://sepolia.base.org');
  assert.equal(config.chainId, 84532);
  assert.equal(config.key, undefined);
  assert.throws(() => parse({ chainId: 1 }), /choose .*sepolia/i);
  assert.throws(() => parse({ proxy: address(12) }), /proxy does not match/);
  assert.throws(() => parse({ token: address(0) }), /valid default token/);
  assert.equal(DEPLOYMENT_SESSION, 'paydaysplit:testnet-workspace:v2');
});

test('browser import requires readable contracts and the matching Reactive and proxy bindings', async () => {
  const config = parse();
  const report = health(config);
  const { makeReader, opened } = workspaceRPC(config);
  await assert.rejects(verifyTestnetDeployment(config, async () => ({ ...report, complete: false }), makeReader),
    /could not be verified/);
  await assert.rejects(verifyTestnetDeployment(config, async () => ({
    ...report, snapshot: { ...report.snapshot, boundReactive: address(8) },
  }), makeReader), /bindings do not match/);
  assert.deepEqual(opened, []);
});

test('current workspace interfaces accept a legacy one-token config without optional modules', async () => {
  const config = parse();
  const { makeReader, opened, closed, reads } = workspaceRPC(config);
  await verifyTestnetDeployment(config, async () => health(config), makeReader);
  assert.deepEqual(opened, [
    { url: config.rpcUrl, chainId: config.chainId }, { url: config.lasnaRpc, chainId: 5318007 },
  ]);
  assert.deepEqual(closed, [config.chainId, 5318007]);
  assert.deepEqual(reads.find(({ method }) => method === 'getBucketIds'), {
    target: config.split, method: 'getBucketIds', args: [config.split, config.token], chainId: config.chainId,
  });
  assert.ok(reads.every(({ target }) => [config.split, config.reactive, config.token].includes(target)));
});

test('matching fee bindings cannot hide a Reactive route to a different chain or split', async () => {
  const config = parse();
  for (const answers of [{ CHAIN_ID: [11155111n] }, { CALLBACK_CONTRACT: [address(9)] }]) {
    const { makeReader, closed } = workspaceRPC(config, { answers });
    await assert.rejects(verifyTestnetDeployment(config, async () => health(config), makeReader),
      /subscription and callback route do not match/);
    assert.deepEqual(closed, [config.chainId, 5318007]);
  }
});

test('older contracts and inconsistent bucket IDs are rejected before using a wallet', async () => {
  const config = parse();
  const olderContract = Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
  const old = workspaceRPC(config, { answers: { getBucketIds: olderContract } });
  await assert.rejects(verifyTestnetDeployment(config, async () => health(config), old.makeReader),
    /PaydaySplit contract is incompatible.*getBucketIds/);
  assert.deepEqual(old.closed, [config.chainId, 5318007]);
  const inconsistent = workspaceRPC(config, { answers: { getBucketIds: [[1n]] } });
  await assert.rejects(verifyTestnetDeployment(config, async () => health(config), inconsistent.makeReader),
    /plan and preview responses do not match/);
});

test('every selectable asset must expose supported ERC-20 views', async () => {
  const additionalToken = address(15);
  const config = parse({ assets: [{ id: 'second', token: additionalToken }] });
  const missing = workspaceRPC(config, { noCode: [additionalToken] });
  await assert.rejects(verifyTestnetDeployment(config, async () => health(config), missing.makeReader),
    /Asset second has no token contract/);
  const unsupported = workspaceRPC(config, { answers: { decimals: [37n] } });
  await assert.rejects(verifyTestnetDeployment(config, async () => health(config), unsupported.makeReader),
    /unsupported token precision/);
  const available = workspaceRPC(config);
  await verifyTestnetDeployment(config, async () => health(config), available.makeReader);
  assert.deepEqual(available.reads.filter(({ target }) => target === additionalToken).map(({ method }) => method),
    ['decimals', 'balanceOf', 'allowance']);
});

test('an unavailable RPC is reported separately from contract incompatibility', async () => {
  const config = parse();
  const outage = Object.assign(new Error('upstream unavailable'), { code: 'TIMEOUT' });
  const { makeReader } = workspaceRPC(config, { answers: { getBucketIds: outage } });
  await assert.rejects(verifyTestnetDeployment(config, async () => health(config), makeReader),
    /Could not check PaydaySplit contract.*Retry the testnet RPC check/);
});
