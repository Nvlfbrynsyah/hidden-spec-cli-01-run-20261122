import { Exit2, Fail, safe } from './types.ts';
import type { Edit, Tree } from './types.ts';
import { findMatch, reindent } from './match.ts';

const SEARCH = '<<<<<<< SEARCH';
const DIVIDER = '=======';
const REPLACE = '>>>>>>> REPLACE';

const trimEnd = (s: string): string => s.replace(/[ \t]+$/, '');
const trimWs = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const blank = (s: string): boolean => trimWs(s) === '';

interface Block {
  path: string | null;
  searchLine: number;
  oldLines: string[];
  newLines: string[];
}

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

export function parseSearchReplace(lines: string[], strict: boolean): Edit[] {
  const blocks: Block[] = [];
  let prev = 0;
  let i = 0;
  while (i < lines.length) {
    if (trimEnd(lines[i]!) !== SEARCH) {
      i++;
      continue;
    }
    const searchLine = i + 1;
    const searchIndex = i;
    let path: string | null = null;
    for (let j = searchIndex - 1; j >= prev; j--) {
      const l = lines[j]!;
      if (blank(l)) continue;
      if (trimWs(l).startsWith('```')) continue;
      path = trimWs(l);
      break;
    }
    i++;
    const oldLines: string[] = [];
    let divider = -1;
    while (i < lines.length) {
      const m = trimEnd(lines[i]!);
      if (m === DIVIDER) {
        divider = i;
        i++;
        break;
      }
      if (m === REPLACE) throw new Exit2(`error: parse ${searchLine}`);
      oldLines.push(lines[i]!);
      i++;
    }
    const newLines: string[] = [];
    let replace = -1;
    if (divider >= 0) {
      while (i < lines.length) {
        const m = trimEnd(lines[i]!);
        if (m === REPLACE) {
          replace = i;
          i++;
          break;
        }
        newLines.push(lines[i]!);
        i++;
      }
    }
    blocks.push({ path, searchLine, oldLines, newLines });
    if (divider >= 0 && replace >= 0) prev = replace + 1;
  }
  if (blocks.length === 0) throw new Exit2('error: parse 1');
  for (const b of blocks) if (b.path === null) throw new Exit2(`error: parse ${b.searchLine}`);
  return blocks.map((b) => (tree: Tree) => applyBlock(tree, b, strict));
}

function applyBlock(tree: Tree, block: Block, strict: boolean): void {
  const path = block.path!;
  if (!safe(path)) throw new Fail('unsafe', path);
  if (block.oldLines.length === 0) {
    if (tree.get(path) !== null) throw new Fail('exists', path);
    tree.now.set(path, block.newLines.length === 0 ? '' : block.newLines.join('\n') + '\n');
    return;
  }
  const text = tree.get(path);
  if (text === null) throw new Fail('missing', path);
  const f = splitContent(text);
  const found = findMatch(f.lines, block.oldLines, strict);
  if (found === null) throw new Fail('no-match', path);
  if (found.positions.length !== 1) throw new Fail('ambiguous', path);
  const at = found.positions[0]!;
  const newLines = reindent(f.lines, block.oldLines, block.newLines, at, found.tier);
  const result = [...f.lines.slice(0, at), ...newLines, ...f.lines.slice(at + block.oldLines.length)];
  tree.now.set(path, result.length === 0 ? '' : result.join(f.brk) + (f.finalBreak ? f.brk : ''));
}
