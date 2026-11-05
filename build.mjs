#!/usr/bin/env node
// Builds the workbook viewer: the pinned editor, our patches, trimmed to what a spreadsheet needs.
//
//   node build.mjs                      clone afresh, patch, build, write dist/
//   node build.mjs --keep-work          reuse .work/, applying only patches not yet committed there
//   node build.mjs --app-origin=<url>   also write dist/vercel.json, framed only by that app
//
// The steps for adding a patch are in README.md.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, '.work');
const DIST = join(HERE, 'dist');
const PATCHES = join(HERE, 'patches');
const SOURCE_URL = 'https://github.com/keyfigures/sheet-editor';
const MARK = 'kf-patch: ';

/** Everything else the upstream build writes is its marketing site. A kept path that is missing is an error. */
const KEEP = [
  'editor.html', 'assets', 'libs', 'ran-fonts', 'ranui-iife', 'themes.json', 'plugins.json', 'licenses',
  'app-tokens.css', 'build-identity.json', 'theme-presentation.js', 'manifest.json', 'icons', 'fonts',
];
const SDKJS_DROP = ['word', 'slide', 'pdf', 'visio'];
const WEB_APPS_DROP = ['documenteditor', 'presentationeditor', 'pdfeditor', 'visioeditor'];

const args = process.argv.slice(2);
const keepWork = args.includes('--keep-work');
const appOrigin = args.find((a) => a.startsWith('--app-origin='))?.slice('--app-origin='.length);
const unknown = args.filter((a) => a !== '--keep-work' && !a.startsWith('--app-origin='));
if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(' ')}`);
const lock = JSON.parse(readFileSync(join(HERE, 'editor.lock.json'), 'utf8'));

function run(command, argv, options = {}) {
  execFileSync(command, argv, { stdio: 'inherit', cwd: WORK, ...options });
}
function output(command, argv) {
  return execFileSync(command, argv, { cwd: WORK, encoding: 'utf8' }).trim();
}
function git(...argv) {
  run('git', ['-c', 'user.name=sheet-editor-build', '-c', 'user.email=build@keyfigures.invalid', ...argv]);
}

function cloneAtCommit() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  run('git', ['init', '-q']);
  run('git', ['remote', 'add', 'origin', lock.repo]);
  run('git', ['fetch', '--depth', '1', 'origin', lock.commit]);
  run('git', ['checkout', '-q', 'FETCH_HEAD']);
  if (output('git', ['rev-parse', 'HEAD']) !== lock.commit) throw new Error('The clone is not at the pinned commit');
}

function applyPatches() {
  const applied = new Set(
    output('git', ['log', '--format=%s']).split('\n').filter((s) => s.startsWith(MARK)).map((s) => s.slice(MARK.length)),
  );
  const names = readdirSync(PATCHES).filter((n) => n.endsWith('.patch')).sort();
  for (const name of names) {
    if (applied.has(name)) continue;
    run('git', ['apply', '--whitespace=nowarn', join(PATCHES, name)]);
    git('add', '-A');
    git('commit', '-q', '-m', `${MARK}${name}`);
    console.log(`[sheet-editor] applied ${name}`);
  }
}

/** bin/build.sh needs pnpm on PATH, and this machine has no corepack. */
function pnpmEnv() {
  const shim = join(WORK, '.temp', 'shim');
  mkdirSync(shim, { recursive: true });
  const path = join(shim, 'pnpm');
  writeFileSync(path, `#!/bin/sh\nexec npx --yes pnpm@${lock.pnpm} "$@"\n`);
  chmodSync(path, 0o755);
  return { ...process.env, PATH: `${shim}:${process.env.PATH}`, VITE_KF_SOURCE_URL: SOURCE_URL };
}

function buildUpstream() {
  const env = pnpmEnv();
  run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { env });
  run('pnpm', ['-r', 'run', 'prepare'], { env });
  run('sh', ['./bin/build.sh'], { env });
}

function copyTrimmed() {
  const built = join(WORK, 'dist');
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  const tokens = readdirSync(built).filter((n) => /^ran-tokens\..+\.css$/.test(n));
  if (tokens.length !== 1) throw new Error(`Expected one hashed ran-tokens file, found ${tokens.length}`);
  for (const name of [...KEEP, ...tokens]) {
    if (!existsSync(join(built, name))) throw new Error(`A kept path is missing from the build: ${name}`);
    cpSync(join(built, name), join(DIST, name), { recursive: true });
  }
  const drop = (from, names) => (source) => !names.some((n) => source === join(built, from, n));
  cpSync(join(built, 'sdkjs'), join(DIST, 'sdkjs'), { recursive: true, filter: drop('sdkjs', SDKJS_DROP) });
  cpSync(join(built, 'web-apps'), join(DIST, 'web-apps'), {
    recursive: true,
    filter: drop(join('web-apps', 'apps'), WEB_APPS_DROP),
  });
  // Ours, not upstream's: NOTICE lists our modifications (AGPL section 5a).
  cpSync(join(HERE, 'LICENSE'), join(DIST, 'LICENSE'));
  cpSync(join(HERE, 'NOTICE'), join(DIST, 'NOTICE'));
}

function writeVercelConfig(origin) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin) throw new Error(`--app-origin must be a bare origin, got ${origin}`);
  const template = readFileSync(join(HERE, 'vercel.template.json'), 'utf8');
  writeFileSync(join(DIST, 'vercel.json'), template.replaceAll('__APP_ORIGIN__', origin));
}

if (!keepWork || !existsSync(join(WORK, '.git'))) cloneAtCommit();
applyPatches();
buildUpstream();
copyTrimmed();
if (appOrigin) writeVercelConfig(appOrigin);
console.log(`[sheet-editor] built ${lock.commit} into dist/`);
