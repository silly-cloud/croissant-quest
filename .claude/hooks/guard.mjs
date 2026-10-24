// PreToolUse guard for the Bash tool. Called by block-dangerous-git.sh. See docs/adr/0008-guardrail-hook-v2.md.
// Reads the hook JSON on stdin; exit 0 = allow, exit 2 = block (message on stderr). Any doubt = exit 2.
// A tripwire for a well-meaning agent, not a security boundary: GitHub branch protection is the boundary.
import { readFileSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_DEPTH = 16;
class CannotCheck extends Error {}

function out(msg) {
  try { writeSync(2, msg + '\n'); } catch { /* stderr gone: the exit code still blocks */ }
}
function failClosed(why) {
  out(`BLOCKED: guardrail could not check this command (${why}); ask the user. They can run it themselves.`);
  process.exit(2);
}

// ---------- shell lexer: words with quotes resolved, split into simple commands ----------
// Returns { commands: [{ words, heredocs, herestrings, piped }], subs: [script text of $(..), `..`, <(..)] }.
function lex(src) {
  const n = src.length;
  const commands = [];
  const subs = [];
  const pending = [];
  const newCmd = (piped) => ({ words: [], heredocs: [], herestrings: [], piped });
  let cur = newCmd(false);
  let word = null;
  let quoted = false;
  let expect = null; // redirection target kind for the next word
  let i = 0;
  const add = (s) => { word = (word ?? '') + s; };

  function endWord() {
    if (word === null) return;
    if (expect === 'herestring') cur.herestrings.push(word);
    else if (expect === 'heredoc' || expect === 'heredoc-') pending.push({ cmd: cur, delim: word, quoted, strip: expect === 'heredoc-' });
    else if (expect === null) cur.words.push(word);
    expect = null;
    word = null;
    quoted = false;
  }
  function endCmd(piped) {
    endWord();
    expect = null;
    if (cur.words.length || cur.herestrings.length) commands.push(cur);
    cur = newCmd(piped);
  }
  function readBacktick(start) { // -> [content, index of closing backtick]
    let j = start, buf = '';
    while (j < n && src[j] !== '`') {
      if (src[j] === '\\' && j + 1 < n && '`\\$'.includes(src[j + 1])) { buf += src[j + 1]; j += 2; continue; }
      buf += src[j++];
    }
    return [buf, j];
  }
  function skipDouble(start) { // index after the closing quote
    let j = start;
    while (j < n && src[j] !== '"') {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '$' && src[j + 1] === '(') { j = findClose(j + 2) + 1; continue; }
      if (src[j] === '`') { j = readBacktick(j + 1)[1] + 1; continue; }
      j++;
    }
    return j + 1;
  }
  function findClose(start) { // index of the ')' matching an already-open '(' (n if unclosed)
    let depth = 1, j = start;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === "'") { const k = src.indexOf("'", j + 1); if (k < 0) return n; j = k + 1; continue; }
      if (c === '"') { j = skipDouble(j + 1); continue; }
      if (c === '`') { j = readBacktick(j + 1)[1] + 1; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return j;
      j++;
    }
    return n;
  }
  function findBrace(start) {
    let depth = 1, j = start;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return j;
      j++;
    }
    return n;
  }
  function readDouble(start) {
    let j = start, buf = '';
    while (j < n && src[j] !== '"') {
      const c = src[j];
      if (c === '\\' && j + 1 < n) {
        const d = src[j + 1];
        if ('$`"\\\n'.includes(d)) { if (d !== '\n') buf += d; j += 2; continue; }
        buf += c; j++; continue;
      }
      if (c === '$' && src[j + 1] === '(') { const e = findClose(j + 2); subs.push(src.slice(j + 2, e)); buf += src.slice(j, e + 1); j = e + 1; continue; }
      if (c === '$' && src[j + 1] === '{') { const e = findBrace(j + 2); buf += src.slice(j, e + 1); j = e + 1; continue; }
      if (c === '`') { const [content, e] = readBacktick(j + 1); subs.push(content); buf += '`' + content + '`'; j = e + 1; continue; }
      buf += c; j++;
    }
    add(buf);
    return j + 1;
  }
  function readAnsi(start) { // $'...'
    let j = start, buf = '';
    const simple = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
    while (j < n && src[j] !== "'") {
      if (src[j] !== '\\' || j + 1 >= n) { buf += src[j++]; continue; }
      const d = src[j + 1];
      let m;
      if (d in simple) { buf += simple[d]; j += 2; }
      else if ((m = /^x([0-9a-fA-F]{1,2})/.exec(src.slice(j + 1, j + 4)))) { buf += String.fromCharCode(parseInt(m[1], 16)); j += 1 + m[0].length; }
      else if ((m = /^[0-7]{1,3}/.exec(src.slice(j + 1, j + 4)))) { buf += String.fromCharCode(parseInt(m[0], 8)); j += 1 + m[0].length; }
      else if ((m = /^[uU]([0-9a-fA-F]{1,8})/.exec(src.slice(j + 1, j + 11)))) { buf += String.fromCodePoint(Math.min(parseInt(m[1], 16), 0x10ffff)); j += 1 + m[0].length; }
      else { buf += '\\' + d; j += 2; }
    }
    add(buf);
    return j + 1;
  }
  function scanSubs(text) {
    // $(..) and `..` in an unquoted heredoc body run when the shell expands it. The body expands like a
    // double-quoted string whose `"` are literal, so lex it as one (with `"` blanked out).
    subs.push(...lex('"' + text.replace(/"/g, ' ') + '"').subs);
  }
  function readHeredocs(start) {
    let j = start;
    for (const p of pending) {
      const body = [];
      while (j < n) {
        const nl = src.indexOf('\n', j);
        const line = src.slice(j, nl < 0 ? n : nl);
        j = nl < 0 ? n : nl + 1;
        if ((p.strip ? line.replace(/^\t+/, '') : line) === p.delim) break;
        body.push(line);
      }
      const text = body.join('\n');
      p.cmd.heredocs.push(text);
      if (!p.quoted) scanSubs(text);
    }
    pending.length = 0;
    return j;
  }

  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') { endWord(); i++; continue; }
    if (ch === '\n') { endCmd(false); i = readHeredocs(i + 1); continue; }
    if (ch === '#' && word === null) { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '\\') {
      if (src[i + 1] === '\n') { i += 2; continue; }
      if (i + 1 < n) add(src[i + 1]);
      quoted = true; i += 2; continue;
    }
    if (ch === "'") { const j = src.indexOf("'", i + 1); const e = j < 0 ? n : j; add(src.slice(i + 1, e)); quoted = true; i = e + 1; continue; }
    if (ch === '"') { i = readDouble(i + 1); quoted = true; continue; }
    if (ch === '$') {
      const nx = src[i + 1];
      if (nx === "'") { i = readAnsi(i + 2); quoted = true; continue; }
      if (nx === '"') { i = readDouble(i + 2); quoted = true; continue; }
      if (nx === '(') { const e = findClose(i + 2); subs.push(src.slice(i + 2, e)); add(src.slice(i, e + 1)); i = e + 1; continue; }
      if (nx === '{') { const e = findBrace(i + 2); add(src.slice(i, e + 1)); i = e + 1; continue; }
      add('$'); i++; continue;
    }
    if (ch === '`') { const [content, e] = readBacktick(i + 1); subs.push(content); add('`' + content + '`'); i = e + 1; continue; }
    if ((ch === '<' || ch === '>') && src[i + 1] === '(') { const e = findClose(i + 2); subs.push(src.slice(i + 2, e)); add(src.slice(i, e + 1)); i = e + 1; continue; }
    if (ch === '<' || ch === '>' || (ch === '&' && src[i + 1] === '>')) {
      if (word !== null && !quoted && /^\d+$/.test(word)) { word = null; quoted = false; } else endWord(); // fd number: 2>
      if (src.startsWith('<<<', i)) { expect = 'herestring'; i += 3; }
      else if (src.startsWith('<<-', i)) { expect = 'heredoc-'; i += 3; }
      else if (src.startsWith('<<', i)) { expect = 'heredoc'; i += 2; }
      else { i++; while (i < n && '<>&|'.includes(src[i]) && !(src[i] === '|' && src[i + 1] === '|') && !(src[i] === '&' && src[i + 1] === '&')) i++; expect = 'file'; }
      continue;
    }
    if (ch === ';' || ch === '&' || ch === '|' || ch === '(' || ch === ')') {
      let piped = false;
      if (ch === '|') { piped = src[i + 1] !== '|'; i += src[i + 1] === '|' || src[i + 1] === '&' ? 2 : 1; }
      else if (ch === '&') i += src[i + 1] === '&' ? 2 : 1;
      else if (ch === ';') i += src[i + 1] === ';' || src[i + 1] === '&' ? 2 : 1;
      else i++;
      endCmd(piped);
      continue;
    }
    add(ch); i++;
  }
  endCmd(false);
  return { commands, subs };
}

// ---------- option scanning ----------
function scanOpts(args, spec = {}) {
  const argShort = spec.argShort || '', optShort = spec.optShort || '', argLong = spec.argLong || [];
  const shorts = new Set(), longs = [], pos = [];
  let dd = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (dd) { pos.push(a); continue; }
    if (a === '--') { dd = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = (eq < 0 ? a.slice(2) : a.slice(2, eq)).toLowerCase();
      let value = eq < 0 ? null : a.slice(eq + 1);
      if (value === null && argLong.includes(name)) value = args[++i] ?? '';
      longs.push({ name, value });
      continue;
    }
    if (a.length > 1 && a[0] === '-') {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        shorts.add(c);
        if (argShort.includes(c)) { if (j === a.length - 1) i++; break; }
        if (optShort.includes(c)) break;
      }
      continue;
    }
    pos.push(a);
  }
  return { shorts, longs, pos, dd };
}
// git accepts unambiguous prefixes of long options: treat any prefix of `target` at least `min` long as `target`.
const hasLong = (o, target, min = target.length) => o.longs.some((l) => l.name.length >= min && target.startsWith(l.name));
const hasShort = (o, chars) => [...chars].some((c) => o.shorts.has(c));

