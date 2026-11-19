// Generated from the Solidity artifacts by web/script/contract-abi.mjs.
export const SPLIT_ABI = [
  {"type":"function","name":"_SERVICE_PROVIDER","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"allocationModes","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"","type":"uint8"}],"stateMutability":"view"},
  {"type":"function","name":"bucketGoals","inputs":[{"name":"user_","type":"address"},{"name":"token_","type":"address"},{"name":"version_","type":"uint256"},{"name":"index_","type":"uint256"}],"outputs":[{"name":"target","type":"uint96"},{"name":"paid","type":"uint96"},{"name":"cycle","type":"uint64"}],"stateMutability":"view"},
  {"type":"function","name":"cancelRetry","inputs":[{"name":"id_","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"cycleConfigs","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"anchor","type":"uint64"},{"name":"duration","type":"uint32"},{"name":"revision","type":"uint32"}],"stateMutability":"view"},
  {"type":"function","name":"dailySpend","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"day","type":"uint256"},{"name":"amount","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"getBucketIds","inputs":[{"name":"user_","type":"address"},{"name":"token_","type":"address"}],"outputs":[{"name":"","type":"uint64[]"}],"stateMutability":"view"},
  {"type":"function","name":"getBuckets","inputs":[{"name":"user_","type":"address"},{"name":"token_","type":"address"}],"outputs":[{"name":"","type":"tuple[]","components":[{"name":"payee","type":"address"},{"name":"fixedAmount","type":"uint96"},{"name":"bps","type":"uint16"},{"name":"active","type":"bool"}]}],"stateMutability":"view"},
  {"type":"function","name":"paused","inputs":[],"outputs":[{"name":"","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"policies","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"reserve","type":"uint96"},{"name":"maxPerRun","type":"uint96"},{"name":"dailyLimit","type":"uint96"},{"name":"minIncome","type":"uint96"},{"name":"validUntil","type":"uint64"},{"name":"paused","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"previewExecution","inputs":[{"name":"user_","type":"address"},{"name":"token_","type":"address"},{"name":"paycheck_","type":"uint256"}],"outputs":[{"name":"amounts","type":"uint256[]"},{"name":"retained","type":"uint256"},{"name":"blocked","type":"uint8"}],"stateMutability":"view"},
  {"type":"function","name":"processRetries","inputs":[],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"processed","inputs":[{"name":"","type":"bytes32"}],"outputs":[{"name":"","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"reactive","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"recoverSplit","inputs":[{"name":"token_","type":"address"},{"name":"paycheck_","type":"uint256"},{"name":"originTxHash_","type":"uint256"},{"name":"logIndex_","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"retryEnabled","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"retryQueue","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"ruleVersion","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"runSplit","inputs":[{"name":"token_","type":"address"},{"name":"paycheck_","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"savingsBucket","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"setAllocationMode","inputs":[{"name":"token_","type":"address"},{"name":"mode_","type":"uint8"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setBucketGoal","inputs":[{"name":"token_","type":"address"},{"name":"index_","type":"uint256"},{"name":"expectedVersion_","type":"uint256"},{"name":"target_","type":"uint96"},{"name":"newCycle_","type":"bool"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setBuckets","inputs":[{"name":"token_","type":"address"},{"name":"buckets_","type":"tuple[]","components":[{"name":"payee","type":"address"},{"name":"fixedAmount","type":"uint96"},{"name":"bps","type":"uint16"},{"name":"active","type":"bool"}]}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setBucketsWithIds","inputs":[{"name":"token_","type":"address"},{"name":"buckets_","type":"tuple[]","components":[{"name":"payee","type":"address"},{"name":"fixedAmount","type":"uint96"},{"name":"bps","type":"uint16"},{"name":"active","type":"bool"}]},{"name":"ids_","type":"uint64[]"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setCycleConfig","inputs":[{"name":"token_","type":"address"},{"name":"anchor_","type":"uint64"},{"name":"duration_","type":"uint32"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setPolicy","inputs":[{"name":"token_","type":"address"},{"name":"policy_","type":"tuple","components":[{"name":"reserve","type":"uint96"},{"name":"maxPerRun","type":"uint96"},{"name":"dailyLimit","type":"uint96"},{"name":"minIncome","type":"uint96"},{"name":"validUntil","type":"uint64"},{"name":"paused","type":"bool"}]}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setRetryEnabled","inputs":[{"name":"token_","type":"address"},{"name":"enabled_","type":"bool"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setSavingsBucket","inputs":[{"name":"token_","type":"address"},{"name":"bucket_","type":"address"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"event","name":"BucketSkipped","inputs":[{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"bucketIndex","type":"uint256","indexed":false},{"name":"paycheck","type":"uint256","indexed":false},{"name":"requested","type":"uint256","indexed":false},{"name":"reason","type":"uint8","indexed":false},{"name":"version","type":"uint256","indexed":false},{"name":"originTxHash","type":"uint256","indexed":false},{"name":"logIndex","type":"uint256","indexed":false}],"anonymous":false},
  {"type":"event","name":"BucketsSet","inputs":[{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"version","type":"uint256","indexed":true},{"name":"payees","type":"address[]","indexed":false},{"name":"fixedAmounts","type":"uint96[]","indexed":false},{"name":"bps","type":"uint16[]","indexed":false},{"name":"active","type":"bool[]","indexed":false}],"anonymous":false},
  {"type":"event","name":"Retained","inputs":[{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"amount","type":"uint256","indexed":false},{"name":"version","type":"uint256","indexed":false},{"name":"originTxHash","type":"uint256","indexed":false},{"name":"logIndex","type":"uint256","indexed":false}],"anonymous":false},
  {"type":"event","name":"Split","inputs":[{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"payee","type":"address","indexed":true},{"name":"paycheck","type":"uint256","indexed":false},{"name":"amount","type":"uint256","indexed":false},{"name":"bucketIndex","type":"uint256","indexed":false},{"name":"version","type":"uint256","indexed":false},{"name":"originTxHash","type":"uint256","indexed":false},{"name":"logIndex","type":"uint256","indexed":false}],"anonymous":false},
];

export const REACTIVE_ABI = [
  {"type":"function","name":"_SERVICE_PROVIDER","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"getRule","inputs":[{"name":"user_","type":"address"},{"name":"token_","type":"address"}],"outputs":[{"name":"payees","type":"address[]"},{"name":"fixedAmounts","type":"uint96[]"},{"name":"bps","type":"uint16[]"},{"name":"active","type":"bool[]"},{"name":"version","type":"uint256"},{"name":"subscribed","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"paused","inputs":[],"outputs":[{"name":"","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"react","inputs":[{"name":"log_","type":"tuple","components":[{"name":"chainId","type":"uint256"},{"name":"contractAddress","type":"address"},{"name":"topic0","type":"uint256"},{"name":"topic1","type":"uint256"},{"name":"topic2","type":"uint256"},{"name":"topic3","type":"uint256"},{"name":"data","type":"bytes"},{"name":"blockNumber","type":"uint256"},{"name":"opCode","type":"uint256"},{"name":"blockHash","type":"uint256"},{"name":"txHash","type":"uint256"},{"name":"logIndex","type":"uint256"}]}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"remaining","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"remainingRetryCalls","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"seen","inputs":[{"name":"","type":"bytes32"}],"outputs":[{"name":"","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"userRemaining","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"event","name":"Seen","inputs":[{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"amount","type":"uint256","indexed":false},{"name":"originTxHash","type":"uint256","indexed":false},{"name":"logIndex","type":"uint256","indexed":false}],"anonymous":false},
];

export const TOKEN_ABI = [
  {"type":"function","name":"FAUCET_AMOUNT","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"FAUCET_COOLDOWN","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"allowance","inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"approve","inputs":[{"name":"spender","type":"address"},{"name":"value","type":"uint256"}],"outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"balanceOf","inputs":[{"name":"account","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"decimals","inputs":[],"outputs":[{"name":"","type":"uint8"}],"stateMutability":"pure"},
  {"type":"function","name":"faucet","inputs":[],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"lastFaucetAt","inputs":[{"name":"","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"symbol","inputs":[],"outputs":[{"name":"","type":"string"}],"stateMutability":"view"},
  {"type":"event","name":"Transfer","inputs":[{"name":"from","type":"address","indexed":true},{"name":"to","type":"address","indexed":true},{"name":"value","type":"uint256","indexed":false}],"anonymous":false},
];

export const RETRY_QUEUE_ABI = [
  {"type":"function","name":"retryJob","inputs":[{"name":"id","type":"uint256"}],"outputs":[{"name":"","type":"tuple","components":[{"name":"origin","type":"tuple","components":[{"name":"user","type":"address"},{"name":"token","type":"address"},{"name":"version","type":"uint256"},{"name":"txHash","type":"uint256"},{"name":"logIndex","type":"uint256"},{"name":"gross","type":"uint256"}]},{"name":"epoch","type":"uint256"},{"name":"period","type":"uint64"},{"name":"due","type":"uint64"},{"name":"amount","type":"uint96"},{"name":"bucketIndex","type":"uint8"},{"name":"attempts","type":"uint8"}]}],"stateMutability":"view"},
  {"type":"function","name":"retryPending","inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"retryQueueLength","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"event","name":"RetryClosed","inputs":[{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"id","type":"uint256","indexed":true},{"name":"result","type":"uint8","indexed":false},{"name":"amount","type":"uint256","indexed":false}],"anonymous":false},
  {"type":"event","name":"RetryQueued","inputs":[{"name":"user","type":"address","indexed":true},{"name":"token","type":"address","indexed":true},{"name":"id","type":"uint256","indexed":true},{"name":"originTxHash","type":"uint256","indexed":false},{"name":"logIndex","type":"uint256","indexed":false},{"name":"bucketIndex","type":"uint256","indexed":false},{"name":"amount","type":"uint256","indexed":false},{"name":"due","type":"uint256","indexed":false}],"anonymous":false},
];

export const FACTORY_ABI = [
  {"type":"function","name":"createAave","inputs":[{"name":"asset","type":"address"},{"name":"pool","type":"address"}],"outputs":[{"name":"module","type":"address"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"createCooldown","inputs":[{"name":"asset","type":"address"},{"name":"delay","type":"uint256"}],"outputs":[{"name":"module","type":"address"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"createNative","inputs":[{"name":"wrapped","type":"address"}],"outputs":[{"name":"module","type":"address"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"latest","inputs":[{"name":"","type":"address"},{"name":"","type":"address"},{"name":"","type":"uint8"}],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"split","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
];

export const SAVINGS_ABI = [
  {"type":"function","name":"aToken","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"pool","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
];

export const VAULT_ABI = [
  {"type":"function","name":"cancelWithdrawal","inputs":[],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"delay","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"pendingAmount","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"releaseAt","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"releaseWithdrawal","inputs":[],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"requestWithdrawal","inputs":[{"name":"amount","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
];

export const OBSERVER_ABI = [
  {"type":"function","name":"count","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"OWNER","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"remaining","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"subscribed","inputs":[],"outputs":[{"name":"","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"TOKEN","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
];
