import { Exit2, Fail, safe } from './types.ts';
import type { Edit, Tree } from './types.ts';
import { matchesTier, reindent } from './match.ts';

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const ADD = '*** Add File: ';
const DELETE = '*** Delete File: ';
const UPDATE = '*** Update File: ';
const MOVE = '*** Move to: ';
const EOF = '*** End of File';

const trimWs = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const blank = (s: string): boolean => trimWs(s) === '';

interface BodyLine {
  kind: 'ctx' | 'old' | 'new';
  text: string;
}

interface Chunk {
  anchor: string | null;
  eof: boolean;
  lines: BodyLine[];
}

type Section =
  | { kind: 'add'; path: string; fileLines: string[] }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo: string | null; chunks: Chunk[] };

function splitContent(text: string): { lines: string[]; finalBreak: boolean; brk: string } {
  if (text === '') return { lines: [], finalBreak: false, brk: '\n' };
  const nl = text.indexOf('\n');
  const brk = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(brk);
  let finalBreak = false;
  if (parts[parts.length - 1] === '') {
    parts.pop();
    finalBreak = true;
  }
  return { lines: parts, finalBreak, brk };
}

function startsSection(l: string): boolean {
  return l.startsWith(ADD) || l.startsWith(DELETE) || l.startsWith(UPDATE);
}

function parseBody(l: string): BodyLine | null {
  const c = l[0];
  if (c === ' ') return { kind: 'ctx', text: l.slice(1) };
  if (c === '-') return { kind: 'old', text: l.slice(1) };
  if (c === '+') return { kind: 'new', text: l.slice(1) };
  return null;
}

