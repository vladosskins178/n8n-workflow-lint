// Helpers for reading the node graph of an exported n8n workflow.

const EXTRA_TRIGGER_TYPES = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.start',
  'n8n-nodes-base.cron',
  'n8n-nodes-base.interval',
  'n8n-nodes-base.emailReadImap',
]);

export const STICKY_NOTE = 'n8n-nodes-base.stickyNote';

export function isTrigger(node) {
  const type = String(node?.type ?? '');
  return /trigger$/i.test(type) || EXTRA_TRIGGER_TYPES.has(type);
}

export function isStickyNote(node) {
  return node?.type === STICKY_NOTE;
}

/**
 * Build in/out edge maps keyed by node name.
 * n8n stores connections as
 *   { [sourceName]: { [connectionType]: [[{ node, type, index }], ...] } }
 * where connectionType is "main" for data flow and "ai_*" for AI sub-nodes.
 */
export function buildEdges(workflow) {
  const incoming = new Map();
  const outgoing = new Map();
  const ensure = (map, key) => {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  };

  const connections = workflow?.connections ?? {};
  for (const [source, byType] of Object.entries(connections)) {
    if (!byType || typeof byType !== 'object') continue;
    for (const [type, outputs] of Object.entries(byType)) {
      if (!Array.isArray(outputs)) continue;
      for (const output of outputs) {
        if (!Array.isArray(output)) continue;
        for (const target of output) {
          if (!target || typeof target.node !== 'string') continue;
          ensure(outgoing, source).push({ node: target.node, type });
          ensure(incoming, target.node).push({ node: source, type });
        }
      }
    }
  }
  return { incoming, outgoing };
}
