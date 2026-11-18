// v6 integration check. Requires a fresh script/local-demo.ps1 run; local Anvil only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Contract, JsonRpcProvider} from 'ethers';

const d = JSON.parse(fs.readFileSync(new URL('../../deployments/31337.json', import.meta.url), 'utf8'));
assert.equal(d.rpcUrl, 'http://127.0.0.1:8545');
const provider = new JsonRpcProvider(d.rpcUrl);
assert.equal((await provider.getNetwork()).chainId, 31337n);
assert.match(await provider.send('web3_clientVersion', []), /anvil/i);
const user = await provider.getSigner(d.deployer);
const SYSTEM = '0x8888888888888888888888888888888888888888';
await provider.send('anvil_impersonateAccount', [SYSTEM]);
await provider.send('anvil_setBalance', [SYSTEM, '0x56BC75E2D63100000']);
const systemSigner = await provider.getSigner(SYSTEM);
const token = new Contract(d.token, [
  'function mint(address,uint256)', 'function balanceOf(address) view returns(uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
], user);
const split = new Contract(d.split, [
  'function ruleVersion(address,address) view returns(uint256)',
  'function getBuckets(address,address) view returns((address payee,uint96 fixedAmount,uint16 bps,bool active)[])',
  'function setBucketGoal(address,uint256,uint256,uint96,bool)',
  'function bucketGoals(address,address,uint256,uint256) view returns(uint96 target,uint96 paid,uint64 cycle)',
  'function previewExecution(address,address,uint256) view returns(uint256[] amounts,uint256 retained,uint8 blocked)',
], user);
const reactive = new Contract(d.reactive, [
  'function react((uint256 chainId,address contractAddress,uint256 topic0,uint256 topic1,uint256 topic2,uint256 topic3,bytes data,uint256 blockNumber,uint256 opCode,uint256 blockHash,uint256 txHash,uint256 logIndex))',
], systemSigner);
const system = new Contract(SYSTEM, [
  'function lastRequest() view returns((uint256 chainId,address recipient,uint64 gasLimit,bytes payload))',
], provider);
const proxy = new Contract(d.proxy, ['function deliver(address,address,bytes) returns(bool,bytes)'], user);
const U = 1_000000n;
const version = await split.ruleVersion(d.deployer, d.token);
const buckets = await split.getBuckets(d.deployer, d.token);
assert.equal(buckets.length, 3, 'Use the default fresh demo rule');
const goalTx = await split.setBucketGoal(d.token, 0, version, 350n * U, true);
await goalTx.wait();
const runs = [];
for (const expected of [[300n,250n,150n], [50n,250n,150n], [0n,250n,150n]]) {
  const before = await Promise.all(buckets.map(b => token.balanceOf(b.payee)));
  const mint = await token.mint(d.deployer, 1000n * U);
  const receipt = await mint.wait();
  const preview = await split.previewExecution(d.deployer, d.token, 1000n * U);
  assert.deepEqual([...preview.amounts], expected.map(x => x * U));
  assert.equal(preview.blocked, 0n);
  const event = receipt.logs.find(log => log.address.toLowerCase() === d.token.toLowerCase());
  const record = {chainId:31337, contractAddress:event.address, topic0:BigInt(event.topics[0]),
    topic1:BigInt(event.topics[1]), topic2:BigInt(event.topics[2]), topic3:0n, data:event.data,
    blockNumber:event.blockNumber, opCode:event.topics.length, blockHash:BigInt(event.blockHash),
    txHash:BigInt(event.transactionHash), logIndex:event.index};
  const reactTx = await reactive.react(record); await reactTx.wait();
  const request = await system.lastRequest();
  const callback = await proxy.deliver(d.split, d.reactive, request.payload, {gasLimit:900000});
  await callback.wait();
  const after = await Promise.all(buckets.map(b => token.balanceOf(b.payee)));
  const amounts = after.map((x,i) => x - before[i]);
  assert.deepEqual(amounts, [...preview.amounts], 'Preview must match actual beneficiary balances');
  const replay = await proxy.deliver(d.split, d.reactive, request.payload, {gasLimit:900000});
  await replay.wait();
  assert.deepEqual(await Promise.all(buckets.map(b => token.balanceOf(b.payee))), after);
  runs.push({incomeTx:mint.hash, reactTx:reactTx.hash, callbackTx:callback.hash, replayTx:replay.hash,
    amounts:amounts.map(String), retained:String(preview.retained)});
}
const goal = await split.bucketGoals(d.deployer, d.token, version, 0);
assert.equal(goal.paid, 350n * U);
const evidence = {note:'Disposable local Anvil + MockSystem/MockProxy only. Not public testnet delivery.',
  chainId:31337, token:d.token, split:d.split, ruleVersion:String(version), goalTx:goalTx.hash,
  target:String(goal.target), paid:String(goal.paid), runs, recordedAt:new Date().toISOString()};
fs.writeFileSync(new URL('../../deployments/31337.goals-v6.evidence.json', import.meta.url), JSON.stringify(evidence,null,2));
console.log('PASS: three full callback loops pay rent 300, 50, 0; goal=350; previews match; replays pay nothing.');
provider.destroy();
