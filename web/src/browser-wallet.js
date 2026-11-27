export function createBrowserWallet({ $, browser, onChange }) {
  const dialog = $('#wallet-dialog');
  const title = $('#wallet-dialog-title');
  const description = $('#wallet-dialog-description');
  const options = $('#wallet-options');
  const empty = $('#wallet-empty');
  const detectionStatus = $('#wallet-detection-status');
  const checkAgain = $('#wallet-check-again');
  const demoLink = $('#wallet-open-demo');
  const accountDialog = $('#wallet-account-dialog');
  const document = dialog.ownerDocument;
  const announced = new Map();
  const alreadyDemo = new URLSearchParams(browser.location.search).has('demo');
  let selected = null;
  let pending;
  let optionButtons = new Map();
  let accountTrigger;

  if (alreadyDemo) demoLink.href = '#dashboard';

  function available() {
    const legacy = browser.ethereum;
    const providers = new Map(announced);
    const injected = Array.isArray(legacy?.providers) && legacy.providers.length ? legacy.providers : [legacy];
    for (const [index, provider] of injected.entries()) {
      if (typeof provider?.request !== 'function' || providers.has(provider)) continue;
      providers.set(provider, injected.length === 1 ? 'Browser wallet' : 'Browser wallet ' + (index + 1));
    }
    return providers;
  }

  function restoreFocus(trigger) {
    if (trigger?.isConnected && !trigger.disabled && !trigger.hidden) trigger.focus({ preventScroll: true });
  }

  function finish(provider) {
    const session = pending;
    pending = undefined;
    if (dialog.open) dialog.close();
    if (provider) selected = provider;
    restoreFocus(session?.trigger);
    session?.resolve(provider);
  }

  function render() {
    const focused = document.activeElement;
    const focusedProvider = [...optionButtons].find(([, button]) => button === focused)?.[0];
    const wallets = available();
    optionButtons = new Map();
    for (const [provider, label] of wallets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline';
      button.textContent = label;
      button.addEventListener('click', () => finish(provider));
      optionButtons.set(provider, button);
    }
    options.replaceChildren(...optionButtons.values());
    options.hidden = wallets.size === 0;
    empty.hidden = wallets.size !== 0;
    demoLink.hidden = wallets.size !== 0;
    if (dialog.open) {
      const replacement = optionButtons.get(focusedProvider);
      if (replacement) replacement.focus({ preventScroll: true });
      else if (wallets.size && (focused === checkAgain || focused === demoLink)) title.focus({ preventScroll: true });
    }
  }

  browser.addEventListener('eip6963:announceProvider', event => {
    const { info, provider } = event.detail ?? {};
    if (typeof provider?.request !== 'function' || announced.has(provider)
      || typeof info?.name !== 'string' || !info.name.trim()) return;
    announced.set(provider, info.name.trim().slice(0, 48));
    if (dialog.open) render();
    onChange();
  });
  $('#wallet-cancel').addEventListener('click', () => finish(null));
  dialog.addEventListener('close', () => { if (pending && !dialog.open) finish(null); });
  $('#wallet-account-close').addEventListener('click', closeAccount);
  accountDialog.addEventListener('close', () => {
    if (accountDialog.open) return;
    restoreFocus(accountTrigger);
    accountTrigger = undefined;
  });

  function discover() { browser.dispatchEvent(new browser.Event('eip6963:requestProvider')); }
  checkAgain.addEventListener('click', () => {
    discover();
    render();
    if (!empty.hidden) detectionStatus.textContent = 'No Ethereum wallet detected yet.';
  });
  demoLink.addEventListener('click', () => finish(null));

  function choose({ reuse = false, explicit = false, trigger, network, readOnly = false } = {}) {
    if (reuse && selected) return Promise.resolve(selected);
    if (pending) return Promise.resolve(null);
    discover();
    const wallets = Array.from(available().keys());
    if (!explicit && wallets.length === 1) {
      selected = wallets[0];
      return Promise.resolve(selected);
    }
    description.textContent = readOnly
      ? 'Connect to see your wallet address and current network.'
      : network
        ? `Choose an Ethereum wallet. The workspace may ask to switch it to ${network}.`
        : 'Choose an Ethereum wallet installed in this browser.';
    detectionStatus.textContent = 'No Ethereum wallet detected.';
    render();
    return new Promise(resolve => {
      pending = { resolve, trigger: trigger ?? document.activeElement };
      dialog.showModal();
      title.focus({ preventScroll: true });
    });
  }

  function openAccount({ trigger, account, providerLabel, network, readOnly }) {
    if (accountDialog.open || dialog.open) return;
    accountTrigger = trigger ?? document.activeElement;
    $('#wallet-account-provider').textContent = providerLabel || 'Browser wallet';
    $('#wallet-account-network').textContent = network || 'Unknown network';
    $('#wallet-account-address').textContent = account;
    $('#wallet-account-status').textContent = '';
    $('#wallet-account-description').textContent = !readOnly
      ? 'Use this account to manage your plan in the testnet workspace.'
      : alreadyDemo
        ? 'Wallet connected in read-only mode. The demo uses sample funds.'
        : 'Wallet connected in read-only mode. Open a verified testnet workspace to save a plan.';
    accountDialog.showModal();
    $('#wallet-account-title').focus({ preventScroll: true });
  }

  function closeAccount() {
    if (accountDialog.open) accountDialog.close();
  }

  function clearSelection() {
    selected = null;
    if (pending) finish(null);
  }

  return {
    discover, choose, openAccount, closeAccount, clearSelection,
    hasWallet: () => available().size > 0,
    label: provider => available().get(provider) || 'Browser wallet',
  };
}
