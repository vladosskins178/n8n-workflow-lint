import { RULES, RULE_IDS } from './rules.js';

export { RULES, RULE_IDS };

export const SEVERITY_RANK = { info: 0, warning: 1, error: 2 };

export function isWorkflow(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.nodes);
}

/**
 * Rules switched off for one node through its Notes field:
 *   "n8n-lint-disable"                          -> every rule
 *   "n8n-lint-disable: http-no-retry, disabled-node" -> just those
 */
function suppressedRules(node) {
  const notes = typeof node?.notes === 'string' ? node.notes : '';
  const m = notes.match(/n8n-lint-disable(?::([^\n]*))?/);
  if (!m) return null;
  if (!m[1] || !m[1].trim()) return 'all';
  return new Set(
    m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Lint one workflow object.
 * @param {object} workflow parsed n8n workflow export
 * @param {{ disable?: string[] }} [options]
 * @returns {{ ruleId: string, severity: string, node?: string, message: string, hint?: string }[]}
 */
export function lintWorkflow(workflow, options = {}) {
  if (!isWorkflow(workflow)) {
    throw new TypeError('not an n8n workflow: expected an object with a "nodes" array');
  }
  const disabled = new Set(options.disable ?? []);
  const byName = new Map(workflow.nodes.map((n) => [n.name, n]));
  const results = [];

  for (const rule of RULES) {
    if (disabled.has(rule.id)) continue;
    for (const finding of rule.check(workflow)) {
      if (finding.node) {
        const sup = suppressedRules(byName.get(finding.node));
        if (sup === 'all' || sup?.has(rule.id)) continue;
      }
      results.push({ ruleId: rule.id, severity: rule.severity, ...finding });
    }
  }

  return results.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || RULE_IDS.indexOf(a.ruleId) - RULE_IDS.indexOf(b.ruleId),
  );
}

/**
 * Lint the parsed contents of a file. Accepts a single workflow or the array
 * produced by `n8n export:workflow --all`.
 * @returns {{ workflow: string, results: object[] }[]}
 */
export function lintDocument(doc, options = {}) {
  const workflows = Array.isArray(doc) ? doc : [doc];
  if (workflows.length === 0 || !workflows.every(isWorkflow)) {
    throw new TypeError('not an n8n workflow: expected an object with a "nodes" array (or an array of them)');
  }
  return workflows.map((wf, i) => ({
    workflow: typeof wf.name === 'string' && wf.name ? wf.name : `workflow #${i + 1}`,
    results: lintWorkflow(wf, options),
  }));
}
