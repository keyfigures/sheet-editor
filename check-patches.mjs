#!/usr/bin/env node
// CI: every patch still applies to the pinned commit, in order. Fetches only the files the patches touch.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(readFileSync(join(HERE, 'editor.lock.json'), 'utf8'));
const patches = readdirSync(join(HERE, 'patches')).filter((n) => n.endsWith('.patch')).sort();
if (!patches.length) throw new Error('No patches found');
const touched = new Set();
for (const name of patches) {
  for (const m of readFileSync(join(HERE, 'patches', name), 'utf8').matchAll(/^diff --git a\/(\S+) b\//gm)) touched.add(m[1]);
}
const work = mkdtempSync(join(tmpdir(), 'sheet-editor-patches-'));
const git = (...args) => execFileSync('git', args, { cwd: work, stdio: 'inherit' });
try {
  git('init', '-q');
  git('remote', 'add', 'origin', lock.repo);
  git('sparse-checkout', 'set', '--no-cone', ...[...touched].map((p) => `/${p}`));
  git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', lock.commit);
  git('checkout', '-q', 'FETCH_HEAD');
  for (const name of patches) {
    git('apply', '--whitespace=nowarn', join(HERE, 'patches', name));
    console.log(`applies: ${name}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
