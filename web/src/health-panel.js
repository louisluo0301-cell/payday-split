import { formatEther } from 'ethers';
import { serializeHealthReport } from './automation-health.js';

const severityLabels = { blocked: 'Blocked', warning: 'Warning', info: 'Info' };
const statusLabels = {
  blocked: 'Action needed',
  attention: 'Review recommended',
  unavailable: 'Live status unavailable',
  unconfigured: 'Live deployment not configured',
  inactive: 'Saved plan is inactive',
  completed: 'Observation task completed',
  demo: 'Demo checks',
};
const initialScope = 'Checks cover fees, subscriptions and saved spending controls.';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString();
}

function scopeDescription(report) {
  if (report.scope === 'simulation-only') return 'Sample data only. Live fees and delivery are unchecked.';
  if (report.status === 'unconfigured') return 'Try demo mode or add a verified deployment.';
  if (report.status === 'unavailable') return 'Retry the check to refresh the latest available results.';
  if (report.scope === 'platform-only') return 'Connect a wallet to check your saved rule, allowance and spending limits.';
  return 'Based on your saved onchain settings and the latest available balances.';
}

export function createHealthPanel({ $, toast = () => {}, refresh = async () => {}, now = Date.now }) {
  let report = null;
  let confirmed = new Map();
  let history = [];
  let lastOutage = false;
  let lastList = '';

  function appendHistory(message) {
    history.unshift({ at: new Date(now()).toISOString(), message });
    history = history.slice(0, 20);
  }

  function renderFindings(current) {
    const items = current.status === 'unconfigured' ? [] : [...current.alerts];
    if (!current.complete) {
      for (const [id, alert] of confirmed) {
        if (items.some(item => item.id === id)) continue;
        items.push({
          ...alert,
          title: `Last confirmed: ${alert.title}`,
          action: 'Run another check to see whether this issue has cleared.',
        });
      }
    }
    const signature = JSON.stringify([current.status === 'unconfigured', current.complete, items]);
    if (signature === lastList) return;
    lastList = signature;
    const list = $('#health-items');
    list.replaceChildren();
    for (const alert of items) {
      const item = element('li', null, `health-issue health-${alert.severity}`);
      const header = element('div', null, 'health-issue-heading');
      header.append(
        element('span', severityLabels[alert.severity], 'health-severity'),
        element('strong', alert.title),
      );
      item.append(header, element('p', alert.action));
      list.append(item);
    }
    if (!items.length && current.status !== 'unconfigured') {
      const message = current.complete ? 'No issues found in this check.' : 'Check results unavailable.';
      list.append(element('li', message, 'health-clear'));
    }
  }

  function renderMetrics(snapshot = {}) {
    const metrics = $('#health-metrics');
    metrics.replaceChildren();
    for (const [label, balance, reserves] of [
      ['Reactive fee credit', snapshot.reactiveBalance, snapshot.reactiveReserves],
      ['Callback fee credit', snapshot.destinationBalance, snapshot.destinationReserves],
    ]) {
      if (balance === undefined || reserves === undefined) continue;
      const row = element('div');
      row.append(element('dt', label), element('dd', `${formatEther(balance + reserves)} native units`));
      metrics.append(row);
    }
  }

  function renderHistory() {
    const log = $('#health-history');
    log.replaceChildren();
    if (!history.length) {
      log.append(element('li', 'No status changes recorded in this session.'));
      return;
    }
    for (const entry of history) {
      const li = element('li');
      const time = element('time', formatTime(entry.at));
      time.dateTime = entry.at;
      li.append(time, ` · ${entry.message}`);
      log.append(li);
    }
  }

  function render(current) {
    const summary = $('#health-summary');
    const readyLabel = current.scope === 'platform-only' ? 'Platform checks passed' : 'Saved plan checks passed';
    const label = current.status === 'ready' ? readyLabel : statusLabels[current.status] || 'Status unknown';
    if (summary.textContent !== label) summary.textContent = label;
    summary.dataset.status = current.status;
    $('#health-scope').textContent = scopeDescription(current);
    const checked = $('#health-checked');
    const checkedAt = current.snapshot?.checkedAt;
    checked.hidden = !checkedAt;
    if (checkedAt) {
      checked.dateTime = checkedAt;
      checked.textContent = `Checked ${formatTime(checkedAt)}`;
    }
    renderFindings(current);
    renderMetrics(current.snapshot);
    renderHistory();
    $('#health-export').disabled = false;
  }

  function apply(current, { notify = true } = {}) {
    const next = new Map(current.alerts.filter(alert => alert.severity !== 'info').map(alert => [alert.id, alert]));
    const fresh = [...next.values()].filter(alert => confirmed.get(alert.id)?.severity !== alert.severity);
    const resolved = current.complete ? [...confirmed.values()].filter(alert => !next.has(alert.id)) : [];
    const messages = [];
    if (!current.complete && current.status !== 'unconfigured') {
      if (!lastOutage) {
        appendHistory('Live checks became unavailable.');
        messages.push('Live checks are unavailable; previous issues are not confirmed resolved.');
      }
      lastOutage = true;
    } else if (current.complete) {
      if (lastOutage) {
        appendHistory('Live checks restored.');
        messages.push('Live checks restored.');
      }
      lastOutage = false;
      for (const alert of fresh) {
        appendHistory(alert.title);
        messages.push(alert.title);
      }
      for (const alert of resolved) {
        appendHistory(`Resolved: ${alert.title}`);
        messages.push(`Resolved: ${alert.title}`);
      }
      confirmed = next;
    }
    report = current;
    render(current);
    if (notify && messages.length) toast(messages.join(' · '), current.alerts.some(alert => alert.severity === 'blocked'));
  }

  function wire() {
    const refreshButton = $('#health-refresh');
    refreshButton.addEventListener('click', async () => {
      if (refreshButton.getAttribute('aria-disabled') === 'true') return;
      refreshButton.setAttribute('aria-disabled', 'true');
      refreshButton.textContent = 'Checking…';
      try {
        await refresh();
      } finally {
        refreshButton.removeAttribute('aria-disabled');
        refreshButton.textContent = 'Check now';
      }
    });
    $('#health-export').addEventListener('click', () => {
      if (!report) return;
      const url = URL.createObjectURL(new Blob([serializeHealthReport({ ...report, history })], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'paydaysplit-health.json';
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  function reset() {
    report = null;
    confirmed.clear();
    history = [];
    lastOutage = false;
    lastList = '';
    const summary = $('#health-summary');
    summary.textContent = 'Not checked';
    delete summary.dataset.status;
    $('#health-scope').textContent = initialScope;
    const checked = $('#health-checked');
    checked.hidden = true;
    checked.removeAttribute('datetime');
    checked.textContent = '';
    $('#health-items').replaceChildren();
    $('#health-metrics').replaceChildren();
    renderHistory();
    $('#health-export').disabled = true;
  }

  return { apply, wire, reset, getHistory: () => history.slice() };
}
