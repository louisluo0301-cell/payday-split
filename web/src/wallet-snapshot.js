export async function readWalletBlock(provider, afterBlock) {
  let block = await provider.send('eth_getBlockByNumber', ['latest', false]);
  if (afterBlock !== undefined && (!block || BigInt(block.number) < BigInt(afterBlock))) {
    block = await provider.send('eth_getBlockByNumber', ['0x' + Number(afterBlock).toString(16), false]);
  }
  if (!block?.number || !block.timestamp || (afterBlock !== undefined && BigInt(block.number) < BigInt(afterBlock))) {
    throw new Error('The wallet RPC has not reached the confirmed block. Refresh the plan to try again.');
  }
  return block;
}

export async function readWalletSnapshot({ provider, account, token, split, tokenAddress, splitAddress }, afterBlock) {
  const block = await readWalletBlock(provider, afterBlock);
  const at = { blockTag: block.number };
  const [
    balance, allowance, buckets, version, ids, allocationMode, cycle, policy, dailySpend,
  ] = await Promise.all([
    token.balanceOf(account, at), token.allowance(account, splitAddress, at),
    split.getBuckets(account, tokenAddress, at), split.ruleVersion(account, tokenAddress, at),
    split.getBucketIds(account, tokenAddress, at), split.allocationModes(account, tokenAddress, at),
    split.cycleConfigs(account, tokenAddress, at), split.policies(account, tokenAddress, at),
    split.dailySpend(account, tokenAddress, at),
  ]);
  if (buckets.length !== ids.length) throw new Error('Saved destinations and their IDs could not be matched. Refresh the plan.');
  return { at, timestamp: Number(block.timestamp), balance, allowance, buckets, version, ids, allocationMode, cycle, policy, dailySpend };
}

export async function readFaucet(token, account, at) {
  try {
    const [last, amount, cooldown] = await Promise.all([
      token.lastFaucetAt(account, at), token.FAUCET_AMOUNT(at), token.FAUCET_COOLDOWN(at),
    ]);
    if (amount > 0n && cooldown > 0n && last + cooldown <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return { amount, next: Number(last + cooldown) };
    }
  } catch {
    // ERC-20 balances and plans remain usable when this token has no faucet.
  }
  return null;
}