function parseSections(lines: string[], from: number, to: number): Section[] {
  const sections: Section[] = [];
  let i = from;
  while (i < to) {
    if (blank(lines[i]!)) {
      i++;
      continue;
    }
    const line = lines[i]!;
    if (line.startsWith(ADD)) {
      const path = trimWs(line.slice(ADD.length));
      i++;
      const fileLines: string[] = [];
      while (i < to) {
        const l = lines[i]!;
        if (l === '') {
          fileLines.push('');
          i++;
          continue;
        }
        if (startsSection(l)) break;
        if (!l.startsWith('+')) throw new Exit2(`error: parse ${i + 1}`);
        fileLines.push(l.slice(1));
        i++;
      }
      sections.push({ kind: 'add', path, fileLines });
      continue;
    }
    if (line.startsWith(DELETE)) {
      const path = trimWs(line.slice(DELETE.length));
      i++;
      while (i < to && blank(lines[i]!)) i++;
      if (i < to && !startsSection(lines[i]!)) throw new Exit2(`error: parse ${i + 1}`);
      sections.push({ kind: 'delete', path });
      continue;
    }
    if (line.startsWith(UPDATE)) {
      const path = trimWs(line.slice(UPDATE.length));
      i++;
      let moveTo: string | null = null;
      if (i < to && !blank(lines[i]!) && lines[i]!.startsWith(MOVE)) {
        moveTo = trimWs(lines[i]!.slice(MOVE.length));
        i++;
      }
      const chunks: Chunk[] = [];
      let inChunk = false;
      while (i < to && !startsSection(lines[i]!)) {
        const l = lines[i]!;
        if (blank(l)) {
          if (!inChunk) {
            i++;
            continue;
          }
          chunks[chunks.length - 1]!.lines.push({ kind: 'ctx', text: '' });
          i++;
          continue;
        }
        inChunk = true;
        if (l === EOF) {
          i++;
          if (chunks.length > 0) chunks[chunks.length - 1]!.eof = true;
          continue;
        }
        if (l.startsWith('@@')) {
          const anchor = trimWs(l.slice(2));
          chunks.push({ anchor: anchor === '' ? null : anchor, eof: false, lines: [] });
          i++;
          continue;
        }
        const body = parseBody(l);
        if (body !== null) {
          if (chunks.length === 0) chunks.push({ anchor: null, eof: false, lines: [] });
          chunks[chunks.length - 1]!.lines.push(body);
          i++;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
      for (const c of chunks) {
        while (c.lines.length > 0 && c.lines[c.lines.length - 1]!.kind === 'ctx' && c.lines[c.lines.length - 1]!.text === '') c.lines.pop();
      }
      if (moveTo === null && chunks.length === 0) throw new Exit2(`error: parse ${i + 1}`);
      sections.push({ kind: 'update', path, moveTo, chunks });
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  return sections;
}

export function parseV4A(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (trimWs(lines[first]!) !== BEGIN) throw new Exit2(`error: parse ${first + 1}`);
  let last = lines.length - 1;
  while (last >= 0 && blank(lines[last]!)) last--;
  if (last < 0 || trimWs(lines[last]!) !== END) {
    throw new Exit2(`error: parse ${lines.length + 1}`);
  }
  const sections = parseSections(lines, first + 1, last);
  return sections.map((s) => (tree: Tree) => applySection(tree, s, strict));
}

function applySection(tree: Tree, sec: Section, strict: boolean): void {
  if (!safe(sec.path)) throw new Fail('unsafe', sec.path);
  if (sec.kind === 'add') {
    if (tree.get(sec.path) !== null) throw new Fail('exists', sec.path);
    tree.now.set(sec.path, sec.fileLines.length === 0 ? '' : sec.fileLines.join('\n') + '\n');
    return;
  }
  if (sec.kind === 'delete') {
    if (tree.get(sec.path) === null) throw new Fail('missing', sec.path);
    tree.now.set(sec.path, null);
    return;
  }
  if (sec.moveTo !== null) {
    if (!safe(sec.moveTo)) throw new Fail('unsafe', sec.moveTo);
    if (tree.get(sec.moveTo) !== null) throw new Fail('exists', sec.moveTo);
  }
  const text = tree.get(sec.path);
  if (text === null) throw new Fail('missing', sec.path);
  const f = splitContent(text);
  const result = applyChunks(f.lines, sec.chunks, strict, sec.path);
  const out = result.length === 0 ? '' : result.join(f.brk) + (f.finalBreak ? f.brk : '');
  if (sec.moveTo !== null && sec.moveTo !== sec.path) {
    tree.now.set(sec.path, null);
    tree.now.set(sec.moveTo, out);
    tree.moves.push([sec.path, sec.moveTo]);
  } else {
    tree.now.set(sec.path, out);
  }
}

function applyChunks(fileLines: string[], chunks: Chunk[], strict: boolean, path: string): string[] {
  const current = fileLines.slice();
  const tiers = strict ? [0] : [0, 1, 2];
  const cursor = { at: 0 };
  for (const chunk of chunks) {
    if (chunk.anchor !== null) {
      let at = -1;
      for (const t of tiers) {
        for (let i = cursor.at; i < current.length; i++) {
          if (matchesTier([current[i]!], [chunk.anchor], t)) {
            at = i;
            break;
          }
        }
        if (at >= 0) break;
      }
      if (at < 0) throw new Fail('no-match', path);
      cursor.at = at + 1;
    }
    const o = chunk.lines.filter((l) => l.kind !== 'new').map((l) => l.text);
    const n = chunk.lines.filter((l) => l.kind !== 'old').map((l) => l.text);
    if (o.length === 0) {
      if (chunk.eof) cursor.at = current.length;
      current.splice(cursor.at, 0, ...n);
      cursor.at += n.length;
      continue;
    }
    let found = -1;
    let foundTier = 0;
    for (const t of tiers) {
      for (let i = cursor.at; i + o.length <= current.length; i++) {
        if (!matchesTier(current.slice(i, i + o.length), o, t)) continue;
        if (chunk.eof && i + o.length !== current.length) continue;
        found = i;
        foundTier = t;
        break;
      }
      if (found >= 0) break;
    }
    if (found < 0) throw new Fail('no-match', path);
    const reind = reindent(current, o, n, found, foundTier);
    const written: string[] = [];
    let oPos = 0;
    let nPos = 0;
    for (const bl of chunk.lines) {
      if (bl.kind === 'ctx') {
        written.push(current[found + oPos]!);
        oPos++;
        nPos++;
      } else if (bl.kind === 'old') {
        oPos++;
      } else {
        written.push(reind[nPos]!);
        nPos++;
      }
    }
    current.splice(found, o.length, ...written);
    cursor.at = found + written.length;
  }
  return current;
}
