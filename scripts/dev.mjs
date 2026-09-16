#!/usr/bin/env node
/**
 * Test runner bridge.
 *
 * The D: drive grants (RX,W) but not Delete, so npm cannot install here — it
 * stages packages and then renames them into place, and the rename is denied.
 * This script mirrors the source to a work directory on C:, installs there
 * once, and runs the requested command against the mirror.
 *
 * Uses only Node built-ins, so it runs with nothing installed.
 *
 *   node scripts/dev.mjs test        run the suite once
 *   node scripts/dev.mjs watch       re-run on change
 *   node scripts/dev.mjs typecheck   tsc --noEmit
 *
 * Delete this file once the ACLs are repaired:
 *   icacls "D:\" /grant "Everyone:(OI)(CI)(M)" /T      (elevated)
 * after which plain `npm install && npm test` works in place.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectName = path.basename(projectRoot).replace(/[^\w.-]+/g, '-');
const workDir = path.join(
  process.env.LOCALAPPDATA || os.tmpdir(),
  `${projectName}-build`,
);

/** Files and directories that make up the buildable project. */
const MIRRORED = ['src', 'tests', 'package.json', 'tsconfig.json', 'vitest.config.ts'];

const COMMANDS = {
  test: ['npx', 'vitest', 'run'],
  watch: ['npx', 'vitest'],
  typecheck: ['npx', 'tsc', '--noEmit'],
};

function log(message) {
  process.stderr.write(`[dev] ${message}\n`);
}

/**
 * Skip the stray `*.tmp.<pid>.<hash>` siblings that failed atomic writes leave
 * behind on D:. They are not valid TypeScript and vitest would try to load them.
 */
function isMirrorable(source) {
  const name = path.basename(source);
  return !/\.tmp\.\d+\./.test(name) && name !== 'node_modules';
}

function mirror() {
  fs.mkdirSync(workDir, { recursive: true });

  for (const entry of MIRRORED) {
    const from = path.join(projectRoot, entry);
    const to = path.join(workDir, entry);

    if (!fs.existsSync(from)) {
      log(`warning: ${entry} not found, skipping`);
      continue;
    }

    // Clear the destination first so a file deleted on D: also disappears from
    // the mirror — otherwise a renamed test would keep running from a ghost.
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, filter: isMirrorable });
  }
}

/** Reinstall only when the manifest actually changed. */
function installIfNeeded() {
  const manifest = fs.readFileSync(path.join(workDir, 'package.json'));
  const hash = createHash('sha256').update(manifest).digest('hex');
  const stamp = path.join(workDir, '.install-stamp');

  const installed = fs.existsSync(path.join(workDir, 'node_modules'));
  const current = fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === hash;

  if (installed && current) return;

  log('installing dependencies (first run or manifest changed)...');
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: workDir,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    log('npm install failed');
    process.exit(result.status ?? 1);
  }

  fs.writeFileSync(stamp, hash);
}

const [, , requested = 'test', ...rest] = process.argv;
const command = COMMANDS[requested];

if (!command) {
  log(`unknown command "${requested}". Expected one of: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}

mirror();
installIfNeeded();

log(`running "${requested}" in ${workDir}`);
const [bin, ...args] = command;
const run = spawnSync(bin, [...args, ...rest], {
  cwd: workDir,
  stdio: 'inherit',
  shell: true,
});

process.exit(run.status ?? 1);
