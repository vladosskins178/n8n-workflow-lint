#!/usr/bin/env node
import { run } from '../src/cli.js';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(`${s}\n`),
  stderr: (s) => process.stderr.write(`${s}\n`),
  color: Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env),
});