// ---------- command normalisation ----------
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const RESERVED = new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', 'coproc']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish', 'busybox']);

function skipFlags(w, withArg = '', optAttached = '') {
  let i = 0;
  while (i < w.length && w[i].startsWith('-') && w[i] !== '-') {
    const a = w[i++];
    if (a === '--') break;
    if (a.startsWith('--')) continue;
    for (let j = 1; j < a.length; j++) {
      if (optAttached.includes(a[j])) break;
      if (withArg.includes(a[j])) { if (j === a.length - 1) i++; break; }
    }
  }
  return w.slice(i);
}
function skipEnv(w) {
  let i = 0;
  while (i < w.length) {
    const a = w[i];
    if (a === '--') { i++; break; }
    if (a === '-' || a === '-i' || a === '-0' || a === '-v' || a === '--ignore-environment' || a === '--null' || a === '--debug') { i++; continue; }
    if (a === '-u' || a === '-C' || a === '--unset' || a === '--chdir') { i += 2; continue; }
    if (a === '-S' || a === '--split-string') return [...splitWords(w[i + 1] ?? ''), ...w.slice(i + 2)];
    if (a.startsWith('-S')) return [...splitWords(a.slice(2)), ...w.slice(i + 1)];
    if (a.startsWith('--split-string=')) return [...splitWords(a.slice(15)), ...w.slice(i + 1)];
    if (a.startsWith('-')) { i++; continue; }
    break;
  }
  return w.slice(i);
}
const splitWords = (s) => lex(s).commands.flatMap((c) => c.words);
const baseName = (w) => w.split('/').pop().replace(/\.exe$/i, '');

