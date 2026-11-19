import { BrowserProvider, Contract, ZeroAddress, ZeroHash, dataSlice, formatUnits, getAddress, isHexString, parseUnits, zeroPadValue } from 'ethers';
import { switchWalletChain, verifyWalletContext } from './wallet-context.js';

export const CCTP_TESTNET = Object.freeze({
  sourceChain: 84532,
  sourceDomain: 6,
  sourceUsdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  destinationChain: 11155111,
  destinationDomain: 0,
  destinationUsdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  messenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  transmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
  finality: 2000,
});

const ERC20 = [
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
];
const MESSENGER = [
  'function getMinFeeAmount(uint256 amount) view returns(uint256)',
  'function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
];
const TRANSMITTER = [
  'function usedNonces(bytes32) view returns(uint256)',
  'function receiveMessage(bytes,bytes) returns(bool)',
];
const { sourceChain, sourceDomain, sourceUsdc, destinationChain, destinationDomain, destinationUsdc, messenger, transmitter, finality } = CCTP_TESTNET;
const walletNetworks = {
  [sourceChain]: { chainName: 'Base Sepolia', rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] },
  [destinationChain]: { chainName: 'Ethereum Sepolia', rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'] },
};

export function decodeCollection(message, wallet) {
  if (!isHexString(message, 376)) throw new Error('Expected a standard CCTP V2 burn message.');
  const word = (offset, size = 32) => dataSlice(message, offset, offset + size).toLowerCase();
  const integer = (offset, size) => BigInt(word(offset, size));
  const padded = value => zeroPadValue(getAddress(value), 32).toLowerCase();
  const recipient = padded(wallet);
  if (integer(0, 4) !== 1n || integer(148, 4) !== 1n || integer(4, 4) !== BigInt(sourceDomain)
    || integer(8, 4) !== BigInt(destinationDomain) || word(44) !== padded(messenger)
    || word(76) !== padded(messenger) || word(108) !== ZeroHash
    || integer(140, 4) !== BigInt(finality) || integer(144, 4) < BigInt(finality)
    || word(152) !== padded(sourceUsdc) || word(184) !== recipient || word(248) !== recipient) {
    throw new Error('Attestation does not match the supported Base Sepolia USDC collection for this wallet.');
  }
  const nonce = word(12);
  const amount = integer(216);
  const maxFee = integer(280);
  const fee = integer(312);
  const expiration = integer(344);
  if (nonce === ZeroHash || amount === 0n || fee >= amount || fee > maxFee) {
    throw new Error('Attestation has an invalid nonce, amount or fee.');
  }
  return { nonce, amount, fee, received: amount - fee, expiration };
}

export function selectCollection(payload, wallet) {
  if (!Array.isArray(payload?.messages)) throw new Error('Circle returned an invalid message response.');
  const complete = payload.messages.filter(item => item?.status === 'complete' && item.cctpVersion === 2);
  if (!complete.length) return null;
  const matches = [];
  for (const item of complete) {
    try {
      const decoded = decodeCollection(item.message, wallet);
      if (isHexString(item.attestation, true) && item.attestation.length > 2) {
        matches.push({ ...decoded, message: item.message, attestation: item.attestation });
      }
    } catch {
      // Ignore unrelated burns in the same source transaction.
    }
  }
  if (matches.length !== 1) throw new Error('This source transaction must contain exactly one matching collection for this wallet.');
  return matches[0];
}

