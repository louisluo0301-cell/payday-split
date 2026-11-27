import {
  BrowserProvider,
  Contract,
  FetchRequest,
  JsonRpcProvider,
  MaxUint256,
  formatUnits,
  getAddress,
  parseUnits,
} from "ethers";
import { SPLIT_ABI, TOKEN_ABI, REACTIVE_ABI } from "./contract-abi.generated.js";
import { calculateRun } from "./waterfall.js";
import { createPlanning } from "./planning.js";
import { createBudgetControls } from "./budget-controls.js";
import { collectAutomationHealth, demoHealthReport } from "./automation-health.js";
import { createHealthPanel } from "./health-panel.js";
import { createIncomeTrace } from "./income-trace.js";
import { groupWaterfallEvents, incomeTransfers, matchedPayout, recoveryQuote } from "./income-evidence.js";
import { createIncomeModules, SAMPLE_SAVINGS_DESTINATION } from "./income-modules.js";
import { wireCctpCollection } from "./cctp-collection.js";
import { selectDeploymentAsset } from "./deployment-assets.js";
import { readWalletChainId, readWalletIdentity, switchWalletChain, verifyWalletContext } from "./wallet-context.js";
import { readIncomeRetries } from "./retry-evidence.js";
import { exportLedger, importRecipients } from "./ledger-csv.js";
import { workspaceJourney } from "./workspace-journey.js";
import { createManualPayment, paymentQuoteKey } from "./manual-payment.js";
import { createBrowserWallet } from "./browser-wallet.js";
import { DEPLOYMENT_SESSION, parseTestnetDeployment, wireTestnetDeployment } from "./browser-deployment.js";
import { readFaucet, readWalletSnapshot } from "./wallet-snapshot.js";
import { updateWalletAllowance } from "./wallet-allowance.js";
import { createActionReview } from "./action-review.js";

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
      policyDirty = false;
      document.querySelector("#policy-status").textContent = "Demo controls saved. The next sample run applies these limits.";
      planner.preview();
      loadReactiveStatus();
      return;
    }
    if (!state.signer) { toast("Connect your wallet to save controls.", true); return; }
    if (state.syncStatus !== "ready") throw new Error("Refresh the onchain plan before changing its controls.");
    state.busy = true;
    $("#spending-controls").inert = true;
    const { signer, split } = state;
    const tx = await split.connect(signer).setPolicy(deployment.token, policy);
    const receipt = await tx.wait();
    if (signer !== state.signer) return;
    policyDirty = false;
    lastHealth = null;
    renderWorkspace();
    await refreshAll({ afterBlock: receipt.blockNumber });
    toast("Spending controls confirmed onchain.", false, tx.hash);
  } catch (err) { toast(humanError(err), true); }
  finally { state.busy = false; $("#spending-controls").inert = false; }
}

function applyPolicy({ policy, dailySpend: [day, amount], timestamp }) {
  if (!policyDirty) {
    for (const key of ["reserve", "maxPerRun", "dailyLimit", "minIncome"]) {
      $("#policy-" + key).value = formatUnits(policy[key], state.decimals);
    }
    $("#policy-paused").checked = policy.paused;
    const date = policy.validUntil > 0n ? new Date(Number(policy.validUntil) * 1000) : null;
    $("#policy-expiry").value = date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,19) : "";
  }
  const spent = Number(day) === Math.floor(timestamp / 86400) ? amount : 0n;
  setText("policy-status", "Onchain controls loaded · spent today: " + formatUnits(spent, state.decimals) + " " + state.symbol
    + (policy.paused ? " · PAUSED" : ""));
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_BUCKETS = 8;




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
let usingSessionDeployment = false;
try {
  const res = await fetch(deploymentFile, { cache: "no-store" });
  if (res.ok) deployment = { ...deployment, ...(await res.json()) };
} catch {
  // Static file is optional; the page still renders in "not deployed" mode.
}
if (!useLocal && !demoMode && params.get("deployment") === "session") {
  try {
    deployment = parseTestnetDeployment(sessionStorage.getItem(DEPLOYMENT_SESSION));
    usingSessionDeployment = true;
  } catch {
    // The workspace can still open its bundled configuration.
  }
}

const assetProfile = selectDeploymentAsset(deployment, demoMode ? null : params.get("asset"));
deployment = assetProfile.deployment;
const configured = Boolean(deployment.token && deployment.split);
const readOnlyWallet = demoMode || !configured;
const chainId = Number(deployment.chainId || 11155111);
const wrappedAsset = !demoMode && !!deployment.token
  && deployment.token.toLowerCase() === deployment.modules.wrappedNative?.toLowerCase();
const defaultSample = wrappedAsset ? "0.1" : "1000";
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

PRESETS.balanced = [
  {label:'Essentials',payee:'0x000000000000000000000000000000000000dEaD',fixed:'0',bps:'50',active:true},
  {label:'Flexible budget',payee:'0x000000000000000000000000000000000000bEEF',fixed:'0',bps:'30',active:true},
  {label:'Savings',payee:'0x000000000000000000000000000000000000cafE',fixed:'0',bps:'20',active:true},
];
PRESETS.emergency = [
  {label:'Emergency reserve',payee:'0x000000000000000000000000000000000000dEaD',fixed:'0',bps:'80',active:true},
  {label:'Savings',payee:'0x000000000000000000000000000000000000cafE',fixed:'0',bps:'20',active:true},
];
const SAMPLE_PAYEES = new Set(Object.values(PRESETS).flat().map(bucket => bucket.payee.toLowerCase()));
const LABELS = {
  "0x000000000000000000000000000000000000dead": "Rent vault",
  "0x000000000000000000000000000000000000beef": "Tax reserve",
  "0x000000000000000000000000000000000000cafe": "Savings",
};

const COLORS = ["#1d6a4a", "#e8bb62", "#8bbf9f", "#b4472f", "#5b7fa8", "#9c7bb5", "#c98b5e", "#6b8e6b"];

function labelsKey(account) {
  const scope = demoMode ? "demo" : account?.toLowerCase() || "draft";
  return `paydaysplit:labels:v2:${chainId}:${deployment.token || "none"}:${scope}`;
}
function loadLabels(account) {
  try { return JSON.parse(localStorage.getItem(labelsKey(account)) || "{}") || {}; }
  catch { return {}; }
}

const state = {
  provider: null,
  signer: null,
  injected: null,
  account: null,
  token: null,
  split: null,
  symbol: wrappedAsset ? "WETH" : "dUSDC",
  decimals: wrappedAsset ? 18 : 6,
  balance: 0n,
  allowance: 0n,
  buckets: [],
  ruleVersion: 0,
  onchainBucketCount: 0,
  savedActive: null,
  groups: [],
  skips: [],
  activityError: false,
  demoToken: false,
  nextFaucetAt: 0,
  latestIncome: null,
  faucetAmount: 0n,
  busy: false,
  dirty: false,
  syncStatus: "idle",
  samplePaycheck: defaultSample,
  allocationMode: 0,
  draftAllocationMode: 0,
  cycleConfig: {anchor:0,duration:0,revision:0},
  demoNonce: 0,
  labels: loadLabels(null),
  mode: "personal",
  demoMode,
};