function normalize(words) {
  let w = words.slice();
  const env = {};
  let viaXargs = false;
  for (let guard = 0; guard < 64; guard++) {
    while (w.length && RESERVED.has(w[0])) w.shift();
    while (w.length && ASSIGN.test(w[0])) { const k = w[0].indexOf('='); env[w[0].slice(0, k)] = w[0].slice(k + 1); w.shift(); }
    if (!w.length) return null;
    const name = baseName(w[0]);
    const rest = w.slice(1);
    switch (name) {
      case 'env': w = skipEnv(rest); continue;
      case 'command': case 'builtin': w = skipFlags(rest); continue;
      case 'exec': w = skipFlags(rest, 'a'); continue;
      case 'nohup': case 'chronic': case 'unbuffer': w = rest; continue;
      case 'time': w = skipFlags(rest, 'fo'); continue;
      case 'sudo': w = skipFlags(rest, 'ugCDhprtUT'); continue;
      case 'doas': w = skipFlags(rest, 'uC'); continue;
      case 'nice': w = skipFlags(rest, 'n'); continue;
      case 'ionice': w = skipFlags(rest, 'cnpP'); continue;
      case 'stdbuf': w = skipFlags(rest, 'ioe'); continue;
      case 'timeout': w = skipFlags(rest, 'sk').slice(1); continue;
      case 'xargs': viaXargs = true; w = skipFlags(rest, 'adEILnPs', 'eil'); continue;
      case 'npx': case 'bunx': w = skipFlags(rest, 'p'); continue;
      case 'pnpm': case 'npm': case 'yarn': case 'bun': {
        const k = rest.findIndex((x) => x === 'exec' || x === 'dlx' || x === 'x');
        if (k >= 0) { w = skipFlags(rest.slice(k + 1)); continue; }
        return { name, args: rest, env, viaXargs };
      }
      default:
        return { name, args: rest, env, viaXargs };
    }
  }
  throw new CannotCheck('too many command wrappers');
}

