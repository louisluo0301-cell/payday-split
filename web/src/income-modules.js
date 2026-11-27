import { Contract, FetchRequest, JsonRpcProvider, ZeroAddress, formatUnits, getAddress, isAddress, parseUnits } from 'ethers';
import {
  FACTORY_ABI as FACTORY, REACTIVE_ABI, RETRY_QUEUE_ABI, SAVINGS_ABI as AAVE, TOKEN_ABI as TOKEN, VAULT_ABI as VAULT,
} from './contract-abi.generated.js';

const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const available = address => isAddress(address || '') && !same(address, ZeroAddress);
const time = value => new Date(Number(value) * 1000).toLocaleString();

export const SAMPLE_SAVINGS_DESTINATION = '0x000000000000000000000000000000000000aa03';

export function savingsSetupState({ aavePool, factory } = {}, savings) {
  if (!available(aavePool) || !available(factory)) return { step: 'unsupported' };
  if (!savings) return { step: 'unavailable' };
  const { aave, pool, registered } = savings;
  if (!available(aave)) return { step: 'create' };
  if (!same(pool, aavePool)) return { step: 'unavailable', address: aave };
  return { step: same(aave, registered) ? 'ready' : 'bind', address: aave };
}

export function createIncomeModules({ $, context, stageBucket, toast, setWalletBusy, refreshWorkspace, onSavingsChange }) {
  let snapshot;
  let requestId = 0;
  let working = false;

  function set(id, text) { $('#' + id).textContent = text; }
  function enabled(id, value) { $('#' + id).disabled = working || !value; }
  const amount = (value, ctx) => `${formatUnits(value, ctx.decimals)} ${ctx.symbol}`;
  const moduleButtons = [
    'retry-toggle', 'retry-process', 'retry-cancel', 'native-create', 'native-copy', 'aave-create',
    'aave-register', 'aave-stage', 'aave-withdraw', 'cooldown-create', 'cooldown-stage',
    'cooldown-request', 'cooldown-release', 'cooldown-cancel',
  ];

  function reset() {
    ++requestId;
    snapshot = null;
    moduleButtons.forEach(id => enabled(id, false));
    for (const id of ['retry-status', 'native-status', 'aave-status', 'cooldown-status']) set(id, '');
    $('#retry-jobs').replaceChildren();
    set('modules-status', context().demoMode
      ? 'Module controls require a connected wallet and the new contracts.'
      : 'Connect a wallet on the configured network to manage your modules.');
    onSavingsChange();
  }

  async function retrySchedule(ctx) {
    const { deployment, reactiveChainId } = ctx;
    if (!available(deployment.reactive) || !deployment.lasnaRpc) return null;
    const request = new FetchRequest(deployment.lasnaRpc);
    request.timeout = 5000;
    const rpc = new JsonRpcProvider(request, reactiveChainId, { staticNetwork: true, batchMaxCount: 1 });
    try {
      if (BigInt(await rpc.send('eth_chainId', [])) !== BigInt(reactiveChainId)) return null;
      const reactive = new Contract(deployment.reactive, REACTIVE_ABI, rpc);
      return await reactive.remainingRetryCalls();
    } catch { return null; }
    finally { rpc.destroy(); }
  }

  async function readRetries(ctx) {
    const [queueAddress, optedIn, ticks] = await Promise.all([
      ctx.split.retryQueue(), ctx.split.retryEnabled(ctx.account, ctx.token), retrySchedule(ctx),
    ]);
    const queue = new Contract(queueAddress, RETRY_QUEUE_ABI, ctx.provider);
    const [pending, occupied] = await Promise.all([queue.retryPending(ctx.account, ctx.token), queue.retryQueueLength()]);
    let jobs = [];
    let closed = [];
    let historyUnavailable = false;
    try {
      const head = Number(await ctx.provider.send('eth_blockNumber', []));
      const from = Math.max(0, head - 2000);
      const [queued, finished] = await Promise.all([
        pending > 0n ? queue.queryFilter(queue.filters.RetryQueued(ctx.account, ctx.token), from, head) : [],
        queue.queryFilter(queue.filters.RetryClosed(ctx.account, ctx.token), from, head),
      ]);
      const ids = queued.slice(-16).map(event => event.args.id);
      const entries = await Promise.all(ids.map(async id => ({ id, job: await queue.retryJob(id) })));
      jobs = entries.filter(({ job }) => job.amount > 0n);
      closed = finished.slice(-5).reverse();
    } catch { historyUnavailable = true; }
    return { optedIn, ticks, pending, occupied, jobs, closed, historyUnavailable };
  }

  async function readModuleFactory(ctx, at) {
    const config = ctx.deployment.modules || {};
    if (!available(config.factory)) return null;
    const factory = new Contract(config.factory, FACTORY, ctx.provider);
    if (!same(await factory.split(at), ctx.deployment.split)) throw new Error('Module factory belongs to another split contract.');
    return factory;
  }

  async function readSavings(ctx, factory, at) {
    const [latest, registered] = await Promise.all([
      factory.latest(ctx.account, ctx.token, 1, at), ctx.split.savingsBucket(ctx.account, ctx.token, at),
    ]);
    // An adapter still bound to the waterfall takes priority over a newer factory entry.
    const aave = available(registered) ? registered : latest;
    if (!available(aave)) return { aave, registered };
    try {
      const savings = new Contract(aave, AAVE, ctx.provider);
      const [aToken, pool] = await Promise.all([savings.aToken(at), savings.pool(at)]);
      return { aave, registered, aToken, pool };
    } catch {
      return { aave, registered };
    }
  }

  async function readBuckets(ctx) {
    const at = { blockTag: await ctx.provider.send('eth_blockNumber', []) };
    const factory = await readModuleFactory(ctx, at);
    if (!factory) return null;
    const config = ctx.deployment.modules || {};
    const [native, cooldown, savings] = await Promise.all([
      factory.latest(ctx.account, ctx.token, 0, at), factory.latest(ctx.account, ctx.token, 2, at),
      readSavings(ctx, factory, at),
    ]);
    const results = { factory, config, native, cooldown, ...savings };
    if (available(results.aToken)) {
      try { results.position = await new Contract(results.aToken, TOKEN, ctx.provider).balanceOf(ctx.account, at); }
      catch { /* An unavailable position cannot authorize a withdrawal. */ }
    }
    if (available(cooldown)) {
      try {
        const vault = new Contract(cooldown, VAULT, ctx.provider);
        const block = await ctx.provider.send('eth_getBlockByNumber', ['latest', false]);
        const at = { blockTag: block.number };
        const [locked, pending, releaseAt, delay] = await Promise.all([
          new Contract(ctx.token, TOKEN, ctx.provider).balanceOf(cooldown, at), vault.pendingAmount(at),
          vault.releaseAt(at), vault.delay(at),
        ]);
        results.vault = { locked, pending, releaseAt, delay, ready: pending !== 0n && BigInt(block.timestamp) >= releaseAt };
      } catch { /* Unreadable state cannot authorize a release. */ }
    }
    return results;
  }

  function savingsDestination() {
    const ctx = context();
    if (ctx.demoMode) return { step: 'sample', address: SAMPLE_SAVINGS_DESTINATION };
    const config = ctx.deployment.modules;
    if (!available(config?.factory) || !available(config?.aavePool)) return { step: 'unsupported' };
    if (!ctx.signer) return { step: 'connect' };
    if (working) return { step: 'working', address: snapshot?.buckets?.aave };
    if (!snapshot || snapshot.signer !== ctx.signer) return { step: 'checking' };
    return savingsSetupState(config, snapshot.buckets);
  }

  async function verifySavingsDestination(address) {
    const ctx = context();
    const at = { blockTag: await ctx.provider.send('eth_blockNumber', []) };
    const factory = await readModuleFactory(ctx, at);
    const savings = factory && await readSavings(ctx, factory, at);
    const result = savingsSetupState(ctx.deployment.modules, savings);
    if (result.step !== 'ready' || !same(result.address, address) || ctx.signer !== context().signer) {
      throw new Error('Verify the configured Aave adapter and enable automatic supply before saving this destination.');
    }
  }

  function render(ctx) {
    if (!snapshot) return;
    const { retries, buckets } = snapshot;
    if (retries) {
      const cron = retries.ticks === null ? 'Scheduler status unavailable'
        : retries.ticks === 0n ? 'Cron inactive' : `${retries.ticks} scheduled callbacks remaining`;
      set('retry-status', `${retries.optedIn ? 'Enabled' : 'Disabled'} · ${retries.pending} pending · ${cron}.`);
      set('retry-toggle', retries.optedIn ? 'Disable and invalidate jobs' : 'Enable retries');
      enabled('retry-toggle', true);
      enabled('retry-process', retries.occupied > 0n);
      enabled('retry-cancel', retries.pending > 0n);
      const jobs = $('#retry-jobs');
      jobs.replaceChildren();
      const addJob = text => {
        const li = document.createElement('li');
        li.textContent = text;
        jobs.append(li);
      };
      for (const { id, job } of retries.jobs) {
        addJob(`Job ${id} · bucket ${job.bucketIndex + 1n} · ${amount(job.amount, ctx)} · due ${time(job.due)} · ${job.attempts}/3 attempts`);
      }
      for (const event of retries.closed) {
        const { id, result, amount: value } = event.args;
        const label = ['','paid','invalidated','attempts ended','cancelled'][Number(result)];
        addJob(`Job ${id} · ${label} · ${amount(value, ctx)}`);
      }
      if (retries.historyUnavailable || BigInt(retries.jobs.length) < retries.pending) {
        addJob('Some job details were outside the recent scan or unavailable. Use the job ID from its queue event to cancel it.');
      }
    } else set('retry-status', 'Retry contract state unavailable. This feature requires the new split.');

    if (!buckets) {
      for (const id of ['native-status', 'aave-status', 'cooldown-status']) set(id, 'Module factory is unavailable.');
      return;
    }
    const { config, native, aave, cooldown, vault, pool, position } = buckets;
    const wethReady = same(config.wrappedNative || '', ctx.token);
    set('native-status', available(native) ? `Send native ETH to ${native}`
      : wethReady ? 'No ETH receiver yet.' : 'Select a deployment whose waterfall asset is the configured WETH.');
    enabled('native-create', wethReady && !available(native));
    enabled('native-copy', available(native));
    const aaveStep = savingsSetupState(config, buckets).step;
    const registeredAave = aaveStep === 'ready';
    set('aave-status', available(aave)
      ? `${aave} · ${registeredAave ? 'Automatic supply enabled' : 'Automatic supply pending'}${position === undefined ? '' : ` · wallet aToken position ${amount(position, ctx)}`}`
      : available(config.aavePool) ? 'No savings bucket yet.' : 'Set the verified Aave V3 pool for this asset in the deployment.');
    enabled('aave-create', aaveStep === 'create');
    enabled('aave-register', aaveStep === 'bind');
    enabled('aave-stage', registeredAave);
    enabled('aave-withdraw', available(pool) && same(pool, config.aavePool) && position > 0n);

    set('cooldown-status', !available(cooldown) ? 'No spending bucket yet.'
      : !vault ? `${cooldown} · balance and withdrawal state unavailable.`
        : `${cooldown} · ${amount(vault.locked, ctx)} locked for ${vault.delay / 3600n}h per request${vault.pending ? ` · ${amount(vault.pending, ctx)} requested, available ${time(vault.releaseAt)}` : ''}.`);
    enabled('cooldown-create', !available(cooldown));
    enabled('cooldown-stage', available(cooldown));
    enabled('cooldown-request', !!vault && vault.locked > 0n && vault.pending === 0n);
    enabled('cooldown-release', !!vault?.ready);
    enabled('cooldown-cancel', !!vault && vault.pending > 0n);
  }

  async function refresh() {
    const ctx = context();
    if (!ctx.signer || !ctx.split || ctx.demoMode) { reset(); return; }
    const request = ++requestId;
    set('modules-status', 'Reading modules…');
    moduleButtons.forEach(id => enabled(id, false));
    const [retries, buckets] = await Promise.allSettled([readRetries(ctx), readBuckets(ctx)]);
    if (request !== requestId || ctx.signer !== context().signer) return;
    snapshot = {
      signer: ctx.signer,
      retries: retries.status === 'fulfilled' ? retries.value : null,
      buckets: buckets.status === 'fulfilled' ? buckets.value : null,
    };
    set('modules-status', '');
    render(ctx);
    onSavingsChange();
  }

  async function verifyWallet(ctx) {
    if (BigInt(await ctx.provider.send('eth_chainId', [])) !== BigInt(ctx.chainId)
      || !same((await ctx.provider.send('eth_accounts', []))[0], ctx.account)
      || ctx.signer !== context().signer) throw new Error('Wallet or network changed. Refresh before continuing.');
  }

  async function runTransaction(work) {
    const ctx = context();
    if (working || ctx.busy || !ctx.signer || snapshot?.signer !== ctx.signer) return;
    working = true;
    setWalletBusy(true);
    render(ctx);
    onSavingsChange();
    try {
      await verifyWallet(ctx);
      const tx = await work(ctx, snapshot);
      const receipt = await tx.wait();
      if (ctx.signer === context().signer) {
        toast('Module transaction confirmed.', false, tx.hash);
        await refreshWorkspace({ afterBlock: receipt.blockNumber });
      }
    } catch (error) {
      if (ctx.signer === context().signer) toast(error.shortMessage || error.message, true);
    } finally {
      working = false;
      setWalletBusy(false);
      await refresh();
    }
  }

  function setupSavings(step) {
    return runTransaction(async ctx => {
      const at = { blockTag: await ctx.provider.send('eth_blockNumber', []) };
      const factory = await readModuleFactory(ctx, at);
      const config = ctx.deployment.modules;
      const savings = factory && await readSavings(ctx, factory, at);
      const current = savingsSetupState(config, savings);
      if (current.step !== step || (step !== 'create' && step !== 'bind')) {
        throw new Error('The Aave setup changed. Check the current destination before continuing.');
      }
      if (step === 'create') {
        const pool = new Contract(config.aavePool, ['function getReserveAToken(address) view returns (address)'], ctx.provider);
        const reserve = await pool.getReserveAToken(ctx.token, at);
        if (!available(reserve) || same(reserve, ctx.token) || await ctx.provider.getCode(reserve, at.blockTag) === '0x') {
          throw new Error('The configured Aave pool has no supported reserve for this asset.');
        }
        await verifyWallet(ctx);
        return factory.connect(ctx.signer).createAave(ctx.token, config.aavePool);
      }
      await verifyWallet(ctx);
      return ctx.split.connect(ctx.signer).setSavingsBucket(ctx.token, current.address);
    });
  }

  function wire() {
    $('#modules-refresh').addEventListener('click', refresh);
    function transaction(id, work) {
      $('#' + id).addEventListener('click', () => void runTransaction(work));
    }
    transaction('retry-toggle', (ctx, s) => ctx.split.connect(ctx.signer).setRetryEnabled(ctx.token, !s.retries.optedIn));
    transaction('retry-process', ctx => ctx.split.connect(ctx.signer).processRetries());
    transaction('retry-cancel', (ctx, s) => {
      const id = $('#retry-id').value;
      if (!/^[1-9]\d*$/.test(id)) throw new Error('Enter a positive job ID.');
      return ctx.split.connect(ctx.signer).cancelRetry(BigInt(id));
    });
    transaction('native-create', (ctx, s) => s.buckets.factory.connect(ctx.signer).createNative(ctx.token));
    $('#aave-create').addEventListener('click', () => void setupSavings('create'));
    $('#aave-register').addEventListener('click', () => void setupSavings('bind'));
    transaction('aave-withdraw', (ctx, s) => {
      const destination = getAddress($('#aave-withdraw-address').value.trim());
      if (!available(destination) || same(destination, ctx.account)) throw new Error('Choose a separate wallet so the withdrawal does not trigger this income rule.');
      const quantity = parseUnits($('#aave-withdraw-amount').value, ctx.decimals);
      if (quantity <= 0n || quantity > s.buckets.position) throw new Error('Enter an amount within your Aave position.');
      return new Contract(s.buckets.pool, ['function withdraw(address,uint256,address) returns(uint256)'], ctx.signer)
        .withdraw(ctx.token, quantity, destination);
    });
    transaction('cooldown-create', (ctx, s) => {
      const hours = Number($('#cooldown-hours').value);
      if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error('Set a delay from 1 to 720 hours.');
      return s.buckets.factory.connect(ctx.signer).createCooldown(ctx.token, hours * 3600);
    });
    transaction('cooldown-request', (ctx, s) => {
      const quantity = parseUnits($('#cooldown-amount').value, ctx.decimals);
      if (quantity <= 0n || quantity > s.buckets.vault.locked) throw new Error('Enter an amount within the locked balance.');
      return new Contract(s.buckets.cooldown, VAULT, ctx.signer).requestWithdrawal(quantity);
    });
    transaction('cooldown-release', (ctx, s) => new Contract(s.buckets.cooldown, VAULT, ctx.signer).releaseWithdrawal());
    transaction('cooldown-cancel', (ctx, s) => new Contract(s.buckets.cooldown, VAULT, ctx.signer).cancelWithdrawal());
    $('#native-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(snapshot.buckets.native); toast('ETH receiving address copied.'); }
      catch { toast('Select and copy the receiving address above.', true); }
    });
    $('#aave-stage').addEventListener('click', () => stageBucket(snapshot.buckets.aave, 'Aave savings', 'aave'));
    $('#cooldown-stage').addEventListener('click', () => stageBucket(snapshot.buckets.cooldown, 'Spending cooldown'));
    reset();
  }

  return { wire, refresh, reset, savingsDestination, setupSavings, verifySavingsDestination };
}
