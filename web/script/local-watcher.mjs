import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Contract } from 'ethers';
import { createLocalRelay } from './local-relay.mjs';
import { openLocalAnvil } from './local-rpc.mjs';

const deployment = JSON.parse(await readFile(new URL('../../deployments/31337.json', import.meta.url), 'utf8'));
const provider = await openLocalAnvil(deployment);
const relay = await createLocalRelay(deployment);

try {
  const user = await provider.getSigner(deployment.deployer);
  const token = new Contract(deployment.token, ['function mint(address,uint256)', 'function balanceOf(address) view returns(uint256)'], user);
  const split = new Contract(deployment.split, [
    'event Split(address indexed user,address indexed token,address indexed payee,uint256 paycheck,uint256 amount,uint256 bucketIndex,uint256 version,uint256 originTxHash,uint256 logIndex)',
    'event Retained(address indexed user,address indexed token,uint256 amount,uint256 version,uint256 originTxHash,uint256 logIndex)',
  ], provider);
  const before = await token.balanceOf(user.address);
  const receipt = await (await token.mint(user.address, 1000_000000n)).wait();
  const run = await relay.tick();
  const reaction = run.reactions.filter(entry => entry.origin === receipt.hash);
  assert.equal(reaction.length, 1, 'Expected exactly one reaction for the sample transfer.');
  assert.equal(run.callbacks, 1, 'Expected exactly one callback.');
  const [payout, retain] = await Promise.all([
    split.queryFilter(split.filters.Split(user.address, deployment.token), receipt.blockNumber),
    split.queryFilter(split.filters.Retained(user.address, deployment.token), receipt.blockNumber),
  ]);
  const amounts = payout.filter(row => row.args.originTxHash === BigInt(receipt.hash)).map(row => String(row.args.amount));
  const retained = retain.filter(row => row.args.originTxHash === BigInt(receipt.hash)).map(row => String(row.args.amount));
  assert.deepEqual(amounts, ['300000000', '250000000', '150000000']);
  assert.deepEqual(retained, ['300000000']);
  assert.equal(await token.balanceOf(user.address) - before, 300_000000n);
  assert.equal((await relay.tick()).callbacks, 0, 'The relay must not deliver an already recorded request again.');
  const evidence = {
    note: 'Local Anvil harness.',
    chainId: 31337, token: deployment.token, split: deployment.split,
    reactive: deployment.reactive, proxy: deployment.proxy, user: user.address,
    paycheckTx: receipt.hash, reactTx: reaction.map(entry => entry.hash), deliverTx: run.deliveries,
    amounts, retained, splitTx: payout.map(row => row.transactionHash), recordedAt: new Date().toISOString(),
  };
  await writeFile(new URL('../../deployments/31337.evidence.json', import.meta.url), JSON.stringify(evidence, null, 2));
  console.log('Verified 700 dUSDC routed, 300 retained and no duplicate callback.');
} finally {
  relay.close();
  provider.destroy();
}
