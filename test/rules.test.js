import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintWorkflow, lintDocument } from '../src/lint.js';
import { connect, ids, node, workflow } from './helpers.js';

const webhook = (extra = {}) => node('Hook', 'webhook', { parameters: { path: 'in', authentication: 'headerAuth' }, ...extra });

test('a well-built workflow has no findings', () => {
  const wf = workflow(
    [webhook(), node('Call API', 'httpRequest', { retryOnFail: true }), node('Note', 'stickyNote')],
    connect('Hook', 'Call API'),
  );
  assert.deepEqual(lintWorkflow(wf), []);
});

test('missing-error-workflow', () => {
  const wf = workflow([webhook()], {}, {});
  assert.deepEqual(ids(lintWorkflow(wf)), ['missing-error-workflow']);
  // An error workflow does not need its own error workflow.
  const errorWf = workflow([node('On error', 'errorTrigger')], {}, {});
  assert.deepEqual(lintWorkflow(errorWf), []);
});

test('webhook-no-auth', () => {
  for (const parameters of [{ path: 'x' }, { path: 'x', authentication: 'none' }]) {
    const res = lintWorkflow(workflow([node('Hook', 'webhook', { parameters })]));
    assert.deepEqual(ids(res), ['webhook-no-auth']);
    assert.match(res[0].message, /"\/x"/);
  }
});

test('http-no-retry', () => {
  const wf = workflow([webhook(), node('Call API', 'httpRequest')], connect('Hook', 'Call API'));
  const res = lintWorkflow(wf);
  assert.deepEqual(ids(res), ['http-no-retry']);
  assert.equal(res[0].node, 'Call API');
});

test('disabled-node is reported once, not also as unconnected', () => {
  const wf = workflow([webhook(), node('A', 'set'), node('Old', 'set', { disabled: true })], connect('Hook', 'A'));
  assert.deepEqual(ids(lintWorkflow(wf)), ['disabled-node']);
});

test('unconnected-node: orphans and nodes without input', () => {
  const wf = workflow(
    [webhook(), node('A', 'set'), node('Lonely', 'set'), node('Headless', 'set'), node('B', 'set')],
    { ...connect('Hook', 'A'), ...connect('Headless', 'B') },
  );
  const res = lintWorkflow(wf).filter((r) => r.ruleId === 'unconnected-node');
  assert.deepEqual(
    res.map((r) => [r.node, r.message]),
    [
      ['Lonely', 'node has no connections'],
      ['Headless', 'node has no input, so it will never run'],
    ],
  );
});

test('AI sub-nodes connected through ai_* outputs are not dead', () => {
  const wf = workflow(
    [
      node('Chat', '@n8n/n8n-nodes-langchain.chatTrigger'),
      node('Agent', '@n8n/n8n-nodes-langchain.agent'),
      node('Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi'),
    ],
    {
      ...connect('Chat', 'Agent'),
      Model: { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
    },
  );
  assert.deepEqual(lintWorkflow(wf), []);
});

test('hardcoded-secret is an error with the secret masked', () => {
  const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz012345';
  const wf = workflow(
    [webhook(), node('Call API', 'httpRequest', { retryOnFail: true, parameters: { url: 'https://x.test', jsonHeaders: `{"Authorization":"Bearer ${key}"}` } })],
    connect('Hook', 'Call API'),
  );
  const [res] = lintWorkflow(wf);
  assert.equal(res.ruleId, 'hardcoded-secret');
  assert.equal(res.severity, 'error');
  assert.ok(!res.message.includes(key.slice(4)), 'secret must not be printed');
});

test('pinned-data is informational', () => {
  const wf = { ...workflow([webhook()]), pinData: { Hook: [{ json: { email: 'a@b.c' } }] } };
  const res = lintWorkflow(wf);
  assert.deepEqual(ids(res), ['pinned-data']);
  assert.equal(res[0].severity, 'info');
});

test('rules can be disabled globally or per node via notes', () => {
  const wf = workflow(
    [
      webhook(),
      node('Quiet', 'httpRequest', { notes: 'n8n-lint-disable: http-no-retry' }),
      node('Loud', 'httpRequest'),
    ],
    connect('Hook', 'Quiet', 'Loud'),
  );
  assert.deepEqual(lintWorkflow(wf).map((r) => r.node), ['Loud']);
  assert.deepEqual(lintWorkflow(wf, { disable: ['http-no-retry'] }), []);
  const silenced = workflow([webhook({ notes: 'legacy endpoint\nn8n-lint-disable' })], {});
  silenced.nodes[0].parameters.authentication = 'none';
  assert.deepEqual(lintWorkflow(silenced), []);
});

test('results are sorted by severity', () => {
  const wf = {
    ...workflow([node('Hook', 'webhook', { parameters: { path: 'p', token: 'abcdef1234567890' } })], {}, {}),
    pinData: { Hook: [] },
  };
  assert.deepEqual(
    lintWorkflow(wf).map((r) => r.severity),
    ['error', 'warning', 'warning', 'info'],
  );
});

test('lintDocument accepts single workflows and export:workflow --all arrays', () => {
  const one = workflow([webhook()]);
  assert.equal(lintDocument(one).length, 1);
  assert.equal(lintDocument([one, { ...one, name: '' }])[1].workflow, 'workflow #2');
  assert.throws(() => lintDocument({ name: 'nope' }), /not an n8n workflow/);
  assert.throws(() => lintDocument([]), /not an n8n workflow/);
});
