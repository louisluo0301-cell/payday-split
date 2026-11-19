import { AbiCoder, Interface, keccak256, toBeHex } from 'ethers';
import { TOKEN_ABI } from './contract-abi.generated.js';

const transfer = new Interface(TOKEN_ABI);
const transferTopic = transfer.getEvent('Transfer').topicHash;
const coder = AbiCoder.defaultAbiCoder();

export function parseIncomeHash(value) {
  const hash = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || BigInt(hash) === 0n) {
    throw new Error('Enter a complete source transaction hash.');
  }
  return hash.toLowerCase();
}

export function incomeTransfers(receipt, hash, account, token) {
  if (!receipt) throw new Error('Source transaction receipt is unavailable on this network.');
  if (receipt.hash?.toLowerCase() !== hash) throw new Error('The receipt does not match the requested transaction.');
  if (receipt.status !== 1) throw new Error('The source transaction did not succeed.');
  const receiver = account.toLowerCase();
  const matches = new Map();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== token.toLowerCase() || log.topics.length !== 3
      || log.topics[0] !== transferTopic || log.data.length !== 66 || log.removed
      || !Number.isSafeInteger(log.index) || log.index < 0) continue;
    const { from, to, value } = transfer.parseLog(log).args;
    if (to.toLowerCase() !== receiver || from.toLowerCase() === receiver || value === 0n) continue;
    matches.set(log.index, { hash, logIndex: log.index, from, amount: value, block: receipt.blockNumber, blockHash: receipt.blockHash });
  }
  if (!matches.size) throw new Error('No incoming transfer of the configured token to your wallet was found.');
  return [...matches.values()].sort((a, b) => a.logIndex - b.logIndex);
}

export function incomeKeys(account, token, { hash, logIndex }) {
  const origin = BigInt(hash);
  return {
    reactive: keccak256(coder.encode(['uint256', 'uint256'], [origin, logIndex])),
    destination: keccak256(coder.encode(['address', 'address', 'uint256', 'uint256'], [account, token, origin, logIndex])),
  };
}

export function groupWaterfallEvents({ splits, retained, skipped }) {
  const groups = new Map();
  function getGroup({ transactionHash, blockNumber, transactionIndex, args }) {
    const originHash = args.originTxHash === 0n ? null : toBeHex(args.originTxHash, 32);
    const logIndex = originHash ? Number(args.logIndex) : null;
    const key = `${transactionHash}:${originHash || 'manual'}:${logIndex ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        txHash: transactionHash, blockNumber, transactionIndex, originHash, logIndex,
        splits: [], retained: 0n, totalRouted: 0n, version: Number(args.version), skipped: 0,
      });
    }
    return groups.get(key);
  }
  for (const event of splits) {
    const group = getGroup(event);
    const { payee, amount, bucketIndex, paycheck } = event.args;
    group.splits.push({ payee, amount, bucketIndex: Number(bucketIndex), paycheck });
    group.totalRouted += amount;
  }
  for (const event of retained) getGroup(event).retained += event.args.amount;
  for (const event of skipped) getGroup(event).skipped++;
  return [...groups.values()].map(group => ({
    ...group, paycheck: group.totalRouted + group.retained,
  })).sort((a, b) => b.blockNumber - a.blockNumber || b.transactionIndex - a.transactionIndex);
}

export function matchedPayout(groups, income) {
  return groups.find(group => group.originHash === income.hash && group.logIndex === income.logIndex
    && group.blockNumber >= income.block && group.paycheck === income.amount) ?? null;
}

export function recoveryQuote(version, result, buckets, income) {
  const [amounts, retained, blocked] = result;
  if (!version || blocked || amounts.length !== buckets.length || retained > income.amount) return null;
  const paid = income.amount - retained;
  if (paid === 0n || amounts.reduce((sum, amount) => sum + amount, 0n) !== paid) return null;
  return {
    version, paid, retained,
    payouts: amounts.flatMap((amount, index) => amount > 0n ? [{ payee: buckets[index].payee, amount }] : []),
  };
}
