// Token launch radar — valuation model (Option B′).
//
// The board ranks pre-token protocols by the implied value of a token
// they do not have yet. The value is worked out from the snapshot's own
// figures, never from a hardcoded list of names:
//
//   implied = TVL x multiple x growth multiplier x maturity multiplier
//
// The multiple comes from the market: protocols whose token already
// trades have a market-cap-to-TVL ratio, and a pre-token protocol
// inherits the median ratio of its category — when that category has
// at least five traded comps. When it has fewer, the protocol inherits
// the global median across all traded comps instead. Ratios are
// winsorised to [0.02, 5.0] so one outlier cannot set the price.
//
// Node 22 stdlib only. No clocks, no randomness, no network: the same
// snapshot always produces the same board, byte for byte.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  /** The multiple used when a category has too few comps to trust. */
  global_median: number;
  /** Multiples are clamped into this band before any median is taken. */
  winsorise_low: number;
  winsorise_high: number;
  /** A category median is used only when the category has this many comps. */
  min_category_comps: number;
  /** Last-resort multiple; unreachable while any traded comp exists. */
  fallback_multiple: number;
  growth_clamp_low: number;
  growth_clamp_high: number;
  /** Maturity saturates at this many days of age. */
  maturity_days: number;
  /** Age assumed when a protocol has no listed date. */
  unknown_age_days: number;
  /** Early rows taken below the watchlist floor, by implied value. */
  early_rows: number;
  /** Live-token rows shown, by market cap. */
  live_rows: number;
}

export interface ModelBreakdown {
  multiple: number;
  /** Where the multiple came from: the category median, the global median, or the fallback. */
  multiple_source: 'category' | 'global' | 'fallback';
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  age_days: number;
  /** Raw market-cap-to-TVL ratio; a market value, not a model value. */
  multiple: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number;
  implied_value_usd: number;
  multiple: number;
  multiple_source: 'category' | 'global' | 'fallback';
  growth_multiplier: number;
  maturity_multiplier: number;
  /** True when the row is one of the snapshot's forty watchlist slugs. */
  watchlist: boolean;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {}

export const MODEL_VERSION = 'radar-2';
export const EARLY_ROWS = 260;
export const LIVE_ROWS = 24;

const MULT_LOW = 0.02;
const MULT_HIGH = 5.0;
const MIN_CATEGORY_COMPS = 5;
const FALLBACK_MULTIPLE = 0.25;
const GROWTH_LOW = -60;
const GROWTH_HIGH = 120;
const MATURITY_DAYS = 1095;
const UNKNOWN_AGE_DAYS = 365;

/** Categories the watchlist rules keep out entirely. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name ending in a version marker (v2, V3, 2.1 ...) is a version, not a protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** The snapshot's own figures say whether a protocol records a token. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function isVersioned(name: string): boolean {
  return VERSION_SUFFIX.test(name);
}

function isWatchlistProtocol(p: SnapshotProtocol, floor: number): boolean {
  if (p.tvl_usd < floor) return false;
  if (!isPreToken(p)) return false;
  if (isVersioned(p.name)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** A protocol is rankable when it records no token and is not a CEX or a versioned name. */
function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !isVersioned(p.name);
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return FALLBACK_MULTIPLE;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function ageDays(p: SnapshotProtocol, asOfMs: number): number {
  if (p.listed_at === null) return UNKNOWN_AGE_DAYS;
  const listedMs = Date.parse(p.listed_at);
  if (Number.isNaN(listedMs)) return UNKNOWN_AGE_DAYS;
  const days = Math.floor((asOfMs - listedMs) / 86400000);
  return days < 0 ? 0 : days;
}

/** A generic first action for a category — a kind of DeFi activity, not a product claim. */
function firstAction(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('lending')) return 'supply assets to the lending market';
  if (c.includes('dex') || c.includes('exchange')) return 'provide liquidity to one pool';
  if (c.includes('yield')) return 'deposit into one vault';
  if (c.includes('risk')) return 'deposit into one curated vault';
  if (c.includes('restak')) return 'restake a small position';
  if (c.includes('perp') || c.includes('deriv')) return 'open one small hedged position';
  if (c.includes('bridge')) return 'bridge a small amount through the protocol';
  if (c.includes('liquid')) return 'mint a small liquid position';
  return 'use the protocol’s main product once';
}

