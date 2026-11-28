const spendingAlerts = new Set(['plan-paused', 'expired', 'daily-limit']);

export function workspaceJourney({ demo, configured, sessionDeploymentMissing, invalidAsset, hasWallet, connected, connecting, walletLinked,
  savedActive, dirty, policyDirty, modeDirty, allowance, report, symbol, network, nativeReceiver, demoToken, faucetReady, syncStatus,
  testIncomePending }) {
  const scope = demo ? 'Interactive demo' : configured ? network + ' · ' + symbol : 'Workspace setup';
  const next = (tone, title, note, action, label) => ({ scope, tone, title, note, action, label });
  if (demo) return next('demo', 'Try a sample income',
    'Edit the destinations or amount, then see what would be paid and what stays in your wallet.', 'sample', 'Run sample income');
  if (sessionDeploymentMissing) return next('warning', 'Reopen the testnet workspace',
    'This tab needs a current deployment check. Import the deployment JSON again to continue.', 'deployment', 'Open testnet workspace');
  if (invalidAsset) return next('warning', 'Choose a supported asset',
    'Use the asset selector to open a plan on this network.', 'asset', 'Choose asset');
  if (!connected && connecting) return next('neutral', 'Waiting for your wallet',
    configured ? 'Confirm the account and network in your wallet.' : 'Confirm the account in your wallet.');
  if (!configured && walletLinked) return next('neutral', 'Open a testnet workspace',
    'Your wallet address is connected. Open a verified deployment to save a plan and test payments.', 'deployment', 'Open testnet workspace');
  if (!configured) return next('neutral', 'Connect your wallet or try the demo',
    'You can view your wallet address now. Payments require a verified testnet workspace.', 'connect', 'Connect wallet');
  if (!connected && !hasWallet) return next('demo', 'Try it without a wallet',
    'Use the demo now, or reopen this page in a browser with an Ethereum wallet to use this testnet.', 'demo', 'Open interactive demo');
  if (!connected) return next('neutral', 'Connect to see your plan',
    'Connect the wallet that will receive your test income on ' + network + '. Spending permission is a separate step.', 'connect', 'Connect wallet');
  if (syncStatus === 'reading') return next('neutral', 'Reading your onchain plan',
    'Checking balance, allowance and saved settings from the same block.');
  if (syncStatus === 'unavailable') return next('warning', 'Refresh your onchain plan',
    'The latest wallet data is unavailable. Check your connection before making changes.', 'refresh', 'Refresh plan');
  if (testIncomePending) return next('neutral', 'Test income submitted',
    'Track the source transaction while your claim is pending.', 'claim-status', 'View claim status');
  if (dirty) return next('warning', 'Save your destination changes',
    'The last saved destinations still apply onchain. Review your draft before saving.', 'plan', 'Review destinations');
  if (savedActive === null) return next('neutral', 'Read your saved plan',
    'Check the current wallet and network before setting up payments.', 'refresh', 'Check plan');
  if (savedActive === 0) return next('neutral', 'Choose where your income goes',
    'Add an active destination with a fixed amount or a percentage. Save it to use the plan.', 'plan', 'Set destinations');
  if (policyDirty) return next('warning', 'Review your spending changes',
    'The previous spending controls still apply until the new settings are confirmed.', 'spending', 'Review controls');
  if (modeDirty) return next('warning', 'Review your allocation mode',
    'Choose and save how to allocate income across your destinations.', 'budget', 'Review allocation mode');
  if (allowance === 0n) return next('warning', 'Set a spending allowance',
    'Choose the total amount this plan can spend from your wallet before you renew its allowance.', 'allowance', 'Set allowance');
  const alerts = report?.alerts ?? [];
  const issue = alerts.find(alert => alert.severity === 'blocked')
    ?? (report?.complete ? alerts.find(alert => alert.severity === 'warning') : undefined);
  if (issue && spendingAlerts.has(issue.id)) return next('warning', issue.title, issue.action, 'spending', 'Review controls');
  if (issue) return next('warning', issue.title, issue.action, 'health', 'View health checks');
  if (!report?.complete) return next('neutral', 'Check automation before receiving',
    'Run a read-only check of your saved plan, fees and subscription.', 'check-health', 'Check automation');
  if (report.status !== 'ready') return next('neutral', 'Review automation before receiving',
    'Open the latest checks for your saved plan, fees and subscription.', 'health', 'View health checks');
  if (nativeReceiver) return next('ready', 'Ready for WETH income',
    'Use a dedicated receiving address if the sender pays in native ETH.', 'native', 'Open ETH receiver');
  if (demoToken && faucetReady) return next('ready', 'Ready for a test income',
    'Claim a test transfer to see how the saved plan routes your income.', 'faucet', 'Claim test income');
  return next('ready', 'Ready to receive ' + symbol,
    'Share this wallet address with a sender using ' + network + ' and ' + symbol + '.', 'receive', 'Copy receiving address');
}
