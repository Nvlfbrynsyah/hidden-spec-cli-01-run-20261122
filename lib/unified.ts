import { Exit2, Fail, safe, Tree } from './types.ts';
import type { Edit } from './types.ts';
import { findMatch, reindent } from './match.ts';

interface Entry {
  kind: 'ctx' | 'old' | 'new';
  text: string;
  backslashAfter: boolean;
}

interface Hunk {
  a: number;
  entries: Entry[];
  lastCtxNewBackslash: boolean;
}

interface Section {
  diffOld: string | null;
  diffNew: string | null;
  dash: string | null;
  plus: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  create: boolean;
  deleted: boolean;
  hunks: Hunk[];
}

const hunkRe = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const diffRe = /^diff --git a\/(\S+) b\/(\S+)\s*$/;

const trimWs = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

function headerPath(line: string): string | null {
  let p = line.slice(4);
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = trimWs(p);
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function blankSection(diffOld: string | null, diffNew: string | null): Section {
  return {
    diffOld,
    diffNew,
    dash: null,
    plus: null,
    renameFrom: null,
    renameTo: null,
    create: false,
    deleted: false,
    hunks: [],
  };
}

function parseSection(lines: string[], i: number, sec: Section): number {
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) break;
    if (line.startsWith('@@')) {
      const m = hunkRe.exec(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      const a = parseInt(m[1]!, 10);
      i++;
      let j = i;
      while (j < lines.length) {
        const b = lines[j]!;
        if (b.startsWith('diff --git ')) break;
        if (b.startsWith('--- ') && j + 1 < lines.length && lines[j + 1]!.startsWith('+++ ')) break;
        if (b === '' || b[0] === ' ' || b[0] === '-' || b[0] === '+' || b[0] === '\\') {
          j++;
          continue;
        }
        break;
      }
      while (j > i && lines[j - 1] === '') j--;
      const entries: Entry[] = [];
      for (let k = i; k < j; k++) {
        const b = lines[k]!;
        if (b === '') entries.push({ kind: 'ctx', text: '', backslashAfter: false });
        else if (b[0] === '\\') {
          if (entries.length > 0) entries[entries.length - 1]!.backslashAfter = true;
        } else {
          entries.push({ kind: b[0] === ' ' ? 'ctx' : b[0] === '-' ? 'old' : 'new', text: b.slice(1), backslashAfter: false });
        }
      }
      let lastCtxNewBackslash = false;
      for (let k = entries.length - 1; k >= 0; k--) {
        const e = entries[k]!;
        if (e.kind !== 'old') {
          lastCtxNewBackslash = e.backslashAfter;
          break;
        }
      }
      sec.hunks.push({ a, entries, lastCtxNewBackslash });
      i = j;
      continue;
    }
    if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ')) {
      if (sec.hunks.length === 0 && sec.dash === null && sec.plus === null) {
        sec.dash = headerPath(line);
        sec.plus = headerPath(lines[i + 1]!);
        i += 2;
        continue;
      }
      break;
    }
    if (sec.hunks.length === 0) {
      if (line.startsWith('--- ')) throw new Exit2(`error: parse ${i + 2}`);
      if (line === 'rename from' || line.startsWith('rename from ')) {
        sec.renameFrom = trimWs(line.slice(12));
        i++;
        continue;
      }
      if (line === 'rename to' || line.startsWith('rename to ')) {
        sec.renameTo = trimWs(line.slice(10));
        i++;
        continue;
      }
      if (line === 'new file mode' || line.startsWith('new file mode ')) {
        sec.create = true;
        i++;
        continue;
      }
      if (line === 'deleted file mode' || line.startsWith('deleted file mode ')) {
        sec.deleted = true;
        i++;
        continue;
      }
    }
    i++;
  }
  return i;
}

export function parseUnified(lines: string[], strict: boolean): Edit[] {
  const sections: Section[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const m = diffRe.exec(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      sections.push(blankSection(m[1]!, m[2]!));
      i = parseSection(lines, i + 1, sections[sections.length - 1]!);
    } else if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ')) {
      const sec = blankSection(null, null);
      sec.dash = headerPath(line);
      sec.plus = headerPath(lines[i + 1]!);
      sections.push(sec);
      i = parseSection(lines, i + 2, sec);
    } else if (line.startsWith('@@')) {
      throw new Exit2(`error: parse ${i + 1}`);
    } else {
      i++;
    }
  }
  return sections.map((sec) => (tree: Tree) => {
    applySection(tree, sec, strict);
  });
}

