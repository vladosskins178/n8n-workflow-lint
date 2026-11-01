// Small builders for test workflows.
let counter = 0;

export function node(name, type, extra = {}) {
  counter += 1;
  return {
    id: `node-${counter}`,
    name,
    type: type.includes('.') ? type : `n8n-nodes-base.${type}`,
    typeVersion: 1,
    position: [counter * 200, 0],
    parameters: {},
    ...extra,
  };
}

export function connect(...names) {
  const connections = {};
  for (let i = 0; i < names.length - 1; i++) {
    connections[names[i]] ??= { main: [[]] };
    connections[names[i]].main[0].push({ node: names[i + 1], type: 'main', index: 0 });
  }
  return connections;
}

export function workflow(nodes, connections = {}, settings = { errorWorkflow: '1' }) {
  return { name: 'test', nodes, connections, settings };
}

export const ids = (results) => results.map((r) => r.ruleId);
