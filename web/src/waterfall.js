// Integer token units throughout. Shared by the demo and regression tests.
export function calculateRun(buckets, paycheck, balance, allowance, policy = {}, spentToday = 0n, now = Math.floor(Date.now() / 1000), goals = [], allocationMode = 0, cycle = {}) {
  const { reserve = 0n, maxPerRun = 0n, dailyLimit = 0n, minIncome = 0n, validUntil = 0n, paused = false } = policy;
  const blocked = paused || (validUntil > 0n && BigInt(now) >= validUntil) || paycheck < minIncome || (cycle.duration > 0 && now < cycle.anchor);
  const min = (a, b) => a < b ? a : b;
  let remaining = paycheck;
  let budget = blocked ? 0n : paycheck;
  if (maxPerRun > 0n) budget = min(budget, maxPerRun);
  if (dailyLimit > 0n) budget = min(budget, dailyLimit > spentToday ? dailyLimit - spentToday : 0n);
  if (reserve > 0n) budget = min(budget, balance > reserve ? balance - reserve : 0n);
  if (allocationMode === 1) budget = min(budget, min(balance, allowance));
  const allocationBase = budget;
  const splits = [];
  buckets.forEach((bucket, bucketIndex) => {
    if (!bucket.active) return;
    if (allocationMode === 1 && bucket.fixedAmount !== 0n) throw new Error('Pro-rata destinations must have zero fixed amounts.');
    const requested = allocationMode === 1 ? allocationBase * BigInt(bucket.bps) / 10000n : bucket.fixedAmount + paycheck * BigInt(bucket.bps) / 10000n;
    let amount = min(min(requested, remaining), budget);
    const goal = goals[bucketIndex];
    if (goal?.target > 0n) amount = min(amount, goal.target > goal.paid ? goal.target - goal.paid : 0n);
    if (amount <= 0n || amount > balance || amount > allowance) return;
    remaining -= amount; budget -= amount; balance -= amount; allowance -= amount;
    splits.push({payee: bucket.payee, amount, bucketIndex, paycheck});
  });
  return {splits, retained: remaining, paid: paycheck - remaining};
}