const planner = createPlanning({
  state, deployment, chainId, $, toast, bucketFromEditor, renderBuckets, updateSummary,
  readPolicy: readPolicyEditor,
  getPolicy: () => demoPolicy,
  getSpent: () => Math.floor(Date.now() / 86400000) === demoDay ? demoSpent : 0n,
  writeBudget: (plan) => {
    budgetControls.stage(plan);
  },
  writePolicy: (policy) => {
    for (const key of ["reserve","maxPerRun","dailyLimit","minIncome"]) $(`#policy-${key}`).value = policy[key];
    $("#policy-paused").checked = policy.paused;
    const date = BigInt(policy.validUntil) > 0n ? new Date(Number(policy.validUntil) * 1000) : null;
    $("#policy-expiry").value = date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,19) : "";
    policyDirty = true;
  },
});
const budgetControls = createBudgetControls({state,deployment,$,toast,planner,refresh:refreshAll,update:updateSummary});
const healthPanel = createHealthPanel({$,toast,refresh:loadReactiveStatus});
const incomeTrace = createIncomeTrace({
  $, toast, context: incomeTraceContext, readReactive: readIncomeReaction, readActivity: loadActivity,
  readRetries: readIncomeRetries, recover: recoverIncome,
});
const incomeModules = createIncomeModules({
  $, toast,
  context: () => ({ ...incomeTraceContext(), deployment, reactiveChainId: useLocal ? 31337 : 5318007, busy: state.busy }),
  setWalletBusy: value => { state.busy = value; },
  refreshWorkspace: refreshAll,
  stageBucket: stageModuleBucket,
  onSavingsChange: renderBucketDestinations,
  reviewSavingsSetup,
});
let healthReadId = 0;
let activityReadId = 0;
let walletReadId = 0;
let walletBlockFloor = 0;
let connectReadId = 0;
let connecting = false;
let walletSession = null;
let lastHealth = null;
let stopWalletEvents = () => {};
const browserWallet = createBrowserWallet({ $, browser: window, onChange: renderWorkspace });
const actionReview = createActionReview();
const manualPayment = createManualPayment({
  $, context: () => ({ ...incomeTraceContext(), network: networkName() }),
  readQuote: readManualQuote, pay: submitManualPayment, labelFor, errorMessage: humanError,
  jumpToTrace: () => jumpTo("#trace-hash"),
  jumpToHistory: () => jumpTo("#activity-heading"),
  onTrackingChange: renderWorkspace,
  onConfirmation: (ctx, receipt) => {
    if (ctx.signer === state.signer) void refreshAll({ afterBlock: receipt.blockNumber });
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
    localStorage.setItem(labelsKey(state.account), JSON.stringify(state.labels));
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
  if (el && el.textContent !== value) el.textContent = value;
}

function networkName() {
  return CHAIN_PARAMS[chainId]?.chainName || 'Chain ' + chainId;
}

function jumpTo(selector) {
  const item = $(selector);
  item?.focus({ preventScroll: true });
  item?.scrollIntoView({ block: 'start' });
}

function renderWorkspace() {
  const reportedVersion = lastHealth?.snapshot?.ruleVersion;
  const reportedAllowance = lastHealth?.snapshot?.allowance;
  const matchesSavedPlan = (reportedVersion === undefined || reportedVersion === BigInt(state.ruleVersion))
    && (reportedAllowance === undefined || reportedAllowance === state.allowance);
  const report = state.syncStatus === 'ready' && matchesSavedPlan ? lastHealth : null;
  const connected = !!state.signer;
  const next = workspaceJourney({
    demo: state.demoMode, configured, invalidAsset: assetProfile.invalid, hasWallet: browserWallet.hasWallet(),
    walletLinked: Boolean(walletSession),
    syncStatus: state.syncStatus,
    connected, connecting, savedActive: state.savedActive, dirty: state.dirty, policyDirty,
    modeDirty: state.draftAllocationMode !== state.allocationMode, allowance: state.allowance,
    report, symbol: state.symbol, network: networkName(), nativeReceiver: wrappedAsset && !!deployment.modules.factory,
    demoToken: state.demoToken, faucetReady: !$("#faucet-btn").disabled,
  });
  const panel = $('.workspace-next');
  panel.dataset.tone = next.tone;
  setText('workspace-scope', next.scope);
  setText('workspace-next-title', next.title);
  setText('workspace-next-note', next.note);
  const action = $('#workspace-next-action');
  action.hidden = !next.action || next.action === 'demo';
  action.dataset.action = next.action ?? '';
  setText('workspace-next-action', next.label ?? '');
  const demoLink = $('#workspace-demo-link');
  demoLink.hidden = state.demoMode || (configured && next.action !== 'demo') || assetProfile.invalid;
  demoLink.classList.toggle('btn-primary', next.action === 'demo');
  demoLink.classList.toggle('btn-outline', next.action !== 'demo');
  $('#workspace-stages').hidden = !connected;
  setText('workspace-plan', state.dirty ? 'Unsaved changes' : state.savedActive === null ? 'Checking'
    : state.savedActive ? state.savedActive + ' active · v' + state.ruleVersion : 'No active destinations');
  setText('workspace-allowance', state.savedActive === null ? 'Checking'
    : state.allowance === 0n ? 'Required' : state.allowance === MaxUint256 ? 'Unlimited' : 'Set');
  setText('workspace-health', { ready: 'Verified', blocked: 'Blocked', attention: 'Needs attention', inactive: 'Inactive' }[report?.status] ?? 'Check needed');
  const paymentPending = connected && manualPayment.hasPending();
  setText('run-now', paymentPending ? 'Check manual payment' : 'Review new payment');
  $('#run-now').disabled = !state.demoMode && !paymentPending
    && (!connected || state.syncStatus !== 'ready' || !state.savedActive || state.dirty);
}

async function runWorkspaceAction() {
  if (state.busy) { toast('Finish the current wallet action first.'); return; }
  const action = $('#workspace-next-action').dataset.action;
  switch (action) {
    case 'connect': await connect($('#workspace-next-action')); break;
    case 'deployment': $('#open-deployment').click(); break;
    case 'refresh': await refreshAll(); break;
    case 'plan': jumpTo('#waterfall-title'); break;
    case 'asset': jumpTo('#asset-select'); break;
    case 'allowance': jumpTo('#approval-amount'); break;
    case 'budget': jumpTo('#allocation-mode'); break;
    case 'spending':
      $('#spending-controls').open = true;
      jumpTo('#spending-controls summary');
      break;
    case 'health': jumpTo('#health-refresh'); break;
    case 'native':
      $('#native-receiver').open = true;
      jumpTo('#native-receiver summary');
      break;
    case 'sample':
      if (runDemoIncome()) jumpTo('#activity-heading');
      break;
    case 'faucet': await claim(); break;
    case 'receive':
      if (!state.signer || !state.account) break;
      try {
        const account = state.account;
        await verifyWalletContext(state.injected, chainId, account);
        await navigator.clipboard.writeText(account);
        toast('Receiving address copied for ' + state.symbol + ' on ' + networkName() + '.');
      } catch (error) { toast(humanError(error), true); }
      break;
  }
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
    const exact = formatUnits(value, state.decimals);
    const n = Number(exact);
    if (!Number.isFinite(n)) return "0";
    if (n !== 0 && Math.abs(n) < 10 ** -digits) return exact;
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
  const code = err.info?.error?.code ?? err.code;
  if (Number(code) === 4100 || /has not been authorized/i.test(err.info?.error?.message || err.message || "")) {
    $("#wallet-reauthorize").hidden = false;
    return "Wallet access is missing for this network. Use Update wallet access, then retry.";
  }
  return err.shortMessage || err.reason || err.message || "Something went wrong.";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function txUrl(hash) {
  if (state.demoMode) return "";
  return hash && explorer ? `${explorer}/tx/${hash}` : "";
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
  const buckets = PRESETS[name].map(bucket => ({ ...bucket }));
  if (wrappedAsset && (name === "freelancer" || name === "team")) {
    const weights = name === "team" ? ["30", "30", "20", "10"] : ["30", "25", "15"];
    return buckets.map((bucket, index) => ({ ...bucket, fixed: "", bps: weights[index] }));
  }
  return buckets;
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

function renderWalletControls() {
  const account = walletSession?.account;
  const top = $('#connect-top');
  top.setAttribute('aria-label', account ? 'Manage connected wallet' : 'Connect wallet');
  top.setAttribute('aria-busy', String(connecting));
  setText('connect-top', account ? short(account) : connecting ? 'Connecting…' : 'Connect wallet');
  setText('wallet-label', account ? short(account) : state.demoMode ? 'Demo mode' : 'Not connected');
  setText('wallet-provider-label', walletSession?.providerLabel || '');
  $('#wallet-chip').classList.toggle('connected', Boolean(account));
  $('#wallet-provider-label').hidden = !account;
  $('#connect-workspace').hidden = Boolean(account);
  $('#disconnect').hidden = !account;
}

function connectedNetwork(chain) {
  return chain === 1n ? 'Ethereum Mainnet' : CHAIN_PARAMS[chain]?.chainName || 'Chain ' + chain;
}

function openWalletSession(injected, account, chain) {
  walletSession = { injected, account, chain, providerLabel: browserWallet.label(injected) };
  stopWalletEvents = attachWalletEvents(injected);
  $('#wallet-reauthorize').hidden = true;
  renderWalletControls();
}

function attachWalletEvents(injected) {
  const changed = message => {
    if (walletSession?.injected !== injected) return;
    disconnect();
    toast(message);
  };
  const handlers = {
    accountsChanged: accounts => {
      if (typeof accounts?.[0] !== 'string' || accounts[0].toLowerCase() !== walletSession?.account.toLowerCase()) {
        changed("The wallet account changed. Connect again to continue.");
      }
    },
    chainChanged: value => {
      if (walletSession?.injected !== injected) return;
      try {
        const chain = readWalletChainId(value);
        if (!readOnlyWallet && chain !== BigInt(chainId)) {
          changed("The wallet network changed. Reconnect to return to this plan.");
        } else if (walletSession.chain !== chain) {
          walletSession.chain = chain;
          browserWallet.closeAccount();
        }
      } catch { changed("The wallet reported an invalid network. Reconnect to continue."); }
    },
    disconnect: () => changed("The wallet lost its connection. Reconnect to continue."),
  };
  for (const [event, listener] of Object.entries(handlers)) injected.on?.(event, listener);
  return () => {
    const remove = injected.removeListener || injected.off;
    if (typeof remove === 'function') {
      for (const [event, listener] of Object.entries(handlers)) remove.call(injected, event, listener);
    }
  };
}

async function connect(trigger = document.activeElement) {
  if (walletSession) {
    const { account, chain, providerLabel } = walletSession;
    browserWallet.openAccount({ trigger, account, network: connectedNetwork(chain), providerLabel, readOnly: readOnlyWallet });
    return;
  }
  if (connecting || state.busy) return;

  const request = ++connectReadId;
  connecting = true;
  renderWalletControls();
  renderWorkspace();
  let provider;
  try {
    const injected = await browserWallet.choose({
      explicit: true, trigger, network: networkName(), readOnly: readOnlyWallet,
    });
    if (!injected || request !== connectReadId) return;
    const accounts = await injected.request({ method: "eth_requestAccounts" });
    if (request !== connectReadId) return;
    if (!Array.isArray(accounts) || !accounts[0]) throw new Error("Select an account in your wallet to continue.");
    if (readOnlyWallet) {
      const { account, chain } = await readWalletIdentity(injected, accounts[0]);
      if (request !== connectReadId) return;
      openWalletSession(injected, account, chain);
      toast("Wallet connected for address viewing.");
      return;
    }
    await switchWalletChain(injected, chainId, CHAIN_PARAMS[chainId]);
    const account = await verifyWalletContext(injected, chainId, accounts[0]);
    provider = new BrowserProvider(injected, chainId);
    const signer = await provider.getSigner(account);
    const token = new Contract(deployment.token, TOKEN_ABI, provider);
    const split = new Contract(deployment.split, SPLIT_ABI, provider);
    const [symbol, decimals, splitCode] = await Promise.all([
      token.symbol().catch(() => assetProfile.selected?.label || "token"),
      token.decimals().catch(() => null),
      provider.getCode(deployment.split),
    ]);
    if (decimals === null || Number(decimals) < 0 || Number(decimals) > 36 || splitCode === "0x") {
      throw new Error("Could not verify token precision or the split contract. Wallet actions remain disabled.");
    }
    await verifyWalletContext(injected, chainId, account);
    if (request !== connectReadId) return;
    policyDirty = false;
    try { parseUnits(state.samplePaycheck, Number(decimals)); }
    catch {
      state.samplePaycheck = "1";
      $("#sample-input").value = "1";
      $("#sample-input").removeAttribute("aria-invalid");
      $("#sample-error").hidden = true;
    }
    Object.assign(state, { provider, signer, account, token, split, symbol, injected, decimals: Number(decimals), labels: loadLabels(account) });
    openWalletSession(injected, account, BigInt(chainId));

    await refreshAll();
    if (request === connectReadId) incomeModules.refresh();
  } catch (err) {
    if (request === connectReadId) {
      const code = Number(err?.data?.originalError?.code ?? err?.code);
      const message = code === 4001 || err?.code === 'ACTION_REJECTED'
        ? 'Wallet connection or network switch declined. You can try again.'
        : code === -32002 ? 'Open your wallet to respond to the pending connection request.'
          : humanError(err);
      toast(message, true);
    }
  } finally {
    if (provider && provider !== state.provider) provider.destroy();
    if (request === connectReadId) {
      connecting = false;
      if (!walletSession) browserWallet.clearSelection();
      renderWalletControls();
      renderWorkspace();
    }
  }
}

function disconnect() {
  ++connectReadId;
  connecting = false;
  stopWalletEvents();
  stopWalletEvents = () => {};
  walletSession = null;
  browserWallet.closeAccount();
  browserWallet.clearSelection();
  $('#wallet-reauthorize').hidden = true;
  renderWalletControls();
  if (!state.signer) {
    renderWorkspace();
    return;
  }
  ++healthReadId;
  ++activityReadId;
  ++walletReadId;
  walletBlockFloor = 0;
  lastHealth = null;
  healthPanel.reset();
  incomeTrace.reset();
  manualPayment.close();
  actionReview.cancel();
  incomeModules.reset();
  planner.clear();
  policyDirty = false;
  const previousProvider = state.provider;
  state.provider = null;
  state.signer = null;
  state.injected = null;
  state.account = null;
  state.token = null;
  state.split = null;
  state.balance = 0n;
  state.allowance = 0n;
  state.syncStatus = "idle";
  state.labels = loadLabels(null);
  state.demoToken = false;
  state.faucetAmount = 0n;
  state.nextFaucetAt = 0;
  state.latestIncome = null;
  setText("faucet-progress", "");
  $("#faucet-trace").hidden = true;
  state.buckets = clonePreset("freelancer");
  state.ruleVersion = 0;
  state.allocationMode = 0;
  state.draftAllocationMode = 0;
  state.cycleConfig = {anchor:0,duration:0,revision:0};
  budgetControls.show(null, true);
  state.onchainBucketCount = 0;
  state.savedActive = null;
  state.groups = [];
  state.skips = [];
  state.activityError = false;
  state.dirty = false;
  for (const id of ["reserve", "maxPerRun", "dailyLimit", "minIncome", "expiry"]) $("#policy-" + id).value = "";
  $("#policy-paused").checked = false;
  setText("policy-status", "Connect to read onchain controls.");

  renderDisconnected();
  loadReactiveStatus();
  previousProvider?.destroy();
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

function applyWalletSnapshot(snapshot) {
  const draftMode = state.draftAllocationMode !== state.allocationMode ? state.draftAllocationMode : null;
  const { balance, allowance, buckets, version, ids, allocationMode, cycle } = snapshot;
  Object.assign(state, { balance, allowance, ruleVersion: Number(version), allocationMode: Number(allocationMode),
    cycleConfig: {anchor:Number(cycle.anchor),duration:Number(cycle.duration),revision:Number(cycle.revision)},
    onchainBucketCount: buckets.length, savedActive: buckets.filter(bucket => bucket.active).length });
  budgetControls.show(draftMode);
  if (!state.dirty) {
    state.buckets = buckets.map((bucket, i) => ({
      id: String(ids[i]), identityPayee: bucket.payee.toLowerCase(),
      label: state.labels[bucket.payee.toLowerCase()] || LABELS[bucket.payee.toLowerCase()] || "",
      payee: bucket.payee, fixed: formatUnits(bucket.fixedAmount, state.decimals),
      bps: Number(bucket.bps) > 0 ? String(Number(bucket.bps) / 100) : "", active: bucket.active,
    }));
    if (!state.buckets.length) state.buckets = clonePreset("freelancer");
    renderBuckets();
  }
  applyPolicy(snapshot);
}

async function refreshAll({ afterBlock } = {}) {
  const { account, signer, token, split, provider } = state;
  if (!signer || !configured) return;
  const request = ++walletReadId;
  if (afterBlock !== undefined) walletBlockFloor = Math.max(walletBlockFloor, afterBlock);
  const isCurrent = () => request === walletReadId && signer === state.signer;
  state.syncStatus = "reading";
  renderWorkspace();
  try {
    const snapshot = await readWalletSnapshot({ provider, account, token, split, tokenAddress: deployment.token,
      splitAddress: deployment.split }, walletBlockFloor);
    if (!isCurrent()) return;
    const faucet = state.symbol === "dUSDC" ? await readFaucet(token, account, snapshot.at) : null;
    if (!isCurrent()) return;
    applyWalletSnapshot(snapshot);
    walletBlockFloor = Number(snapshot.at.blockTag);
    Object.assign(state, { demoToken: Boolean(faucet), faucetAmount: faucet?.amount ?? 0n, nextFaucetAt: faucet?.next ?? 0,
      syncStatus: "ready" });
    lastHealth = null;
    renderConnected();
    loadReactiveStatus();
    await Promise.all([loadActivity({ head: snapshot.at.blockTag }), planner.load(snapshot.at)]);
    if (isCurrent()) await planner.preview(snapshot.at);
  } catch (error) {
    if (!isCurrent()) return;
    state.syncStatus = "unavailable";
    renderWorkspace();
    setText("policy-status", "Can’t verify the latest saved controls. Refresh the plan.");
    toast(humanError(error), true);
  }
}

async function loadActivity({ head: blockTag, publish = true } = {}) {
  const { split, account, provider } = state;
  if (!split || !account) return [];
  const request = publish ? ++activityReadId : null;
  const isCurrent = () => publish && request === activityReadId && account === state.account && provider === state.provider;

  try {
    const head = Number(blockTag ?? await provider.send("eth_blockNumber", []));
    const fromBlock = Math.max(0, head - 5000);
    const token = deployment.token;
    const [splits, retained, skipped] = await Promise.all([
      split.queryFilter(split.filters.Split(account, token), fromBlock, head),
      split.queryFilter(split.filters.Retained(account, token), fromBlock, head),
      split.queryFilter(split.filters.BucketSkipped(account, token), fromBlock, head),
    ]);
    const groups = groupWaterfallEvents({ splits, retained, skipped });
    const skips = skipped.map((event) => ({
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      bucketIndex: Number(event.args.bucketIndex),
      paycheck: event.args.paycheck,
      requested: event.args.requested,
      reason: Number(event.args.reason),
      originTxHash: event.args.originTxHash,
      logIndex: event.args.logIndex,
    }));
    // Relative time is much more useful than "block 723".
    const blockNumbers = [...new Set(groups.slice(0, 10).map((group) => group.blockNumber))];
    const blocks = await Promise.all(
      blockNumbers.map((number) => provider.getBlock(number).catch(() => null)),
    );
    const times = new Map(blocks.filter(Boolean).map((block) => [block.number, block.timestamp]));
    for (const group of groups) {
      group.timestamp = times.get(group.blockNumber) || 0;
      group.relative = group.timestamp ? timeAgo(group.timestamp) : `block ${group.blockNumber}`;
    }

    if (isCurrent()) {
      state.groups = groups;
      state.skips = skips;
      state.activityError = false;
      renderActivity();
    }
    return groups;
  } catch {
    if (isCurrent()) {
      state.groups = [];
      state.skips = [];
      state.activityError = true;
      renderActivity();
    }
    return [];
  }
}

function incomeTraceContext() {
  return {
    account: state.account, provider: state.provider, split: state.split, signer: state.signer, injected: state.injected,
    symbol: state.symbol, decimals: state.decimals, demoMode: state.demoMode,
    token: deployment.token, splitAddress: deployment.split, chainId, txLink: txUrl,
    reactiveTxLink: hash => useLocal ? "" : `${lasnaExplorer}/tx/${hash}`,
  };
}

function stageModuleBucket(address, label, destination) {
  if (state.busy) return;
  if (state.buckets.some(bucket => bucket.payee.toLowerCase() === address.toLowerCase())) {
    toast("This destination is already in the draft.");
    return;
  }
  if (state.buckets.length >= MAX_BUCKETS) {
    toast("Remove a destination before adding a module.", true);
    return;
  }
  if (destination === 'aave' && state.buckets.some(bucket => bucketDestination(bucket) === 'aave')) {
    toast("This plan already has an Aave destination.", true);
    return;
  }
  state.buckets.push({ label, payee: address, fixed: "", bps: "", active: false, destination });
  state.dirty = true;
  renderBuckets();
  updateSummary();
  $(".card-rule").scrollIntoView({ block: "start" });
  toast("Destination staged. Set its amount, enable it and save your plan.");
}

async function readIncomeReaction(ctx, income, key) {
  if (!deployment.reactive || !deployment.lasnaRpc) return { requested: null };
  const reactiveChainId = useLocal ? 31337 : 5318007;
  const request = new FetchRequest(deployment.lasnaRpc);
  request.timeout = 7000;
  const provider = new JsonRpcProvider(request, reactiveChainId, { staticNetwork: true, batchMaxCount: 1 });
  try {
    if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(reactiveChainId)) return { requested: null };
    const contract = new Contract(deployment.reactive, REACTIVE_ABI, provider);
    const requested = await contract.seen(key);
    const evidence = { chainId: reactiveChainId, contract: deployment.reactive, requested, txHash: null };
    if (!requested) return evidence;
    try {
      const head = await provider.getBlockNumber();
      const events = await contract.queryFilter(contract.filters.Seen(ctx.account, ctx.token), Math.max(0, head - 1000), head);
      const match = events.find(event => event.args.originTxHash === BigInt(income.hash)
        && event.args.logIndex === BigInt(income.logIndex) && event.args.amount === income.amount);
      if (match) evidence.txHash = match.transactionHash;
    } catch {
      // The exact-key state check still works when recent event indexing is unavailable.
    }
    return evidence;
  } finally {
    provider.destroy();
  }
}

async function recoverIncome(ctx, income) {
  if (!ctx.signer || state.busy) throw new Error("Finish the current wallet action before recovering income.");
  if (ctx.account !== state.account || ctx.signer !== state.signer) throw new Error("The connected wallet changed. Inspect the income again.");
  state.busy = true;
  try {
    const [network, accounts] = await Promise.all([
      ctx.provider.send("eth_chainId", []),
      ctx.provider.send("eth_accounts", []),
    ]);
    if (BigInt(network) !== BigInt(ctx.chainId) || accounts[0]?.toLowerCase() !== ctx.account.toLowerCase()
      || ctx.signer !== state.signer) throw new Error("The wallet or network changed. Inspect the income again.");
    const tx = await ctx.split.connect(ctx.signer).recoverSplit(ctx.token, income.amount, BigInt(income.hash), income.logIndex);
    const receipt = await tx.wait();
    if (ctx.account === state.account && ctx.signer === state.signer) {
      toast("Recovery transaction confirmed. Check the destination result for the payout.", false, tx.hash);
      await refreshAll({ afterBlock: receipt.blockNumber });
    }
  } finally {
    state.busy = false;
  }
}

async function loadReactiveStatus() {
  if(state.demoMode){
    healthPanel.apply(demoHealthReport({allowance:state.allowance,policy:demoPolicy,activeBuckets:state.buckets.filter(bucket=>bucket.active).length}));
    return;
  }
  const request=++healthReadId,account=state.account;
  try {
    const report=await collectAutomationHealth({...deployment,reactiveChainId:useLocal?31337:5318007},{account});
    if(request!==healthReadId||account!==state.account)return;
    lastHealth = report;
    renderWorkspace();
    healthPanel.apply(report,{notify:report.status!=='unconfigured'});
    const s=report.snapshot;
    setText('remaining-label',s.remaining===undefined?(report.status==='unconfigured'?'not deployed':'status unknown'):s.reactivePaused?'paused':`${s.remaining} callback slots`);
    if(account&&s.mirroredVersion!==undefined)setText('reactive-note',`Saved rule v${s.ruleVersion??'unknown'} · mirrored v${s.mirroredVersion} · user callback slots ${s.userBudget??'unknown'}.`);
    else setText('reactive-note',report.status==='unconfigured'?'Configure a verified deployment to enable live checks.':'Health checks cover platform funding. Connect a wallet to inspect your saved plan.');
  } catch {
    if(request!==healthReadId||account!==state.account)return;
    lastHealth = null;
    renderWorkspace();
    setText("remaining-label", "status unknown");
    healthPanel.apply({status:'unavailable',complete:false,scope:account?'saved-plan':'platform-only',alerts:[{id:'health-unavailable',severity:'warning',title:'Health checks could not complete',action:'Check the deployment configuration and RPC connection, then retry.'}],snapshot:{checkedAt:new Date().toISOString()}});
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
        <select class="bucket-destination-select" data-destination="${index}" aria-label="Destination type for bucket ${index + 1}">
          <option value="wallet">Wallet transfer</option>
          <option value="aave">Aave V3 supply</option>
        </select>
        <input class="bucket-payee" data-i="${index}" data-f="payee" type="text" aria-label="Bucket payee address"
          placeholder="0x… payee" autocomplete="off" spellcheck="false" value="${escapeAttr(bucket.payee)}" />
        <div class="bucket-savings" hidden>
          <p class="bucket-savings-note" role="status"></p>
          <button class="btn btn-small btn-outline bucket-savings-action" data-savings-action="${index}" type="button" hidden></button>
        </div>
      </div>
      <div class="bucket-amounts">
        <label class="bucket-amount-field">
          <span class="bucket-amount-caption">Fixed amount</span>
          <span class="bucket-input">
            <input data-i="${index}" data-f="fixed" type="text" inputmode="decimal" aria-label="Fixed amount in ${escapeAttr(state.symbol)}"
              placeholder="0" value="${escapeAttr(bucket.fixed)}" />
          </span>
        </label>
        <label class="bucket-amount-field">
          <span class="bucket-amount-caption">Percentage</span>
          <span class="bucket-input">
            <input data-i="${index}" data-f="bps" type="text" inputmode="decimal" aria-label="Percentage for this destination"
              placeholder="0" value="${escapeAttr(bucket.bps)}" />
            <span class="bucket-suffix" aria-hidden="true">%</span>
          </span>
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
  renderBucketDestinations();
}

function bucketDestination(bucket, savings = incomeModules.savingsDestination()) {
  return bucket.destination === 'aave'
    || (savings.address && bucket.payee.trim().toLowerCase() === savings.address.toLowerCase()) ? 'aave' : 'wallet';
}

function renderBucketDestinations() {
  const savings = incomeModules.savingsDestination();
  const chosen = state.buckets.findIndex(bucket => bucketDestination(bucket, savings) === 'aave');
  const messages = {
    sample: 'Simulated supply allocation.',
    unsupported: 'Aave is unavailable for this asset.',
    connect: 'Connect your wallet to set up supply.',
    checking: 'Checking the configured adapter…',
    unavailable: 'The configured Aave adapter could not be verified.',
    create: 'Create a savings adapter for this wallet and asset.',
    bind: 'Enable the adapter before saving this destination.',
    ready: useLocal ? 'Local mock reserve · simulated supply.' : 'Your wallet receives aTokens. The supply rate varies.',
    working: 'Waiting for your wallet or confirmation…',
  };
  const actions = { connect: 'Connect wallet', unavailable: 'Check setup', create: 'Create adapter', bind: 'Enable supply' };

  for (const row of $("#buckets-list").children) {
    const select = row.querySelector('[data-destination]');
    if (!select) continue;
    const index = Number(select.dataset.destination);
    const bucket = state.buckets[index];
    if (!bucket) continue;
    const isSavings = bucketDestination(bucket, savings) === 'aave';
    const savingsOption = select.options[1];
    savingsOption.disabled = !isSavings && (savings.step === 'unsupported' || (chosen >= 0 && chosen !== index));
    savingsOption.textContent = savings.step === 'unsupported' && !isSavings ? 'Aave V3 unavailable' : 'Aave V3 supply';
    select.value = isSavings ? 'aave' : 'wallet';
    const walletField = row.querySelector('.bucket-payee');
    walletField.hidden = isSavings;
    walletField.disabled = isSavings;
    row.querySelector('.bucket-savings').hidden = !isSavings;
    if (!isSavings) continue;

    bucket.destination = 'aave';
    if (!bucket.payee && (savings.step === 'ready' || savings.step === 'sample')) bucket.payee = savings.address;
    const differs = savings.step === 'ready' && bucket.payee.toLowerCase() !== savings.address.toLowerCase();
    const note = row.querySelector('.bucket-savings-note');
    note.textContent = differs ? 'The bound adapter changed. Select Wallet transfer, then reselect Aave.' : messages[savings.step];
    const action = row.querySelector('[data-savings-action]');
    action.textContent = actions[savings.step] || '';
    action.hidden = !actions[savings.step];
    action.dataset.step = savings.step;
    action.disabled = state.busy;
  }
}

function setBucketDestination(index, destination) {
  const bucket = state.buckets[index];
  if (!bucket || state.busy || !['wallet', 'aave'].includes(destination) || bucketDestination(bucket) === destination) {
    renderBucketDestinations();
    return;
  }
  const savings = incomeModules.savingsDestination();
  if (destination === 'aave') {
    if (savings.step === 'unsupported' || state.buckets.some((other, i) => i !== index && bucketDestination(other, savings) === 'aave')) {
      renderBucketDestinations();
      return;
    }
    bucket.walletPayee = bucket.payee;
    bucket.payee = savings.step === 'ready' || savings.step === 'sample' ? savings.address : '';
    if (!bucket.label) bucket.label = 'Aave savings';
  } else {
    bucket.payee = bucket.walletPayee?.trim().toLowerCase() === savings.address?.toLowerCase() ? '' : bucket.walletPayee || '';
    delete bucket.walletPayee;
  }
  bucket.destination = destination;
  const row = $("#buckets-list").children[index];
  row.querySelector('.bucket-payee').value = bucket.payee;
  row.querySelector('.bucket-label').value = bucket.label || '';
  state.dirty = true;
  clearRuleError();
  renderBucketDestinations();
  updateSummary();
}

function updateSummary() {
  const active = state.buckets.filter((bucket) => bucket.active);
  if(state.demoMode)healthPanel.apply(demoHealthReport({allowance:state.allowance,policy:demoPolicy,activeBuckets:active.length}));
  const sample = parseUnits(state.samplePaycheck, state.decimals);

  setText("rule-buckets", String(active.length));
  setText("rule-version", state.ruleVersion ? `v${state.ruleVersion}` : "—");

  const pill = $("#rule-pill");
  if (state.demoMode) {
    pill.textContent = active.length ? "Demo" : "Demo paused";
    pill.className = active.length ? "pill active" : "pill warn";
  } else if (!state.account) {
    pill.textContent = active.length ? "Draft" : "Not set";
    pill.className = "pill";
  } else if (state.dirty || !state.onchainBucketCount) {
    pill.textContent = state.dirty ? "Unsaved changes" : "Draft";
    pill.className = state.dirty ? "pill warn" : "pill";
  } else {
    pill.textContent = state.savedActive ? "Saved plan" : "Paused";
    pill.className = state.savedActive ? "pill active" : "pill warn";
  }
  setText('editor-allocation-note', state.draftAllocationMode === 1
    ? 'Shares of available budget' : 'Fixed amounts in ' + state.symbol + ' and % of income');

  let result;
  try {
    const draft = active.map(bucket => ({ ...bucket, ...readBucketAmounts(bucket) }));
    if (draft.reduce((sum, bucket) => sum + bucket.bps, 0) > 10_000) throw new Error("Destination percentages exceed 100%.");
    result = calculateRun(draft, sample, sample, sample, undefined, undefined, undefined, undefined, state.draftAllocationMode);
    setText("sample-note", "Allocation before spending limits");
  } catch (error) {
    result = { splits: [], paid: 0n, retained: sample };
    setText("sample-note", error.message);
  }
  const { paid: routed, retained: remaining } = result;
  const percent = amount => Number(amount * 10_000n / sample) / 100;
  const rows = result.splits.map(({ bucketIndex, amount }) => ({
    label: active[bucketIndex].label || labelFor(active[bucketIndex].payee),
    paid: amount,
    pct: percent(amount),
    color: COLORS[bucketIndex % COLORS.length],
  }));
  if (active.length) setBigPercent(String(Math.round(percent(routed) * 10) / 10), false);
  else setBigPercent("—", true);

  setText("rule-routed", `${fmt(routed)} ${state.symbol}`);
  setText("allocated-label", `${fmt(routed)} routed`);

  const bar = $("#waterfall-bar");
  const segments = rows.filter(row => row.paid > 0n);
  if (remaining > 0) {
    segments.push({ label: "Retained", paid: remaining, pct: percent(remaining), color: "", retained: true });
  }
  segments.forEach((segment, index) => {
    let node = bar.children[index];
    if (!node) {
      node = document.createElement("span");
      bar.append(node);
    }
    node.className = segment.retained ? "waterfall-seg waterfall-retained" : "waterfall-seg";
    node.style.width = `${segment.pct}%`;
    node.style.background = segment.color;
    node.title = `${segment.label}: ${fmt(segment.paid)}`;
  });
  while (bar.children.length > segments.length) bar.lastElementChild.remove();

  const legend = $("#waterfall-legend");
  legend.innerHTML = "";
  rows.forEach((row) => {
    const item = document.createElement("span");
    item.className = "wf-legend-item";
    item.innerHTML = `<i style="background:${row.color}"></i>${escapeAttr(row.label)} <b>${fmt(row.paid)}</b>`;
    legend.append(item);
  });
  if (remaining > 0) {
    const item = document.createElement("span");
    item.className = "wf-legend-item";
    item.innerHTML = `<i class="retained-dot"></i>Retained <b>${fmt(remaining)}</b>`;
    legend.append(item);
  }
  setText("retained-label", `${fmt(remaining)} / ${fmt(sample)}`);

  if (state.account) {
    $("#save-rule").disabled = !state.dirty && !!state.onchainBucketCount;
    setText('save-rule', state.dirty || !state.onchainBucketCount ? 'Save destinations' : 'Destinations saved');
  }
  $('#pause-rule').disabled = !state.demoMode && !state.savedActive;
  renderWorkspace();
  planner.sync();
}

function updateModeUI() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  setText("waterfall-title", state.mode === "team" ? "Team payroll waterfall" : "Your waterfall");
}

function renderDisconnected() {
  if (!state.buckets.length) state.buckets = clonePreset("freelancer");
  updateModeUI();
  renderBuckets();
  updateSummary();

  setText("token-balance", "— " + state.symbol);
  setText("sample-unit", state.symbol);
  setText("approval-unit", "(" + state.symbol + ")");
  if (document.activeElement !== $("#sample-input")) $("#sample-input").value = String(state.samplePaycheck);
  setText("allowance-pill", "Allowance —");
  setText("allowance-status", "");
  setText("split-count", "0 splits");
  setText("total-saved", "0.00");
  setText("total-retained", "0.00");
  setText("last-split", "—");

  $("#save-rule").disabled = true;
  $("#save-rule").textContent = "Connect to save";
  $("#approve-btn").disabled = true;
  $("#faucet-btn").disabled = true;
  setText('faucet-title', 'Receive income');
  setText('faucet-note', 'Connect your wallet to see how to receive this asset.');
  $("#faucet-btn").hidden = true;
  $('#revoke-allowance').disabled = true;
  renderActivity();
}

function renderConnected() {
  setText("token-balance", `${fmt(state.balance)} ${state.symbol}`);
  setText("sample-unit", state.symbol);
  setText("approval-unit", "(" + state.symbol + ")");
  if (document.activeElement !== $("#sample-input")) $("#sample-input").value = String(state.samplePaycheck);
  setText("total-saved-unit", state.symbol);
  setText("total-retained-unit", state.symbol);
  setText(
    "faucet-title",
    state.demoToken ? "Test income" : "Receive " + state.symbol,
  );
  setText(
    "faucet-note",
    state.demoToken
      ? "A test transfer lets you inspect the automatic payout."
      : "Share your wallet address with someone sending " + state.symbol + " on " + networkName() + ".",
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
  pill.textContent = state.allowance === MaxUint256 ? 'Unlimited allowance' : approved
    ? 'Allowance: ' + formatUnits(state.allowance, state.decimals) : "Allowance —";
  $('#revoke-allowance').disabled = !approved;
  renderWorkspace();
  if (state.demoMode) { planner.preview(); loadReactiveStatus(); }
}

function renderFaucet() {
  const btn = $("#faucet-btn");
  btn.hidden = !state.demoMode && !state.demoToken;
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
    list.dataset.latestRun = "";
    list.innerHTML = `
      <div class="empty">
        <span class="empty-mark">◎</span>
        <p>Your first waterfall run will appear here.</p>
        <span>Set buckets, approve, then claim a demo income.</span>
      </div>`;
    return;
  }

  list.innerHTML = "";
  const newest = state.groups[0];
  const latestRun = newest ? [newest.txHash, newest.originHash, newest.logIndex].join(":") : "";
  const hasNewRun = list.dataset.latestRun !== undefined && list.dataset.latestRun !== latestRun;
  list.dataset.latestRun = latestRun;

  if (splitCount > 0) {
    const summary = document.createElement("div");
    summary.className = "activity-run-summary";
    summary.textContent = `${splitCount} split${splitCount === 1 ? "" : "s"} across ${runCount} run${runCount === 1 ? "" : "s"}`;
    list.append(summary);
  }

  for (const group of state.groups.slice(0, 10)) {
    const wrapper = document.createElement("div");
    wrapper.className = "activity-group";
    if (group === newest && hasNewRun) wrapper.classList.add("motion-enter");

    const head = document.createElement("div");
    head.className = "activity-group-head";
    const left = document.createElement("span");
    const runLabel = state.demoMode ? 'Sample income' : group.originHash ? 'Income payout' : 'Manual payment';
    left.textContent = `${runLabel} · ${short(group.txHash)}`;
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
    if (group.originHash) {
      const trace = document.createElement("button");
      trace.type = "button";
      trace.className = "link-btn";
      trace.textContent = "Trace income";
      trace.addEventListener("click", () => incomeTrace.open(group.originHash, group.logIndex));
      actions.append(trace);
    }
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

      const bucket = !state.dirty && group.version === state.ruleVersion ? state.buckets[split.bucketIndex] : null;
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
  if (!payee && bucket.destination === 'aave') throw new Error('Finish Aave setup before saving this destination.');
  if (!active && !payee) payee = ZERO;
  if (!payee) throw new Error("Every active bucket needs a payee.");
  const parsedPayee = getAddress(payee);
  if (active && parsedPayee === ZERO) {
    throw new Error("An active bucket needs a non-zero payee.");
  }
  if (active && parsedPayee.toLowerCase() === state.account?.toLowerCase()) {
    throw new Error("A bucket payee cannot be your spending wallet.");
  }
  if (active && parsedPayee.toLowerCase() === deployment.split.toLowerCase()) {
    throw new Error("A bucket payee cannot be the split contract.");
  }

  const { fixedAmount, bps } = readBucketAmounts(bucket);
  if (active && fixedAmount === 0n && bps === 0) throw new Error("An active bucket needs a fixed amount or a percentage.");

  return { payee: parsedPayee, fixedAmount, bps, active };
}

function readBucketAmounts(bucket) {
  let fixedAmount, rate;
  try { fixedAmount = parseUnits(bucket.fixed.trim() || "0", state.decimals); }
  catch { throw new Error("Enter fixed amounts in " + state.symbol + " at its supported precision."); }
  if (fixedAmount < 0n || fixedAmount >= 2n ** 96n) throw new Error("Fixed amount is outside the supported range.");
  try { rate = parseUnits(String(bucket.bps || "0").trim() || "0", 2); }
  catch { throw new Error("Enter percentages with up to two decimal places."); }
  if (rate < 0n || rate > 10_000n) throw new Error("Percentage must be between 0% and 100%.");
  return { fixedAmount, bps: Number(rate) };
}

function reviewFacts() {
  return [
    ['Asset', state.symbol],
    ['Workspace', state.demoMode ? 'Local simulation' : networkName()],
    ...(!state.demoMode && state.account ? [['Wallet', state.account]] : []),
  ];
}

function reviewWalletIsCurrent(signer) {
  if (!state.busy && signer === state.signer) return true;
  toast('The workspace changed. Review your selection again.', true);
  return false;
}

function reviewSavingsSetup({ trigger, step, adapter }) {
  const creating = step === 'create';
  return actionReview.open({
    trigger,
    title: creating ? 'Create an Aave adapter?' : 'Enable Aave supply?',
    description: creating
      ? 'This creates the adapter for your wallet and asset. You can enable it in the next step.'
      : 'This links the verified adapter to your waterfall. Save the destination and its amount after enabling it.',
    facts: [
      ...reviewFacts(),
      [useLocal ? 'Mock pool' : 'Aave V3 pool', deployment.modules.aavePool],
      ...(!creating ? [['Adapter', adapter]] : []),
    ],
    note: useLocal ? 'This workspace uses a mock reserve for local testing.'
      : 'When income is routed to this destination, your wallet receives aTokens. The supply rate varies.',
    confirm: 'Continue to wallet',
  });
}

async function reviewTemplate(trigger, preset) {
  const { signer, dirty, buckets, symbol } = state;
  const proRata = preset === 'balanced' || preset === 'emergency';
  const draft = JSON.stringify(buckets);
  const confirmed = await actionReview.open({
    trigger,
    title: 'Preview ' + trigger.textContent.trim(),
    description: dirty ? 'Applying this template replaces the destinations in your unsaved draft.' : 'Review the example allocations before adding them to your draft.',
    facts: [['Asset', symbol], ['Allocation', proRata ? 'Share of available budget' : 'By priority']],
    rows: PRESETS[preset].map(({ label, fixed, bps, active }) => ({
      label,
      address: 'Example recipient',
      terms: Number(fixed) > 0 ? `${fixed} ${symbol} fixed` : `${bps}%`,
      active,
    })),
    note: state.demoMode ? 'Run a sample income to see the result.'
      : 'Edit the example recipients and amounts before saving.',
    confirm: 'Apply to draft',
  });
  if (!confirmed || !reviewWalletIsCurrent(signer)) return false;
  if (JSON.stringify(state.buckets) === draft) return true;
  toast('The draft changed. Preview the template again.', true);
  return false;
}

function saveReviewRows(buckets) {
  const percentageBase = state.allocationMode === 1 ? 'of available budget' : 'of income';
  return buckets.map(({ payee, fixedAmount, bps, active }, index) => {
    const draft = state.buckets[index];
    const savings = bucketDestination(draft) === 'aave';
    const label = draft.label?.trim() || (savings ? 'Aave V3 supply' : 'Wallet transfer');
    const fixed = fixedAmount > 0n ? `${formatUnits(fixedAmount, state.decimals)} ${state.symbol} fixed` : '';
    const rate = bps > 0 ? `${bps / 100}% ${percentageBase}` : '';
    return {
      label: savings && label !== 'Aave V3 supply' ? `${label} · Aave V3 supply` : label,
      address: payee === ZERO ? 'No recipient' : payee,
      terms: [fixed, rate].filter(Boolean).join(' + '),
      active,
    };
  });
}

async function saveRule(event) {
  event.preventDefault();
  if (!state.signer) {
    await connect();
    return;
  }
  if (state.busy) return;
  if (state.syncStatus !== "ready") { toast("Refresh the onchain plan first.", true); return; }
  clearRuleError();

  let buckets;
  let savingsPayee;
  try {
    if (!state.buckets.length) throw new Error("Add at least one destination.");
    buckets = state.buckets.map(bucketFromEditor);
    if (buckets.some(bucket => bucket.payee.toLowerCase() === SAMPLE_SAVINGS_DESTINATION)) {
      throw new Error("Replace the simulated Aave destination with a configured adapter before saving.");
    }
    const savingsBuckets = state.buckets.filter(bucket => bucketDestination(bucket) === 'aave');
    if (savingsBuckets.length > 1) throw new Error("Use one Aave destination per asset.");
    savingsPayee = savingsBuckets[0]?.payee;
    if (chainId !== 31337 && buckets.some(bucket => bucket.active && SAMPLE_PAYEES.has(bucket.payee.toLowerCase()))) {
      throw new Error("Replace the template’s sample addresses with your own recipients before saving.");
    }
    const totalBps = buckets.filter((bucket) => bucket.active).reduce((sum, bucket) => sum + bucket.bps, 0);
    if (totalBps > 10_000) throw new Error("Active percentages cannot exceed 100%.");
    if (state.allocationMode === 1 && buckets.some(bucket => bucket.active && bucket.fixedAmount > 0n)) {
      throw new Error("Pro-rata mode uses percentages. Clear the fixed amounts or save priority mode first.");
    }
  } catch (err) {
    showRuleError(err.message);
    toast(err.message, true);
    return;
  }

  const button = $("#save-rule");
  const { signer, split, account, provider, injected, ruleVersion, allocationMode, draftAllocationMode } = state;
  const ids = state.buckets.map((bucket, index) => bucket.identityPayee === buckets[index].payee.toLowerCase()
    && /^\d+$/.test(bucket.id || '') ? BigInt(bucket.id) : 0n);
  const draft = JSON.stringify(state.buckets);
  const confirmed = await actionReview.open({
    trigger: event.submitter || button,
    title: 'Review destinations',
    description: 'Check the recipient addresses and allocation order before saving your waterfall.',
    facts: [...reviewFacts(), ['Allocation', allocationMode === 1 ? 'Share of available budget' : 'By priority']],
    rows: saveReviewRows(buckets),
    note: draftAllocationMode !== allocationMode
      ? 'These destinations use the current mode shown above. Save your pending mode change in Allocation settings.'
      : 'Saving updates the rules for future runs. Set a spending limit separately to let the waterfall route income.',
    confirm: 'Continue to wallet',
  });
  if (!confirmed || !reviewWalletIsCurrent(signer)) return;
  if (state.syncStatus !== 'ready' || state.ruleVersion !== ruleVersion || state.allocationMode !== allocationMode
      || state.draftAllocationMode !== draftAllocationMode || JSON.stringify(state.buckets) !== draft) {
    showRuleError('The saved plan or draft changed. Review the current destinations again.');
    return;
  }

  state.busy = true;
  $("#rule-form").inert = true;
  setBusy(button, "Saving…", true);
  try {
    const at = { blockTag: await provider.send('eth_blockNumber', []) };
    const [version, mode] = await Promise.all([
      split.ruleVersion(account, deployment.token, at),
      split.allocationModes(account, deployment.token, at),
      savingsPayee ? incomeModules.verifySavingsDestination(savingsPayee) : undefined,
    ]);
    if (version !== BigInt(ruleVersion) || Number(mode) !== allocationMode) {
      throw new Error('The saved rule changed. Refresh the workspace before saving.');
    }
    await verifyWalletContext(injected, chainId, account);
    if (signer !== state.signer) return;
    const tx = await split.connect(signer).setBucketsWithIds(deployment.token, buckets, ids);
    clearRuleError();
    toast("Destination changes submitted.", false, tx.hash);
    const receipt = await tx.wait();
    if (signer !== state.signer) return;
    rememberLabels();
    state.dirty = false;
    lastHealth = null;
    await refreshAll({ afterBlock: receipt.blockNumber });
    toast("Destinations saved. Check automation before receiving income.", false, tx.hash);
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    state.busy = false;
    $("#rule-form").inert = false;
    setBusy(button, "", false);
    updateSummary();
  }
}

function readAllowanceAmount() {
  try {
    const amount = parseUnits($("#approval-amount").value.trim(), state.decimals);
    if (amount > 0n && amount < MaxUint256) return amount;
  } catch {
    // Give the same amount guidance for formatting, precision and range errors.
  }
  throw new Error("Enter a positive, finite " + state.symbol + " amount. Use Revoke allowance to clear it.");
}

async function approve() {
  if (state.busy || (!state.demoMode && !state.signer)) return;
  if (!state.demoMode && state.syncStatus !== "ready") { toast("Refresh the onchain plan before approving.", true); return; }
  let requested;
  try { requested = readAllowanceAmount(); }
  catch (error) { showAllowanceStatus(error.message); return; }
  await reviewAllowance(requested, $("#approve-btn"));
}

async function reviewAllowance(requested, button) {
  const { allowance, signer, demoMode, decimals, symbol } = state;
  const revoking = requested === 0n;
  const confirmed = await actionReview.open({
    trigger: button,
    title: revoking ? 'Revoke spending permission?' : 'Review spending limit',
    description: revoking
      ? 'Setting the allowance to zero prevents the waterfall from pulling more funds under this permission. Your saved destinations stay available.'
      : 'This is the maximum the split contract can pull from your wallet for this asset.',
    facts: [
      ...reviewFacts(),
      ['Last known allowance', allowance === MaxUint256 ? 'Unlimited' : `${formatUnits(allowance, decimals)} ${symbol}`],
      ['Requested allowance', `${formatUnits(requested, decimals)} ${symbol}`],
      ...(!demoMode ? [['Spending contract', deployment.split]] : []),
    ],
    note: demoMode ? 'This changes the simulator in this tab.'
      : revoking ? 'The transaction status appears below the spending controls.'
        : 'If a different limit is already set, your wallet may ask you to clear it before approving the new one.',
    confirm: demoMode ? (revoking ? 'Revoke demo allowance' : 'Set demo allowance') : 'Continue to wallet',
  });
  if (!confirmed || !reviewWalletIsCurrent(signer)) return;
  if (demoMode) {
    state.allowance = requested;
    renderAllowance();
    showAllowanceStatus(revoking ? 'Demo allowance revoked.' : 'Demo allowance updated.');
    return;
  }
  await changeAllowance(requested, button);
}

function showAllowanceStatus(message, hash) {
  const status = $("#allowance-status");
  status.textContent = message;
  const href = hash ? txUrl(hash) : null;
  if (!href) return;
  const link = document.createElement("a");
  link.className = "trace-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "View transaction ↗";
  status.append(" ", link);
}

async function changeAllowance(requested, button) {
  state.busy = true;
  const { token, account, signer, provider, injected } = state;
  const isCurrent = () => signer === state.signer && provider === state.provider;
  let lastReceipt;
  let clearedForReplacement = false;
  setBusy(button, requested === 0n ? "Revoking…" : "Approving…", true);
  showAllowanceStatus("Checking the onchain allowance…");

  async function requireWallet() {
    await verifyWalletContext(injected, chainId, account);
    if (!isCurrent()) throw new Error("The wallet changed. Connect again to update its allowance.");
  }

  try {
    await requireWallet();
    const { allowance, blockNumber, receipt } = await updateWalletAllowance({
      provider, token, account, splitAddress: deployment.split, requested, afterBlock: walletBlockFloor,
      onReset: () => showAllowanceStatus("Clear the current allowance in your wallet before approving the new amount."),
      submit: async amount => {
        clearedForReplacement = amount > 0n && !!lastReceipt;
        await requireWallet();
        const tx = await token.connect(signer).approve(deployment.split, amount);
        if (isCurrent()) showAllowanceStatus("Allowance transaction submitted. Waiting for confirmation…", tx.hash);
        const receipt = await tx.wait();
        if (receipt?.status === 1) {
          lastReceipt = receipt;
          clearedForReplacement = false;
        }
        return receipt;
      },
    });
    if (!isCurrent()) return;
    state.allowance = allowance;
    lastHealth = null;
    if (!receipt) {
      showAllowanceStatus(requested === 0n ? "The onchain allowance is already zero." : "The requested allowance is already set.");
    } else if (allowance === requested) {
      showAllowanceStatus(requested === 0n ? "Onchain allowance revoked." : "Onchain allowance confirmed.", receipt.hash);
    } else {
      showAllowanceStatus("Transaction confirmed. Current allowance is " + formatUnits(allowance, state.decimals)
        + " " + state.symbol + ".", receipt.hash);
    }
    await refreshAll({ afterBlock: blockNumber });
  } catch (error) {
    if (isCurrent()) {
      const prefix = !lastReceipt ? "" : clearedForReplacement
        ? "The old allowance was cleared. " : "An allowance transaction confirmed. ";
      showAllowanceStatus(prefix + humanError(error), lastReceipt?.hash);
      if (lastReceipt) await refreshAll({ afterBlock: lastReceipt.blockNumber });
    }
  } finally {
    state.busy = false;
    setBusy(button, "", false);
    renderAllowance();
  }
}

function runDemoIncome(silent = false) {
  if (!silent && $("#sample-input").getAttribute("aria-invalid") === "true") { jumpTo("#sample-input"); return false; }
  const paycheck = parseUnits(String(state.samplePaycheck), state.decimals);
  const day = Math.floor(Date.now() / 86400000);
  if (day !== demoDay) { demoSpent = 0n; demoDay = day; }
  let result;
  try {
    const buckets=state.buckets.map(bucketFromEditor);
    if(buckets.reduce((sum,b)=>sum+(b.active?b.bps:0),0)>10000) throw new Error('Active percentages cannot exceed 100%.');
    result = calculateRun(buckets, paycheck,
      state.balance + paycheck, state.allowance, demoPolicy, demoSpent, undefined, planner.getGoals(), state.allocationMode, state.cycleConfig);
  } catch(err) {toast(err.message,true);return;}
  const { splits } = result;
  demoSpent += result.paid;
  if (state.allowance !== MaxUint256) state.allowance -= result.paid;

  const nonce = ++state.demoNonce;
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
  if (!silent) toast(`Sample run: ${formatUnits(result.paid, state.decimals)} routed, ${formatUnits(result.retained, state.decimals)} retained.`);
  return true;
}

async function pauseAll() {
  if (state.busy || (!state.demoMode && (!state.signer || !state.savedActive))) return;
  const { signer, split, account, provider, injected, ruleVersion, savedActive } = state;
  const confirmed = await actionReview.open({
    trigger: $("#pause-rule"),
    title: 'Pause all destinations?',
    description: state.demoMode ? 'All destinations in this sample plan will become inactive.'
      : 'All saved destinations for this asset will become inactive. Your spending allowance and any unsaved draft stay available.',
    facts: [...reviewFacts(), ['Active destinations', String(state.demoMode ? state.buckets.filter(bucket => bucket.active).length : savedActive)]],
    note: state.demoMode ? 'Turn destinations back on to resume the sample.'
      : 'To resume routing, turn destinations back on and save the plan.',
    confirm: state.demoMode ? 'Pause sample plan' : 'Continue to wallet',
  });
  if (!confirmed || !reviewWalletIsCurrent(signer)) return;
  if (state.demoMode) {
    state.buckets = state.buckets.map((bucket) => ({ ...bucket, active: false }));
    state.dirty = true;
    renderBuckets();
    updateSummary();
    toast("Demo rule paused. All buckets are inactive.");
    return;
  }
  state.busy = true;
  try {
    const at = { blockTag: await provider.send('eth_blockNumber', []) };
    const [raw, version] = await Promise.all([
      split.getBuckets(account, deployment.token, at),
      split.ruleVersion(account, deployment.token, at),
    ]);
    if (version !== BigInt(ruleVersion)) throw new Error('The saved plan changed. Refresh it before pausing destinations.');
    const buckets = raw.map(({ payee, fixedAmount, bps }) => ({ payee, fixedAmount, bps, active: false }));
    await verifyWalletContext(injected, chainId, account);
    if (signer !== state.signer || !buckets.length) return;
    const tx = await split.connect(signer).setBuckets(deployment.token, buckets);
    const receipt = await tx.wait();
    if (signer !== state.signer) return;
    lastHealth = null;
    await refreshAll({ afterBlock: receipt.blockNumber });
    toast("Saved destinations paused. Any draft remains in the editor.", false, tx.hash);
  } catch (err) {
    toast(humanError(err), true);
  } finally {
    state.busy = false;
    updateSummary();
  }
}

async function revokeAllowance() {
  if (state.busy || (!state.demoMode && !state.signer) || state.allowance === 0n) return;
  await reviewAllowance(0n, $("#revoke-allowance"));
}

function runNow() {
  if (state.demoMode) { runDemoIncome(); return; }
  if (!state.signer) return;
  if (!manualPayment.hasPending() && (state.busy || state.syncStatus !== "ready" || state.dirty || !state.savedActive)) return;
  manualPayment.open($("#sample-input").value);
}

async function readManualQuote(ctx, amount) {
  if (!ctx.signer || ctx.signer !== state.signer || state.syncStatus !== "ready" || state.dirty || policyDirty
    || state.draftAllocationMode !== state.allocationMode) {
    throw new Error("Save your changes and check the current plan before reviewing a payment.");
  }
  const at = { blockTag: await ctx.provider.send('eth_blockNumber', []) };
  const [version, result, buckets] = await Promise.all([
    ctx.split.ruleVersion(ctx.account, ctx.token, at),
    ctx.split.previewExecution(ctx.account, ctx.token, amount, at),
    ctx.split.getBuckets(ctx.account, ctx.token, at),
  ]);
  const reason = ['','Your spending plan is paused.','Your spending plan expired.','This amount is below your income minimum.',
    'Payments are paused for this deployment.','Your payday cycle has not started.'][Number(result[2])];
  if (reason) throw new Error(reason);
  const quote = recoveryQuote(version, result, buckets, { amount });
  if (!quote) throw new Error('No payable amount for this plan. Check your balance, allowance and spending limits.');
  return quote;
}

async function submitManualPayment({ ctx, amount, quote }, isCurrent, onSigning) {
  if (state.busy) throw new Error('Finish the current wallet action first.');
  state.busy = true;
  try {
    const latest = await readManualQuote(ctx, amount);
    if (paymentQuoteKey(quote) !== paymentQuoteKey(latest)) return { quote: latest };
    const request = await ctx.split.runSplit.populateTransaction(ctx.token, amount);
    const startBlock = await ctx.provider.getBlockNumber();
    await verifyWalletContext(ctx.injected, chainId, ctx.account);
    if (!isCurrent(ctx) || state.dirty || policyDirty || state.draftAllocationMode !== state.allocationMode) {
      throw new Error('Your wallet or plan changed. Preview the payment again.');
    }
    onSigning();
    // Track the wallet's broadcast hash before an RPC has indexed the transaction.
    const hash = await ctx.signer.sendUncheckedTransaction(request);
    return { transaction: {
      hash,
      async wait(confirmations, timeout) {
        const response = await ctx.provider.getTransaction(hash);
        return response
          ? response.replaceableTransaction(startBlock).wait(confirmations, timeout)
          : ctx.provider.waitForTransaction(hash, confirmations, timeout);
      },
    } };
  } finally {
    state.busy = false;
  }
}

async function claim() {
  if (state.demoMode) {
    runDemoIncome();
    return;
  }
  if (!state.signer || state.busy || !state.demoToken || state.syncStatus !== "ready") return;
  state.busy = true;
  const button = $("#faucet-btn");
  const { account, signer, token } = state;
  setBusy(button, "Claiming…", true);

  try {
    const tx = await token.connect(signer).faucet();
    toast("Test income submitted. Waiting for confirmation…", false, tx.hash);
    const receipt = await tx.wait();
    if (signer !== state.signer) return;
    const [income] = incomeTransfers(receipt, receipt.hash.toLowerCase(), account, deployment.token);
    const tracked = { signer, income };
    state.latestIncome = tracked;
    $("#faucet-trace").hidden = false;
    setText("faucet-progress", "Income confirmed. Waiting for Reactive to deliver the callback.");
    await refreshAll({ afterBlock: receipt.blockNumber });
    void followIncome(tracked);
  } catch (err) {
    if (signer === state.signer) toast(humanError(err), true);
  } finally {
    state.busy = false;
    setBusy(button, "", false);
    if (signer === state.signer) { renderFaucet(); renderWorkspace(); }
  }
}

async function followIncome(tracked) {
  const isCurrent = () => state.latestIncome === tracked && state.signer === tracked.signer;
  for (let check = 0; check < 10 && isCurrent(); check++) {
    const groups = await loadActivity({ publish: false });
    if (!isCurrent()) return;
    const payout = matchedPayout(groups, tracked.income);
    if (payout) {
      setText("faucet-progress", `Callback confirmed. ${formatUnits(payout.totalRouted, state.decimals)} ${state.symbol} routed.`);
      await refreshAll({ afterBlock: payout.blockNumber });
      return;
    }
    await sleep(3000);
  }
  if (isCurrent()) setText("faucet-progress", "The payout is still unconfirmed. Use Income trace to check its source and callback.");
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */


function exportCsv() {
  if (!state.groups.length) {
    toast("No waterfall runs to export yet.", true);
    return;
  }

  const csv = exportLedger(state.groups, {
    chainId, token: deployment.token, labelFor, decimals: state.decimals, simulated: state.demoMode,
  });
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


function openImport() {
  const dialog = $("#import-dialog");
  if (!dialog) return;
  $("#import-text").value = "";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function applyImport() {
  try {
    const buckets = importRecipients($("#import-text").value, state.decimals, MAX_BUCKETS);
    buckets.forEach(bucketFromEditor);
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
  budgetControls.wire();
  healthPanel.wire();
  incomeTrace.wire();
  incomeModules.wire();
  wireCctpCollection({
    $, deployment, demoMode: state.demoMode, isWalletBusy: () => state.busy || connecting,
    setWalletBusy: value => { state.busy = value; },
    chooseWallet: () => browserWallet.choose({ reuse: true }),
  });
  wireTestnetDeployment({
    $, usingSession: usingSessionDeployment,
    busy: () => state.busy || connecting,
    canSwitch: () => !hasWorkspaceDraft() || window.confirm("Open another deployment and discard the current unsaved draft?"),
    refreshWorkspace: session => {
      const url = new URL(location.href);
      for (const key of ['local', 'demo', 'asset', 'deployment']) url.searchParams.delete(key);
      if (session) url.searchParams.set('deployment', 'session');
      url.hash = 'dashboard';
      location.assign(url);
    },
  });
  $("#save-policy").addEventListener("click", savePolicy);
  document.querySelectorAll('input[id^="policy-"]').forEach(el => el.addEventListener("input", () => {
    policyDirty = true;
    renderWorkspace();
  }));
  $('#workspace-next-action').addEventListener('click', runWorkspaceAction);
  $('#wallet-reauthorize').addEventListener('click', async () => {
    if (state.busy || connecting) return;
    state.busy = true;
    try {
      const injected = state.injected || await browserWallet.choose({ reuse: true });
      if (!injected) return;
      await injected.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      $("#wallet-reauthorize").hidden = true;
      toast("Wallet access updated. Retry your action or reconnect if the account changed.");
    } catch (error) {
      toast(error.code === -32601 ? "This wallet manages access in the extension. Review the site permissions there, then reconnect." : humanError(error), true);
    } finally { state.busy = false; }
  });
  for (const selector of ['#connect-top', '#connect-workspace']) {
    $(selector).addEventListener('click', event => void connect(event.currentTarget));
  }
  $('#connect-hero').addEventListener('click', event => {
    if (state.demoMode) jumpTo('#dashboard');
    else if (assetProfile.invalid) jumpTo('#asset-select');
    else if (!configured) location.assign($('#workspace-demo-link').href);
    else void connect(event.currentTarget);
  });
  for (const selector of ['#disconnect', '#wallet-account-disconnect']) {
    $(selector).addEventListener('click', () => {
      if (state.busy) {
        if ($('#wallet-account-dialog').open) setText('wallet-account-status', 'Finish the active wallet action before disconnecting.');
        else toast('Finish the active wallet action before disconnecting.');
        return;
      }
      disconnect();
      if (selector === '#disconnect') $('#connect-workspace').focus({ preventScroll: true });
      toast('Wallet disconnected from this workspace.');
    });
  }
  $('#wallet-copy-address').addEventListener('click', async () => {
    const session = walletSession;
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.account);
      if (walletSession === session) setText('wallet-account-status', 'Address copied.');
    } catch {
      if (walletSession === session) setText('wallet-account-status', 'Select the address above to copy it manually.');
    }
  });
  $("#rule-form").addEventListener("submit", saveRule);
  $("#approve-btn").addEventListener("click", approve);
  $("#faucet-btn").addEventListener("click", claim);
  $("#faucet-trace").addEventListener("click", () => {
    const tracked = state.latestIncome;
    if (tracked && tracked.signer === state.signer) incomeTrace.open(tracked.income.hash, tracked.income.logIndex);
  });
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
    const value = event.target.value;
    try {
      const units = parseUnits(value, state.decimals);
      if(units<=0n || units>=2n**96n) throw new Error();
      state.samplePaycheck = value;
    } catch {
      event.target.setAttribute('aria-invalid', 'true');
      setText('sample-error', 'Enter a positive amount in ' + state.symbol + '. The chart shows the last valid amount.');
      $('#sample-error').hidden = false;
      return;
    }
    event.target.removeAttribute('aria-invalid');
    $('#sample-error').hidden = true;
    updateSummary();
    planner.preview();
  });

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = button.dataset.mode;
      if (state.busy || mode === state.mode) return;
      const preset = mode === "team" ? "team" : "freelancer";
      if (state.dirty && !await reviewTemplate(button, preset)) return;
      state.mode = mode;
      state.buckets = clonePreset(preset);
      state.samplePaycheck = state.mode === "team" && !wrappedAsset ? "5000" : defaultSample;
      $("#sample-input").value = String(state.samplePaycheck);
      $("#sample-input").removeAttribute('aria-invalid');
      $('#sample-error').hidden = true;
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
    $("#buckets-list [data-i='" + (state.buckets.length - 1) + "'][data-f='label']")?.focus();
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const preset = button.dataset.preset;
      if (state.busy || !await reviewTemplate(button, preset)) return;
      state.buckets = clonePreset(preset);
      state.draftAllocationMode=['balanced','emergency'].includes(preset) ? 1 : 0;
      $("#allocation-mode").value=String(state.draftAllocationMode);
      state.dirty = true;
      renderBuckets();
      updateSummary();
      toast('Template staged. Example payees must be reviewed. Save destinations and mode separately.');
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
    const destination = event.target.closest('select[data-destination]');
    if (destination) {
      setBucketDestination(Number(destination.dataset.destination), destination.value);
      return;
    }
    const input = event.target.closest("input[data-i]");
    if (!input || input.dataset.f !== "active") return;
    const index = Number(input.dataset.i);
    if (!state.buckets[index]) return;
    state.buckets[index].active = input.checked;
    state.dirty = true;
    updateSummary();
  });

  $("#buckets-list").addEventListener("click", (event) => {
    const savings = event.target.closest('[data-savings-action]');
    if (savings) {
      if (state.busy) return;
      switch (savings.dataset.step) {
        case 'connect': void connect(); break;
        case 'unavailable': void incomeModules.refresh(); break;
        case 'create':
        case 'bind': void incomeModules.setupSavings(savings.dataset.step, savings); break;
      }
      return;
    }
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

  browserWallet.discover();

  setInterval(() => {
    if (state.account && state.demoToken) { renderFaucet(); renderWorkspace(); }
    if(!state.busy&&document.visibilityState!=='hidden')loadReactiveStatus();
  }, 30_000);
}

function wireAssetPicker() {
  if (state.demoMode || (!assetProfile.invalid && assetProfile.assets.length < 2) || !assetProfile.assets.length) return;
  const select = $("#asset-select");
  if (assetProfile.invalid) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Select a supported asset";
    option.disabled = true;
    select.append(option);
  }
  for (const asset of assetProfile.assets) {
    const option = document.createElement("option");
    option.value = asset.id;
    option.textContent = asset.label;
    select.append(option);
  }
  select.value = assetProfile.selected?.id || "";
  select.addEventListener("change", () => {
    if (state.busy || connecting || (hasWorkspaceDraft() && !window.confirm("Switch assets and discard the current unsaved draft?"))) {
      select.value = assetProfile.selected?.id || "";
      return;
    }
    const target = new URL(location.href);
    target.searchParams.set("asset", select.value);
    target.hash = "dashboard";
    location.assign(target.toString());
  });
  $("#asset-picker").hidden = false;
}

function hasWorkspaceDraft() {
  return state.dirty || policyDirty || state.draftAllocationMode !== state.allocationMode || budgetControls.hasCycleDraft();
}

function boot() {
  wire();
  wireAssetPicker();
  renderWalletControls();
  $("#approval-amount").value = defaultSample;

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

  if (!configured && !assetProfile.invalid) {
    setText('connect-hero', 'Try interactive demo');
    setText('network-label', 'Demo available · testnet setup optional');
    $('#hero-demo').href = '#proof';
    setText('hero-demo', 'View testnet proof');
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

    $('#hero-demo').href = '#proof';
    setText('hero-demo', 'View testnet proof');
    setText("network-label", "Simulation · no wallet required");
    setText("connect-hero", "Open sample workspace");

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
