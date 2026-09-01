/**
 * Contract verification gate.
 *
 * Runs the GenVM linter and the direct-mode test suite, and exits non-zero on
 * failure. Run this before deploying a new version of the contract to Studio —
 * a contract that does not lint or whose tests fail should not be deployed.
 *
 * Usage: node scripts/preflight.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CONTRACT = 'contracts/guardian_budget.py';
const VENV = '.venv';

/** Resolve an executable inside the project virtualenv, if one exists. */
function venvBin(name) {
  const relative =
    process.platform === 'win32'
      ? path.join(VENV, 'Scripts', `${name}.exe`)
      : path.join(VENV, 'bin', name);
  return existsSync(relative) ? relative : null;
}

function fail(message) {
  console.error(`\nPreflight failed: ${message}\n`);
  process.exit(1);
}

function run(label, command, args) {
  console.log(`\n> ${label}\n  ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    // genvm-lint writes non-ASCII status glyphs, which throws on a cp1252 stdout.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (result.error) fail(`${label} could not be started (${result.error.message})`);
  if (result.status !== 0) fail(`${label} exited with code ${result.status}`);
}

const linter = venvBin('genvm-lint');
const python = venvBin('python');

if (!linter || !python) {
  const venvPython = path.join(VENV, process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
  fail(
    `no virtualenv found at ./${VENV}. Create one and install the contract tooling:\n` +
      `  python -m venv ${VENV}\n` +
      `  ${venvPython} -m pip install -r requirements.txt`,
  );
}

run('Contract lint and validation', linter, ['check', CONTRACT]);
// tests/integration needs a live network and a funded account, so it is excluded
// here and run explicitly via `npm run test:integration`.
run('Direct-mode contract tests', python, [
  '-m',
  'pytest',
  'tests',
  '-q',
  '--ignore=tests/integration',
]);

console.log('\nPreflight passed: contract lints and all direct-mode tests pass.');
console.log('Deploy contracts/guardian_budget.py at https://studio.genlayer.com');
