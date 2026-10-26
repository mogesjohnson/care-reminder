// Guards the committed agent configs against a well-meant "just allow everything" edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const claudePath = new URL('.claude/settings.json', root);
const codexPath = new URL('.codex/config.toml', root);

/**
 * A model of Claude Code's documented Bash rule matching (code.claude.com/docs/en/permissions,
 * read 2026-10-25): "*" matches any text, spaces included; a trailing " *" that is the only
 * wildcard also matches the bare command; deny and ask apply if any subcommand of a compound
 * command matches, and leading VAR=value assignments are skipped. It is a model, so it checks intent, not Claude Code itself.
 */
export function bashRuleMatches(rule, command) {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const pattern = m[1].replace(/:\*$/, ' *');
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's');
  const bare = (pattern.match(/\*/g) || []).length === 1 && pattern.endsWith(' *') ? pattern.slice(0, -2) : null;
  const subs = command.split(/\s*(?:&&|\|\||;|\|)\s*/).map((sub) => sub.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''));
  return subs.some((sub) => re.test(sub) || sub === bare);
}

/**
 * A model of the documented Read rules: gitignore-style paths, where "./" is the project root,
 * "**\/" matches zero or more folders, "*" stays inside one folder and [aA] is a character class.
 */
export function readRuleMatches(rule, path) {
  const m = /^Read\(\.\/(.*)\)$/.exec(rule);
  if (!m) return false;
  const re = m[1].split(/(\*\*\/|\*|\[[^\]]+\])/).map((p) => {
    if (p === '**/') return '(?:.*/)?';
    if (p === '*') return '[^/]*';
    if (/^\[.+\]$/.test(p)) return p;
    return p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^${re}$`).test(path);
}

export function decide(permissions, command) {
  for (const kind of ['deny', 'ask', 'allow']) {
    if ((permissions[kind] || []).some((r) => bashRuleMatches(r, command))) return kind;
  }
  return 'ask';
}

test('the rule model follows the documented examples', () => {
  assert.ok(bashRuleMatches('Bash(ls *)', 'ls'));
  assert.ok(!bashRuleMatches('Bash(ls *)', 'lsof'));
  assert.ok(bashRuleMatches('Bash(git log * main)', 'git log --output= main'));
  assert.ok(!bashRuleMatches('Bash(* --help *)', 'npm --help'));
  assert.ok(bashRuleMatches('Bash(rm *)', 'cd /tmp && rm -rf x'));
  assert.ok(bashRuleMatches('Bash(rm *)', 'A=1 B=2 rm x'));
});

test('Claude settings are strict JSON with no blanket allows', { skip: !existsSync(claudePath) }, () => {
  const { permissions } = JSON.parse(readFileSync(claudePath, 'utf8'));
  const wide = permissions.allow.filter((r) => /^(Bash|Edit|Write)(\(\*[ *]*\))?$/.test(r));
  assert.deepEqual(wide, [], 'allow must not contain blanket Bash, Edit or Write');
  for (const rule of ['Read(./.env)', 'Read(./.env.*)']) assert.ok(permissions.deny.includes(rule), `deny is missing ${rule}`);
  assert.equal(permissions.defaultMode, undefined, 'do not set a default mode in the shared file');
});

test('Claude settings deny secret reads in any case and folder', { skip: !existsSync(claudePath) }, () => {
  const { permissions } = JSON.parse(readFileSync(claudePath, 'utf8'));
  const denied = (path) => permissions.deny.some((r) => readRuleMatches(r, path));
  for (const p of ['.env', '.ENV', '.Env.local', 'apps/api/.env.production', 'secrets.json', 'config/Secrets.JSON',
    'id_rsa', 'keys/ID_RSA', 'deploy/id_ed25519', 'certs/server.PEM', 'tls/site.key', 'a/b.P12']) {
    assert.ok(denied(p), `Read(${p}) should be denied`);
  }
  for (const p of ['README.md', 'src/env.ts', 'docs/keys.md', 'id_rsa.pub', 'secrets.json.md']) assert.ok(!denied(p), `Read(${p}) should be allowed`);
});

test('Claude settings deny the bypasses wherever the flag sits', { skip: !existsSync(claudePath) }, () => {
  const { permissions } = JSON.parse(readFileSync(claudePath, 'utf8'));
  const expect = {
    deny: [
      'git commit --no-verify -m x', 'git commit -m x --no-verify', 'git push --no-verify', 'git merge main --no-verify',
      'git commit -n -m x', 'git commit -m x -n', 'npm test && git commit -m x -n',
      'git push --force', 'git push origin main --force', 'git push --force-with-lease', 'git push -f origin main',
      'git push origin main -f', 'git push origin +main', 'GIT_TRACE=1 git push --force',
      'git reset --hard', 'git reset HEAD~1 --hard',
      'git config core.hooksPath /dev/null', 'git config --local core.hooksPath x', 'git -c core.hooksPath=/dev/null commit -m x',
      'git config --unset core.hooksPath', 'git config --unset-all core.hookspath', 'git config set core.hooksPath x',
      'git diff --output=/tmp/x', 'git log -p --output x', 'git show HEAD --output=x', 'git diff --ext-diff',
      'git diff --no-index /dev/null ../.env', 'git diff --stat --no-index a b',
      'git show HEAD:.env', 'git show main:config/.env.local', 'git show HEAD:certs/server.pem', 'git show HEAD:id.key',
      'git log -p -- .env', 'git diff HEAD~3 -- config/.env.local',
      'git log > /tmp/out.txt', 'git log -p >> log.txt', 'git diff main > patch.diff', 'git log >out.txt',
      'git diff >patch.diff', 'git log 1>out.txt', 'git log &>out.txt', 'git log>>out.txt',
      'git cat-file -p HEAD:.env', 'git cat-file -p main:config/.env.local', 'git cat-file blob HEAD:tls/site.key',
      'git grep sk-', 'git grep -n AKIA', 'git grep -e ghp_ HEAD~5', 'git grep "BEGIN RSA PRIVATE KEY"', 'git grep -i api_key',
      'git grep --untracked TOKEN', 'git config unset core.hooksPath', 'git config unset --all core.hookspath',
      'rm -rf node_modules', 'rm -fr dist',
    ],
    ask: ['git push', 'git push -u origin grok/topic', 'npm install left-pad', 'gh pr create', 'curl https://example.com'],
    allow: [
      'npm test', 'git status', 'git diff', 'git diff --stat main', 'git log --oneline -5', 'git log -n 5', 'git show HEAD',
      'git config --get core.hooksPath', 'git show HEAD:README.md', 'git status 2>&1',
      'git log --format="%h -> %s"', 'git log --oneline --format=%h->%s', 'git diff -- .env.example', 'git diff --stat 2>&1',
    ],
  };
  for (const [want, commands] of Object.entries(expect)) {
    for (const c of commands) assert.equal(decide(permissions, c), want, c);
  }
});

test('known gaps stay written down', { skip: !existsSync(claudePath) }, () => {
  // Not matched by any rule; docs/agents.md lists them. If one starts matching, update the docs.
  const { permissions } = JSON.parse(readFileSync(claudePath, 'utf8'));
  const gaps = [
    'git -C . push --force', 'git commit -anm x', '/usr/bin/git push --force',
    'git log>out.txt', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=x git commit -m x',
    'git config core.HOOKSPATH x', 'git log -p', 'git log -S AKIA -p', 'git log -G "sk-" -p', 'git diff HEAD~1 -- .env.prod',
    'git grep -e s"k-"',
  ];
  for (const c of gaps) {
    assert.notEqual(decide(permissions, c), 'deny', c);
  }
});

test('AGENTS.md stays at or under 70 lines', () => {
  // This repo's root AGENTS.md sits one level above template/; a downstream repo has only one.
  const parent = root.pathname.endsWith('/template/') ? [new URL('../AGENTS.md', root)] : [];
  const files = [new URL('AGENTS.md', root), ...parent].filter((f) => existsSync(f));
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').replace(/\n$/, '').split('\n').length;
    assert.ok(lines <= 70, `${f.pathname.split('/').slice(-2).join('/')} has ${lines} lines`);
  }
});

test('Codex config stays sandboxed', { skip: !existsSync(codexPath) }, () => {
  const toml = readFileSync(codexPath, 'utf8').replace(/#.*$/gm, '');
  assert.match(toml, /^sandbox_mode\s*=\s*"(workspace-write|read-only)"/m);
  assert.match(toml, /^approval_policy\s*=\s*"on-request"/m);
  assert.match(toml, /^network_access\s*=\s*false/m);
  assert.doesNotMatch(toml, /danger-full-access/);
});