export function wireCctpCollection({ $, deployment, demoMode, chooseWallet, isWalletBusy = () => false, setWalletBusy = () => {} }) {
  const status = $('#bridge-status');
  const hashInput = $('#bridge-hash');
  const enabled = !demoMode && Number(deployment.chainId) === destinationChain
    && deployment.token?.toLowerCase() === destinationUsdc.toLowerCase() && isHexString(deployment.split, 20);
  const actions = [...document.querySelectorAll('[data-bridge-action]')];
  actions.forEach(button => { button.disabled = !enabled; });
  if (!enabled) {
    status.textContent = 'Requires a configured Sepolia waterfall using Circle test USDC.';
    return;
  }

  const hashKey = 'paydaysplit:cctp:base-sepolia:last-source';
  try { hashInput.value = sessionStorage.getItem(hashKey) || ''; } catch {}
  function localHash(hash) {
    hashInput.value = hash;
    try { sessionStorage.setItem(hashKey, hash); } catch {}
  }
  let running = false;
  async function action(chain, work) {
    if (running) return;
    if (isWalletBusy()) {
      status.textContent = 'Finish the current wallet action before using the bridge.';
      return;
    }
    running = true;
    setWalletBusy(true);
    actions.forEach(button => { button.disabled = true; });
    let provider;
    try {
      const injected = await chooseWallet();
      if (!injected) { status.textContent = 'Choose a browser wallet to use the testnet bridge.'; return; }
      const initial = await injected.request({ method: 'eth_requestAccounts' });
      if (!initial?.[0]) throw new Error('Select an account in your wallet.');
      const network = walletNetworks[chain];
      status.textContent = 'Confirm ' + network.chainName + ' in your wallet.';
      await switchWalletChain(injected, chain, {
        ...network, chainId: '0x' + chain.toString(16), nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      });
      const account = await verifyWalletContext(injected, chain, initial[0]);
      provider = new BrowserProvider(injected, chain);
      const signer = await provider.getSigner(account);
      await work(provider, signer);
    } catch (error) {
      status.textContent = error.code === 'ACTION_REJECTED' ? 'Wallet request cancelled.' : error.shortMessage || error.message;
    } finally {
      provider?.destroy();
      running = false;
      setWalletBusy(false);
      actions.forEach(button => { button.disabled = false; });
    }
  }
  async function assertWallet(provider, signer, chain, name) {
    const [network, accounts] = await Promise.all([provider.send('eth_chainId', []), provider.send('eth_accounts', [])]);
    if (BigInt(network) !== BigInt(chain) || accounts[0]?.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(`Select ${name} and the same recipient wallet, then retry.`);
    }
  }

  $('#bridge-burn').addEventListener('click', () => action(sourceChain, async (provider, signer) => {
    await assertWallet(provider, signer, sourceChain, 'Base Sepolia');
    const amount = parseUnits($('#bridge-amount').value, 6);
    const maxFee = parseUnits($('#bridge-max-fee').value || '0', 6);
    if (amount <= 1n || amount > 10_000_000n * 10n ** 6n || maxFee < 0n || maxFee >= amount) {
      throw new Error('Enter a positive USDC amount and a fee cap below that amount.');
    }
    if ((await provider.getCode(messenger)) === '0x') throw new Error('Circle messenger is unavailable on this network.');
    const asset = new Contract(sourceUsdc, ERC20, signer);
    const cctp = new Contract(messenger, MESSENGER, signer);
    const [balance, allowance, minFee] = await Promise.all([
      asset.balanceOf(signer.address),
      asset.allowance(signer.address, messenger),
      cctp.getMinFeeAmount(amount).catch(() => null),
    ]);
    if (balance < amount) throw new Error('Insufficient Base Sepolia USDC.');
    if (minFee !== null && minFee > maxFee) {
      throw new Error(`Circle's current minimum is ${formatUnits(minFee, 6)} USDC. Review your fee cap.`);
    }
    if (allowance !== amount) {
      status.textContent = `Approve exactly ${formatUnits(amount, 6)} USDC for Circle on Base Sepolia.`;
      await (await asset.approve(messenger, amount)).wait();
    }
    await assertWallet(provider, signer, sourceChain, 'Base Sepolia');
    const burnArgs = [amount, destinationDomain, zeroPadValue(signer.address, 32), sourceUsdc, ZeroHash, maxFee, finality];
    try { await cctp.depositForBurn.staticCall(...burnArgs); }
    catch { throw new Error('Circle did not accept the burn preview. Review your fee cap and route, or revoke the unused approval.'); }
    await assertWallet(provider, signer, sourceChain, 'Base Sepolia');
    status.textContent = 'Review the Base Sepolia burn. Mint recipient is this same wallet on Sepolia.';
    const tx = await cctp.depositForBurn(...burnArgs);
    localHash(tx.hash);
    await tx.wait();
    status.textContent = 'Burn confirmed. Use Check and mint to switch to Ethereum Sepolia and look up the attestation.';
  }));

  $('#bridge-revoke').addEventListener('click', () => action(sourceChain, async (provider, signer) => {
    await assertWallet(provider, signer, sourceChain, 'Base Sepolia');
    const asset = new Contract(sourceUsdc, ERC20, signer);
    if (await asset.allowance(signer.address, messenger) === 0n) {
      status.textContent = 'There is no active Circle approval to revoke.';
      return;
    }
    await assertWallet(provider, signer, sourceChain, 'Base Sepolia');
    await (await asset.approve(messenger, 0n)).wait();
    status.textContent = 'Base Sepolia Circle approval revoked.';
  }));

  $('#bridge-mint').addEventListener('click', () => action(destinationChain, async (provider, signer) => {
    await assertWallet(provider, signer, destinationChain, 'Ethereum Sepolia');
    const hash = hashInput.value.trim();
    if (!isHexString(hash, 32) || hash === ZeroHash) throw new Error('Enter the Base Sepolia burn transaction hash.');
    localHash(hash);
    status.textContent = 'Checking the Circle attestation for this income…';
    const response = await fetch(`https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${hash}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) {
      status.textContent = 'Circle has not indexed this burn yet. Check again after it reaches finality.';
      return;
    }
    if (!response.ok) throw new Error('Circle attestation service could not complete the lookup.');
    const collection = selectCollection(await response.json(), signer.address);
    if (!collection) {
      status.textContent = 'Attestation is pending. Check again after the source burn reaches finality.';
      return;
    }
    const target = new Contract(transmitter, TRANSMITTER, signer);
    if (collection.expiration !== 0n && BigInt(await provider.send('eth_blockNumber', [])) >= collection.expiration) {
      throw new Error('The attestation expired. Request a fresh attestation through Circle before retrying.');
    }
    if (await target.usedNonces(collection.nonce) !== 0n) {
      status.textContent = 'This CCTP message was already used on Sepolia.';
      return;
    }
    await assertWallet(provider, signer, destinationChain, 'Ethereum Sepolia');
    if (!await target.receiveMessage.staticCall(collection.message, collection.attestation)) throw new Error('Circle did not accept the mint preview.');
    await assertWallet(provider, signer, destinationChain, 'Ethereum Sepolia');
    status.textContent = `Review the Sepolia mint of ${formatUnits(collection.received, 6)} USDC to this wallet.`;
    const tx = await target.receiveMessage(collection.message, collection.attestation);
    const receipt = await tx.wait();
    const asset = new Contract(destinationUsdc, ERC20, provider);
    const income = receipt.logs.find(log => {
      if (log.address.toLowerCase() !== destinationUsdc.toLowerCase() || log.topics.length !== 3
        || log.topics[0] !== asset.interface.getEvent('Transfer').topicHash) return false;
      const { from, to, value } = asset.interface.parseLog(log).args;
      return from === ZeroAddress && to.toLowerCase() === signer.address.toLowerCase() && value === collection.received;
    });
    status.textContent = income
      ? `USDC arrived. Use the Sepolia hash in Income trace: ${tx.hash}`
      : `Mint transaction confirmed. Verify the wallet’s USDC receipt: ${tx.hash}`;
    if (income) $('#trace-hash').value = tx.hash;
  }));
}
