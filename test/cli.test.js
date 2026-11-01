import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examples = join(root, 'examples');

async function cli(...argv) {
  const out = [];
  const err = [];
  const code = await run(argv, { stdout: (s) => out.push(s), stderr: (s) => err.push(s), cwd: root });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('clean examples pass with exit code 0', async () => {
  const r = await cli(join(examples, 'clean-lead-intake.json'), join(examples, 'ai-support-agent.json'));
  assert.equal(r.code, 0);
  assert.match(r.out, /No problems found in 2 files/);
});

test('risky example fails and reports every rule', async () => {
  const r = await cli('--format', 'json', join(examples, 'risky-lead-intake.json'));
  assert.equal(r.code, 1);
  const report = JSON.parse(r.out);
  assert.deepEqual(report.summary, { error: 2, warning: 5, info: 1 });
  const rules = new Set(report.files[0].workflows[0].results.map((x) => x.ruleId));
  for (const id of ['hardcoded-secret', 'missing-error-workflow', 'webhook-no-auth', 'http-no-retry', 'disabled-node', 'unconnected-node', 'pinned-data']) {
    assert.ok(rules.has(id), id);
  }
  assert.ok(!r.out.includes('FAKEkey4demo'), 'secrets must be masked in output');
});

test('folders are scanned and non-workflow JSON is skipped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'n8n-lint-'));
  try {
    await writeFile(join(dir, 'package.json'), '{"name":"x"}');
    const wf = JSON.stringify({ name: 'w', nodes: [], connections: {}, settings: { errorWorkflow: '1' } });
    await writeFile(join(dir, 'wf.json'), wf);
    await writeFile(join(dir, 'with-bom.json'), `\uFEFF${wf}`);
    const r = await cli(dir);
    assert.equal(r.code, 0);
    assert.match(r.out, /in 2 files\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('explicit non-workflow or broken files are errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'n8n-lint-'));
  try {
    await writeFile(join(dir, 'broken.json'), '{ nope');
    await writeFile(join(dir, 'other.json'), '{"a":1}');
    const r = await cli(join(dir, 'broken.json'), join(dir, 'other.json'));
    assert.equal(r.code, 1);
    assert.match(r.out, /cannot read JSON/);
    assert.match(r.out, /not an n8n workflow export/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--disable, --quiet and --max-warnings', async () => {
  const risky = join(examples, 'risky-lead-intake.json');
  assert.equal((await cli('--disable', 'hardcoded-secret', risky)).code, 0);
  assert.equal((await cli('-d', 'hardcoded-secret', '--max-warnings', '4', risky)).code, 1);
  assert.equal((await cli('-d', 'hardcoded-secret', '--max-warnings', '5', risky)).code, 0);
  const quiet = await cli('--quiet', risky);
  assert.doesNotMatch(quiet.out, /warning  /);
  assert.match(quiet.out, /2 errors, 0 warnings, 0 info/);
});

test('usage errors exit with code 2', async () => {
  assert.equal((await cli()).code, 2);
  assert.equal((await cli('--format', 'xml', 'x.json')).code, 2);
  assert.equal((await cli('--disable', 'no-such-rule', 'x.json')).code, 2);
  assert.equal((await cli('--max-warnings', '-1', 'x.json')).code, 2);
  assert.equal((await cli('does-not-exist.json')).code, 2);
  assert.equal((await cli('--bogus')).code, 2);
});

test('--list-rules, --version and --help', async () => {
  assert.match((await cli('--list-rules')).out, /hardcoded-secret\s+error/);
  assert.match((await cli('--version')).out, /^\d+\.\d+\.\d+$/);
  assert.match((await cli('--help')).out, /Usage: n8n-workflow-lint/);
});