function splitContent(text: string): { lines: string[]; finalBreak: boolean; brk: string } {
  if (text === '') return { lines: [], finalBreak: false, brk: '\n' };
  const idx = text.indexOf('\n');
  const brk = idx > 0 && text[idx - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(brk);
  let finalBreak = false;
  if (parts[parts.length - 1] === '') {
    parts.pop();
    finalBreak = true;
  }
  return { lines: parts, finalBreak, brk };
}

function joinContent(lines: string[], finalBreak: boolean, brk: string): string {
  if (lines.length === 0) return '';
  return lines.join(brk) + (finalBreak ? brk : '');
}

function createContent(sec: Section): string {
  const plus: string[] = [];
  let lastBackslash = false;
  for (const h of sec.hunks) {
    for (const e of h.entries) {
      if (e.kind === 'new') {
        plus.push(e.text);
        lastBackslash = e.backslashAfter;
      }
    }
  }
  if (plus.length === 0) return '';
  return plus.join('\n') + (lastBackslash ? '' : '\n');
}

function applyHunks(
  fileLines: string[],
  hunks: Hunk[],
  strict: boolean,
  path: string,
  finalBreak0: boolean
): { lines: string[]; finalBreak: boolean } {
  const current = fileLines.slice();
  let finalBreak = finalBreak0;
  let d = 0;
  for (const h of hunks) {
    const oEntries = h.entries.filter((e) => e.kind !== 'new');
    const nEntries = h.entries.filter((e) => e.kind !== 'old');
    const oTexts = oEntries.map((e) => e.text);
    const nTexts = nEntries.map((e) => e.text);
    let ranToEnd = false;
    if (oTexts.length > 0) {
      const found = findMatch(current, oTexts, strict);
      if (found === null) throw new Fail('no-match', path);
      const target = h.a - 1 + d;
      let mi = found.positions[0]!;
      for (const p of found.positions) {
        if (Math.abs(p - target) < Math.abs(mi - target)) mi = p;
      }
      ranToEnd = mi + oTexts.length === current.length;
      const plusTexts = nEntries.filter((e) => e.kind === 'new').map((e) => e.text);
      const plusWritten = reindent(current, oTexts, plusTexts, mi, found.tier);
      const written: string[] = [];
      let oPos = 0;
      let pPos = 0;
      for (const e of h.entries) {
        if (e.kind === 'ctx') {
          written.push(current[mi + oPos]!);
          oPos++;
        } else if (e.kind === 'old') {
          oPos++;
        } else {
          written.push(plusWritten[pPos]!);
          pPos++;
        }
      }
      current.splice(mi, oTexts.length, ...written);
    } else {
      const at = Math.min(h.a + d, current.length);
      ranToEnd = at === current.length;
      current.splice(at, 0, ...nTexts);
    }
    if (ranToEnd) finalBreak = !h.lastCtxNewBackslash;
    d += nTexts.length - oTexts.length;
  }
  return { lines: current, finalBreak };
}

function applySection(tree: Tree, sec: Section, strict: boolean): void {
  const old = sec.dash ?? sec.renameFrom ?? sec.diffOld;
  const neu = sec.plus ?? sec.renameTo ?? sec.diffNew;
  if (old !== null && !safe(old)) throw new Fail('unsafe', old);
  if (neu !== null && !safe(neu)) throw new Fail('unsafe', neu);
  if (old === null || sec.create) {
    if (neu === null) throw new Fail('missing', '');
    if (tree.get(neu) !== null) throw new Fail('exists', neu);
    tree.now.set(neu, createContent(sec));
    return;
  }
  if (neu === null || sec.deleted) {
    if (tree.get(old) === null) throw new Fail('missing', old);
    tree.now.set(old, null);
    return;
  }
  const text = tree.get(old);
  if (old !== neu) {
    if (text === null) throw new Fail('missing', old);
    if (tree.get(neu) !== null) throw new Fail('exists', neu);
    const f = splitContent(text);
    const r = applyHunks(f.lines, sec.hunks, strict, old, f.finalBreak);
    tree.now.set(old, null);
    tree.now.set(neu, joinContent(r.lines, r.finalBreak, f.brk));
    tree.moves.push([old, neu]);
    return;
  }
  if (text === null) throw new Fail('missing', old);
  const f = splitContent(text);
  const r = applyHunks(f.lines, sec.hunks, strict, old, f.finalBreak);
  tree.now.set(old, joinContent(r.lines, r.finalBreak, f.brk));
}
