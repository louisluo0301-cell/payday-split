import { FetchRequest, JsonRpcProvider } from 'ethers';

export function localAnvilURL(value) {
  const address = new URL(value);
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1'
    || !address.port || address.username || address.password || address.pathname !== '/'
    || address.search || address.hash) throw new Error('Use a dedicated loopback Anvil RPC.');
  return address.origin;
}

export async function openLocalAnvil(deployment) {
  const rpc = localAnvilURL(deployment.rpcUrl || 'http://127.0.0.1:8545');
  if (process.env.LOCAL_RPC && localAnvilURL(process.env.LOCAL_RPC) !== rpc) {
    throw new Error('LOCAL_RPC and the local deployment point to different Anvil instances.');
  }
  const request = new FetchRequest(rpc);
  request.timeout = 6_000;
  const provider = new JsonRpcProvider(request, 31337, { staticNetwork: true, cacheTimeout: 0 });
  try {
    const [chainId, client] = await Promise.all([
      provider.send('eth_chainId', []), provider.send('web3_clientVersion', []),
    ]);
    if (BigInt(chainId) !== 31337n || !/anvil/i.test(client)) throw new Error('The configured server is not Anvil chain 31337.');
    return provider;
  } catch (error) {
    provider.destroy();
    throw error;
  }
}
