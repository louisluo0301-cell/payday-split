import { formatUnits, parseUnits } from 'ethers';

export function paymentQuoteKey(quote) {
  return [quote.version, quote.retained, ...quote.payouts.flatMap(({ payee, amount }) => [payee, amount])].join('|');
}

export function createManualPayment({ $, context, readQuote, pay, labelFor, errorMessage, jumpToTrace }) {
  const dialog = $('#manual-dialog');
  const input = $('#manual-amount');
  const status = $('#manual-status');
  const preview = $('#manual-preview');
  const send = $('#manual-send');
  const list = $('#manual-payouts');
  const totals = $('#manual-totals');
  let reviewed = null;
  let reading = false;
  let sending = false;
  let revision = 0;

  function current(ctx) {
    const next = context();
    return dialog.open && ctx.signer === next.signer && ctx.account === next.account;
  }

  function buttons() {
    preview.disabled = reading || sending;
    send.disabled = !reviewed || reading || sending;
    input.disabled = sending;
    $('#manual-close').disabled = sending;
  }

  function clear(message) {
    reviewed = null;
    list.replaceChildren();
    list.hidden = true;
    totals.hidden = true;
    status.textContent = message;
    buttons();
  }

  function render(ctx, amount, quote, message) {
    reviewed = { ctx, amount, quote };
    list.replaceChildren();
    for (const payout of quote.payouts) {
      const row = document.createElement('li');
      const recipient = document.createElement('div');
      const name = document.createElement('strong');
      const address = document.createElement('code');
      const payment = document.createElement('span');
      name.textContent = labelFor(payout.payee);
      address.textContent = payout.payee;
      recipient.append(name, address);
      payment.textContent = formatUnits(payout.amount, ctx.decimals) + ' ' + ctx.symbol;
      row.append(recipient, payment);
      list.append(row);
    }
    totals.textContent = formatUnits(quote.paid, ctx.decimals) + ' ' + ctx.symbol + ' to pay · '
      + formatUnits(quote.retained, ctx.decimals) + ' ' + ctx.symbol + ' unallocated';
    list.hidden = false;
    totals.hidden = false;
    status.textContent = message ?? ('Saved plan v' + quote.version + '. Final payouts depend on funds available when the transaction confirms.');
    buttons();
  }

  async function review(event) {
    event.preventDefault();
    if (sending || reading) return;
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
    if (!reviewed || reading || sending) return;
    const snapshot = reviewed;
    sending = true;
    status.textContent = 'Reviewing the latest available amounts…';
    buttons();
    try {
      const quote = await pay(snapshot, current);
      if (!current(snapshot.ctx)) return;
      if (quote) render(snapshot.ctx, snapshot.amount, quote, 'The payable amounts or saved plan changed. Review the updated payment.');
      else dialog.close();
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
    input.focus();
  }

  function close() {
    ++revision;
    reading = false;
    clear('');
    if (dialog.open) dialog.close();
  }

  $('#manual-form').addEventListener('submit', review);
  input.addEventListener('input', () => {
    ++revision;
    reading = false;
    input.removeAttribute('aria-invalid');
    clear('Check the recipients and amounts before continuing.');
  });
  $('#manual-close').addEventListener('click', close);
  $('#manual-trace').addEventListener('click', event => { event.preventDefault(); close(); jumpToTrace(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!sending) close(); });
  send.addEventListener('click', confirm);
  return { open, close };
}
