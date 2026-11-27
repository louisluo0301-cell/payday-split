import { Interface, formatUnits, parseUnits } from 'ethers';
import { SPLIT_ABI } from './contract-abi.generated.js';

const splitEvents = new Interface(SPLIT_ABI);
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const CHECK_TIMEOUT_MS = 20_000;
const RECHECK_TIMEOUT_MS = 4_000;

export function paymentQuoteKey(quote) {
  return [quote.version, quote.retained, ...quote.payouts.flatMap(({ payee, amount }) => [payee, amount])].join('|');
}

function manualPayoutFromReceipt(receipt, { account, token, splitAddress }) {
  const user = account.toLowerCase();
  const asset = token.toLowerCase();
  const split = splitAddress.toLowerCase();
  if (receipt.status !== 1 || receipt.to?.toLowerCase() !== split || receipt.from?.toLowerCase() !== user) return null;
  const payout = { paid: 0n, retained: 0n, skipped: 0, payouts: [] };
  let matched = false;
  for (const log of receipt.logs) {
    if (log.removed || log.address.toLowerCase() !== split) continue;
    const event = splitEvents.parseLog(log);
    if (!event || !['Split', 'Retained', 'BucketSkipped'].includes(event.name)) continue;
    const { args } = event;
    if (args.user.toLowerCase() !== user || args.token.toLowerCase() !== asset || args.originTxHash !== 0n) continue;
    matched = true;
    if (event.name === 'Split') {
      payout.paid += args.amount;
      payout.payouts.push({ payee: args.payee, amount: args.amount });
    } else if (event.name === 'Retained') {
      payout.retained += args.amount;
    } else {
      payout.skipped++;
    }
  }
  return matched ? payout : null;
}

