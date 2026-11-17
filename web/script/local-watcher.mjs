// Local end-to-end harness: mimics the Reactive Network on Anvil.
//
// 1. Mirrors BucketsSet events into the Reactive contract by calling react() from 0x8888.
// 2. Emits a paycheck Transfer and calls react() for it.
// 3. Delivers the request through MockProxy, exactly like the real Callback Proxy.
//
// Run: node script/local-watcher.mjs
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import fs from "node:fs";

const SYSTEM = "0x8888888888888888888888888888888888888888";
const RPC = process.env.LOCAL_RPC || "http://127.0.0.1:8545";
const KEY = process.env.LOCAL_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const deployment = JSON.parse(fs.readFileSync(new URL("../../deployments/31337.json", import.meta.url), "utf8"));

const provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
const user = new Wallet(KEY, provider);

await provider.send("anvil_impersonateAccount", [SYSTEM]);
await provider.send("anvil_setBalance", [SYSTEM, "0x56BC75E2D63100000"]); // 100 ETH for gas
const system = await provider.getSigner(SYSTEM);

const split = new Contract(
  deployment.split,
  [
    "event BucketsSet(address indexed user, address indexed token, uint256 indexed version, address[] payees, uint96[] fixedAmounts, uint16[] bps, bool[] active)",
    "event Split(address indexed user, address indexed token, address indexed payee, uint256 paycheck, uint256 amount, uint256 bucketIndex, uint256 version, uint256 originTxHash, uint256 logIndex)",
    "event Retained(address indexed user, address indexed token, uint256 amount, uint256 version, uint256 originTxHash, uint256 logIndex)",
    "event Retained(address indexed user, address indexed token, uint256 amount, uint256 version, uint256 originTxHash, uint256 logIndex)",
  ],
  provider,
);

const token = new Contract(
  deployment.token,
  [
    "function mint(address,uint256)",
    "function faucet()",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ],
  user,
);

const reactive = new Contract(
  deployment.reactive,
  [
    "function react((uint256 chainId,address contractAddress,uint256 topic0,uint256 topic1,uint256 topic2,uint256 topic3,bytes data,uint256 blockNumber,uint256 opCode,uint256 blockHash,uint256 txHash,uint256 logIndex))",
    "function getRule(address,address) view returns (address[],uint96[],uint16[],bool[],uint256,bool)",
    "function remaining() view returns (uint256)",
  ],
  system,
);

const systemMock = new Contract(
  SYSTEM,
  [
    "function requestCount() view returns (uint256)",
    "function lastRequest() view returns (tuple(uint256 chainId,address recipient,uint64 gasLimit,bytes payload))",
    "function subCount() view returns (uint256)",
  ],
  provider,
);

const proxy = new Contract(
  deployment.proxy,
  ["function deliver(address recipient, address reactive, bytes payload) returns (bool, bytes)"],
  user,
);

function toRecord(log) {
  return {
    chainId: 31337,
    contractAddress: log.address,
    topic0: BigInt(log.topics[0] || 0),
    topic1: BigInt(log.topics[1] || 0),
    topic2: BigInt(log.topics[2] || 0),
    topic3: BigInt(log.topics[3] || 0),
    data: log.data,
    blockNumber: log.blockNumber,
    opCode: log.topics.length,
    blockHash: BigInt(log.blockHash),
    txHash: BigInt(log.transactionHash),
    logIndex: log.index ?? 0,
  };
}

async function mirrorRules() {
  const events = await split.queryFilter(split.filters.BucketsSet(user.address), 0, "latest");
  for (const event of events) {
    const record = toRecord(event);
    const tx = await reactive.react(record);
    await tx.wait();
    console.log(`mirrored BucketsSet ${event.transactionHash}`);
  }
}

async function main() {
  console.log("system subscriptions before:", (await systemMock.subCount()).toString());
  await mirrorRules();

  const rule = await reactive.getRule(user.address, deployment.token);
  console.log(`Lasna rule: buckets=${rule[0].length} version=${rule[4]} subscribed=${rule[5]}`);

  // A paycheck-sized transfer to the user. mint() is owner-only and emits Transfer(0x0, user).
  const before = await token.balanceOf(user.address);
  const tx = await token.mint(user.address, 1000_000000n);
  const receipt = await tx.wait();
  console.log(`paycheck tx ${receipt.hash}`);

  const events = await token.queryFilter(token.filters.Transfer(null, user.address), receipt.blockNumber, "latest");
  const reactHashes = [];
  for (const event of events) {
    const record = toRecord(event);
    const reactTx = await reactive.react(record);
    await reactTx.wait();
    reactHashes.push(reactTx.hash);
    console.log(`react() tx ${reactTx.hash}`);
  }

  const count = await systemMock.requestCount();
  console.log("callback requests:", count.toString());
  const deliverHashes = [];
  if (count > 0n) {
    const request = await systemMock.lastRequest();
    const data = proxy.interface.encodeFunctionData("deliver", [
      deployment.split,
      deployment.reactive,
      request.payload,
    ]);
    const deliverHash = await provider.send("eth_sendTransaction", [
      { from: user.address, to: deployment.proxy, data, gas: "0x7a120" },
    ]);
    await provider.waitForTransaction(deliverHash);
    deliverHashes.push(deliverHash);
    console.log(`deliver tx ${deliverHash}`);
  }

  const after = await token.balanceOf(user.address);
  const saved = await token.balanceOf(deployment.savings);
  console.log(`user balance: ${before} -> ${after}`);
  console.log(`savings balance: ${saved}`);
  console.log("remaining callbacks:", (await reactive.remaining()).toString());

  const splits = await split.queryFilter(split.filters.Split(user.address), 0, "latest");
  const retainedEvents = await split.queryFilter(split.filters.Retained(user.address), 0, "latest");
  console.log(
    "Split events:",
    splits.map((s) => `payee=${s.args.payee} amount=${s.args.amount} tx=${s.transactionHash}`),
  );

  const evidence = {
    note: "Local Anvil harness. Not a testnet deployment.",
    chainId: 31337,
    token: deployment.token,
    split: deployment.split,
    reactive: deployment.reactive,
    proxy: deployment.proxy,
    user: user.address,
    paycheckTx: receipt.hash,
    reactTx: reactHashes,
    deliverTx: deliverHashes,
    amounts: splits.map((s) => s.args.amount.toString()),
    retained: retainedEvents.map((s) => s.args.amount.toString()),
    splitTx: splits.map((s) => s.transactionHash),
    recordedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    new URL("../../deployments/31337.evidence.json", import.meta.url),
    JSON.stringify(evidence, null, 2),
  );
  console.log("evidence written to deployments/31337.evidence.json");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
