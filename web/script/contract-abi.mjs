import { readFile, writeFile } from 'node:fs/promises';

// Match the product operations, excluding deployment and administrator methods.
const contracts = [
  ['SPLIT_ABI', 'PaydaySplit', 'PaydaySplit', [
    '_SERVICE_PROVIDER', 'allocationModes', 'bucketGoals', 'cancelRetry', 'cycleConfigs', 'dailySpend',
    'getBucketIds', 'getBuckets', 'paused', 'policies', 'previewExecution', 'processRetries', 'processed',
    'reactive', 'recoverSplit', 'retryEnabled', 'retryQueue', 'ruleVersion', 'runSplit', 'savingsBucket',
    'setAllocationMode', 'setBucketGoal', 'setBuckets', 'setBucketsWithIds', 'setCycleConfig', 'setPolicy',
    'setRetryEnabled', 'setSavingsBucket', 'BucketSkipped', 'BucketsSet', 'Retained', 'Split',
  ]],
  ['REACTIVE_ABI', 'PaydaySplitReactive', 'PaydaySplitReactive', [
    '_SERVICE_PROVIDER', 'getRule', 'paused', 'react', 'remaining', 'remainingRetryCalls', 'seen', 'userRemaining', 'Seen',
  ]],
  ['TOKEN_ABI', 'DemoUSDC', 'DemoUSDC', [
    'FAUCET_AMOUNT', 'FAUCET_COOLDOWN', 'allowance', 'approve', 'balanceOf', 'decimals', 'faucet', 'lastFaucetAt',
    'symbol', 'Transfer',
  ]],
  ['RETRY_QUEUE_ABI', 'PaydayRetryQueue', 'PaydayRetryQueue', [
    'retryJob', 'retryPending', 'retryQueueLength', 'RetryClosed', 'RetryQueued',
  ]],
  ['FACTORY_ABI', 'IncomeModules', 'IncomeModuleFactory', ['createAave', 'createCooldown', 'createNative', 'latest', 'split']],
  ['SAVINGS_ABI', 'IncomeModules', 'AaveSavingsBucket', ['aToken', 'pool']],
  ['VAULT_ABI', 'IncomeModules', 'CooldownBucket', [
    'cancelWithdrawal', 'delay', 'pendingAmount', 'releaseAt', 'releaseWithdrawal', 'requestWithdrawal',
  ]],
  ['OBSERVER_ABI', 'CampTransferMonitor', 'CampTransferMonitor', ['count', 'OWNER', 'remaining', 'subscribed', 'TOKEN']],
];

const output = ['// Generated from the Solidity artifacts by web/script/contract-abi.mjs.'];
function defineParameter({ name, type, indexed, components }) {
  return { name, type, indexed, components: components?.map(defineParameter) };
}
for (const [constant, source, contract, names] of contracts) {
  const file = new URL('../../out/' + source + '.sol/' + contract + '.json', import.meta.url);
  const { abi } = JSON.parse(await readFile(file, 'utf8'));
  const fragments = names.map(name => {
    const candidates = abi.filter(item => item.name === name && ['event', 'function'].includes(item.type));
    if (candidates.length !== 1) throw new Error(contract + ' must expose one ABI fragment named ' + name);
    const { type, inputs, outputs, anonymous, stateMutability } = candidates[0];
    return { type, name, inputs: inputs.map(defineParameter), outputs: outputs?.map(defineParameter), anonymous, stateMutability };
  });
  output.push('export const ' + constant + ' = [', ...fragments.map(item => '  ' + JSON.stringify(item) + ','), '];', '');
}
const target = new URL('../src/contract-abi.generated.js', import.meta.url);
const content = output.join('\n');
if (process.argv.includes('--check')) {
  const existing = await readFile(target, 'utf8');
  if (existing.replace(/\r\n/g, '\n') !== content) {
    throw new Error('Frontend contract ABIs are stale. Rebuild the Solidity artifacts and run node web/script/contract-abi.mjs.');
  }
  console.log('Frontend contract ABIs match the compiled Solidity artifacts.');
} else {
  await writeFile(target, content);
}
