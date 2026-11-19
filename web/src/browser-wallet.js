export function createBrowserWallet({ $, browser, onChange }) {
  const dialog = $('#wallet-dialog');
  const options = $('#wallet-options');
  const announced = new Map();
  let selected = null;
  let pending;

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

  function finish(provider) {
    const resolve = pending;
    pending = undefined;
    if (dialog.open) dialog.close();
    if (provider) selected = provider;
    resolve?.(provider);
  }

  function render() {
    const buttons = Array.from(available(), ([provider, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline';
      button.textContent = label;
      button.addEventListener('click', () => finish(provider));
      return button;
    });
    options.replaceChildren(...buttons);
    if (!buttons.length) {
      const message = document.createElement('p');
      message.textContent = 'Open this page in a browser with an Ethereum wallet, or try the interactive demo.';
      options.append(message);
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

  function discover() { browser.dispatchEvent(new browser.Event('eip6963:requestProvider')); }
  function choose({ reuse = false } = {}) {
    if (reuse && selected) return Promise.resolve(selected);
    if (pending) return Promise.resolve(null);
    discover();
    const wallets = Array.from(available().keys());
    if (wallets.length === 1) {
      selected = wallets[0];
      return Promise.resolve(selected);
    }
    render();
    return new Promise(resolve => {
      pending = resolve;
      dialog.showModal();
    });
  }

  return { discover, choose, hasWallet: () => available().size > 0, label: provider => available().get(provider) || 'Browser wallet' };
}