export function createManualPayment({
  $, context, readQuote, pay, onConfirmation, onTrackingChange, labelFor, errorMessage, jumpToTrace, jumpToHistory, storage,
}) {
  const dialog = $('#manual-dialog');
  const doc = dialog.ownerDocument;
  const input = $('#manual-amount');
  const status = $('#manual-status');
  const preview = $('#manual-preview');
  const send = $('#manual-send');
  const list = $('#manual-payouts');
  const totals = $('#manual-totals');
  const transactionDetails = doc.createElement('p');
  transactionDetails.className = 'fineprint';
  transactionDetails.style.overflowWrap = 'anywhere';
  transactionDetails.hidden = true;
  status.after(transactionDetails);
  const forget = doc.createElement('button');
  forget.className = 'btn btn-small btn-ghost';
  forget.type = 'button';
  forget.textContent = 'Forget tracker';
  forget.hidden = true;
  send.before(forget);
  const pendingByWallet = new Map();
  let reviewed = null;
  let shownTransaction = null;
  let forgetArmed = false;
  let reading = false;
  let sending = false;
  let revision = 0;

  function current(ctx) {
    const next = context();
    return dialog.open && ctx.signer === next.signer && ctx.account === next.account;
  }

  function trackerKey({ chainId, account, token, splitAddress }) {
    return ['paydaysplit.manual-payment', chainId, account, token, splitAddress].join(':').toLowerCase();
  }

  function pending(ctx) {
    const key = trackerKey(ctx);
    if (pendingByWallet.has(key)) return pendingByWallet.get(key);
    try {
      const hash = (storage ?? doc.defaultView.localStorage)?.getItem(key);
      if (HASH_PATTERN.test(hash)) {
        const transaction = { hash, phase: 'pending', checking: false };
        pendingByWallet.set(key, transaction);
        return transaction;
      }
    } catch {
      // An unavailable browser storage does not remove the in-page tracker.
    }
    return null;
  }

  function track(ctx, transaction, resolvedHash) {
    const key = trackerKey(ctx);
    if (transaction) pendingByWallet.set(key, transaction);
    else pendingByWallet.delete(key);
    try {
      const persisted = storage ?? doc.defaultView.localStorage;
      if (transaction) persisted?.setItem(key, transaction.hash);
      else if (persisted?.getItem(key) === resolvedHash) persisted.removeItem(key);
    } catch {
      // Keep the in-page status if persistence is unavailable.
    }
    onTrackingChange();
  }

  function buttons() {
    const transaction = shownTransaction;
    $('#manual-title').textContent = transaction ? 'Manual payment status' : 'Review a new payment';
    preview.hidden = !!transaction;
    preview.disabled = reading || sending;
    input.disabled = sending || !!transaction;
    $('#manual-close').disabled = sending;
    forget.hidden = !transaction || transaction.phase !== 'pending' || transaction.checking;
    forget.textContent = forgetArmed ? 'Confirm forget' : 'Forget tracker';
    if (transaction) {
      send.textContent = transaction.phase === 'pending' ? 'Check confirmation'
        : transaction.phase === 'confirmed' ? 'Open history' : 'Review a new payment';
      send.disabled = transaction.checking;
    } else {
      send.textContent = 'Continue to wallet';
      send.disabled = !reviewed || reading || sending;
    }
  }

  function clearPayouts() {
    list.replaceChildren();
    list.hidden = true;
    totals.hidden = true;
  }

  function clear(message) {
    reviewed = null;
    shownTransaction = null;
    forgetArmed = false;
    clearPayouts();
    transactionDetails.hidden = true;
    transactionDetails.replaceChildren();
    status.textContent = message;
    buttons();
  }

  function showPayouts(ctx, payout, actual) {
    list.replaceChildren();
    for (const entry of payout.payouts) {
      const row = doc.createElement('li');
      const recipient = doc.createElement('div');
      const name = doc.createElement('strong');
      const address = doc.createElement('code');
      const payment = doc.createElement('span');
      name.textContent = labelFor(entry.payee);
      address.textContent = entry.payee;
      recipient.append(name, address);
      payment.textContent = formatUnits(entry.amount, ctx.decimals) + ' ' + ctx.symbol;
      row.append(recipient, payment);
      list.append(row);
    }
    const paid = actual ? ' paid · ' : ' to pay · ';
    const skipped = payout.skipped ? ' · ' + payout.skipped + (payout.skipped === 1 ? ' bucket skipped' : ' buckets skipped') : '';
    totals.textContent = formatUnits(payout.paid, ctx.decimals) + ' ' + ctx.symbol + paid
      + formatUnits(payout.retained, ctx.decimals) + ' ' + ctx.symbol + ' unallocated' + skipped;
    list.hidden = payout.payouts.length === 0;
    totals.hidden = false;
  }

  function render(ctx, amount, quote, message) {
    reviewed = { ctx, amount, quote };
    showPayouts(ctx, quote, false);
    status.textContent = message ?? ('Saved plan v' + quote.version + '. Final payouts depend on funds available when the transaction confirms.');
    buttons();
  }

  function renderTransaction(ctx, transaction) {
    reviewed = null;
    shownTransaction = transaction;
    forgetArmed = false;
    clearPayouts();
    transactionDetails.hidden = false;
    const href = ctx.txLink?.(transaction.hash);
    const reference = doc.createElement(href ? 'a' : 'code');
    reference.textContent = transaction.hash;
    if (href) {
      reference.href = href;
      reference.target = '_blank';
      reference.rel = 'noreferrer';
      reference.className = 'trace-link';
    }
    transactionDetails.replaceChildren(reference);
    const { phase, checking, payout } = transaction;
    const messages = {
      pending: checking ? 'Transaction submitted. Checking for a confirmation…' : 'Confirmation is unavailable. Check again or look up the transaction in your wallet.',
      reverted: 'The transaction reverted before any payment could settle.',
      replaced: 'Your wallet replaced or cancelled this transaction.',
      confirmed: !payout ? 'Transaction confirmed. Matching payout events were unavailable.'
        : payout.paid > 0n ? 'Payment confirmed. These amounts come from the transaction receipt.'
        : 'Transaction confirmed. No funds were paid from this wallet.',
    };
    status.textContent = messages[phase];
    if (payout) showPayouts(ctx, payout, true);
    buttons();
  }

  async function checkConfirmation(ctx, transaction, initial = false) {
    if (transaction.checking) return;
    transaction.checking = true;
    if (current(ctx)) renderTransaction(ctx, transaction);
    try {
      const network = await ctx.provider.send('eth_chainId', []);
      if (BigInt(network) !== BigInt(ctx.chainId)) return;
      let receipt = await ctx.provider.getTransactionReceipt(transaction.hash).catch(() => null);
      let replaced = false;
      let expectedHash = transaction.hash;
      if (!receipt && transaction.response) {
        try {
          receipt = await transaction.response.wait(1, initial ? CHECK_TIMEOUT_MS : RECHECK_TIMEOUT_MS);
        } catch (error) {
          receipt = error.receipt;
          if (error.code === 'TRANSACTION_REPLACED' && receipt && HASH_PATTERN.test(receipt.hash)) {
            replaced = error.cancelled !== false || error.reason !== 'repriced';
            expectedHash = receipt.hash;
          }
        }
      }
      if (receipt?.hash?.toLowerCase() !== expectedHash.toLowerCase()
        || (receipt.status !== 1 && receipt.status !== 0)) return;
      if (BigInt(await ctx.provider.send('eth_chainId', [])) !== BigInt(ctx.chainId)) return;
      transaction.phase = replaced ? 'replaced' : receipt.status === 0 ? 'reverted' : 'confirmed';
      track(ctx, null, transaction.hash);
      transaction.hash = expectedHash;
      if (transaction.phase === 'confirmed') {
        try { transaction.payout = manualPayoutFromReceipt(receipt, ctx); }
        catch { transaction.payout = null; }
        onConfirmation(ctx, receipt);
      }
    } catch {
      // Keep the tracker available through transport errors or a wallet network change.
    } finally {
      transaction.checking = false;
      if (current(ctx)) renderTransaction(ctx, transaction);
    }
  }

  async function review(event) {
    event.preventDefault();
    if (sending || reading || shownTransaction) return;
    const ctx = context();
    const request = ++revision;
    let amount;
    try {
      amount = parseUnits(input.value.trim(), ctx.decimals);
      if (amount <= 0n || amount >= 2n ** 96n) throw new Error();
    } catch {
      input.setAttribute('aria-invalid', 'true');
      clear('Enter a positive ' + ctx.symbol + ' amount at the supported precision.');
      return;
    }
    reading = true;
    clear('Checking the saved plan and available funds…');
    try {
      const quote = await readQuote(ctx, amount);
      if (request === revision && current(ctx)) render(ctx, amount, quote);
    } catch (error) {
      if (request === revision && current(ctx)) clear(errorMessage(error));
    } finally {
      if (request === revision) {
        reading = false;
        buttons();
      }
    }
  }

  async function confirm() {
    if (shownTransaction) {
      if (shownTransaction.phase === 'pending') await checkConfirmation(context(), shownTransaction);
      else if (shownTransaction.phase === 'confirmed') {
        close();
        jumpToHistory();
      } else {
        clear('Check the recipients and amounts before continuing.');
        input.focus();
      }
      return;
    }
    if (!reviewed || reading || sending) return;
    const snapshot = reviewed;
    sending = true;
    status.textContent = 'Reviewing the latest available amounts…';
    buttons();
    try {
      const existing = pending(snapshot.ctx);
      if (existing) {
        renderTransaction(snapshot.ctx, existing);
        return;
      }
      const { quote, transaction } = await pay(snapshot, current, () => {
        if (current(snapshot.ctx)) status.textContent = 'Review and confirm the transaction in your wallet.';
      });
      if (transaction) {
        if (!HASH_PATTERN.test(transaction.hash)) {
          throw new Error('The wallet returned an invalid transaction reference. Check its activity before trying again.');
        }
        const tracker = { hash: transaction.hash, response: transaction, phase: 'pending', checking: false };
        track(snapshot.ctx, tracker);
        void checkConfirmation(snapshot.ctx, tracker, true);
      } else if (current(snapshot.ctx)) {
        render(snapshot.ctx, snapshot.amount, quote, 'The payable amounts or saved plan changed. Review the updated payment.');
      }
    } catch (error) {
      if (current(snapshot.ctx)) clear(errorMessage(error));
    } finally {
      sending = false;
      buttons();
    }
  }

  function open(value) {
    const ctx = context();
    if (dialog.open || sending) return;
    $('#manual-context').textContent = ctx.symbol + ' · ' + ctx.network + ' · ' + ctx.account;
    input.value = value;
    input.removeAttribute('aria-invalid');
    clear('Check the recipients and amounts before continuing.');
    dialog.showModal();
    const existing = pending(ctx);
    if (existing) {
      renderTransaction(ctx, existing);
      $('#manual-close').focus();
    } else input.focus();
  }

  function close() {
    ++revision;
    reading = false;
    clear('');
    if (dialog.open) dialog.close();
  }

  $('#manual-form').addEventListener('submit', review);
  input.addEventListener('input', () => {
    if (shownTransaction) return;
    ++revision;
    reading = false;
    input.removeAttribute('aria-invalid');
    clear('Check the recipients and amounts before continuing.');
  });
  $('#manual-close').addEventListener('click', close);
  $('#manual-trace').addEventListener('click', event => { event.preventDefault(); close(); jumpToTrace(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!sending) close(); });
  send.addEventListener('click', confirm);
  forget.addEventListener('click', () => {
    if (shownTransaction?.phase !== 'pending' || shownTransaction.checking) return;
    if (forgetArmed) {
      track(context(), null, shownTransaction.hash);
      clear('Check the recipients and amounts before continuing.');
      input.focus();
      return;
    }
    forgetArmed = true;
    status.textContent = 'The transaction can still confirm. Check its status in your wallet before starting another payment.';
    buttons();
  });
  return { open, close, hasPending: () => !!pending(context()) };
}
