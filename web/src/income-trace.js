import { formatUnits } from 'ethers';
import { serializeHealthReport } from './automation-health.js';
import { incomeKeys, incomeTransfers, matchedPayout, parseIncomeHash, recoveryQuote } from './income-evidence.js';

export function createIncomeTrace({ $, context, readReactive, readActivity, readRetries = async () => null, recover, toast }) {
  const input = $('#trace-hash');
  const select = $('#trace-transfer');
  const summary = $('#trace-status');
  const timeline = $('#trace-steps');
  const preview = $('#trace-preview');
  const inspectButton = $('#trace-inspect');
  const recoverButton = $('#trace-recover');
  const exportButton = $('#trace-export');
  let revision = 0;
  let moves = [];
  let report = null;
  let reading = false;

  function isCurrent(request, ctx) {
    const current = context();
    return request === revision && ctx.account === current.account && ctx.provider === current.provider;
  }

  function buttons() {
    inspectButton.disabled = reading;
    select.disabled = reading;
    const live = report?.mode === 'chain';
    recoverButton.hidden = !live || !report.preview;
    recoverButton.disabled = reading || !live || report.destination.processed !== false;
    exportButton.hidden = !report;
    exportButton.disabled = reading;
  }

  function reset({ clearInput = false, keepTransfers = false } = {}) {
    ++revision;
    report = null;
    reading = false;
    timeline.hidden = true;
    preview.hidden = true;
    preview.replaceChildren();
    timeline.replaceChildren();
    if (!keepTransfers) {
      moves = [];
      select.replaceChildren();
      $('#trace-transfer-row').hidden = true;
    }
    if (clearInput) input.value = '';
    summary.textContent = '';
    buttons();
  }

  function addStep(title, message, status, link, links = []) {
    const li = document.createElement('li');
    li.dataset.status = status;
    const heading = document.createElement('strong');
    heading.textContent = title;
    const description = document.createElement('p');
    description.textContent = message;
    li.append(heading, description);
    for (const [href, label] of link ? [[link, 'Open transaction ↗'], ...links] : links) {
      const a = document.createElement('a');
      a.className = 'trace-link';
      a.textContent = label;
      a.href = href;
      a.target = '_blank';
      a.rel = 'noreferrer';
      li.append(a);
    }
    timeline.append(li);
  }

  function render(result, ctx) {
    report = result;
    const { source, reactive, destination } = result;
    const demo = result.mode === 'simulation';
    const units = amount => `${formatUnits(amount, ctx.decimals)} ${ctx.symbol}`;
    timeline.hidden = false;
    timeline.replaceChildren();
    summary.textContent = demo ? 'Sample income · simulated data' : 'Verified incoming transfer for this wallet.';
    addStep('Income received', `${units(source.amount)} · block ${source.block} · log ${source.logIndex}`,
      'done', demo ? '' : ctx.txLink(source.hash));

    const requested = reactive.requested;
    addStep('Reactive callback', requested === true ? 'Callback requested for this exact transfer.'
      : requested === false ? 'No callback request was recorded for this transfer.'
      : 'Could not read callback status.', requested === true ? 'done' : 'unknown',
    demo || !reactive.txHash ? '' : ctx.reactiveTxLink(reactive.txHash));

    const payout = destination.payout;
    const paid = payout?.totalRouted;
    const destinationMessage = payout
      ? `${units(paid)} routed · ${units(payout.retained)} retained${payout.skipped ? ` · ${payout.skipped} skipped buckets` : ''}.`
      : destination.processed === true
        ? 'This transfer was marked processed. Matching payment logs were unavailable in recent history.'
        : destination.processed === false
          ? 'No payout has consumed this transfer yet.'
          : 'Could not check whether the payout chain processed this transfer.';
    addStep('Destination result', destinationMessage, destination.processed === true ? 'done' : 'unknown',
      payout && !demo ? ctx.txLink(payout.txHash) : '');

    const retries = destination.retries;
    if (retries && (retries.jobs.length || retries.status !== 'checked')) {
      const states = { queued: 'queued', paid: 'paid', invalidated: 'expired or invalidated', exhausted: 'attempts ended', cancelled: 'cancelled', unknown: 'unconfirmed' };
      const details = retries.jobs.map(job => `Bucket ${job.bucketIndex + 1n}: ${units(job.amount)} ${states[job.result]}.`).join(' ');
      const totals = retries.totals && retries.paid > 0n
        ? ` Updated allocation: ${units(retries.totals.routed)} routed, ${units(retries.totals.retained)} retained.` : '';
      const scope = retries.status === 'checked' ? '' : ' Retry history is limited or unavailable.';
      const links = retries.jobs.flatMap(job => {
        const href = job.resultTx && ctx.txLink(job.resultTx);
        return href ? [[href, 'Bucket ' + (job.bucketIndex + 1n) + ' transaction ↗']] : [];
      });
      addStep('Failed bucket retries', (details + totals + scope).trim(),
        retries.status === 'checked' && retries.jobs.every(job => job.result === 'paid') ? 'done' : 'unknown', '', links);
    }
    const quote = result.preview;
    preview.hidden = !quote;
    if (quote) {
      const title = document.createElement('strong');
      title.textContent = 'Recovery preview';
      const details = document.createElement('p');
      details.textContent = `Saved rule v${quote.version} · ${units(quote.paid)} routed · ${units(quote.retained)} retained.`;
      const payouts = document.createElement('ul');
      for (const { payee, amount } of quote.payouts) {
        const row = document.createElement('li');
        row.textContent = `${payee} · ${units(amount)}`;
        payouts.append(row);
      }
      const note = document.createElement('p');
      note.className = 'fineprint';
      note.textContent = demo ? 'Connect to a configured deployment to recover a real income.'
        : 'Recovery uses the saved rule and funds available when it executes. If the callback gets there first, recovery makes no second payment.';
      preview.replaceChildren(title, details, payouts, note);
    }
    buttons();
  }

  async function verifyNetwork(ctx) {
    const chain = await ctx.provider.send('eth_chainId', []);
    if (BigInt(chain) !== BigInt(ctx.chainId)) throw new Error('Switch to the configured source network and try again.');
  }

  async function quoteFromChain(ctx, income, blockTag) {
    const options = { blockTag };
    const [version, result, buckets] = await Promise.all([
      ctx.split.ruleVersion(ctx.account, ctx.token, options),
      ctx.split.previewExecution(ctx.account, ctx.token, income.amount, options),
      ctx.split.getBuckets(ctx.account, ctx.token, options),
    ]);
    return recoveryQuote(version, result, buckets, income);
  }

  async function inspectTransfer(income) {
    reset({ keepTransfers: true });
    const request = revision;
    const ctx = context();
    reading = true;
    buttons();
    summary.textContent = 'Checking this transfer…';
    try {
      const keys = incomeKeys(ctx.account, ctx.token, income);
      const [reaction, destinationState] = await Promise.allSettled([
        readReactive(ctx, income, keys.reactive),
        (async () => {
          const head = BigInt(await ctx.provider.send('eth_blockNumber', []));
          const processed = await ctx.split.processed(keys.destination, { blockTag: head });
          if (processed) {
            const groups = await readActivity({ head, publish: false });
            const payout = matchedPayout(groups, income);
            const retries = await readRetries(ctx, income, payout, head);
            return { processed, payout, retries };
          }
          const preview = await quoteFromChain(ctx, income, head).catch(() => null);
          return { processed, preview };
        })(),
      ]);
      if (!isCurrent(request, ctx)) return;
      const destination = destinationState.status === 'fulfilled' ? destinationState.value : { processed: null };
      render({
        schema: 'paydaysplit.income-trace', version: 1, mode: 'chain', checkedAt: new Date().toISOString(),
        chainId: ctx.chainId, wallet: ctx.account, token: ctx.token, source: income,
        reactive: reaction.status === 'fulfilled' ? reaction.value : { requested: null },
        destination: {
          contract: ctx.splitAddress, processed: destination.processed,
          payout: destination.payout ?? null, retries: destination.retries ?? null,
        },
        preview: destination.preview ?? null,
      }, ctx);
      if (destination.processed === false && !report.preview) {
        summary.textContent = 'Verified incoming transfer. A positive recovery preview is unavailable; check your saved rule and spending controls.';
      }
    } catch {
      if (isCurrent(request, ctx)) summary.textContent = 'Could not complete this check. Inspect the transfer again.';
    } finally {
      if (isCurrent(request, ctx)) {
        reading = false;
        buttons();
      }
    }
  }

  async function inspect(preselectedIndex) {
    reset();
    const ctx = context();
    if (!ctx.account) {
      summary.textContent = 'Connect your wallet to look up your income.';
      return;
    }
    const request = revision;
    try {
      const hash = parseIncomeHash(input.value);
      reading = true;
      buttons();
      summary.textContent = 'Reading the source receipt…';
      await verifyNetwork(ctx);
      let receipt;
      try { receipt = await ctx.provider.getTransactionReceipt(hash); }
      catch { throw new Error('Could not read the source receipt. Check the network connection.'); }
      if (!isCurrent(request, ctx)) return;
      moves = incomeTransfers(receipt, hash, ctx.account, ctx.token);
      if (moves.length === 1) {
        await inspectTransfer(moves[0]);
        return;
      }
      $('#trace-transfer-row').hidden = false;
      function addOption(text, value) {
        const option = document.createElement('option');
        option.textContent = text;
        option.value = value;
        select.append(option);
      }
      addOption('Choose an incoming transfer', '');
      for (const move of moves) {
        addOption(`Log ${move.logIndex} · ${formatUnits(move.amount, ctx.decimals)} ${ctx.symbol}`, String(move.logIndex));
      }
      const selected = moves.find(move => move.logIndex === preselectedIndex);
      if (selected) {
        select.value = String(selected.logIndex);
        await inspectTransfer(selected);
      } else {
        summary.textContent = `Found ${moves.length} incoming transfers. Choose one to inspect.`;
      }
    } catch (error) {
      if (isCurrent(request, ctx)) summary.textContent = error.message;
    } finally {
      if (isCurrent(request, ctx)) {
        reading = false;
        buttons();
      }
    }
  }

  function sample() {
    reset();
    const ctx = context();
    const unit = 10n ** BigInt(ctx.decimals);
    const scope = '0x' + '0'.repeat(39);
    const source = { hash: '0x' + '0'.repeat(63) + '1', block: 19000001, logIndex: 2, amount: 1000n * unit };
    render({
      schema: 'paydaysplit.income-trace', version: 1, mode: 'simulation', source,
      reactive: { requested: true }, destination: { processed: false, payout: null },
      preview: { version: 1n, paid: 700n * unit, retained: 300n * unit, payouts: [
        { payee: scope + '1', amount: 300n * unit },
        { payee: scope + '2', amount: 250n * unit },
        { payee: scope + '3', amount: 150n * unit },
      ] },
    }, ctx);
  }

  async function submit() {
    if (reading || report?.mode !== 'chain' || !report.preview) return;
    const ctx = context();
    const request = revision;
    const { source, preview: previousQuote } = report;
    reading = true;
    buttons();
    try {
      await verifyNetwork(ctx);
      const receipt = await ctx.provider.getTransactionReceipt(source.hash);
      const income = incomeTransfers(receipt, source.hash, ctx.account, ctx.token)
        .find(move => move.logIndex === source.logIndex && move.amount === source.amount && move.blockHash === source.blockHash);
      if (!income) throw new Error('The source receipt changed. Inspect this income again.');
      const head = BigInt(await ctx.provider.send('eth_blockNumber', []));
      const { destination: key } = incomeKeys(ctx.account, ctx.token, income);
      const [processed, quote] = await Promise.all([
        ctx.split.processed(key, { blockTag: head }),
        quoteFromChain(ctx, income, head),
      ]);
      if (!isCurrent(request, ctx)) return;
      if (processed || serializeHealthReport(quote) !== serializeHealthReport(previousQuote)) {
        toast(processed ? 'This income has already been processed.' : 'Saved settings or available funds changed. Review the refreshed preview.');
        await inspectTransfer(income);
        return;
      }
      await recover(ctx, income);
      if (isCurrent(request, ctx)) await inspectTransfer(income);
    } catch (error) {
      if (isCurrent(request, ctx)) toast(error.shortMessage || error.message, true);
    } finally {
      if (isCurrent(request, ctx)) {
        reading = false;
        buttons();
      }
    }
  }

  function wire() {
    $('#trace-sample').hidden = !context().demoMode;
    $('#trace-sample').addEventListener('click', sample);
    $('#trace-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!reading) inspect();
    });
    input.addEventListener('input', () => reset());
    select.addEventListener('change', () => {
      const selected = moves.find(move => String(move.logIndex) === select.value);
      if (selected) inspectTransfer(selected);
      else reset({ keepTransfers: true });
    });
    recoverButton.addEventListener('click', submit);
    exportButton.addEventListener('click', () => {
      if (!report) return;
      const url = URL.createObjectURL(new Blob([serializeHealthReport(report)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = report.mode === 'simulation' ? 'paydaysplit-income-example.json' : 'paydaysplit-income-trace.json';
      a.click();
      URL.revokeObjectURL(url);
    });
    reset();
  }

  function open(hash, logIndex) {
    input.value = hash;
    $('#income-trace').scrollIntoView({ block: 'start' });
    input.focus({ preventScroll: true });
    inspect(logIndex);
  }

  return { wire, open, reset: () => reset({ clearInput: true }) };
}
