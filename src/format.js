const STYLES = {
  error: ['\x1b[31m', 'x'],
  warning: ['\x1b[33m', '!'],
  info: ['\x1b[36m', 'i'],
};
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function countSeverities(files) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of files) for (const wf of f.workflows ?? []) for (const r of wf.results) counts[r.severity]++;
  for (const f of files) if (f.error) counts.error++;
  return counts;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {{ file: string, error?: string, workflows?: { workflow: string, results: object[] }[] }[]} files
 * @param {{ color?: boolean }} [opts]
 */
export function formatText(files, { color = false } = {}) {
  const c = (code, s) => (color ? `${code}${s}${RESET}` : s);
  const lines = [];

  for (const f of files) {
    if (f.error) {
      lines.push(c(BOLD, f.file));
      lines.push(`  ${c(STYLES.error[0], `${STYLES.error[1]} error`)}    ${f.error}`, '');
      continue;
    }
    for (const wf of f.workflows) {
      if (wf.results.length === 0) continue;
      lines.push(`${c(BOLD, f.file)} ${c(DIM, `(${wf.workflow})`)}`);
      for (const r of wf.results) {
        const [code, icon] = STYLES[r.severity];
        const sev = c(code, `${icon} ${r.severity.padEnd(7)}`);
        const where = r.node ? `[${r.node}] ` : '';
        lines.push(`  ${sev}  ${where}${r.message}  ${c(DIM, r.ruleId)}`);
        if (r.hint) lines.push(`             ${c(DIM, `-> ${r.hint}`)}`);
      }
      lines.push('');
    }
  }

  const n = countSeverities(files);
  const total = n.error + n.warning + n.info;
  const summary =
    total === 0
      ? `No problems found in ${plural(files.length, 'file')}.`
      : `${plural(n.error, 'error')}, ${plural(n.warning, 'warning')}, ${n.info} info in ${plural(files.length, 'file')}.`;
  lines.push(c(BOLD, n.error ? c(STYLES.error[0], summary) : summary));
  return lines.join('\n');
}

export function formatJson(files) {
  return JSON.stringify({ summary: countSeverities(files), files }, null, 2);
}
