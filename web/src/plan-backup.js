import {getAddress, parseUnits} from 'ethers';
const MAX96 = 2n ** 96n;
function amount(value, decimals) {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) throw new Error('Amounts must be non-negative decimal strings.');
  const units = parseUnits(value, decimals);
  if (units >= MAX96) throw new Error('Amount exceeds uint96.');
  return value;
}
export function parsePlan(text, context) {
  if (text.length > 50000) throw new Error('Backup is too large (maximum 50 KB).');
  const data = JSON.parse(text);
  if (data?.schema !== 'paydaysplit.plan' || data.version !== 1) throw new Error('Unsupported backup format.');
  if (data.chainId !== context.chainId || data.decimals !== context.decimals || getAddress(data.token) !== getAddress(context.token)) {
    throw new Error('Backup network, token or decimals do not match this dashboard.');
  }
  if (!Array.isArray(data.buckets) || data.buckets.length > 8) throw new Error('At most 8 destinations are supported.');
  let totalBps = 0;
  const buckets = data.buckets.map(row => {
    if (typeof row.active !== 'boolean' || typeof row.label !== 'string' || row.label.length > 80) throw new Error('Invalid destination metadata.');
    const payee = getAddress(row.payee);
    const fixed = amount(row.fixed, context.decimals);
    const percent = amount(row.bps, 2);
    const bps = Number(parseUnits(percent, 2));
    if (bps > 10000 || (row.active && (payee === '0x0000000000000000000000000000000000000000' || (parseUnits(fixed, context.decimals) === 0n && bps === 0)))) throw new Error('Invalid active destination.');
    if (row.active) totalBps += bps;
    return {label:row.label, payee, fixed, bps:percent, active:row.active};
  });
  if (totalBps > 10000) throw new Error('Active percentages exceed 100%.');
  const policy = {};
  for (const key of ['reserve','maxPerRun','dailyLimit','minIncome']) policy[key] = amount(data.policy?.[key], context.decimals);
  if (typeof data.policy?.paused !== 'boolean' || typeof data.policy?.validUntil !== 'string' || !/^\d+$/.test(data.policy.validUntil) || BigInt(data.policy.validUntil) > 253402300799n) throw new Error('Invalid policy expiry or pause flag.');
  policy.paused = data.policy.paused;
  policy.validUntil = data.policy.validUntil;
  if (!Array.isArray(data.goalTargets) || data.goalTargets.length !== buckets.length) throw new Error('Goal targets must match destinations.');
  const goalTargets = data.goalTargets.map(value => amount(value, context.decimals));
  // Copy only recognized fields. Never restore paid progress, approval, credentials or deployment addresses.
  return {buckets, policy, goalTargets};
}
