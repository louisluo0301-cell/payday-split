export function createActionReview() {
  const dialog = document.createElement('dialog');
  dialog.id = 'action-review';
  dialog.className = 'import-dialog manual-dialog';
  dialog.setAttribute('aria-labelledby', 'action-review-title');
  dialog.setAttribute('aria-describedby', 'action-review-description');
  dialog.innerHTML = `
    <div class="import-form">
      <header class="import-head">
        <h3 id="action-review-title" tabindex="-1"></h3>
        <p id="action-review-description"></p>
      </header>
      <dl class="action-review-facts" id="action-review-facts"></dl>
      <ol class="action-review-destinations" id="action-review-destinations" aria-label="Destination priority" hidden></ol>
      <p class="action-review-note" id="action-review-note" hidden></p>
      <div class="import-actions">
        <button class="btn btn-small btn-ghost" id="action-review-cancel" type="button">Cancel</button>
        <button class="btn btn-small btn-primary" id="action-review-confirm" type="button"></button>
      </div>
    </div>`;
  document.body.append(dialog);

  const title = dialog.querySelector('#action-review-title');
  const description = dialog.querySelector('#action-review-description');
  const facts = dialog.querySelector('#action-review-facts');
  const destinations = dialog.querySelector('#action-review-destinations');
  const note = dialog.querySelector('#action-review-note');
  const cancel = dialog.querySelector('#action-review-cancel');
  const confirm = dialog.querySelector('#action-review-confirm');
  let pending = false;
  cancel.addEventListener('click', () => dialog.close());
  confirm.addEventListener('click', () => dialog.close('confirmed'));

  function make(tag, content) {
    const element = document.createElement(tag);
    element.textContent = content;
    return element;
  }

  function open({ trigger, title: heading, description: detail, facts: summary, rows = [], note: message = '', confirm: label }) {
    if (pending) return Promise.resolve(false);
    title.textContent = heading;
    description.textContent = detail;
    facts.replaceChildren(...summary.map(([name, value]) => {
      const entry = document.createElement('div');
      entry.append(make('dt', name), make('dd', value));
      return entry;
    }));
    destinations.replaceChildren(...rows.map(({ label, address, terms, active }) => {
      const row = document.createElement('li');
      const detail = document.createElement('div');
      detail.append(make('strong', label), make('code', address));
      row.append(detail, make('span', active ? terms : 'Paused'));
      return row;
    }));
    destinations.hidden = !rows.length;
    note.textContent = message;
    note.hidden = !message;
    confirm.textContent = label;
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => {
        pending = false;
        if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
        resolve(dialog.returnValue === 'confirmed');
      }, { once: true });
      pending = true;
      dialog.showModal();
      dialog.scrollTop = 0;
      title.focus({ preventScroll: true });
    });
  }

  return { open, cancel: () => { if (dialog.open) dialog.close(); } };
}
