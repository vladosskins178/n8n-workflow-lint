import { buildEdges, isStickyNote, isTrigger } from './graph.js';
import { findSecrets } from './secrets.js';

const ERROR_TRIGGER = 'n8n-nodes-base.errorTrigger';
const HTTP_REQUEST = 'n8n-nodes-base.httpRequest';
const WEBHOOK = 'n8n-nodes-base.webhook';

const realNodes = (wf) => wf.nodes.filter((n) => !isStickyNote(n));

/**
 * Each rule receives the workflow and returns findings:
 *   { node?: string, message: string, hint?: string }
 */
export const RULES = [
  {
    id: 'hardcoded-secret',
    severity: 'error',
    description: 'API keys, tokens or passwords typed directly into node parameters.',
    check(wf) {
      const out = [];
      for (const node of realNodes(wf)) {
        for (const s of findSecrets(node.parameters)) {
          out.push({
            node: node.name,
            message: `${s.path} holds a hardcoded ${s.label} (${s.preview})`,
            hint: 'Move it into an n8n credential and rotate the exposed value.',
          });
        }
      }
      return out;
    },
  },
  {
    id: 'missing-error-workflow',
    severity: 'warning',
    description: 'No error workflow is set, so failed production runs go unnoticed.',
    check(wf) {
      if (wf.settings?.errorWorkflow) return [];
      // The error workflow itself does not need one.
      if (wf.nodes.some((n) => n.type === ERROR_TRIGGER)) return [];
      return [
        {
          message: 'settings.errorWorkflow is not set',
          hint: 'Workflow settings > Error workflow: pick a workflow that starts with an Error Trigger and alerts you.',
        },
      ];
    },
  },
  {
    id: 'webhook-no-auth',
    severity: 'warning',
    description: 'Webhook nodes that accept requests from anyone.',
    check(wf) {
      return realNodes(wf)
        .filter((n) => n.type === WEBHOOK && !n.disabled)
        .filter((n) => {
          const auth = n.parameters?.authentication;
          return auth === undefined || auth === 'none';
        })
        .map((n) => ({
          node: n.name,
          message: `webhook${n.parameters?.path ? ` "/${String(n.parameters.path).replace(/^\//, '')}"` : ''} has no authentication`,
          hint: 'Set Authentication to Header Auth, Basic Auth or JWT, or verify a signature in the next node.',
        }));
    },
  },
  {
    id: 'http-no-retry',
    severity: 'warning',
    description: 'HTTP Request nodes without Retry On Fail.',
    check(wf) {
      return realNodes(wf)
        .filter((n) => n.type === HTTP_REQUEST && !n.disabled && n.retryOnFail !== true)
        .map((n) => ({
          node: n.name,
          message: 'HTTP Request has Retry On Fail turned off',
          hint: 'Node settings > Retry On Fail (for example 3 tries, 1000 ms apart) to survive rate limits and blips.',
        }));
    },
  },
  {
    id: 'disabled-node',
    severity: 'warning',
    description: 'Disabled nodes left in the workflow.',
    check(wf) {
      return realNodes(wf)
        .filter((n) => n.disabled === true)
        .map((n) => ({
          node: n.name,
          message: 'node is disabled',
          hint: 'Delete it, or re-enable it if it was switched off while debugging.',
        }));
    },
  },
  {
    id: 'unconnected-node',
    severity: 'warning',
    description: 'Nodes that are not wired in and can never run.',
    check(wf) {
      const { incoming, outgoing } = buildEdges(wf);
      const out = [];
      for (const n of realNodes(wf)) {
        if (n.disabled) continue;
        const ins = incoming.get(n.name) ?? [];
        const outs = outgoing.get(n.name) ?? [];
        if (ins.length === 0 && outs.length === 0) {
          // A lone trigger is a valid (if empty) workflow; a lone action node is not.
          if (isTrigger(n) && realNodes(wf).length === 1) continue;
          out.push({ node: n.name, message: 'node has no connections', hint: 'Connect it or delete it.' });
          continue;
        }
        // AI sub-nodes (models, memory, tools) only have ai_* outputs and no input.
        const isSubNode = outs.some((e) => e.type !== 'main');
        const hasMainInput = ins.some((e) => e.type === 'main');
        if (!isTrigger(n) && !isSubNode && !hasMainInput) {
          out.push({
            node: n.name,
            message: 'node has no input, so it will never run',
            hint: 'Connect a trigger or an upstream node to it.',
          });
        }
      }
      return out;
    },
  },
  {
    id: 'pinned-data',
    severity: 'info',
    description: 'Pinned test data saved in the export.',
    check(wf) {
      const pinned = Object.keys(wf.pinData ?? {});
      if (pinned.length === 0) return [];
      return [
        {
          message: `pinned data is saved for ${pinned.length} node(s): ${pinned.map((p) => `"${p}"`).join(', ')}`,
          hint: 'Unpin before sharing the file: pinned data often contains real customer records.',
        },
      ];
    },
  },
];

export const RULE_IDS = RULES.map((r) => r.id);