function capitalTier(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

function holdDays(age: number): number {
  if (age === UNKNOWN_AGE_DAYS) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Seven concrete steps for one protocol. Every step carries what it
 * costs and how long it takes. Nothing here invents a points program,
 * a yield figure, or a launch date — the plan is generic on-chain
 * activity, sized by the protocol's own TVL and age.
 */
export function farmSteps(row: BoardRow): string[] {
  const chain = row.chains[0] ?? 'its main chain';
  const second = row.chains.length > 1 ? row.chains[1]! : null;
  const capital = capitalTier(row.tvl_usd);
  const hold = holdDays(row.age_days);
  const gas = capital >= 150 ? 8 : 5;
  const steps = [
    `Open a fresh wallet for ${row.name} only, fund it on ${chain} with about $${gas} of gas, and keep the seed phrase offline. Cost: about $${gas} of gas. Time: 10 minutes.`,
    `On ${chain}, ${firstAction(row.category)} with $${capital} and leave the position open. Cost: $${capital} of capital plus about $2 of gas. Time: 15 minutes.`,
    `Do one more qualifying action each week — a deposit, a swap, a vote, or a claim — so the wallet stays active. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    second === null
      ? `Keep the position active on ${chain} and read the protocol’s own docs for a second supported chain before you touch any other network. Cost: no fee to read. Time: 15 minutes.`
      : `Repeat one small action on ${second} as well, so the wallet is active on both of the protocol’s main chains. Cost: about $2 of gas. Time: 10 minutes.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before you claim anything, open the protocol’s own rewards page from a link it publishes itself, and never pay a fee to claim. Cost: no fee to check. Time: 10 minutes.`,
    `Write the wallet, the dates, and every transaction in a farm log so you can repeat the position or unwind it cleanly. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps;
}

interface CompStats {
  globalMedian: number;
  byCategory: Map<string, { median: number; count: number }>;
}

function compStats(protocols: SnapshotProtocol[]): CompStats {
  const all: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.category === 'CEX' || p.tvl_usd <= 0) continue;
    const multiple = clamp(p.mcap_usd / p.tvl_usd, MULT_LOW, MULT_HIGH);
    all.push(multiple);
    const list = byCategory.get(p.category ?? 'Uncategorised') ?? [];
    list.push(multiple);
    byCategory.set(p.category ?? 'Uncategorised', list);
  }
  all.sort((a, b) => a - b);
  const stats = new Map<string, { median: number; count: number }>();
  for (const [category, list] of byCategory) {
    list.sort((a, b) => a - b);
    stats.set(category, { median: median(list), count: list.length });
  }
  return { globalMedian: median(all), byCategory: stats };
}

function scoreRow(
  p: SnapshotProtocol,
  asOfMs: number,
  stats: CompStats,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(p, asOfMs);
  const cat = stats.byCategory.get(p.category ?? 'Uncategorised');
  let multiple: number;
  let source: ModelBreakdown['multiple_source'];
  if (cat !== undefined && cat.count >= MIN_CATEGORY_COMPS) {
    multiple = cat.median;
    source = 'category';
  } else if (stats.globalMedian !== FALLBACK_MULTIPLE || cat !== undefined) {
    multiple = stats.globalMedian;
    source = 'global';
  } else {
    multiple = FALLBACK_MULTIPLE;
    source = 'fallback';
  }
  const growth = p.change_7d === null
    ? 1
    : 1 + (clamp(p.change_7d, GROWTH_LOW, GROWTH_HIGH) / 100) * 0.5;
  const maturity = 0.6 + (Math.min(age, MATURITY_DAYS) / MATURITY_DAYS) * 0.4;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity));
  return {
    implied,
    breakdown: {
      multiple: round4(multiple),
      multiple_source: source,
      growth_multiplier: round4(growth),
      maturity_multiplier: round4(maturity),
      age_days: age,
    },
  };
}

function compareRows(a: BoardRow, b: BoardRow): number {
  return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

function toRow(p: SnapshotProtocol, asOfMs: number, stats: CompStats): BoardRow {
  const { implied, breakdown } = scoreRow(p, asOfMs, stats);
  const row: BoardRow = {
    rank: 0,
    slug: p.slug,
    name: p.name,
    category: p.category ?? 'Uncategorised',
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    age_days: breakdown.age_days,
    implied_value_usd: implied,
    model: breakdown,
    farm_steps: [],
  };
  row.farm_steps = farmSteps(row);
  return row;
}

/** The ranked board: the whole watchlist, then the strongest rankable pre-token rows outside it. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const asOfMs = Date.parse(snapshot.as_of + 'T00:00:00Z');
  const stats = compStats(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const picked: BoardRow[] = [];
  const seen = new Set<string>();
  for (const p of snapshot.protocols) {
    if (watchlist.has(p.slug) && isWatchlistProtocol(p, snapshot.floor_usd)) {
      picked.push(toRow(p, asOfMs, stats));
      seen.add(p.slug);
    }
  }
  // Safety net: a watchlist slug is the floor, never the ceiling.
  for (const slug of snapshot.watchlist) {
    if (seen.has(slug)) continue;
    const p = snapshot.protocols.find((x) => x.slug === slug);
    if (p !== undefined && isPreToken(p)) {
      picked.push(toRow(p, asOfMs, stats));
      seen.add(slug);
    }
  }
  const early = snapshot.protocols
    .filter((p) => !watchlist.has(p.slug) && isRankable(p))
    .map((p) => toRow(p, asOfMs, stats))
    .sort(compareRows)
    .slice(0, EARLY_ROWS);
  const board = [...picked, ...early].sort(compareRows);
  board.forEach((r, i) => {
    r.rank = i + 1;
  });
  return board;
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const asOfMs = Date.parse(snapshot.as_of + 'T00:00:00Z');
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
      age_days: ageDays(p, asOfMs),
      multiple: p.tvl_usd > 0 ? round4((p.mcap_usd ?? 0) / p.tvl_usd) : 0,
    }));
}

function radarRow(row: BoardRow, isWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: isWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const asOfMs = Date.parse(snapshot.as_of + 'T00:00:00Z');
  const stats = compStats(snapshot.protocols);
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const model: ModelConstants = {
    global_median: round4(stats.globalMedian),
    winsorise_low: MULT_LOW,
    winsorise_high: MULT_HIGH,
    min_category_comps: MIN_CATEGORY_COMPS,
    fallback_multiple: FALLBACK_MULTIPLE,
    growth_clamp_low: GROWTH_LOW,
    growth_clamp_high: GROWTH_HIGH,
    maturity_days: MATURITY_DAYS,
    unknown_age_days: UNKNOWN_AGE_DAYS,
    early_rows: EARLY_ROWS,
    live_rows: LIVE_ROWS,
  };
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
