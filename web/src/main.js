import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  MaxUint256,
  formatUnits,
  getAddress,
  parseUnits,
} from "ethers";
import { calculateRun } from "./waterfall.js";
import { createPlanning } from "./planning.js";

let demoPolicy = {};
let demoSpent = 0n;
let demoDay = Math.floor(Date.now() / 86400000);
let policyDirty = false;

function readPolicyEditor() {
  const policy = {};
  for (const key of ["reserve", "maxPerRun", "dailyLimit", "minIncome"]) {
    const amount = parseUnits(document.querySelector(`#policy-${key}`).value || "0", state.decimals);
    if (amount < 0n || amount >= 2n ** 96n) throw new Error("Spending controls must be non-negative amounts within uint96.");
    policy[key] = amount;
  }
  const expiry = document.querySelector("#policy-expiry").value;
  policy.validUntil = expiry ? BigInt(Math.floor(new Date(expiry).getTime() / 1000)) : 0n;
  policy.paused = document.querySelector("#policy-paused").checked;
  return policy;
}

async function savePolicy() {
  if (state.busy) return;
  try {
    const policy = readPolicyEditor();
    if (state.demoMode) {
      demoPolicy = policy;
      document.querySelector("#policy-status").textContent = "Demo controls saved. The next sample run applies these limits.";
      planner.preview();
      return;
    }
    if (!state.signer) { toast("Connect your wallet to save controls.", true); return; }
    state.busy = true;
    const tx = await state.split.connect(state.signer).setPolicy(deployment.token, policy);
    await tx.wait();
    policyDirty = false;
    await loadPolicy();
    toast("Spending controls confirmed onchain.", false, tx.hash);
  } catch (err) { toast(humanError(err), true); }
  finally { state.busy = false; }
}

async function loadPolicy() {
  try {
    const policy = await state.split.policies(state.account, deployment.token);
    const [day, amount] = await state.split.dailySpend(state.account, deployment.token);
    // Avoid overwriting fields while the user is editing.
    if (!policyDirty && !document.activeElement?.id?.startsWith("policy-")) {
      for (const key of ["reserve", "maxPerRun", "dailyLimit", "minIncome"]) {
        document.querySelector(`#policy-${key}`).value = formatUnits(policy[key], state.decimals);
      }
      document.querySelector("#policy-paused").checked = policy.paused;
      const date = policy.validUntil > 0n ? new Date(Number(policy.validUntil) * 1000) : null;
      document.querySelector("#policy-expiry").value = date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16) : "";
    }
    const spent = Number(day) === Math.floor(Date.now() / 86400000) ? amount : 0n;
    document.querySelector("#policy-status").textContent = `Onchain controls loaded · spent today: ${formatUnits(spent, state.decimals)} ${state.symbol}${policy.paused ? " · PAUSED" : ""}`;
  } catch {
    document.querySelector("#policy-status").textContent = "Controls could not be read. Check the RPC connection and that the deployed contract supports v5.";
  }
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_BUCKETS = 8;

const SPLIT_ABI = [
  "function getBuckets(address user, address token) view returns (tuple(address payee, uint96 fixedAmount, uint16 bps, bool active)[])",
  "function setBuckets(address token, tuple(address payee, uint96 fixedAmount, uint16 bps, bool active)[] buckets)",
  "function disableAll(address token)",
  "function runSplit(address token, uint256 paycheck)",
  "function recoverSplit(address token,uint256 paycheck,uint256 originTxHash,uint256 logIndex)",
  "function previewWaterfall(address user, address token, uint256 paycheck) view returns (address[] payees, uint256[] amounts, uint256 retained)",
  "function bucketCount(address user, address token) view returns (uint256)",
  "function ruleVersion(address user, address token) view returns (uint256)",
  "function reactive() view returns (address)",
  "function setPolicy(address token, tuple(uint96 reserve,uint96 maxPerRun,uint96 dailyLimit,uint96 minIncome,uint64 validUntil,bool paused) policy)",
  "function policies(address user,address token) view returns (uint96 reserve,uint96 maxPerRun,uint96 dailyLimit,uint96 minIncome,uint64 validUntil,bool paused)",
  "function dailySpend(address user,address token) view returns (uint256 day,uint256 amount)",
  "function setBucketGoal(address token,uint256 index,uint256 expectedVersion,uint96 target,bool newCycle)",
  "function bucketGoals(address user,address token,uint256 version,uint256 index) view returns (uint96 target,uint96 paid,uint64 cycle)",
  "function previewExecution(address user,address token,uint256 paycheck) view returns (uint256[] amounts,uint256 retained,uint8 blocked)",
  "event BucketsSet(address indexed user, address indexed token, uint256 indexed version, address[] payees, uint96[] fixedAmounts, uint16[] bps, bool[] active)",
  "event Split(address indexed user, address indexed token, address indexed payee, uint256 paycheck, uint256 amount, uint256 bucketIndex, uint256 version, uint256 originTxHash, uint256 logIndex)",
  "event Retained(address indexed user, address indexed token, uint256 amount, uint256 version, uint256 originTxHash, uint256 logIndex)",
  "event BucketSkipped(address indexed user, address indexed token, uint256 bucketIndex, uint256 paycheck, uint256 requested, uint8 reason, uint256 version, uint256 originTxHash, uint256 logIndex)",
];

const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function faucet()",
  "function lastFaucetAt(address) view returns (uint256)",
  "function FAUCET_AMOUNT() view returns (uint256)",
];

const REACTIVE_ABI = [
  "function remaining() view returns (uint256)",
  "function paused() view returns (bool)",
  "function getRule(address user, address token) view returns (address[] payees, uint96[] fixedAmounts, uint16[] bps, bool[] active, uint256 version, bool subscribed)",
  "function userRemaining(address user, address token) view returns (uint256)",
];

let deployment = {
  chainId: 11155111,
  network: "sepolia",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  explorer: "https://sepolia.etherscan.io",
  lasnaRpc: "https://lasna-rpc.rnk.dev/",
  lasnaExplorer: "https://lasna.reactscan.net",
  token: "",
  split: "",
  reactive: "",
  proxy: "0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4",
};

const params = new URLSearchParams(location.search);
const useLocal = params.has("local");
const demoMode = params.has("demo");
const deploymentFile = useLocal ? "/deployments.local.json" : "/deployments.json";
try {
  const res = await fetch(deploymentFile, { cache: "no-store" });
  if (res.ok) deployment = { ...deployment, ...(await res.json()) };
} catch {
  // Static file is optional; the page still renders in "not deployed" mode.
}

const configured = Boolean(deployment.token && deployment.split);
const chainId = Number(deployment.chainId || 11155111);
const explorer = deployment.explorer || "";
const lasnaExplorer = deployment.lasnaExplorer || "https://lasna.reactscan.net";

const PRESETS = {
  freelancer: [
    { label: "Rent", payee: "0x000000000000000000000000000000000000dEaD", fixed: "300", bps: "", active: true },
    { label: "Tax reserve", payee: "0x000000000000000000000000000000000000bEEF", fixed: "", bps: "25", active: true },
    { label: "Savings", payee: "0x000000000000000000000000000000000000cafE", fixed: "", bps: "15", active: true },
  ],
  team: [
    { label: "Design", payee: "0x000000000000000000000000000000000000dEaD", fixed: "1500", bps: "", active: true },
    { label: "Engineering", payee: "0x000000000000000000000000000000000000bEEF", fixed: "2000", bps: "", active: true },
    { label: "Ops", payee: "0x000000000000000000000000000000000000cafE", fixed: "800", bps: "", active: true },
    { label: "Bonus pool", payee: "0x0000000000000000000000000000000000001234", fixed: "", bps: "10", active: true },
  ],
  simple: [
    { label: "Savings", payee: "0x000000000000000000000000000000000000dEaD", fixed: "", bps: "10", active: true },
  ],
};

