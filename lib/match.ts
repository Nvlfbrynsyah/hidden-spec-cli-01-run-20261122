
export function findMatch(
  fileLines: string[],
  oldLines: string[],
  strict: boolean
): { positions: number[]; tier: number } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const matches: number[] = [];
    for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
      if (matchesTier(fileLines.slice(i, i + oldLines.length), oldLines, tier)) {
        matches.push(i);
      }
    }
    if (matches.length > 0) return { positions: matches, tier };
  }
  return null;
}

export function findOccurrences(
  fileLines: string[],
  oldLines: string[],
  strict: boolean
): number[] {
  const tiers = strict ? [0] : [0, 1, 2];
  
  for (const tier of tiers) {
    const matches: number[] = [];
    for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
      if (matchesTier(fileLines.slice(i, i + oldLines.length), oldLines, tier)) {
        matches.push(i);
      }
    }
    if (matches.length > 0) return matches;
  }
  return [];
}

const strip = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

export function matchesTier(fileLines: string[], oldLines: string[], tier: number): boolean {
  if (fileLines.length !== oldLines.length) return false;
  for (let i = 0; i < fileLines.length; i++) {
    const f = fileLines[i];
    const o = oldLines[i];
    if (tier === 0) {
      if (f !== o) return false;
    } else if (tier === 1) {
      if (f.replace(/[ \t]+$/, '') !== o.replace(/[ \t]+$/, '')) return false;
    } else if (tier === 2) {
      if (strip(f) !== strip(o)) return false;
    }
  }
  return true;
}

export function reindent(
  fileLines: string[],
  oldLines: string[],
  newLines: string[],
  matchIndex: number,
  tier: number
): string[] {
  if (tier !== 2) return newLines;
  
  const F = (fileLines[matchIndex] ?? '').match(/^[ \t]*/)?.[0] ?? '';
  const P = (oldLines[0] ?? '').match(/^[ \t]*/)?.[0] ?? '';
  
  if (F === P) return newLines;
  
  return newLines.map(line => {
    if (line.trim().length === 0) return line;
    if (line.startsWith(P)) {
      return F + line.slice(P.length);
    }
    return line;
  });
}
