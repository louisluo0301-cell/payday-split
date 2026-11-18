import { Contract } from 'ethers';

export const RETRY_QUEUE_ABI = [
  'function retryPending(address,address) view returns(uint256)',
  'function retryJob(uint256) view returns(tuple(tuple(address user,address token,uint256 version,uint256 txHash,uint256 logIndex,uint256 gross) origin,uint256 epoch,uint64 period,uint64 due,uint96 amount,uint8 bucketIndex,uint8 attempts))',
  'function retryQueueLength() view returns(uint256)',
  'event RetryQueued(address indexed user,address indexed token,uint256 indexed id,uint256 originTxHash,uint256 logIndex,uint256 bucketIndex,uint256 amount,uint256 due)',
  'event RetryClosed(address indexed user,address indexed token,uint256 indexed id,uint8 result,uint256 amount)',
];

export function reconcileRetryEvents(queued, closed, income, payout) {
  const origin = BigInt(income.hash);
  const index = BigInt(income.logIndex);
  const matching = queued.filter(event => event.args.originTxHash === origin && event.args.logIndex === index
    && event.blockNumber >= income.block && (!payout || event.transactionHash === payout.txHash));
  const completions = new Map(closed.map(event => [event.args.id, event]));
  const jobs = [...new Map(matching.map(event => [event.args.id, event])).values()].map(event => {
    const { id, amount, bucketIndex, due } = event.args;
    const finish = completions.get(id);
    const result = finish
      ? finish.args.amount === amount && finish.blockNumber >= event.blockNumber
        ? ['unknown', 'paid', 'invalidated', 'exhausted', 'cancelled'][Number(finish.args.result)] ?? 'unknown'
        : 'unknown'
      : 'queued';
    return {
      id, amount, bucketIndex, due, result, queuedTx: event.transactionHash,
      resultTx: finish?.transactionHash ?? null,
    };
  });
  const paid = jobs.reduce((sum, job) => sum + (job.result === 'paid' ? job.amount : 0n), 0n);
  const totals = payout && paid <= payout.retained && jobs.every(job => job.result !== 'unknown')
    ? { routed: payout.totalRouted + paid, retained: payout.retained - paid }
    : null;
  return { jobs, paid, totals };
}

export async function readIncomeRetries(ctx, income, payout, head) {
  try {
    const queueAddress = await ctx.split.retryQueue({ blockTag: head });
    const queue = new Contract(queueAddress, RETRY_QUEUE_ABI, ctx.provider);
    const lastBlock = Number(head);
    const fromBlock = Math.max(payout?.blockNumber ?? income.block, lastBlock - 5000);
    const queued = await queue.queryFilter(queue.filters.RetryQueued(ctx.account, ctx.token), fromBlock, lastBlock);
    const ids = queued.filter(event => event.args.originTxHash === BigInt(income.hash)
      && event.args.logIndex === BigInt(income.logIndex)).map(event => event.args.id);
    const closed = ids.length
      ? await queue.queryFilter(queue.filters.RetryClosed(ctx.account, ctx.token, ids), fromBlock, lastBlock)
      : [];
    const result = reconcileRetryEvents(queued, closed, income, payout);
    const complete = fromBlock <= (payout?.blockNumber ?? income.block);
    return { ...result, totals: complete ? result.totals : null, status: complete ? 'checked' : 'limited', fromBlock };
  } catch {
    return { status: 'unavailable', jobs: [], paid: null, totals: null };
  }
}
