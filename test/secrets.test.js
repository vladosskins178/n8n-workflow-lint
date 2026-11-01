import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, isSecretName, matchSecretPattern, mask } from '../src/secrets.js';

test('recognises common key formats', () => {
  // Fake values are assembled from parts so secret scanners do not flag this file.
  const j = (...parts) => parts.join('');
  const cases = {
    [j('sk-', 'proj-', 'abcdefghijklmnopqrstuvwxyz012345')]: 'OpenAI-style API key',
    [j('sk-', 'ant-', 'api03-abcdefghijklmnopqrstuvwxyz')]: 'Anthropic API key',
    [j('gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789')]: 'GitHub token',
    [j('xo', 'xb-', '1234567890-abcdefghij')]: 'Slack token',
    [j('AK', 'IA', 'ABCDEFGHIJKLMNOP')]: 'AWS access key ID',
    [j('123456789', ':AA', 'abcdefghijklmnopqrstuvwxyz0123456')]: 'Telegram bot token',
    'postgres://admin:hunter22@db.internal:5432/app': 'password in connection URL',
    'https://api.example.com/v1?api_key=abcdef1234567890': 'secret in URL query string',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz': 'bearer token',
  };
  for (const [value, label] of Object.entries(cases)) {
    assert.equal(matchSecretPattern(value)?.label, label, value);
  }
});

test('ignores expressions, placeholders and ordinary text', () => {
  for (const value of [
    '={{ $env.OPENAI_KEY }}',
    'Bearer {{ $json.token }}',
    'https://api.example.com/v1?api_key={{ $env.KEY }}',
    'Hello there, how are you today?',
    'gpt-4o-mini',
  ]) {
    assert.equal(matchSecretPattern(value), null, value);
  }
  assert.deepEqual(findSecrets({ apiKey: 'YOUR_API_KEY' }), []);
  assert.deepEqual(findSecrets({ apiKey: '<paste key here>' }), []);
  assert.deepEqual(findSecrets({ apiKey: '={{ $env.KEY }}' }), []);
  assert.deepEqual(findSecrets({ maxTokens: '2048' }), []);
});

test('flags literal values under secret-looking names', () => {
  const found = findSecrets({
    headerParameters: { parameters: [{ name: 'X-API-Key', value: 'abc123def456ghi' }] },
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].path, 'parameters.headerParameters.parameters[0].value');
  assert.match(found[0].label, /X-API-Key/);
});

test('secret names are matched by suffix, not substring', () => {
  assert.ok(isSecretName('X-API-Key'));
  assert.ok(isSecretName('client_secret'));
  assert.ok(isSecretName('accessToken'));
  assert.ok(!isSecretName('authentication'));
  assert.ok(!isSecretName('tokenType'));
  assert.ok(!isSecretName('maxTokens'));
});

test('mask never prints more than four characters', () => {
  assert.equal(mask('sk-proj-abcdefghijklmnop'), 'sk-p…, 24 chars');
});
