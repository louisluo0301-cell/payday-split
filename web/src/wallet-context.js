import { getAddress, ZeroAddress } from 'ethers';

export async function verifyWalletContext(injected, expectedChain, expectedAccount) {
  const [rawChain, accounts] = await Promise.all([
    injected.request({ method: 'eth_chainId' }),
    injected.request({ method: 'eth_accounts' }),
  ]);
  let chain;
  try { chain = BigInt(rawChain); } catch { throw new Error('The wallet did not return a valid network.'); }
  if (chain !== BigInt(expectedChain)) throw new Error('Switch your wallet to the configured network.');
  const account = Array.isArray(accounts) && accounts[0] ? getAddress(accounts[0]) : null;
  if (!account || account === ZeroAddress) throw new Error('Select an active account in your wallet.');
  if (expectedAccount && account !== getAddress(expectedAccount)) {
    throw new Error('The active wallet account changed. Connect again.');
  }
  return account;
}

export async function switchWalletChain(injected, chainId, chainParams) {
  const expected = BigInt(chainId);
  if (BigInt(await injected.request({ method: 'eth_chainId' })) === expected) return;
  const hex = '0x' + expected.toString(16);
  try {
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (error) {
    const code = error?.data?.originalError?.code ?? error?.code;
    if (Number(code) !== 4902 || !chainParams) throw error;
    await injected.request({ method: 'wallet_addEthereumChain', params: [chainParams] });
    if (BigInt(await injected.request({ method: 'eth_chainId' })) !== expected) {
      await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
    }
  }
}