// ---------- rules ----------
const block = (reason) => ({ reason });

function isAncestorOrSelf(p, of) {
  if (p === of) return true;
  return of.startsWith(p.endsWith('/') ? p : p + '/');
}
function dangerousTarget(t, ctx) {
  if (!t) return false;
  let s = t.length > 1 ? t.replace(/\/+$/, '') || '/' : t;
  while (s === '*' || s.endsWith('/*')) { if (s === '*') return true; s = s.slice(0, -2) || '/'; }
  if (s === '.*' || s.endsWith('/.*')) return true;
  if (s === '.git' || s.endsWith('/.git')) return true;
  let p = s;
  if (p === '~' || p.startsWith('~/')) p = ctx.home + p.slice(1);
  else { const m = /^\$(\{HOME\}|HOME)(?=\/|$)/.exec(p); if (m) p = ctx.home + p.slice(m[0].length); }
  if (p === '.' || p === '..') return true;
  if (/[$*?[`]/.test(p)) return false; // unknown expansion: cannot tell, allow
  const abs = path.resolve(ctx.cwd, p);
  return [ctx.cwd, ctx.projectDir, ctx.home, '/'].filter(Boolean).some((r) => isAncestorOrSelf(abs, path.resolve(r)));
}

function checkRm(args, ctx) {
  const o = scanOpts(args);
  const recursive = hasShort(o, 'rR') || hasLong(o, 'recursive', 1);
  if (!recursive) return null;
  const t = o.pos.find((x) => dangerousTarget(x, ctx));
  return t === undefined ? null : block(`recursive rm of '${t}' (the repository, its .git, home or /)`);
}
function checkFind(args, ctx) {
  if (!args.includes('-delete')) return null;
  const a = skipFlags(args, 'D', 'O');
  const paths = [];
  for (const x of a) { if (x.startsWith('-') || x === '(' || x === '!' || x === ')' || x === ',') break; paths.push(x); }
  if (!paths.length) paths.push('.');
  const t = paths.find((x) => dangerousTarget(x, ctx));
  return t === undefined ? null : block(`find ${t} -delete`);
}

const WHOLE_TREE = new Set(['.', './', ':/', ':/.', ':(top)', '*', './*', '..', '../']);
const isWholeTree = (p) => WHOLE_TREE.has(p);
const isProtectedRef = (r) => ['main', 'master'].includes(r.replace(/^refs\/heads\//, '').replace(/^heads\//, '').toLowerCase());

function checkPush(args, env) {
  const o = scanOpts(args, { argShort: 'o', argLong: ['repo', 'push-option', 'receive-pack', 'exec'] });
  if (hasShort(o, 'fF') || ['force', 'force-with-lease', 'force-if-includes'].some((t) => hasLong(o, t, 1)))
    return block('force push (git push --force / -f / --force-with-lease / --force-if-includes)');
  if (hasLong(o, 'mirror', 2)) return block('git push --mirror (force-updates and deletes remote refs)');
  if (hasShort(o, 'd') || hasLong(o, 'delete', 2)) return block('git push --delete (deletes a remote branch)');
  if (hasLong(o, 'prune', 2)) return block('git push --prune (deletes remote branches)');
  if (hasLong(o, 'all', 2) || hasLong(o, 'branches', 2)) return block('git push --all (would push main)');
  if (hasLong(o, 'no-verify', 4)) return block('git push --no-verify (skips hooks)');
  if (env.HUSKY === '0') return block('HUSKY=0 git push (skips hooks)');
  for (const spec of o.pos.slice(1)) {
    if (spec.startsWith('+')) return block(`force push via +refspec '${spec}'`);
    const k = spec.indexOf(':');
    const src = k < 0 ? spec : spec.slice(0, k);
    const dst = k < 0 ? spec : spec.slice(k + 1);
    if (k >= 0 && src === '') return block(`git push '${spec}' (empty source deletes a remote ref)`);
    if (isProtectedRef(dst) || dst.includes('*')) return block(`push to main/master ('${spec}'): only git push origin <claude/* branch> is allowed`);
  }
  return null;
}

function checkConfig(args, ctx, depth) {
  const o = scanOpts(args, { argShort: 'f', argLong: ['file', 'blob', 'type', 'default', 'comment', 'value'] });
  const pos = o.pos.slice();
  const SUBS = ['set', 'unset', 'get', 'list', 'rename-section', 'remove-section', 'edit'];
  const sub = SUBS.includes(pos[0]) ? pos.shift() : null;
  const read = sub === 'get' || sub === 'list' || o.shorts.has('l') ||
    o.longs.some((l) => ['get', 'get-all', 'get-regexp', 'get-urlmatch', 'get-color', 'get-colorbool', 'list'].includes(l.name));
  const writeFlag = ['set', 'unset', 'rename-section', 'remove-section'].includes(sub) ||
    o.longs.some((l) => ['unset', 'unset-all', 'add', 'replace-all', 'rename-section', 'remove-section'].includes(l.name));
  const [key = '', value] = pos;
  const write = writeFlag || (!read && value !== undefined);
  if (!write) return null;
  const k = key.toLowerCase();
  if (k === 'core.hookspath' || (k === 'core' && o.longs.some((l) => l.name.endsWith('-section'))))
    return block('changing core.hooksPath (disables git hooks)');
  if (k.startsWith('alias.') && value !== undefined) return checkAlias(key, value, ctx, depth);
  return null;
}
function checkAlias(key, value, ctx, depth) {
  const r = analyze(value.startsWith('!') ? value.slice(1) : 'git ' + value, ctx, depth + 1);
  return r ? block(`git alias '${key}' that runs a blocked command: ${r.reason}`) : null;
}

const XARGS_DANGER = new Set(['push', 'reset', 'clean', 'branch', 'checkout', 'switch', 'restore', 'stash', 'tag', 'update-ref', 'config', 'rebase', 'commit', 'filter-branch', 'filter-repo']);

function checkGit(n, ctx, depth) {
  const a = n.args;
  let i = 0;
  const cfg = [];
  while (i < a.length) {
    const x = a[i];
    if (x === '-c') { cfg.push(a[i + 1] ?? ''); i += 2; continue; }
    if (x === '--config-env') { cfg.push(a[i + 1] ?? ''); i += 2; continue; }
    if (x.startsWith('--config-env=')) { cfg.push(x.slice(13)); i++; continue; }
    if (['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--attr-source', '--list-cmds'].includes(x)) { i += 2; continue; }
    if (x.startsWith('-')) { i++; continue; }
    break;
  }
  for (const kv of cfg) {
    const eq = kv.indexOf('=');
    const key = (eq < 0 ? kv : kv.slice(0, eq)).toLowerCase();
    if (key === 'core.hookspath') return block('git -c core.hooksPath=… (disables git hooks)');
    if (key.startsWith('alias.') && eq >= 0) { const r = checkAlias(key, kv.slice(eq + 1), ctx, depth); if (r) return r; }
  }
  const sub = a[i];
  const rest = a.slice(i + 1);
  if (n.viaXargs && (sub === undefined || XARGS_DANGER.has(sub)))
    return block(`git ${sub ?? ''} under xargs (its arguments come from stdin and cannot be checked)`);
  if (n.env.HUSKY === '0' && ['commit', 'push', 'merge'].includes(sub)) return block(`HUSKY=0 git ${sub} (skips hooks)`);
  switch (sub) {
    case 'push': return checkPush(rest, n.env);
    case 'commit': {
      const o = scanOpts(rest, { argShort: 'mFcCt', optShort: 'uS', argLong: ['message', 'file', 'reuse-message', 'reedit-message', 'fixup', 'squash', 'author', 'date', 'template', 'cleanup', 'trailer', 'pathspec-from-file'] });
      if (o.shorts.has('n') || hasLong(o, 'no-verify', 4)) return block('git commit --no-verify / -n (skips hooks)');
      return null;
    }
    case 'merge': {
      const o = scanOpts(rest, { argShort: 'mFsX', argLong: ['message', 'file', 'strategy', 'strategy-option', 'into-name'] });
      return hasLong(o, 'no-verify', 4) ? block('git merge --no-verify (skips hooks)') : null;
    }
    case 'reset': {
      const o = scanOpts(rest, { argLong: ['pathspec-from-file'] });
      if (hasLong(o, 'hard', 2) || hasLong(o, 'merge', 2) || hasLong(o, 'keep', 1)) return block('git reset --hard / --merge / --keep (discards uncommitted work)');
      return null;
    }
    case 'clean': {
      const o = scanOpts(rest, { argShort: 'e', argLong: ['exclude'] });
      return hasShort(o, 'f') || hasLong(o, 'force', 1) ? block('git clean -f (deletes untracked files)') : null;
    }
    case 'branch': {
      const o = scanOpts(rest, { argShort: 'u', argLong: ['set-upstream-to', 'contains', 'no-contains', 'merged', 'no-merged', 'points-at', 'format', 'sort'] });
      const del = hasShort(o, 'd') || hasLong(o, 'delete', 2);
      const force = hasShort(o, 'f') || hasLong(o, 'force', 4);
      return o.shorts.has('D') || (del && force) ? block('git branch -D / --delete --force (deletes an unmerged branch)') : null;
    }
    case 'checkout': {
      const o = scanOpts(rest, { argShort: 'bB', argLong: ['orphan', 'pathspec-from-file'] });
      if (hasShort(o, 'f') || hasLong(o, 'force', 2)) return block('git checkout -f (discards local changes)');
      return o.pos.some(isWholeTree) ? block('git checkout . (discards all local changes)') : null;
    }
    case 'switch': {
      const o = scanOpts(rest, { argShort: 'cC', argLong: ['create', 'force-create', 'orphan'] });
      return hasShort(o, 'f') || hasLong(o, 'force', 2) || hasLong(o, 'discard-changes', 2) ? block('git switch -f / --discard-changes (discards local changes)') : null;
    }
    case 'restore': {
      const o = scanOpts(rest, { argShort: 's', argLong: ['source', 'pathspec-from-file'] });
      return o.pos.some(isWholeTree) ? block('git restore . (discards all local changes)') : null;
    }
    case 'stash': {
      const o = scanOpts(rest, { argShort: 'm', argLong: ['message', 'pathspec-from-file'] });
      return ['drop', 'clear'].includes(o.pos[0]) ? block(`git stash ${o.pos[0]} (destroys stashed work; the stash stack is shared by all worktrees)`) : null;
    }
    case 'tag': {
      const o = scanOpts(rest, { argShort: 'mFu', argLong: ['message', 'file', 'local-user', 'cleanup', 'sort', 'contains', 'no-contains', 'points-at', 'format', 'merged', 'no-merged'] });
      return hasShort(o, 'd') || hasLong(o, 'delete', 2) ? block('git tag -d (deletes a tag)') : null;
    }
    case 'update-ref': {
      const o = scanOpts(rest, { argShort: 'm' });
      return o.shorts.has('d') ? block('git update-ref -d (deletes a ref)') : null;
    }
    case 'filter-branch': case 'filter-repo': return block(`git ${sub} (rewrites history)`);
    case 'rebase': {
      const o = scanOpts(rest);
      return hasLong(o, 'abort', 2) || hasLong(o, 'quit', 1) ? null : block('git rebase (rewrites history)');
    }
    case 'config': return checkConfig(rest, ctx, depth);
    default: return null; // includes aliases: not resolved (see ADR 0008)
  }
}

function checkShell(n, c, ctx, depth) {
  const a = n.name === 'busybox' ? n.args.slice(1) : n.args;
  if (n.name === 'busybox' && !SHELLS.has(n.args[0] ?? '')) return null;
  let cmode = false, i = 0;
  for (; i < a.length; i++) {
    const x = a[i];
    if (x === '--' || x === '-') { i++; break; }
    if (x.startsWith('--')) { if (x === '--rcfile' || x === '--init-file') i++; if (x === '--command') cmode = true; continue; }
    if (x[0] === '-' || x[0] === '+') { if (x[0] === '-' && x.includes('c')) cmode = true; if (/[oO]$/.test(x)) i++; continue; }
    break;
  }
  if (cmode) return a[i] === undefined ? null : analyze(a[i], ctx, depth + 1);
  if (a[i] !== undefined) return null; // a script file: not inspected (see ADR 0008)
  const stdin = [...c.heredocs, ...c.herestrings];
  for (const s of stdin) { const r = analyze(s, ctx, depth + 1); if (r) return r; }
  if (!stdin.length && c.piped) return block(`piping commands into ${n.name} (cannot be checked)`);
  return null;
}

function checkCommand(c, ctx, depth) {
  const n = normalize(c.words);
  if (!n) return null;
  if (n.name === 'git') return checkGit(n, ctx, depth);
  if (SHELLS.has(n.name)) return checkShell(n, c, ctx, depth);
  if (n.name === 'eval') return analyze(n.args.join(' '), ctx, depth + 1);
  if (n.name === 'rm') return checkRm(n.args, ctx);
  if (n.name === 'find') return checkFind(n.args, ctx);
  return null;
}

function analyze(src, ctx, depth) {
  if (depth > MAX_DEPTH) throw new CannotCheck('command nesting is too deep');
  const { commands, subs } = lex(src);
  for (const s of subs) { const r = analyze(s, ctx, depth + 1); if (r) return r; }
  for (const c of commands) {
    const r = checkCommand(c, ctx, depth);
    if (r) return { reason: r.reason, where: r.where ?? c.words.join(' ') };
  }
  return null;
}

// ---------- main ----------
let raw;
try { raw = readFileSync(0, 'utf8'); } catch { failClosed('could not read the hook input'); }
if (!raw.trim()) failClosed('empty hook input');
let input;
try { input = JSON.parse(raw); } catch { failClosed('hook input is not valid JSON'); }
const command = input?.tool_input?.command;
if (typeof command !== 'string') failClosed('hook input has no tool_input.command string');
const ctx = {
  cwd: typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd(),
  projectDir: process.env.CLAUDE_PROJECT_DIR || '',
  home: process.env.HOME || os.homedir(),
};
let verdict;
try { verdict = analyze(command, ctx, 0); } catch (e) { failClosed(e instanceof CannotCheck ? e.message : `internal error: ${e?.message ?? e}`); }
if (verdict) {
  const where = verdict.where.length > 200 ? verdict.where.slice(0, 200) + '…' : verdict.where;
  out(`BLOCKED by the guardrail hook: ${verdict.reason}.\nIn: ${where}\nYou do not have authority to run this. Do not retry, rephrase or work around it: ask the user; they can run it themselves.`);
  process.exit(2);
}
process.exit(0);
