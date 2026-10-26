#!/usr/bin/env node
// BEST-OF-AI-DEV template v1. Runs every *.test.mjs here with node:test.
// Exists because `node --test <dir>` and glob arguments behave differently across
// Node 20 and 22, and cmd.exe does not expand globs. Usage: node scripts/test/run.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutGitEnv } from '../lib/git-env.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(here, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: withoutGitEnv() }); // see lib/git-env.mjs
process.exit(r.status ?? 1);
