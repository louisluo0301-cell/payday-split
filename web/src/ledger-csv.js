import { formatUnits, getAddress, parseUnits } from 'ethers';

function escapeCell(value) {
  let text = String(value ?? '');
  // Plan labels can contain spreadsheet formulas.
  if (/^[\s\u0000-\u0020]*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function exportLedger(groups, { decimals, token, chainId, simulated, labelFor }) {
  const rows = [[
    'txHash', 'block', 'version', 'payee', 'label', 'amount', 'retained',
    'mode', 'chainId', 'token', 'originTxHash', 'originLogIndex', 'entry',
  ]];
  for (const group of groups) {
    const common = [group.txHash, group.blockNumber, group.version];
    const scope = [simulated ? 'simulation' : 'chain', simulated ? '' : chainId, simulated ? '' : token,
      group.originHash ?? '', group.logIndex ?? ''];
    for (const split of group.splits) {
      rows.push([...common, split.payee, labelFor(split.payee), formatUnits(split.amount, decimals), '', ...scope, 'initial-payout']);
    }
    if (group.retained > 0n) {
      rows.push([...common, '', 'Retained', '', formatUnits(group.retained, decimals), ...scope, 'initial-retained']);
    }
  }
  return rows.map(row => row.map(escapeCell).join(',')).join('\r\n');
}

// Each recipient occupies one line. Quoted names and escaped quotes are accepted.
function splitLine(line, number) {
  const cells = [];
  let cursor = 0;
  while (cursor <= line.length) {
    while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
    let field = '';
    if (line[cursor] === '"') {
      cursor++;
      let closed = false;
      while (cursor < line.length) {
        const char = line[cursor++];
        if (char !== '"') field += char;
        else if (line[cursor] === '"') { field += '"'; cursor++; }
        else { closed = true; break; }
      }
      while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
      if (!closed || (cursor < line.length && line[cursor] !== ',')) throw new Error('Invalid CSV quotes on line ' + number + '.');
    } else {
      const comma = line.indexOf(',', cursor);
      const end = comma === -1 ? line.length : comma;
      field = line.slice(cursor, end).trim();
      cursor = end;
      if (field.includes('"')) throw new Error('Invalid CSV quotes on line ' + number + '.');
    }
    cells.push(field);
    cursor++;
  }
  return cells;
}

export function importRecipients(text, decimals, maxBuckets) {
  if (text.length > 16_384) throw new Error('Recipient CSV is too large.');
  const buckets = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  let first = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const row = i + 1;
    if (!line || line.startsWith('#')) continue;
    const cells = splitLine(line, row);
    if (first && /^(label,)?(address|payee),(amount|fixed)$/.test(cells.join(',').toLowerCase())) {
      first = false;
      continue;
    }
    first = false;
    if (cells.length !== 2 && cells.length !== 3) throw new Error('Expected address and amount on line ' + row + '.');
    const [label, address, fixed] = cells.length === 2 ? ['', ...cells] : cells;
    try {
      const input = fixed.replace(/^\$\s*/, '');
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(input)) throw new Error();
      const value = parseUnits(input.replace(/,/g, ''), decimals);
      if (value <= 0n || value >= 2n ** 96n) throw new Error();
      buckets.push({ label: label.trim(), payee: getAddress(address), fixed: formatUnits(value, decimals), bps: '', active: true });
    } catch {
      throw new Error('Invalid address or amount on line ' + row + '.');
    }
    if (buckets.length > maxBuckets) throw new Error('At most ' + maxBuckets + ' buckets are allowed.');
  }
  if (!buckets.length) throw new Error('Paste at least one bucket.');
  return buckets;
}
