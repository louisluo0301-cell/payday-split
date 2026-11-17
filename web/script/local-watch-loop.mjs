// Local auto-watcher: mirrors new BucketsSet events and processes incoming Transfers
// so the Anvil dashboard works with a normal wallet (no second manual command).
//
// Run in a second terminal:
//   cd web && npm run local:watch
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import fs from "node:fs";

const SYSTEM = "0x8888888888888888888888888888888888888888";
const RPC = process.env.LOCAL_RPC || "http://127.0.0.1:8545";
const KEY = process.env.LOCAL_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const deployment = JSON.parse(fs.readFileSync(new URL("../../deployments/31337.json", import.meta.url), "utf8"));

const provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
const user = new Wallet(KEY, provider);

await provider.send("anvil_impersonateAccount", [SYSTEM]);
await provider.send("anvil_setBalance", [SYSTEM, "0x56BC75E2D63100000"]);

const split = new Contract(
  deployment.split,
  [
    "event BucketsSet(address indexed user, address indexed token, uint256 indexed version, address[] payees, uint96[] fixedAmounts, uint16[] bps, bool[] active)",
  ],
  provider,
);
const token = new Contract(
  deployment.token,
  ["event Transfer(address indexed from, address indexed to, uint256 value)"],
  provider,
);
const reactive = new Contract(
  deployment.reactive,
  [
    "function react((uint256 chainId,address contractAddress,uint256 topic0,uint256 topic1,uint256 topic2,uint256 topic3,bytes data,uint256 blockNumber,uint256 opCode,uint256 blockHash,uint256 txHash,uint256 logIndex))",
  ],
  provider,
);
const systemMock = new Contract(
  SYSTEM,
  [
    "function requestCount() view returns (uint256)",
    "function requests(uint256) view returns (uint256 chainId,address recipient,uint64 gasLimit,bytes payload)",
  ],
  provider,
);
const proxy = new Contract(
  deployment.proxy,
  ["function deliver(address recipient, address reactive, bytes payload) returns (bool, bytes)"],
  provider,
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

async function sendFromSystem(to, data) {
  const hash = await provider.send("eth_sendTransaction", [{ from: SYSTEM, to, data, gas: "0x1e8480" }]);
  await provider.waitForTransaction(hash);
}

let lastBlock = 0;
let delivered = 0;
let busy = false;

async function mirrorAllRules() {
  const events = await split.queryFilter(split.filters.BucketsSet(user.address), 0, "latest");
  for (const event of events) {
    await sendFromSystem(deployment.reactive, reactive.interface.encodeFunctionData("react", [toRecord(event)]));
  }
}

async function processNewTransfers() {
  const head = await provider.getBlockNumber();
  if (head <= lastBlock) return;
  const from = lastBlock + 1;
  lastBlock = head;

  const events = await token.queryFilter(token.filters.Transfer(null, user.address), from, "latest");
  for (const event of events) {
    await sendFromSystem(deployment.reactive, reactive.interface.encodeFunctionData("react", [toRecord(event)]));
  }

  const count = Number(await systemMock.requestCount());
  for (let i = delivered; i < count; i++) {
    const request = await systemMock.requests(i);
    const data = proxy.interface.encodeFunctionData("deliver", [
      deployment.split,
      deployment.reactive,
      request.payload,
    ]);
    const hash = await provider.send("eth_sendTransaction", [
      { from: user.address, to: deployment.proxy, data, gas: "0x7a120" },
    ]);
    await provider.waitForTransaction(hash);
  }
  if (count > delivered) {
    console.log(`[local-watch] delivered ${count - delivered} waterfall request(s)`);
    delivered = count;
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await processNewTransfers();
  } catch (err) {
    console.error("[local-watch]", err.shortMessage || err.message);
  } finally {
    busy = false;
  }
}

await mirrorAllRules();
lastBlock = await provider.getBlockNumber();
await processNewTransfers();
console.log("[local-watch] watching", deployment.token, "→", deployment.split);
console.log("[local-watch] press Ctrl+C to stop");
setInterval(tick, 1500);
