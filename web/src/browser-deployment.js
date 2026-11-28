import { getAddress, ZeroAddress } from 'ethers';
import { collectAutomationHealth, createHealthReader } from './automation-health.js';
import { REACTIVE_ABI, SPLIT_ABI, TOKEN_ABI } from './contract-abi.generated.js';
import { selectDeploymentAsset } from './deployment-assets.js';

export const DEPLOYMENT_SESSION = 'paydaysplit:testnet-workspace:v2';
const SYSTEM = '0x8888888888888888888888888888888888888888';
const LASNA_CHAIN_ID = 5318007;
const REACTIVE_ROUTE_ABI = [
  'function CHAIN_ID() view returns (uint256)',
  'function DEST_CHAIN_ID() view returns (uint256)',
  'function CONFIG_CONTRACT() view returns (address)',
  'function CALLBACK_CONTRACT() view returns (address)',
];
const sameAddress = (value, expected) => typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
const testnets = {
  11155111: { network: 'sepolia', name: 'Ethereum Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io', proxy: '0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4' },
  84532: { network: 'base-sepolia', name: 'Base Sepolia', rpc: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org', proxy: '0x476F44b11F5C942c58f4c8E3d0300E5710743585' },
  1301: { network: 'unichain-sepolia', name: 'Unichain Sepolia', rpc: 'https://sepolia.unichain.org',
    explorer: 'https://sepolia.uniscan.xyz', proxy: '0x775c9B990ADe401060B78D0e98684eEf8d2466C1' },
};

function address(value, name, optional = false) {
  if (optional && !value) return '';
  try {
    const parsed = getAddress(value);
    if (parsed !== ZeroAddress) return parsed;
  } catch {
    // Report which field needs attention.
  }
  throw new Error('Enter a valid ' + name + ' contract address.');
}

export function parseTestnetDeployment(text) {
  if (!text || text.length > 64_000) throw new Error('Paste a deployment JSON of up to 64,000 characters.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('This deployment file is not valid JSON.'); }
  const chainId = Number(raw?.chainId);
  if (!Object.hasOwn(testnets, chainId)) throw new Error('Choose Ethereum Sepolia, Base Sepolia or Unichain Sepolia.');
  const network = testnets[chainId];
  const proxy = address(raw.proxy, 'callback proxy');
  if (proxy !== getAddress(network.proxy)) throw new Error('The callback proxy does not match the testnet configuration.');
  const tokens = raw.assets ?? [];
  if (!Array.isArray(tokens) || tokens.length > 8) throw new Error('A deployment can list up to eight assets.');
  const assets = tokens.map(asset => {
    if (!asset || typeof asset.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(asset.id)) {
      throw new Error('Asset IDs must use lowercase letters, digits and hyphens.');
    }
    return { id: asset.id, token: address(asset.token, 'asset token'), label: String(asset.label ?? asset.id).slice(0, 36),
      aavePool: address(asset.aavePool, 'asset Aave pool', true) };
  });
  const module = raw.modules ?? {};
  return {
    chainId, network: network.network, rpcUrl: network.rpc, explorer: network.explorer, proxy,
    lasnaRpc: 'https://lasna-rpc.rnk.dev/', lasnaExplorer: 'https://lasna.reactscan.net',
    token: address(raw.token, 'default token'), split: address(raw.split, 'PaydaySplit'),
    reactive: address(raw.reactive, 'Reactive'), assets,
    modules: {
      factory: address(module.factory, 'module factory', true),
      wrappedNative: address(module.wrappedNative, 'wrapped ETH', true),
      aavePool: address(module.aavePool, 'default Aave pool', true),
    },
  };
}

async function requiredView(reader, address, abi, method, args, component) {
  try {
    return await reader.call(address, abi, method, args);
  } catch (error) {
    if (['CALL_EXCEPTION', 'BAD_DATA'].includes(error?.code)) {
      throw new Error(`${component} is incompatible with this workspace (${method}).`, { cause: error });
    }
    throw new Error(`Could not check ${component} (${method}). Retry the testnet RPC check.`, { cause: error });
  }
}

export async function verifyTestnetDeployment(config, check = collectAutomationHealth, makeReader = createHealthReader) {
  const { snapshot: s, complete } = await check(config);
  if (!complete || !['token', 'reactive', 'system', 'split', 'proxy'].every(key => s.codes[key])) {
    throw new Error('The testnet contracts could not be verified. Check their addresses and try again.');
  }
  if (!sameAddress(s.boundReactive, config.reactive) || !sameAddress(s.destinationService, config.proxy)
      || !sameAddress(s.reactiveService, SYSTEM)) throw new Error('The Reactive and callback proxy bindings do not match this deployment.');

  const destination = makeReader(config.rpcUrl, config.chainId);
  const reactive = makeReader(config.lasnaRpc, LASNA_CHAIN_ID);
  try {
    const route = method => requiredView(reactive, config.reactive, REACTIVE_ROUTE_ABI, method, [], 'Reactive contract');
    const [sourceChain, targetChain, sourceContract, targetContract] = await Promise.all([
      route('CHAIN_ID'), route('DEST_CHAIN_ID'), route('CONFIG_CONTRACT'), route('CALLBACK_CONTRACT'),
    ]);
    const expectedChain = BigInt(config.chainId);
    if (sourceChain !== expectedChain || targetChain !== expectedChain
        || !sameAddress(sourceContract, config.split) || !sameAddress(targetContract, config.split)) {
      throw new Error('The Reactive subscription and callback route do not match this PaydaySplit deployment.');
    }

    // Views use the split address as the probe account, before a wallet is requested.
    const probe = [config.split, config.token];
    const readSplit = (method, args = probe) => requiredView(destination, config.split, SPLIT_ABI, method, args, 'PaydaySplit contract');
    const [buckets, ids, preview, mode, mirror] = await Promise.all([
      readSplit('getBuckets'), readSplit('getBucketIds'), readSplit('previewExecution', [...probe, 0n]),
      readSplit('allocationModes'),
      requiredView(reactive, config.reactive, REACTIVE_ABI, 'getRule', probe, 'Reactive contract'),
      readSplit('ruleVersion'), readSplit('cycleConfigs'), readSplit('policies'), readSplit('dailySpend'),
      requiredView(reactive, config.reactive, REACTIVE_ABI, 'userRemaining', probe, 'Reactive contract'),
    ]);
    if (buckets.length !== ids.length || buckets.length !== preview[0].length || mode > 1n) {
      throw new Error('The PaydaySplit plan and preview responses do not match this workspace.');
    }
    if (!mirror.slice(1, 4).every(values => values.length === mirror[0].length)) {
      throw new Error('The Reactive mirror returned inconsistent destination rows.');
    }

    for (const { id, token } of selectDeploymentAsset(config, null).assets) {
      const component = `Asset ${id}`;
      if (!sameAddress(token, config.token) && await destination.code(token) === '0x') {
        throw new Error(`${component} has no token contract on this testnet.`);
      }
      const readToken = (method, args = []) => requiredView(destination, token, TOKEN_ABI, method, args, component);
      const [decimals] = await Promise.all([
        readToken('decimals'), readToken('balanceOf', [config.split]), readToken('allowance', [config.split, config.split]),
      ]);
      // A decodable metadata and ERC-20 view is required for every selectable asset.
      if (decimals < 0n || decimals > 36n) throw new Error(`${component} uses unsupported token precision.`);
    }
  } finally {
    await Promise.allSettled([destination.close(), reactive.close()]);
  }
}

export function wireTestnetDeployment({ $, usingSession, busy, canSwitch, refreshWorkspace }) {
  const dialog = $('#deployment-dialog');
  const json = $('#deployment-json');
  const status = $('#deployment-status');
  const apply = $('#deployment-apply');
  let checking = false;
  $('#open-deployment').addEventListener('click', () => {
    if (busy() || dialog.open) return;
    status.textContent = '';
    dialog.showModal();
  });
  $('#deployment-close').addEventListener('click', () => { if (!checking) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (checking) event.preventDefault(); });
  $('#deployment-reset').hidden = !usingSession;
  $('#deployment-reset').addEventListener('click', () => {
    if (busy() || checking || !canSwitch()) return;
    sessionStorage.removeItem(DEPLOYMENT_SESSION);
    refreshWorkspace(false);
  });
  $('#deployment-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file || checking) return;
    if (file.size > 64_000) { status.textContent = 'Choose a deployment JSON under 64 KB.'; return; }
    try { json.value = await file.text(); status.textContent = ''; }
    catch { status.textContent = 'Could not read this file. Paste its JSON to continue.'; }
  });
  $('#deployment-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (checking || busy() || !canSwitch()) return;
    checking = true;
    json.readOnly = true;
    $('#deployment-file').disabled = true;
    apply.disabled = true;
    status.textContent = 'Checking the testnet route, contract interfaces and assets…';
    try {
      const config = parseTestnetDeployment(json.value);
      await verifyTestnetDeployment(config);
      sessionStorage.setItem(DEPLOYMENT_SESSION, JSON.stringify(config));
      refreshWorkspace(true);
    } catch (error) {
      status.textContent = error.shortMessage || error.message || 'Could not open this testnet workspace.';
    } finally {
      checking = false;
      json.readOnly = false;
      $('#deployment-file').disabled = false;
      apply.disabled = false;
    }
  });
}
