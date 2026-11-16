// Token launch radar — entrypoint.
//
// Reads a sealed DefiLlama snapshot, ranks its pre-token protocols by
// market-derived implied value, and writes everything the bounty asks
// for into one output directory:
//
//   board.json      the ranked board (watchlist first, then early rows)
//   data.js         the same data, as a script the dashboard loads
//   dashboard/      the static page (index.html, app.css, app.js)
//   screenshots/    three captures of the shipped page
//   dossier.json    the sealed dossier, built last, from the files above
//
// Run it from this repository's root:
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The grader runs it with /input and /output instead. Node 22 stdlib
// only: no network, no clock, no randomness — the same snapshot always
// produces the same output, byte for byte.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildRadar, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import type { BoardRow } from './lib/model.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

function fail(message: string): never {
  console.error(`token-radar: ${message}`);
  process.exit(1);
}

function flagValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return null;
  return argv[i + 1]!;
}

/** One board row as board.json holds it. */
function boardJsonRow(row: BoardRow): Record<string, unknown> {
  return {
    slug: row.slug,
    name: row.name,
    rank: row.rank,
    implied_value_usd: row.implied_value_usd,
    farm_steps: row.farm_steps,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src).sort()) {
    const from = join(src, name);
    const to = join(dst, name);
    if (statSync(from).isDirectory()) copyTree(from, to);
    else cpSync(from, to);
  }
}

function main(argv: string[]): void {
  const input = flagValue(argv, '--input') ?? join(REPO_ROOT, '..', 'input', 'snapshot.json');
  const output = process.env.MAKEFUN_OUTPUT_DIR ?? flagValue(argv, '--output') ?? join(REPO_ROOT, 'out');
  const inPath = resolve(input);
  const outPath = resolve(output);
  if (!existsSync(inPath)) fail(`snapshot not found: ${inPath}`);

  const snapshot = parseSnapshot(readFileSync(inPath, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) fail(`board refused: ${issue}`);

  mkdirSync(outPath, { recursive: true });
  writeFileSync(join(outPath, 'board.json'), `${JSON.stringify(board.map(boardJsonRow), null, 2)}\n`, 'utf8');
  writeFileSync(join(outPath, 'data.js'), dataScript(radar), 'utf8');

  const dashboardDir = join(REPO_ROOT, 'dashboard');
  if (!existsSync(join(dashboardDir, 'index.html'))) fail(`dashboard missing: ${dashboardDir}`);
  copyTree(dashboardDir, join(outPath, 'dashboard'));

  const shotsDir = join(REPO_ROOT, 'screenshots');
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort()
    : [];
  if (shots.length < 3) fail(`need 3 screenshots in ${shotsDir}, found ${shots.length}`);
  copyTree(shotsDir, join(outPath, 'screenshots'));

  // The dossier is built last, from the files already in the output dir,
  // so it always describes exactly what is being handed in.
  const dossier = buildDossier(outPath, { text_max_bytes: 65536 });
  writeFileSync(join(outPath, 'dossier.json'), dossier);

  const top = board[0]!;
  console.log(`token-radar: ${board.length} rows (${radar.watchlist_size} watchlist + ${radar.early_size} early), ${radar.live_size} live`);
  console.log(`token-radar: top implied value $${top.implied_value_usd.toLocaleString('en-US')} (${top.slug})`);
  console.log(`token-radar: wrote ${outPath} — board.json, data.js, dashboard/, screenshots/ (${shots.map((s) => basename(s)).join(', ')}), dossier.json (${dossier.byteLength} bytes)`);
}

main(process.argv.slice(2));
