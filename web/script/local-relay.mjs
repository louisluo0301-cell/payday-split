import { readFile } from 'node:fs/promises';
import { Contract, getAddress } from 'ethers';
import { openLocalAnvil } from './local-rpc.mjs';

const SYSTEM = '0x8888888888888888888888888888888888888888';

export async function createLocalRelay(deployment) {
  deployment ??= JSON.parse(await readFile(new URL('../../deployments/31337.json', import.meta.url), 'utf8'));
  const provider = await openLocalAnvil(deployment);
  try {
    const user = await provider.getSigner(deployment.deployer);
    const assets = [...new Set([deployment.token, ...(deployment.assets || []).map(asset => asset.token)].map(getAddress))];
    const tokens = assets.map(address => new Contract(address,
      ['event Transfer(address indexed from,address indexed to,uint256 value)'], provider));
    const split = new Contract(deployment.split, [
      'event BucketsSet(address indexed user,address indexed token,uint256 indexed version,address[] payees,uint96[] fixedAmounts,uint16[] bps,bool[] active)',
    ], provider);
    const systemMock = new Contract(SYSTEM, [
      'function requestCount() view returns(uint256)',
      'function requests(uint256) view returns(uint256 chainId,address recipient,uint64 gasLimit,bytes payload)',
    ], provider);
    const reactive = new Contract(deployment.reactive, [
      'function react((uint256 chainId,address contractAddress,uint256 topic0,uint256 topic1,uint256 topic2,uint256 topic3,bytes data,uint256 blockNumber,uint256 opCode,uint256 blockHash,uint256 txHash,uint256 logIndex))',
    ], provider);
    const proxy = new Contract(deployment.proxy, ['function deliver(address,address,bytes) returns(bool,bytes)'], user);
    for (const address of [deployment.split, deployment.reactive, deployment.proxy, SYSTEM, ...assets]) {
      if (await provider.getCode(address) === '0x') throw new Error('Local deployment bytecode is missing. Run the local setup first.');
    }
    await provider.send('anvil_impersonateAccount', [SYSTEM]);
    await provider.send('anvil_setBalance', [SYSTEM, '0x56BC75E2D63100000']);
    let through = -1;
    let delivered = 0n;

    async function tick() {
      const head = Number(await provider.send('eth_blockNumber', []));
      if (head < through) throw new Error('Anvil was reset. Restart the relay with the new deployment.');
      let events = 0;
      const reactions = [];
      for (let first = through + 1; first <= head; first += 500) {
        const last = Math.min(head, first + 499);
        const reads = await Promise.all([
          split.queryFilter(split.filters.BucketsSet(user.address), first, last),
          ...tokens.map(token => token.queryFilter(token.filters.Transfer(null, user.address), first, last)),
        ]);
        const ordered = reads.flat().sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
        for (const log of ordered) {
          const record = [
            31337, log.address, ...[0, 1, 2, 3].map(i => BigInt(log.topics[i] || 0)), log.data,
            log.blockNumber, log.topics.length, BigInt(log.blockHash), BigInt(log.transactionHash), log.index,
          ];
          const data = reactive.interface.encodeFunctionData('react', [record]);
          const hash = await provider.send('eth_sendTransaction', [{ from: SYSTEM, to: deployment.reactive, data, gas: '0x1e8480' }]);
          if ((await provider.waitForTransaction(hash, 1, 12_000))?.status !== 1) throw new Error('Local reaction did not confirm.');
          reactions.push({ origin: log.transactionHash, hash });
        }
        events += ordered.length;
        through = last;
      }

      const count = await systemMock.requestCount();
      if (count < delivered) throw new Error('Anvil was reset. Restart the relay with the new deployment.');
      const before = delivered;
      const deliveries = [];
      while (delivered < count) {
        const request = await systemMock.requests(delivered);
        if (request.chainId !== 31337n || request.recipient !== getAddress(deployment.split)) {
          throw new Error('The mock callback targets a different deployment.');
        }
        const args = [request.recipient, deployment.reactive, request.payload];
        const options = { gasLimit: request.gasLimit + 150_000n };
        const [successful] = await proxy.deliver.staticCall(...args, options);
        if (!successful) throw new Error('Local callback reverted. Review the plan and retry the relay.');
        const tx = await proxy.deliver(...args, options);
        if ((await tx.wait(1, 12_000))?.status !== 1) throw new Error('Local callback did not confirm.');
        deliveries.push(tx.hash);
        delivered++;
      }
      return { events, callbacks: Number(delivered - before), reactions, deliveries };
    }

    return { tick, assets, close: () => provider.destroy() };
  } catch (error) {
    provider.destroy();
    throw error;
  }
}