const LABELS = {
  "0x000000000000000000000000000000000000dead": "Rent vault",
  "0x000000000000000000000000000000000000beef": "Tax reserve",
  "0x000000000000000000000000000000000000cafe": "Savings",
};

const COLORS = ["#1d6a4a", "#e8bb62", "#8bbf9f", "#b4472f", "#5b7fa8", "#9c7bb5", "#c98b5e", "#6b8e6b"];

const labelKey = `paydaysplit:labels:${chainId}:${deployment.token || "none"}`;
let storedLabels = {};
try {
  storedLabels = JSON.parse(localStorage.getItem(labelKey) || "{}") || {};
} catch {
  storedLabels = {};
}

const state = {
  provider: null,
  signer: null,
  account: null,
  token: null,
  split: null,
  symbol: "dUSDC",
  decimals: 6,
  balance: 0n,
  allowance: 0n,
  buckets: [],
  ruleVersion: 0,
  onchainBucketCount: 0,
  groups: [],
  skips: [],
  activityError: false,
  demoToken: false,
  nextFaucetAt: 0,
  faucetAmount: 0n,
  busy: false,
  dirty: false,
  pollingSplit: false,
  samplePaycheck: 1000,
  labels: storedLabels,
  mode: "personal",
  demoMode,
};

const planner = createPlanning({
  state, deployment, chainId, $, toast, bucketFromEditor, renderBuckets, updateSummary,
  readPolicy: readPolicyEditor,
  getPolicy: () => demoPolicy,
  getSpent: () => Math.floor(Date.now() / 86400000) === demoDay ? demoSpent : 0n,
  writePolicy: (policy) => {
    for (const key of ["reserve","maxPerRun","dailyLimit","minIncome"]) $(`#policy-${key}`).value = policy[key];
    $("#policy-paused").checked = policy.paused;
    const date = BigInt(policy.validUntil) > 0n ? new Date(Number(policy.validUntil) * 1000) : null;
    $("#policy-expiry").value = date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16) : "";
    policyDirty = true;
  },
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function short(addr) {
  if (!addr || addr === ZERO) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function labelFor(addr) {
  if (!addr) return "—";
  const key = addr.toLowerCase();
  if (state.labels[key]) return state.labels[key];
  const local = state.buckets.find((bucket) => bucket.payee && bucket.payee.toLowerCase() === key);
  if (local?.label) return local.label;
  return LABELS[key] || short(addr);
}

function saveLabels() {
  try {
    localStorage.setItem(labelKey, JSON.stringify(state.labels));
  } catch {
    // localStorage can be unavailable in private windows; labels are a UI nicety.
  }
}

function rememberLabels() {
  let changed = false;
  for (const bucket of state.buckets) {
    if (!bucket.payee || !bucket.label) continue;
    const key = bucket.payee.toLowerCase();
    if (state.labels[key] !== bucket.label) {
      state.labels[key] = bucket.label;
      changed = true;
    }
  }
  if (changed) saveLabels();
}

function showRuleError(message) {
  const box = $("#rule-error");
  if (!box) return;
  box.hidden = !message;
  box.textContent = message || "";
}

function clearRuleError() {
  showRuleError("");
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBigPercent(value, empty) {
  const box = document.querySelector(".big-percent");
  const sup = box?.querySelector("sup");
  if (box) box.classList.toggle("empty", Boolean(empty));
  if (sup) sup.style.display = empty ? "none" : "";
  setText("rule-percent", value);
}

function fmt(value, digits = 2) {
  try {
    const n = Number(formatUnits(value, state.decimals));
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return "0";
  }
}

function fmtAmount(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function humanError(err) {
  if (!err) return "Something went wrong.";
  if (err.code === "ACTION_REJECTED" || err.code === 4001) return "Transaction rejected in your wallet.";
  return err.shortMessage || err.reason || err.message || "Something went wrong.";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function txUrl(hash) {
  if (state.demoMode) return "";
  return hash && explorer ? `${explorer}/tx/${hash}` : "";
}

function toHex(value) {
  return `0x${value.toString(16)}`;
}

function timeAgo(timestamp) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function clonePreset(name) {
  return PRESETS[name].map((bucket) => ({ ...bucket }));
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let toastTimer = null;

function toast(message, isError = false, hash = null) {
  const box = $("#toast");
  const title = $("#toast-title");
  const link = $("#toast-link");
  if (!box || !title || !link) return;

  title.textContent = message;
  box.classList.toggle("error", Boolean(isError));
  box.classList.add("show");

  if (hash && explorer) {
    link.href = `${explorer}/tx/${hash}`;
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), isError ? 8000 : 6500);
}

function setBusy(button, busyLabel, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Wallet                                                              */
/* ------------------------------------------------------------------ */

const CHAIN_PARAMS = {
  11155111: {
    chainId: "0xaa36a7",
    chainName: "Ethereum Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [deployment.rpcUrl || "https://ethereum-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
  84532: {
    chainId: "0x14a34",
    chainName: "Base Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [deployment.rpcUrl || "https://sepolia.base.org"],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
  31337: {
    chainId: "0x7a69",
    chainName: "Anvil Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [deployment.rpcUrl || "http://127.0.0.1:8545"],
    blockExplorerUrls: [],
  },
  1301: {
    chainId: "0x515",
    chainName: "Unichain Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [deployment.rpcUrl || "https://sepolia.unichain.org"],
    blockExplorerUrls: ["https://sepolia.uniscan.xyz"],
  },
};

async function ensureChain() {
  const network = await state.provider.getNetwork();
  if (Number(network.chainId) === chainId) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHex(chainId) }],
    });
  } catch (err) {
    if (err.code === 4902 || err.code === -32603) {
      const params = CHAIN_PARAMS[chainId];
      if (!params) throw new Error(`Add chain ${chainId} to your wallet first.`);
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [params] });
    } else {
      throw err;
    }
  }
}

async function connect() {
  if (state.demoMode) {
    document.querySelector("#dashboard")?.scrollIntoView({ behavior: "smooth" });
    toast("Demo mode — sample data only. Connect a wallet for live mode.");
    return;
  }
  if (!configured) {
    toast("Contracts are not deployed yet. Run script/deploy.ps1 first.", true);
    return;
  }
  if (!window.ethereum) {
    toast("No EVM wallet found. Install MetaMask, Rabby, or another browser wallet.", true);
    return;
  }

  try {
    state.provider = new BrowserProvider(window.ethereum);
    await state.provider.send("eth_requestAccounts", []);
    await ensureChain();
    state.signer = await state.provider.getSigner();
    state.account = await state.signer.getAddress();
    policyDirty = false;
    state.token = new Contract(deployment.token, TOKEN_ABI, state.provider);
    state.split = new Contract(deployment.split, SPLIT_ABI, state.provider);

    $("#wallet-chip").classList.add("connected");
    setText("wallet-label", short(state.account));
    $("#disconnect").hidden = false;
    setText("connect-top", short(state.account));

    const [symbol, decimals] = await Promise.all([
      state.token.symbol().catch(() => "tokens"),
      state.token.decimals().catch(() => 18),
    ]);
    state.symbol = symbol;
    state.decimals = Number(decimals);

    toast("Wallet connected. Reactive is watching this address.");
    await loadRule();
    await refreshAll();
  } catch (err) {
    toast(humanError(err), true);
  }
}

function disconnect() {
  planner.clear();
  policyDirty = false;
  state.provider = null;
  state.signer = null;
  state.account = null;
  state.token = null;
  state.split = null;
  state.balance = 0n;
  state.allowance = 0n;
  state.buckets = clonePreset("freelancer");
  state.ruleVersion = 0;
  state.onchainBucketCount = 0;
  state.groups = [];
  state.dirty = false;

  $("#wallet-chip").classList.remove("connected");
  setText("wallet-label", "Not connected");
  setText("connect-top", "Connect wallet");
  $("#disconnect").hidden = true;
  renderDisconnected();
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

async function loadRule() {
  if (!state.split || !state.account) return;

  try {
    const [raw, version] = await Promise.all([
      state.split.getBuckets(state.account, deployment.token),
      state.split.ruleVersion(state.account, deployment.token),
    ]);
    state.ruleVersion = Number(version);
    state.onchainBucketCount = raw.length;

    if (raw.length > 0) {
      state.buckets = raw.map((bucket) => ({
        label: state.labels[bucket.payee.toLowerCase()] || LABELS[bucket.payee.toLowerCase()] || "",
        payee: bucket.payee,
        fixed: formatUnits(bucket.fixedAmount, state.decimals),
        bps: Number(bucket.bps) > 0 ? String(Number(bucket.bps) / 100) : "",
        active: bucket.active,
      }));
    } else if (!state.buckets.length) {
      state.buckets = clonePreset("freelancer");
    }
    state.dirty = false;
    renderBuckets();
    updateSummary();
  } catch (err) {
    toast(humanError(err), true);
  }
}

async function refreshAll() {
  if (!state.account || !configured) {
    renderDisconnected();
    await loadReactiveStatus();
    return;
  }

  try {
    const [balance, allowance] = await Promise.all([
      state.token.balanceOf(state.account),
      state.token.allowance(state.account, deployment.split),
    ]);
    state.balance = balance;
    state.allowance = allowance;
    state.demoToken = state.symbol === "dUSDC";

    if (state.demoToken) {
      try {
        const [last, amount] = await Promise.all([
          state.token.lastFaucetAt(state.account),
          state.token.FAUCET_AMOUNT(),
        ]);
        state.nextFaucetAt = Number(last) + 3600;
        state.faucetAmount = amount;
      } catch {
        state.nextFaucetAt = 0;
      }
    }

    if (!state.dirty) await loadRule();
    renderConnected();
    await loadPolicy();
    await planner.load();
    await planner.preview();
    await loadActivity();
    await loadReactiveStatus();
  } catch (err) {
    toast(humanError(err), true);
  }
}

async function loadActivity() {
  if (!state.split || !state.account) return;

  try {
    const head = await state.provider.getBlockNumber();
    const fromBlock = Math.max(0, head - 5000);
    const [splits, retained, skipped] = await Promise.all([
      state.split.queryFilter(state.split.filters.Split(state.account), fromBlock, "latest"),
      state.split.queryFilter(state.split.filters.Retained(state.account), fromBlock, "latest"),
      state.split.queryFilter(state.split.filters.BucketSkipped(state.account), fromBlock, "latest"),
    ]);

    const groups = new Map();
    const ensureGroup = (txHash, blockNumber) => {
      if (!groups.has(txHash)) {
        groups.set(txHash, {
          txHash,
          blockNumber,
          splits: [],
          retained: 0n,
          paycheck: 0n,
          version: 0,
        });
      }
      return groups.get(txHash);
    };

    for (const event of splits) {
      const group = ensureGroup(event.transactionHash, event.blockNumber);
      group.splits.push({
        payee: event.args.payee,
        amount: event.args.amount,
        bucketIndex: Number(event.args.bucketIndex),
        paycheck: event.args.paycheck,
      });
      group.paycheck = event.args.paycheck;
      group.version = Number(event.args.version);
    }

    for (const event of retained) {
      const group = ensureGroup(event.transactionHash, event.blockNumber);
      group.retained += event.args.amount;
    }

    state.groups = [...groups.values()].sort((a, b) => b.blockNumber - a.blockNumber);
    state.skips = skipped.map((event) => ({
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      bucketIndex: Number(event.args.bucketIndex),
      paycheck: event.args.paycheck,
      requested: event.args.requested,
      reason: Number(event.args.reason),
      originTxHash: event.args.originTxHash,
      logIndex: event.args.logIndex,
    }));
    state.activityError = false;

    // Relative time is much more useful than "block 723".
    const blockNumbers = [...new Set(state.groups.slice(0, 10).map((group) => group.blockNumber))];
    const blocks = await Promise.all(
      blockNumbers.map((number) => state.provider.getBlock(number).catch(() => null)),
    );
    const times = new Map(blocks.filter(Boolean).map((block) => [block.number, block.timestamp]));
    for (const group of state.groups) {
      group.timestamp = times.get(group.blockNumber) || 0;
      group.relative = group.timestamp ? timeAgo(group.timestamp) : `block ${group.blockNumber}`;
    }

    renderActivity();
  } catch {
    state.groups = [];
    state.skips = [];
    state.activityError = true;
    renderActivity();
  }
}

async function loadReactiveStatus() {
  if (!deployment.reactive) {
    setText("remaining-label", "not deployed");
    return;
  }

  try {
    const provider = new JsonRpcProvider(deployment.lasnaRpc || "https://lasna-rpc.rnk.dev/", 5318007, {
      staticNetwork: true,
    });
    const reactive = new Contract(deployment.reactive, REACTIVE_ABI, provider);
    const [remaining, paused] = await Promise.all([reactive.remaining(), reactive.paused()]);
    setText(
      "remaining-label",
      paused ? "paused" : Number(remaining) === 0 ? "platform budget empty" : `platform fuel · ${remaining.toString()}`,
    );

    if (state.account) {
      const [rule, userBudget] = await Promise.all([
        reactive.getRule(state.account, deployment.token),
        reactive.userRemaining(state.account, deployment.token),
      ]);
      const activeCount = rule[3].filter(Boolean).length;
      if (Number(rule[4]) > 0) {
        setText(
          "reactive-note",
          `Lasna mirrors ${activeCount} active bucket${activeCount === 1 ? "" : "s"} · v${rule[4]} · budget ${userBudget.toString()}.`,
        );
        if (Number(userBudget) === 0) {
          setText("reactive-note", "Reactive is mirrored, but this user's callback budget is empty. Owner top-up needed.");
        }
      }
    }
  } catch {
    setText("remaining-label", "Lasna RPC offline");
  }
}

/* ------------------------------------------------------------------ */
/* Bucket editor                                                       */
/* ------------------------------------------------------------------ */

function renderBuckets() {
  const list = $("#buckets-list");
  if (!list) return;
  list.innerHTML = "";

  if (!state.buckets.length) {
    const empty = document.createElement("div");
    empty.className = "buckets-empty";
    empty.textContent = "No destinations yet. Add one or pick a preset.";
    list.append(empty);
  }

  state.buckets.forEach((bucket, index) => {
    const row = document.createElement("div");
    row.className = "bucket-row";
    row.innerHTML = `
      <span class="bucket-priority">${String(index + 1).padStart(2, "0")}</span>
      <div class="bucket-identity">
        <input class="bucket-label" data-i="${index}" data-f="label" type="text" aria-label="Bucket label"
          placeholder="Label (rent, tax, design)" autocomplete="off" value="${escapeAttr(bucket.label || "")}" />
        <input class="bucket-payee" data-i="${index}" data-f="payee" type="text" aria-label="Bucket payee address"
          placeholder="0x… payee" autocomplete="off" spellcheck="false" value="${escapeAttr(bucket.payee)}" />
      </div>
      <div class="bucket-amounts">
        <label class="bucket-input">
          <span class="bucket-prefix">$</span>
          <input data-i="${index}" data-f="fixed" type="number" min="0" step="0.01" aria-label="Fixed amount"
            placeholder="fixed" value="${escapeAttr(bucket.fixed)}" />
        </label>
        <label class="bucket-input">
          <input data-i="${index}" data-f="bps" type="number" min="0" max="100" step="0.1" aria-label="Percentage of gross income"
            placeholder="0" value="${escapeAttr(bucket.bps)}" />
          <span class="bucket-suffix">%</span>
        </label>
      </div>
      <label class="bucket-active" title="Include this bucket">
        <input data-i="${index}" data-f="active" type="checkbox" aria-label="Include this bucket" ${bucket.active ? "checked" : ""} />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <div class="bucket-controls">
        <button class="bucket-move" type="button" data-up="${index}" aria-label="Move bucket up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="bucket-move" type="button" data-down="${index}" aria-label="Move bucket down" ${index === state.buckets.length - 1 ? "disabled" : ""}>↓</button>
        <button class="bucket-remove" type="button" data-remove="${index}" aria-label="Remove bucket">×</button>
      </div>
    `;
    list.append(row);
  });

  $("#add-bucket").disabled = state.buckets.length >= MAX_BUCKETS;
}

function updateSummary() {
  const active = state.buckets.filter((bucket) => bucket.active);
  const totalBps = active.reduce((sum, bucket) => sum + Math.round((Number(bucket.bps) || 0) * 100), 0);
  const sample = Math.max(1, Number(state.samplePaycheck) || 1000);

  setText("rule-buckets", String(active.length));
  setText("rule-version", state.ruleVersion ? `v${state.ruleVersion}` : "—");

  const pill = $("#rule-pill");
  if (state.demoMode) {
    pill.textContent = active.length ? "Demo" : "Demo paused";
    pill.className = active.length ? "pill active" : "pill warn";
  } else if (!state.account) {
    pill.textContent = active.length ? "Draft" : "Not set";
    pill.className = "pill";
  } else if (active.length) {
    pill.textContent = state.onchainBucketCount ? "Active" : "Draft";
    pill.className = state.onchainBucketCount ? "pill active" : "pill";
  } else {
    pill.textContent = "Paused";
    pill.className = "pill warn";
  }

  // Preview on the user-selected sample paycheck (default 1,000).
  let remaining = sample;
  const rows = [];
  active.forEach((bucket, index) => {
    const requested =
      (Number(bucket.fixed) || 0) + (sample * (Number(bucket.bps) || 0)) / 100;
    const paid = Math.min(requested, remaining);
    remaining -= paid;
    rows.push({
      label: labelFor(bucket.payee),
      paid,
      pct: (paid / sample) * 100,
      color: COLORS[index % COLORS.length],
    });
  });

  const routed = sample - remaining;
  const routedPct = (routed / sample) * 100;
  if (active.length) setBigPercent(String(Math.round(routedPct * 10) / 10), false);
  else setBigPercent("—", true);

  setText("rule-routed", `${fmtAmount(routed)} ${state.symbol}`);
  setText("allocated-label", `${fmtAmount(routed)} routed`);
  setText("retained-label", `${fmtAmount(remaining)} retained`);

  const bar = $("#waterfall-bar");
  bar.innerHTML = "";
  rows.forEach((row) => {
    if (row.paid <= 0) return;
    const seg = document.createElement("span");
    seg.className = "waterfall-seg";
    seg.style.width = `${row.pct}%`;
    seg.style.background = row.color;
    seg.title = `${row.label}: ${fmtAmount(row.paid)}`;
    bar.append(seg);
  });
  if (remaining > 0) {
    const seg = document.createElement("span");
    seg.className = "waterfall-seg waterfall-retained";
    seg.style.width = `${(remaining / sample) * 100}%`;
    seg.title = `Retained: ${fmtAmount(remaining)}`;
    bar.append(seg);
  }

  const legend = $("#waterfall-legend");
  legend.innerHTML = "";
  rows.slice(0, 6).forEach((row) => {
    const item = document.createElement("span");
    item.className = "wf-legend-item";
    item.innerHTML = `<i style="background:${row.color}"></i>${escapeAttr(row.label)} <b>${fmtAmount(row.paid)}</b>`;
    legend.append(item);
  });
  if (remaining > 0) {
    const item = document.createElement("span");
    item.className = "wf-legend-item";
    item.innerHTML = `<i class="retained-dot"></i>Retained <b>${fmtAmount(remaining)}</b>`;
    legend.append(item);
  }
  setText("retained-label", `${fmtAmount(remaining)} / ${fmtAmount(sample)}`);

  if (state.account) {
    $("#save-rule").disabled = false;
    $("#save-rule").textContent = state.onchainBucketCount ? "Update waterfall" : "Save waterfall";
  }
  planner.sync();
}

function updateModeUI() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  setText("waterfall-title", state.mode === "team" ? "Team payroll waterfall" : "Your waterfall");
}

function renderDisconnected() {
  if (!state.buckets.length) state.buckets = clonePreset("freelancer");
  updateModeUI();
  renderBuckets();
  updateSummary();

  setText("token-balance", "0.00 dUSDC");
  setText("sample-unit", "dUSDC");
  if (document.activeElement !== $("#sample-input")) $("#sample-input").value = String(state.samplePaycheck);
  setText("allowance-pill", "Allowance —");
  setText("split-count", "0 splits");
  setText("total-saved", "0.00");
  setText("total-retained", "0.00");
  setText("last-split", "—");

  $("#save-rule").disabled = true;
  $("#save-rule").textContent = "Connect to save";
  $("#approve-btn").disabled = true;
  $("#faucet-btn").disabled = true;
  renderActivity();
}

function renderConnected() {
  setText("token-balance", `${fmt(state.balance)} ${state.symbol}`);
  setText("sample-unit", state.symbol);
  if (document.activeElement !== $("#sample-input")) $("#sample-input").value = String(state.samplePaycheck);
  setText("total-saved-unit", state.symbol);
  setText("total-retained-unit", state.symbol);
  setText(
    "faucet-title",
    state.mode === "team"
      ? "Fund the treasury"
      : state.demoToken
        ? "Claim a demo income"
        : "Send yourself income",
  );
  setText(
    "faucet-note",
    state.mode === "team"
      ? "This Transfer is the funding event; contributors are paid in one waterfall callback."
      : state.demoToken
        ? "Emits a real ERC-20 Transfer — the exact event Reactive watches."
        : `Transfer ${state.symbol} from another wallet to this address.`,
  );

  renderAllowance();
  renderFaucet();
  updateSummary();
}

function renderAllowance() {
  const approved = state.allowance > 0n;
  const pill = $("#allowance-pill");
  pill.textContent = approved ? "Allowance ✓" : "Allowance —";
  pill.className = approved ? "pill active" : "pill pill-soft";

  const btn = $("#approve-btn");
  btn.disabled = !state.signer && !state.demoMode;
  btn.textContent = approved ? "Update" : "Approve";
  pill.textContent = approved ? `Allowance: ${fmt(state.allowance)}` : "Allowance —";
  planner.preview();
}

function renderFaucet() {
  const btn = $("#faucet-btn");
  if (state.demoMode) {
    btn.disabled = false;
    btn.textContent = "Run";
    setText("faucet-title", "Run a sample income");
    setText("faucet-note", "Simulates a Transfer, the waterfall, and the retained remainder. No wallet needed.");
    return;
  }
  if (!state.demoToken) {
    btn.disabled = true;
    btn.textContent = "—";
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const wait = state.nextFaucetAt - now;
  if (wait > 0) {
    btn.disabled = true;
    const mins = Math.ceil(wait / 60);
    btn.textContent = mins > 60 ? `${Math.ceil(mins / 60)}h` : `${mins}m`;
    setText("faucet-note", `Next demo income in ${mins} minute${mins === 1 ? "" : "s"}.`);
  } else {
    btn.disabled = false;
    btn.textContent = "Claim";
    if (state.faucetAmount > 0n) {
      setText(
        "faucet-note",
        `Claim ${fmt(state.faucetAmount)} ${state.symbol}. It emits a real ERC-20 Transfer.`,
      );
    }
  }
}

function renderActivity() {
  const list = $("#activity-list");
  const runCount = state.groups.length;
  const splitCount = state.groups.reduce((sum, group) => sum + group.splits.length, 0);
  setText("split-count", `${runCount} run${runCount === 1 ? "" : "s"}`);

  let routed = 0n;
  let retained = 0n;
  for (const group of state.groups) {
    for (const split of group.splits) routed += split.amount;
    retained += group.retained;
  }
  setText("total-saved", fmt(routed));
  setText("total-retained", fmt(retained));
  setText(
    "last-split",
    state.groups.length
      ? state.groups[0].relative || `block ${state.groups[0].blockNumber}`
      : "—",
  );

  if (state.activityError) {
    list.innerHTML = `
      <div class="empty">
        <span class="empty-mark">!</span>
        <p>Could not load waterfall history.</p>
        <span>The RPC may be rate-limited. Try Refresh in a moment.</span>
      </div>`;
    return;
  }

  if (!state.groups.length && !state.skips.length) {
    list.innerHTML = `
      <div class="empty">
        <span class="empty-mark">◎</span>
        <p>Your first waterfall run will appear here.</p>
        <span>Set buckets, approve, then claim a demo income.</span>
      </div>`;
    return;
  }

  list.innerHTML = "";

  if (splitCount > 0) {
    const summary = document.createElement("div");
    summary.className = "activity-run-summary";
    summary.textContent = `${splitCount} split${splitCount === 1 ? "" : "s"} across ${runCount} run${runCount === 1 ? "" : "s"}`;
    list.append(summary);
  }

  for (const group of state.groups.slice(0, 10)) {
    const wrapper = document.createElement("div");
    wrapper.className = "activity-group";

    const head = document.createElement("div");
    head.className = "activity-group-head";
    const left = document.createElement("span");
    left.textContent = `Waterfall · ${short(group.txHash)}`;
    const right = document.createElement("span");
    right.textContent = `v${group.version} · ${group.relative || `block ${group.blockNumber}`}`;
    const actions = document.createElement("div");
    actions.className = "activity-group-actions";
    const receipt = document.createElement("button");
    receipt.type = "button";
    receipt.className = "link-btn";
    receipt.textContent = "Receipt";
    receipt.addEventListener("click", () => downloadReceipt(group));
    actions.append(receipt);
    head.append(left, right, actions);

    const body = document.createElement("div");
    body.className = "activity-group-body";

    for (const split of group.splits) {
      const row = document.createElement("a");
      row.className = "activity-row";
      const href = txUrl(group.txHash);
      if (href) {
        row.href = href;
        row.target = "_blank";
        row.rel = "noreferrer";
      }

      const icon = document.createElement("div");
      icon.className = "activity-icon";
      icon.textContent = "↓";

      const main = document.createElement("div");
      main.className = "activity-main";
      const title = document.createElement("b");
      title.textContent = labelFor(split.payee);

      const bucket = state.buckets[split.bucketIndex];
      const ruleBits = [];
      if (bucket) {
        if (Number(bucket.fixed) > 0) ruleBits.push(`${fmtAmount(Number(bucket.fixed))} fixed`);
        if (Number(bucket.bps) > 0) ruleBits.push(`${bucket.bps}%`);
      }
      const sub = document.createElement("span");
      sub.textContent = `bucket ${split.bucketIndex + 1}${ruleBits.length ? ` · ${ruleBits.join(" + ")}` : ""} · ${short(split.payee)}`;
      main.append(title, sub);

      const amount = document.createElement("div");
      amount.className = "activity-amount";
      amount.textContent = `+${fmt(split.amount)}`;
      const small = document.createElement("small");
      small.textContent = "routed";
      amount.append(small);

      row.append(icon, main, amount);
      body.append(row);
    }

    if (group.retained > 0n) {
      const row = document.createElement("div");
      row.className = "activity-row activity-retained";
      const icon = document.createElement("div");
      icon.className = "activity-icon retained";
      icon.textContent = "=";
      const main = document.createElement("div");
      main.className = "activity-main";
      const title = document.createElement("b");
      title.textContent = "Stayed in wallet";
      const sub = document.createElement("span");
      sub.textContent = "not allocated — spending money";
      main.append(title, sub);
      const amount = document.createElement("div");
      amount.className = "activity-amount retained-amount";
      amount.textContent = fmt(group.retained);
      const small = document.createElement("small");
      small.textContent = "retained";
      amount.append(small);
      row.append(icon, main, amount);
      body.append(row);
    }

    wrapper.append(head, body);
    list.append(wrapper);
  }

  if (state.skips.length) {
    const skippedHead = document.createElement("div");
    skippedHead.className = "activity-group-head activity-skip-head";
    skippedHead.textContent = `Skipped buckets · ${state.skips.length}`;
    list.append(skippedHead);

    for (const skip of state.skips.slice(0, 8)) {
      const row = document.createElement("a");
      row.className = "activity-row activity-retained";
      const href = txUrl(skip.txHash);
      if (href) {
        row.href = href;
        row.target = "_blank";
        row.rel = "noreferrer";
      }
      const icon = document.createElement("div");
      icon.className = "activity-icon retained";
      icon.textContent = "!";
      const main = document.createElement("div");
      main.className = "activity-main";
      const title = document.createElement("b");
      title.textContent = `Bucket ${skip.bucketIndex + 1} skipped`;
      const sub = document.createElement("span");
      sub.textContent = skipReason(skip.reason);
      main.append(title, sub);
      const amount = document.createElement("div");
      amount.className = "activity-amount retained-amount";
      amount.textContent = fmt(skip.requested);
      const small = document.createElement("small");
      small.textContent = "not routed";
      amount.append(small);
      row.append(icon, main, amount);
      list.append(row);
    }
  }
}

function downloadReceipt(group) {
  const width = 1200;
  const height = 630;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const paper = "#f6f1e6";
  const ink = "#14251c";
  const green = "#1d6a4a";
  const gold = "#e8bb62";
  const soft = "#5e6f64";
  const line = "#d9d2c3";

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);

  // Header
  ctx.fillStyle = green;
  ctx.beginPath();
  ctx.arc(64, 64, 27, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = paper;
  ctx.font = "600 26px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("P", 64, 73);
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = "600 30px Georgia, serif";
  ctx.fillText("PaydaySplit", 104, 64);
  ctx.fillStyle = soft;
  ctx.font = "13px Consolas, monospace";
  ctx.fillText("REACTIVE INCOME WATERFALL", 104, 86);

  ctx.textAlign = "right";
  ctx.fillStyle = green;
  ctx.font = "600 13px Consolas, monospace";
  ctx.fillText(state.demoMode ? "DEMO DATA" : "LOCAL ANVIL DEMO", width - 60, 58);
  ctx.fillStyle = soft;
  ctx.font = "12px Consolas, monospace";
  ctx.fillText(`block ${group.blockNumber} · v${group.version}`, width - 60, 80);

  // Hero numbers
  let routed = 0n;
  for (const split of group.splits) routed += split.amount;
  const total = group.paycheck || routed + group.retained;
  ctx.textAlign = "left";
  ctx.fillStyle = soft;
  ctx.font = "11px Consolas, monospace";
  ctx.fillText("INCOME", 60, 140);
  ctx.fillStyle = ink;
  ctx.font = "600 54px Georgia, serif";
  ctx.fillText(`${fmt(total)} ${state.symbol}`, 60, 196);
  ctx.fillStyle = soft;
  ctx.font = "11px Consolas, monospace";
  ctx.fillText("ROUTED", 700, 140);
  ctx.fillStyle = green;
  ctx.font = "600 40px Georgia, serif";
  ctx.fillText(fmt(routed), 700, 186);
  ctx.fillStyle = soft;
  ctx.font = "11px Consolas, monospace";
  ctx.fillText("RETAINED", 960, 140);
  ctx.fillStyle = ink;
  ctx.font = "600 40px Georgia, serif";
  ctx.fillText(fmt(group.retained), 960, 186);

  // Divider
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 226);
  ctx.lineTo(width - 60, 226);
  ctx.stroke();

  // Bucket rows
  let y = 268;
  const maxRows = 7;
  const splits = group.splits.slice(0, maxRows);
  for (const split of splits) {
    const label = labelFor(split.payee);
    const truncated = label.length > 30 ? `${label.slice(0, 29)}…` : label;
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.arc(72, y - 5, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = paper;
    ctx.font = "600 12px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("↓", 72, y - 1);
    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = "600 18px Georgia, serif";
    ctx.fillText(truncated, 96, y);
    ctx.fillStyle = soft;
    ctx.font = "11px Consolas, monospace";
    ctx.fillText(`bucket ${split.bucketIndex + 1} · ${short(split.payee)}`, 96, y + 18);
    ctx.textAlign = "right";
    ctx.fillStyle = ink;
    ctx.font = "600 18px Georgia, serif";
    ctx.fillText(`+${fmt(split.amount)}`, width - 64, y);
    ctx.fillStyle = soft;
    ctx.font = "10px Consolas, monospace";
    ctx.fillText("routed", width - 64, y + 18);
    ctx.textAlign = "left";
    y += 46;
  }

  if (group.retained > 0n && splits.length < maxRows) {
    ctx.fillStyle = "#e8e0d0";
    ctx.beginPath();
    ctx.arc(72, y - 5, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = soft;
    ctx.font = "600 14px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("=", 72, y);
    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = "600 18px Georgia, serif";
    ctx.fillText("Stayed in wallet", 96, y);
    ctx.fillStyle = soft;
    ctx.font = "11px Consolas, monospace";
    ctx.fillText("not allocated — spending money", 96, y + 18);
    ctx.textAlign = "right";
    ctx.fillStyle = ink;
    ctx.font = "600 18px Georgia, serif";
    ctx.fillText(fmt(group.retained), width - 64, y);
    ctx.textAlign = "left";
  }

  // Footer
  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(60, height - 66);
  ctx.lineTo(width - 60, height - 66);
  ctx.stroke();
  ctx.fillStyle = soft;
  ctx.font = "11px Consolas, monospace";
  ctx.fillText(`${state.demoMode ? "Demo mode" : "Local Anvil"} · one Reactive callback · Split + Retained events`, 60, height - 38);
  ctx.textAlign = "right";
  ctx.fillText(`${short(group.txHash)} · ${group.relative || `block ${group.blockNumber}`}`, width - 60, height - 38);
  ctx.textAlign = "left";

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `paydaysplit-receipt-${group.blockNumber}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Payday receipt downloaded.");
  }, "image/png");
}

function skipReason(reason) {
  return (
    {
      1: "No funds left in this paycheck",
      2: "Balance or allowance too low",
      3: "Token transfer failed",
      4: "Bucket is inactive",
      5: "Funding goal reached",
    }[reason] || "Skipped by the waterfall"
  );
}
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function bucketFromEditor(bucket) {
  const active = Boolean(bucket.active);
  let payee = bucket.payee.trim();
  if (!active && !payee) payee = ZERO;
  if (!payee) throw new Error("Every active bucket needs a payee.");
  const parsedPayee = getAddress(payee);
  if (active && parsedPayee.toLowerCase() === state.account?.toLowerCase()) {
    throw new Error("A bucket payee cannot be your spending wallet.");
  }
  if (active && parsedPayee.toLowerCase() === deployment.split.toLowerCase()) {
    throw new Error("A bucket payee cannot be the split contract.");
  }

  let fixed = 0n;
  try {
    fixed = parseUnits(bucket.fixed.trim() || "0", state.decimals);
  } catch {
    throw new Error("Fixed amount is not a valid number.");
  }
  if (fixed < 0n || fixed >= 2n ** 96n) throw new Error("Fixed amount is outside the supported range.");
  const bps = Number(parseUnits(String(bucket.bps || "0"), 2));
  if (bps < 0 || bps > 10_000) throw new Error("Percentage must be between 0% and 100%.");
  if (active && fixed === 0n && bps === 0) throw new Error("An active bucket needs a fixed amount or a percentage.");

  return { payee: parsedPayee, fixedAmount: fixed, bps, active };
}

async function saveRule(event) {
  event.preventDefault();
  if (!state.signer) {
    await connect();
    return;
  }
  if (state.busy) return;
  clearRuleError();
  rememberLabels();

  let buckets;
  try {
    if (!state.buckets.length) throw new Error("Add at least one destination.");
    buckets = state.buckets.map(bucketFromEditor);
    const totalBps = buckets.filter((bucket) => bucket.active).reduce((sum, bucket) => sum + bucket.bps, 0);
    if (totalBps > 10_000) throw new Error("Active percentages cannot exceed 100%.");
  } catch (err) {
    showRuleError(err.message);
    toast(err.message, true);
    return;
  }

  const button = $("#save-rule");
  state.busy = true;
  setBusy(button, "Saving…", true);
  try {
    const tx = await state.split.connect(state.signer).setBuckets(deployment.token, buckets);
    clearRuleError();
    toast("Waterfall saved. Reactive is mirroring it on Lasna.", false, tx.hash);
    await tx.wait();
    await sleep(2500);
    state.dirty = false;
    await loadRule();
    await refreshAll();
    pollReactiveRule();
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    state.busy = false;
    setBusy(button, "", false);
  }
}

async function pollReactiveRule() {
  if (!deployment.reactive) return;
  try {
    const provider = new JsonRpcProvider(deployment.lasnaRpc || "https://lasna-rpc.rnk.dev/", 5318007, {
      staticNetwork: true,
    });
    const reactive = new Contract(deployment.reactive, REACTIVE_ABI, provider);
    for (let i = 0; i < 6; i++) {
      const rule = await reactive.getRule(state.account, deployment.token);
      if (Number(rule[4]) === state.ruleVersion) {
        setText("reactive-note", `Rule v${state.ruleVersion} mirrored on Lasna. Next income runs the waterfall.`);
        return;
      }
      await sleep(3000);
    }
  } catch {
    // Non-fatal: destination rule is saved; mirror may lag.
  }
}

async function approve() {
  if (state.demoMode) {
    try { state.allowance = parseUnits($("#approval-amount").value, state.decimals); renderAllowance(); }
    catch { toast("Enter a valid approval amount.", true); }
    return;
  }
  if (!state.signer || state.busy) return;
  state.busy = true;
  const button = $("#approve-btn");
  setBusy(button, "Approving…", true);
  try {
    const amount = parseUnits($("#approval-amount").value, state.decimals);
    if (amount <= 0n) throw new Error("Enter a positive approval amount, or use Revoke allowance.");
    if (state.allowance > 0n && state.allowance !== amount) {
      const reset = await state.token.connect(state.signer).approve(deployment.split, 0);
      await reset.wait();
    }
    const tx = await state.token.connect(state.signer).approve(deployment.split, amount);
    toast("Allowance set. The waterfall can move only what your buckets request.", false, tx.hash);
    await tx.wait();
    await refreshAll();
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    state.busy = false;
    setBusy(button, "", false);
  }
}

function runDemoIncome(silent = false) {
  const sample = Math.max(1, Number(state.samplePaycheck) || 1000);
  const paycheck = parseUnits(String(sample), state.decimals);
  const day = Math.floor(Date.now() / 86400000);
  if (day !== demoDay) { demoSpent = 0n; demoDay = day; }
  const result = calculateRun(state.buckets.map(bucketFromEditor), paycheck,
    state.balance + paycheck, state.allowance, demoPolicy, demoSpent, undefined, planner.getGoals());
  const { splits } = result;
  const remaining = Number(formatUnits(result.retained, state.decimals));
  demoSpent += result.paid;
  if (state.allowance !== MaxUint256) state.allowance -= result.paid;

  const nonce = state.groups.length + 1;
  const txHash = `0x${"0".repeat(56)}${nonce.toString(16).padStart(8, "0")}`;
  const group = {
    txHash,
    blockNumber: 19_000_000 + nonce,
    version: Math.max(1, state.ruleVersion),
    splits,
    retained: result.retained,
    paycheck,
    relative: "just now",
    timestamp: Math.floor(Date.now() / 1000),
  };
  state.groups.unshift(group);
  state.groups = state.groups.slice(0, 10);
  state.balance += group.retained;
  if (state.demoMode) setText("token-balance", `${fmt(state.balance)} ${state.symbol}`);
  renderActivity();
  renderAllowance();
  planner.record(splits);
  if (!silent) toast(`Sample run: ${fmtAmount(sample - remaining)} routed, ${fmtAmount(remaining)} retained.`);
}

async function pauseAll() {
  if (state.demoMode) {
    state.buckets = state.buckets.map((bucket) => ({ ...bucket, active: false }));
    state.dirty = true;
    renderBuckets();
    updateSummary();
    toast("Demo rule paused. All buckets are inactive.");
    return;
  }
  if (!state.signer || state.busy) return;

  let buckets;
  try {
    buckets = state.buckets.map((bucket) => ({ ...bucketFromEditor(bucket), active: false }));
  } catch (err) {
    toast(err.message, true);
    return;
  }

  state.busy = true;
  try {
    const tx = await state.split.connect(state.signer).setBuckets(deployment.token, buckets);
    toast("All buckets paused. Reactive will unsubscribe after the mirror.", false, tx.hash);
    await tx.wait();
    state.dirty = false;
    await loadRule();
    await refreshAll();
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    state.busy = false;
  }
}

async function revokeAllowance() {
  if (state.demoMode) {
    state.allowance = 0n;
    renderAllowance();
    toast("Demo allowance revoked.");
    return;
  }
  if (!state.signer || state.busy) return;

  state.busy = true;
  try {
    const tx = await state.token.connect(state.signer).approve(deployment.split, 0);
    toast("Allowance revoked. No further bucket can move funds.", false, tx.hash);
    await tx.wait();
    await refreshAll();
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    state.busy = false;
  }
}

async function runNow() {
  if (state.demoMode) {
    runDemoIncome();
    return;
  }
  if (!state.signer) {
    await connect();
    return;
  }
  if (state.busy) return;

  let paycheck;
  try {
    paycheck = parseUnits(String(state.samplePaycheck), state.decimals);
  } catch {
    toast("Enter a valid preview amount.", true);
    return;
  }

  state.busy = true;
  try {
    const tx = await state.split.connect(state.signer).runSplit(deployment.token, paycheck);
    toast("Manual run submitted. This is a recovery path, not a callback.", false, tx.hash);
    await tx.wait();
    await refreshAll();
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    state.busy = false;
  }
}

async function claim() {
  if (state.demoMode) {
    runDemoIncome();
    return;
  }
  if (!state.signer || state.busy || !state.demoToken) return;
  state.busy = true;
  const button = $("#faucet-btn");
  const before = state.groups.length;
  setBusy(button, "Claiming…", true);

  try {
    const tx = await state.token.connect(state.signer).faucet();
    toast("Income claimed. Reactive is watching the Transfer event…", false, tx.hash);
    await tx.wait();
    await sleep(4000);
    await pollForSplit(before);
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    state.busy = false;
    setBusy(button, "", false);
    await refreshAll();
  }
}

async function pollForSplit(beforeGroups) {
  state.pollingSplit = true;
  for (let i = 0; i < 10; i++) {
    await loadActivity();
    if (state.groups.length > beforeGroups) {
      const group = state.groups[0];
      const routed = group.splits.reduce((sum, split) => sum + split.amount, 0n);
      toast(`Waterfall ran: ${fmt(routed)} ${state.symbol} routed, ${fmt(group.retained)} retained.`);
      state.pollingSplit = false;
      return;
    }
    setText("reactive-note", `Waiting for the callback… (${i + 1}/10)`);
    await sleep(3000);
  }
  setText("reactive-note", "No run yet. Check the mirror, allowance, and callback budget.");
  state.pollingSplit = false;
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function csvAmount(value) {
  try {
    return formatUnits(value, state.decimals);
  } catch {
    return "0";
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  if (!state.groups.length) {
    toast("No waterfall runs to export yet.", true);
    return;
  }

  const rows = [["txHash", "block", "version", "payee", "label", "amount", "retained"]];
  for (const group of state.groups) {
    for (const split of group.splits) {
      rows.push([
        group.txHash,
        group.blockNumber,
        group.version,
        split.payee,
        labelFor(split.payee),
        csvAmount(split.amount),
        "",
      ]);
    }
    if (group.retained > 0n) {
      rows.push([group.txHash, group.blockNumber, group.version, "", "Retained", "", csvAmount(group.retained)]);
    }
  }

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `paydaysplit-runs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${state.groups.length} run${state.groups.length === 1 ? "" : "s"} to CSV.`);
}

function parseImport(text) {
  const buckets = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (const line of lines) {
    const parts = line.split(",").map((part) => part.trim());
    let label = "";
    let address;
    let amount;

    if (parts.length >= 3) {
      label = parts[0];
      address = parts[1];
      amount = parts[2];
    } else if (parts.length === 2) {
      address = parts[0];
      amount = parts[1];
    } else {
      throw new Error(`Invalid line: ${line}`);
    }

    const payee = getAddress(address);
    const fixed = Number(String(amount).replace(/[$,]/g, ""));
    if (!Number.isFinite(fixed) || fixed <= 0) throw new Error(`Invalid amount on line: ${line}`);
    buckets.push({
      label,
      payee,
      fixed: String(fixed),
      bps: "",
      active: true,
    });
  }

  if (!buckets.length) throw new Error("Paste at least one bucket.");
  if (buckets.length > MAX_BUCKETS) throw new Error(`At most ${MAX_BUCKETS} buckets are allowed.`);
  return buckets;
}

function openImport() {
  const dialog = $("#import-dialog");
  if (!dialog) return;
  $("#import-text").value = "";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function applyImport() {
  try {
    const buckets = parseImport($("#import-text").value);
    state.buckets = buckets;
    rememberLabels();
    state.dirty = true;
    renderBuckets();
    updateSummary();
    $("#import-dialog").close();
    toast(`Imported ${buckets.length} bucket${buckets.length === 1 ? "" : "s"}.`);
  } catch (err) {
    toast(err.message, true);
  }
}

function wire() {
  planner.wire();
  $("#recover-income").addEventListener("click", async () => {
    if (state.demoMode) { toast("Recovery needs an onchain Transfer event. Sample runs are simulated."); return; }
    if (!state.signer || state.busy) return;
    try {
      const hash = $("#recover-hash").value.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || BigInt(hash) === 0n) throw new Error("Enter the 32-byte source transaction hash.");
      const index = $("#recover-index").value;
      if (!/^\d+$/.test(index)) throw new Error("Enter a non-negative integer log index.");
      state.busy = true;
      const tx = await state.split.connect(state.signer).recoverSplit(deployment.token,
        parseUnits(String(state.samplePaycheck), state.decimals), BigInt(hash), BigInt(index));
      await tx.wait();
      toast("Recovery confirmed. An already consumed event makes no further payment.", false, tx.hash);
      await refreshAll();
    } catch (err) { toast(humanError(err), true); }
    finally { state.busy = false; }
  });
  $("#save-policy").addEventListener("click", savePolicy);
  document.querySelectorAll('[id^="policy-"]').forEach(el => el.addEventListener("input", () => { policyDirty = true; }));
  $("#connect-top").addEventListener("click", connect);
  $("#connect-hero").addEventListener("click", connect);
  $("#disconnect").addEventListener("click", disconnect);
  $("#rule-form").addEventListener("submit", saveRule);
  $("#approve-btn").addEventListener("click", approve);
  $("#faucet-btn").addEventListener("click", claim);
  $("#pause-rule").addEventListener("click", pauseAll);
  $("#revoke-allowance").addEventListener("click", revokeAllowance);
  $("#run-now").addEventListener("click", runNow);
  $("#refresh-activity").addEventListener("click", async () => {
    if (state.account) await refreshAll();
  });
  $("#export-csv").addEventListener("click", exportCsv);
  $("#import-buckets").addEventListener("click", openImport);
  $("#import-cancel").addEventListener("click", () => $("#import-dialog").close());
  $("#import-apply").addEventListener("click", applyImport);

  $("#sample-input").addEventListener("input", (event) => {
    state.samplePaycheck = Math.max(1, Number(event.target.value) || 1);
    updateSummary();
  });

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      state.buckets = clonePreset(state.mode === "team" ? "team" : "freelancer");
      if (state.mode === "team") {
        state.samplePaycheck = 5000;
      } else {
        state.samplePaycheck = 1000;
      }
      $("#sample-input").value = String(state.samplePaycheck);
      rememberLabels();
      state.dirty = true;
      updateModeUI();
      renderBuckets();
      if (state.demoMode || state.account) renderConnected();
      else renderDisconnected();
      toast(state.mode === "team" ? "Team payroll template loaded." : "Personal waterfall template loaded.");
    });
  });

  $("#add-bucket").addEventListener("click", () => {
    if (state.buckets.length >= MAX_BUCKETS) return;
    state.buckets.push({ payee: "", fixed: "", bps: "", active: true });
    state.dirty = true;
    renderBuckets();
    updateSummary();
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.buckets = clonePreset(button.dataset.preset);
      rememberLabels();
      state.dirty = true;
      renderBuckets();
      updateSummary();
    });
  });

  $("#buckets-list").addEventListener("input", (event) => {
    const input = event.target.closest("input[data-i]");
    if (!input) return;
    const index = Number(input.dataset.i);
    const field = input.dataset.f;
    if (!state.buckets[index]) return;
    clearRuleError();
    state.buckets[index][field] = field === "active" ? input.checked : input.value;
    if (field === "label" && state.buckets[index].payee) {
      state.labels[state.buckets[index].payee.toLowerCase()] = input.value.trim();
      saveLabels();
    }
    state.dirty = true;
    updateSummary();
  });

  $("#buckets-list").addEventListener("change", (event) => {
    const input = event.target.closest("input[data-i]");
    if (!input || input.dataset.f !== "active") return;
    const index = Number(input.dataset.i);
    if (!state.buckets[index]) return;
    state.buckets[index].active = input.checked;
    state.dirty = true;
    updateSummary();
  });

  $("#buckets-list").addEventListener("click", (event) => {
    const up = event.target.closest("[data-up]");
    if (up) {
      const index = Number(up.dataset.up);
      if (index > 0) {
        [state.buckets[index - 1], state.buckets[index]] = [state.buckets[index], state.buckets[index - 1]];
        state.dirty = true;
        renderBuckets();
        updateSummary();
      }
      return;
    }

    const down = event.target.closest("[data-down]");
    if (down) {
      const index = Number(down.dataset.down);
      if (index < state.buckets.length - 1) {
        [state.buckets[index + 1], state.buckets[index]] = [state.buckets[index], state.buckets[index + 1]];
        state.dirty = true;
        renderBuckets();
        updateSummary();
      }
      return;
    }

    const remove = event.target.closest("[data-remove]");
    if (!remove) return;
    state.buckets.splice(Number(remove.dataset.remove), 1);
    state.dirty = true;
    renderBuckets();
    updateSummary();
  });

  window.addEventListener("scroll", () => {
    document.querySelector(".site-header").classList.toggle("scrolled", window.scrollY > 8);
  });

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", (accounts) => {
      if (!accounts || accounts.length === 0) disconnect();
      else window.location.reload();
    });
    window.ethereum.on?.("chainChanged", () => window.location.reload());
  }

  setInterval(() => {
    if (state.account && state.demoToken) renderFaucet();
  }, 30_000);
}

function boot() {
  wire();

  setText(
    "network-label",
    deployment.network === "base-sepolia"
      ? "Base Sepolia"
      : deployment.network === "unichain-sepolia"
        ? "Unichain Sepolia"
        : deployment.network === "anvil"
          ? "Anvil local"
          : "Sepolia testnet",
  );

  if (deployment.split && explorer) {
    $("#split-link").href = `${explorer}/address/${deployment.split}`;
    $("#split-link").hidden = false;
  } else {
    $("#split-link").hidden = true;
  }
  if (deployment.reactive && lasnaExplorer) {
    $("#reactive-link").href = `${lasnaExplorer}/address/${deployment.reactive}`;
    $("#reactive-link").hidden = false;
  } else {
    $("#reactive-link").hidden = true;
  }

  const banner = $("#deployment-banner");
  if (!configured) {
    banner.hidden = false;
    banner.innerHTML =
      '<b>Contracts not deployed yet.</b><span>Run <code>pwsh ./script/deploy.ps1</code> and refresh. The UI reads <code>web/public/deployments.json</code>.</span>';
  } else {
    banner.hidden = true;
  }

  if (state.demoMode) {
    state.symbol = "dUSDC";
    state.decimals = 6;
    state.balance = 1_000n * 10n ** 6n;
    state.allowance = MaxUint256;
    state.onchainBucketCount = 3;
    state.ruleVersion = 3;
    state.demoToken = true;
    state.buckets = clonePreset("freelancer");

    banner.hidden = false;
    banner.innerHTML =
      '<b>Demo mode — sample data.</b><span>No wallet or chain needed. Click <b>Run a sample income</b>, or open <code>?local=1</code> for the Anvil full loop.</span>';
    setText("network-label", "Demo mode");
    setText("wallet-label", "Demo mode");
    $("#wallet-chip").classList.add("connected");
    setText("connect-top", "Demo");
    setText("connect-hero", "See a sample split ↗");

    updateModeUI();
    renderBuckets();
    renderConnected();
    runDemoIncome(true);
    setText("remaining-label", "demo mode");
    setText("faucet-title", "Run a sample income");
    setText("faucet-note", "Simulates a Transfer, the waterfall, and the retained remainder. No wallet needed.");
    $("#faucet-btn").disabled = false;
    $("#faucet-btn").textContent = "Run";
    $("#approve-btn").textContent = "Demo";
    $("#save-rule").disabled = true;
    $("#save-rule").textContent = "Demo mode — connect for live";
    return;
  }

  state.buckets = clonePreset("freelancer");
  updateModeUI();
  renderDisconnected();
  loadReactiveStatus();
}

boot();
