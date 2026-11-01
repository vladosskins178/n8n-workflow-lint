// Detection of credentials that were pasted straight into node parameters
// instead of being stored in n8n's credential manager.

// Value patterns: these match the secret itself, wherever it appears
// (plain fields, expressions, JSON bodies, Code node source).
export const SECRET_PATTERNS = [
  { label: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: 'OpenAI-style API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/ },
  { label: 'Stripe live key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}/ },
  { label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/ },
  { label: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { label: 'AWS access key ID', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { label: 'Telegram bot token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ },
  { label: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { label: 'bearer token', re: /\bBearer\s+(?!\{\{)[A-Za-z0-9._~+/-]{20,}=*/ },
  { label: 'password in connection URL', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/{}]+:[^\s@/{}]{3,}@/i },
  {
    label: 'secret in URL query string',
    re: /[?&](?:api[_-]?key|apikey|key|token|access_token|secret|password)=(?!\{\{)[^&\s{"']{12,}/i,
  },
  {
    label: 'secret assigned in code',
    re: /\b(?:api[_-]?key|apikey|secret|token|password|passwd)\s*[:=]\s*['"`][^'"`\s{}]{12,}['"`]/i,
  },
];

// Field names that usually carry a secret. Compared after lower-casing and
// removing everything that is not a letter or digit ("X-API-Key" -> "xapikey").
const SECRET_NAME_SUFFIXES = [
  'apikey',
  'accesskey',
  'secretkey',
  'privatekey',
  'secret',
  'token',
  'password',
  'passwd',
  'authorization',
];

const PLACEHOLDER =
  /^(?:your|my|insert|enter|put)[-_ ]|^<.*>$|^\[.*\]$|^x{4,}$|^\*{3,}$|placeholder|changeme|example|replace[-_ ]?me|^test$|^none$/i;

export function isSecretName(name) {
  if (typeof name !== 'string') return false;
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!n) return false;
  return SECRET_NAME_SUFFIXES.some((s) => n === s || n.endsWith(s));
}

// n8n expressions start with "=" and are evaluated at runtime.
export function isExpression(value) {
  return typeof value === 'string' && (value.startsWith('=') || value.includes('{{'));
}

function looksLikeLiteralSecret(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 8 || isExpression(v) || PLACEHOLDER.test(v)) return false;
  if (/^(true|false|null|undefined)$/i.test(v)) return false;
  if (/^(.)\1+$/.test(v)) return false;
  // "Bearer abc..." is fine, other values with spaces are probably prose.
  if (/\s/.test(v) && !/^(Bearer|Basic|Token)\s+\S+$/i.test(v)) return false;
  return true;
}

export function mask(value) {
  const v = String(value);
  return `${v.slice(0, 4)}…, ${v.length} chars`;
}

/** Find the first secret pattern that matches a string. */
export function matchSecretPattern(value) {
  if (typeof value !== 'string') return null;
  for (const p of SECRET_PATTERNS) {
    const m = value.match(p.re);
    if (m && !PLACEHOLDER.test(m[0])) return { label: p.label, match: m[0] };
  }
  return null;
}

/**
 * Walk a node's parameters and return every hard-coded secret found.
 * Each finding: { path, label, preview }.
 */
export function findSecrets(parameters) {
  const findings = [];
  const seen = new Set();

  const add = (path, label, raw) => {
    if (seen.has(path)) return;
    seen.add(path);
    findings.push({ path, label, preview: mask(raw) });
  };

  const walk = (value, path, keyName) => {
    if (typeof value === 'string') {
      const hit = matchSecretPattern(value);
      if (hit) return add(path, hit.label, hit.match);
      if (keyName && isSecretName(keyName) && looksLikeLiteralSecret(value)) {
        add(path, `value for "${keyName}"`, value.trim());
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, keyName));
      return;
    }
    if (value && typeof value === 'object') {
      // Name/value pairs, e.g. HTTP Request headers and query parameters.
      const pairName = typeof value.name === 'string' ? value.name : value.key;
      for (const [k, v] of Object.entries(value)) {
        const childName = k === 'value' && typeof pairName === 'string' ? pairName : k;
        walk(v, path ? `${path}.${k}` : k, childName);
      }
    }
  };

  walk(parameters ?? {}, 'parameters', null);
  return findings;
}
