[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/Nvlfbrynsyah/hidden-spec-cli-01-run-20261122/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/Nvlfbrynsyah/hidden-spec-cli-01-run-20261122/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

# mend

A CLI that applies an edit an AI model wrote to a tree of UTF-8 text files.
Every file is changed or nothing is. The behaviour is defined by `SPEC.md`
(sections 1-10); this implementation follows it.

## Formats

The patch is read in one of four formats:

- `unified`: unified diffs (`diff --git`, `---`/`+++`, `@@` hunks), with
  tolerant line numbers and hunk offset search.
- `search-replace`: SEARCH/REPLACE blocks (`<<<<<<< SEARCH` ... `=======`
  ... `>>>>>>> REPLACE`).
- `v4a`: `*** Begin Patch` sections (Add / Delete / Update File, Move to,
  `@@` anchors, `*** End of File`).
- `json`: an array of edit objects or JSON Lines, with `create`,
  `str_replace` and `insert` commands.

With `--format=auto` (the default) the format is detected from the patch
text, in the order above (section 4).

## Matching

Old lines O are matched against the file at the first of three tiers that
holds:

- tier 0: exact;
- tier 1: trailing spaces and tabs ignored;
- tier 2: leading and trailing spaces and tabs ignored, and the replacement
  lines are re-indented to the file's leading whitespace.

`--strict` forces tier 0. Occurrences may overlap; formats that need a
choice pick per their section (nearest to the stated position, or exactly
one).

## Usage

    node main.ts [--format=NAME] [--check] [--strict] [PATCH]

- `PATCH` is a path relative to the working directory, or `-` / absent means
  to read standard input.
- `--format=NAME` is one of `unified`, `search-replace`, `v4a`, `json`,
  `auto` (default).
- `--check` produces the same output and exit code but writes nothing.
- `--strict` matches lines exactly (tier 0).
- Options and PATCH may come in any order; `--` ends option parsing.

## Exit codes

- `0` the tree is written (or, with `--check`, would be). Lines `A`, `D`,
  `M`, `R` per changed path, then `ok: <n> files`.
- `1` at least one edit failed. One `error: <code> <path>` line per failed
  edit (`no-match`, `ambiguous`, `missing`, `exists`, `unsafe`), then
  `failed: <k> of <n> edits`. No file is written.
- `2` nothing written, one line: `error: usage`, `error: no-patch`,
  `error: format`, or `error: parse <N>`.

## Verification

The public practice set passes 100 of 100 (`node check.ts practice.json`,
score 1000). Output is deterministic: repeated runs on the same inputs give
byte-identical exit codes, standard output and files.
