// Integer token units throughout. Shared by the demo and regression tests.
export function calculateRun(buckets, paycheck, balance, allowance, policy = {}, spentToday = 0n, now = Math.floor(Date.now() / 1000)) {
  const { reserve = 0n, maxPerRun = 0n, dailyLimit = 0n, minIncome = 0n, validUntil = 0n, paused = false } = policy;
  const blocked = paused || (validUntil > 0n && BigInt(now) >= validUntil) || paycheck < minIncome;
  const min = (a, b) => a < b ? a : b;
  let remaining = paycheck;
  let budget = blocked ? 0n : paycheck;
  if (maxPerRun > 0n) budget = min(budget, maxPerRun);
  if (dailyLimit > 0n) budget = min(budget, dailyLimit > spentToday ? dailyLimit - spentToday : 0n);
  if (reserve > 0n) budget = min(budget, balance > reserve ? balance - reserve : 0n);
  const splits = [];
  buckets.forEach((bucket, bucketIndex) => {
    if (!bucket.active) return;
    const requested = bucket.fixedAmount + paycheck * BigInt(bucket.bps) / 10000n;
    const amount = min(min(requested, remaining), budget);
    if (amount <= 0n || amount > balance || amount > allowance) return;
    remaining -= amount; budget -= amount; balance -= amount; allowance -= amount;
    splits.push({payee: bucket.payee, amount, bucketIndex, paycheck});
  });
  return {splits, retained: remaining, paid: paycheck - remaining};
}
