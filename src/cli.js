import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { RULES, RULE_IDS, isWorkflow, lintDocument } from './lint.js';
import { countSeverities, formatJson, formatText } from './format.js';

const { version } = createRequire(import.meta.url)('../package.json');

const HELP = `Usage: n8n-workflow-lint [options] <file-or-folder ...>

Checks exported n8n workflow JSON files for common production problems.
Folders are scanned recursively for *.json files that look like workflows.

Options:
  -f, --format <text|json>   output format (default: text)
  -d, --disable <rules>      comma-separated rule ids to skip
      --max-warnings <n>     exit with code 1 if there are more than n warnings
  -q, --quiet                report errors only
      --no-color             disable colored output
      --list-rules           print the available rules and exit
  -h, --help                 show this help
  -v, --version              show the version

Exit codes: 0 = no errors, 1 = errors (or too many warnings), 2 = bad usage.`;

const SKIP_DIRS = new Set(['node_modules', '.git']);

async function collectJsonFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...(await collectJsonFiles(join(dir, entry.name))));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      out.push(join(dir, entry.name));
    }
  }
  return out.sort();
}

function displayPath(cwd, path) {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
}

async function lintFile(path, { explicit, disable }) {
  let doc;
  try {
    // Some editors save exports with a byte order mark; JSON.parse rejects it.
    doc = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (err) {
    return { file: path, error: `cannot read JSON: ${err.message}` };
  }
  const looksLikeWorkflow = isWorkflow(doc) || (Array.isArray(doc) && doc.length > 0 && doc.every(isWorkflow));
  if (!looksLikeWorkflow) {
    // Inside folders, quietly skip package.json and other unrelated files.
    return explicit ? { file: path, error: 'not an n8n workflow export (no "nodes" array)' } : null;
  }
  return { file: path, workflows: lintDocument(doc, { disable }) };
}

/**
 * Run the CLI. Returns the exit code instead of exiting, so it can be tested.
 * @param {string[]} argv
 * @param {{ stdout: (s: string) => void, stderr: (s: string) => void, color?: boolean, cwd?: string }} io
 */
export async function run(argv, io) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: 'string', short: 'f', default: 'text' },
        disable: { type: 'string', short: 'd', multiple: true },
        'max-warnings': { type: 'string' },
        quiet: { type: 'boolean', short: 'q' },
        'no-color': { type: 'boolean' },
        'list-rules': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    io.stderr(`${err.message}\n\n${HELP}`);
    return 2;
  }
  const { values: o, positionals } = args;

  if (o.help) {
    io.stdout(HELP);
    return 0;
  }
  if (o.version) {
    io.stdout(version);
    return 0;
  }
  if (o['list-rules']) {
    for (const r of RULES) io.stdout(`${r.id.padEnd(24)} ${r.severity.padEnd(8)} ${r.description}`);
    return 0;
  }

  if (!['text', 'json'].includes(o.format)) {
    io.stderr(`Unknown format "${o.format}". Use "text" or "json".`);
    return 2;
  }
  const disable = (o.disable ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const unknown = disable.filter((id) => !RULE_IDS.includes(id));
  if (unknown.length) {
    io.stderr(`Unknown rule(s): ${unknown.join(', ')}. Run --list-rules to see them.`);
    return 2;
  }
  let maxWarnings = Infinity;
  if (o['max-warnings'] !== undefined) {
    maxWarnings = Number(o['max-warnings']);
    if (!Number.isInteger(maxWarnings) || maxWarnings < 0) {
      io.stderr('--max-warnings expects a whole number of 0 or more.');
      return 2;
    }
  }
  if (positionals.length === 0) {
    io.stderr(`No files given.\n\n${HELP}`);
    return 2;
  }

  const cwd = io.cwd ?? process.cwd();
  const files = [];
  for (const target of positionals) {
    let info;
    try {
      info = await stat(target);
    } catch {
      io.stderr(`No such file or folder: ${target}`);
      return 2;
    }
    const paths = info.isDirectory() ? await collectJsonFiles(target) : [target];
    for (const p of paths) {
      const res = await lintFile(p, { explicit: !info.isDirectory(), disable });
      if (res) files.push({ ...res, file: displayPath(cwd, p) });
    }
  }

  if (o.quiet) {
    for (const f of files) for (const wf of f.workflows ?? []) wf.results = wf.results.filter((r) => r.severity === 'error');
  }

  const color = io.color && !o['no-color'];
  io.stdout(o.format === 'json' ? formatJson(files) : formatText(files, { color }));

  const counts = countSeverities(files);
  return counts.error > 0 || counts.warning > maxWarnings ? 1 : 0;
}
