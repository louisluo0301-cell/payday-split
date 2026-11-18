import { getAddress, ZeroAddress } from 'ethers';

function addressOrEmpty(value) {
  try {
    const address = getAddress(value);
    return address === ZeroAddress ? '' : address;
  } catch { return ''; }
}

export function selectDeploymentAsset(base, requested) {
  const primary = addressOrEmpty(base.token);
  const shared = base.modules || {};
  const assets = [];
  const ids = new Set();
  const tokens = new Set();
  for (const entry of Array.isArray(base.assets) ? base.assets : []) {
    const token = addressOrEmpty(entry?.token);
    if (!token || typeof entry.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(entry.id)
      || ids.has(entry.id) || tokens.has(token) || (entry.id === 'default' && token !== primary)) continue;
    ids.add(entry.id);
    tokens.add(token);
    assets.push({
      id: entry.id, token, label: typeof entry.label === 'string' && entry.label.trim()
        ? entry.label.trim().slice(0, 36) : `${token.slice(0, 8)}…`,
      aavePool: addressOrEmpty(entry.aavePool),
    });
  }
  const legacy = { id: 'default', token: primary, label: 'Default asset', aavePool: addressOrEmpty(shared.aavePool) };
  const fallback = assets.find(entry => entry.token === primary) || (primary ? legacy : assets[0]);
  if (fallback === legacy) assets.unshift(legacy);
  const selected = requested === null ? fallback : assets.find(entry => entry.id === requested);
  return {
    assets,
    selected,
    invalid: requested !== null && !selected,
    deployment: {
      ...base, token: selected?.token || '', split: addressOrEmpty(base.split),
      modules: { ...shared, wrappedNative: addressOrEmpty(shared.wrappedNative), aavePool: selected?.aavePool || '' },
    },
  };
}
