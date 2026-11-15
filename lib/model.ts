// Token Radar model v2 ("radar-2"): one snapshot of the protocol universe in, one ranked board out.
//
//   IV = anchor x (TVL / 50M)^0.522 x C x A x M x K
//
//   anchor  = 50M x the global median mcap/TVL, computed at runtime from the snapshot
//             (0.214 here, so the anchor is $10.69M — the anchor Pi's analysis used).
//   slope   = 0.522, the OLS slope of ln(mcap) on ln(TVL) over ALL 128 protocols with a
//             market cap (R² = 0.194). Pi's 0.457 used only the 95 with a listing date
//             (R² = 0.168); the listing date has nothing to do with the TVL→value
//             relation, so the full sample is the better estimate. Both slopes were
//             recomputed from this snapshot before the model was written, and the
//             dashboard states both, so the choice is checkable, not asserted.
//   C       = the category weight, hybrid: clip(0.5 + 0.5 x median_cat / globalMedian,
//             0.25, 2.0) where the category has at least 5 priced protocols (median_cat
//             is the median mcap/TVL of the protocols with a market cap in the category,
//             computed at runtime from the snapshot); where the sample is smaller, an
//             expert weight from the analysis (EXPERT_CATEGORY_WEIGHTS below), one line
//             of reason each. A small sample's median is noise — Risk Curators has one
//             priced protocol at 2.975x, which the runtime rule would have read as a
//             2.0 weight; the expert 0.35 discounts it because a curator's TVL is other
//             protocols' markets counted a second time. No protocol name is ever
//             special-cased, and no weight is fitted to a single protocol.
//   A       = age bands (ageMultiplier): the launch window peaks at 180–540 days.
//   M       = exp(0.015 x clamp(change_7d, -25, +25)); no value reported → 0.95.
//   K       = 1 + 0.05 x min(chains - 1, 8).
//
// The board ranks every rankable pre-token protocol: the 40 watchlist slugs plus all
// 158 pre-token protocols below the floor (198 rows). Live-token protocols are set
// aside with their market caps, never mixed into the ranking.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's fitted constants: the fixed tuning plus what the snapshot itself says. */
export interface ModelConstants {
  anchor_usd: number;
  floor_usd: number;
  tvl_exponent: number;
  global_median: number;
  growth_rate: number;
  growth_clip: number;
  missing_growth_mult: number;
  chains_step: number;
  chains_cap: number;
  category_min_n: number;
  category_clip_low: number;
  category_clip_high: number;
}

/** One category's weight, as fitted from the snapshot at runtime or set by an expert. */
export interface CategoryWeight {
  n: number;
  median: number | null;
  weight: number;
  source: 'runtime' | 'expert' | 'neutral';
}

/** An OLS fit of ln(mcap) on ln(TVL), recomputed from the snapshot for the record. */
export interface OlsFit {
  n: number;
  slope: number;
  r2: number;
}

/** Everything the snapshot determines about the model, fitted once per run. */
export interface FittedModel {
  constants: ModelConstants;
  category_weights: Record<string, CategoryWeight>;
  ols_all: OlsFit;
  ols_listed: OlsFit;
}

/** The fixed tuning: the exponent is the documented choice (0.522, see the header). */
export const TUNING = {
  tvl_exponent: 0.522,
  floor_usd: 50_000_000,
  growth_rate: 0.015,
  growth_clip: 25,
  missing_growth_mult: 0.95,
  chains_step: 0.05,
  chains_cap: 8,
  category_min_n: 5,
  category_clip_low: 0.25,
  category_clip_high: 2.0,
};

/**
 * Expert category weights, from the analysis (value-model.md §2.4): only categories
 * with fewer than 5 priced protocols in this snapshot — the sample is too small for
 * a median to mean anything, so the weight is set by reason, one line each. A
 * category with 5 or more priced protocols never appears here: its weight is fitted
 * at runtime and this table is not consulted for it.
 */
export const EXPERT_CATEGORY_WEIGHTS: Record<string, number> = {
  // Double-counted TVL: the TVL is other protocols' markets, counted a second time.
  'Risk Curators': 0.35, // a curator's $2.75B is the markets it curates, not its own
  'Onchain Capital Allocator': 0.3, // allocations sit in other protocols' TVL
  'Yield Aggregator': 0.45, // TVL gathered from other pools
  Restaking: 0.3, // TVL is re-staked BTC/ETH, counted twice
  'Staking Pool': 0.4, // LST-like double count
  'Stablecoin Wrapper': 0.5, // a wrapper of someone else's stablecoin
  // Small samples, set from the priced protocols the snapshot does have.
  Derivatives: 1.8, // n=2 priced (1.38x, 2.95x), no cap applied — expert 1.8
  Chain: 1.25, // n=1 (3.03x): a chain with no token is rare infrastructure
  'Collateral Markets': 0.85, // n=1 is an outlier (12.16x); analogy with Lending
  Payments: 0.95, // n=2 (0.18x), near-neutral
  'Prediction Market': 1.0, // n=1 (400x) is an outlier; neutral
  'Liquidity Manager': 0.6, // expert
  CeDeFi: 1.1, // expert
  // No priced sample: set by analogy with a neighbouring category.
  CDP: 0.9, // like Lending, but issuing a stablecoin
  'CDP Manager': 0.9, // no data; analogy with CDP
  Insurance: 0.9, // no data
  'Governance Incentives': 0.9, // no data
  'OTC Marketplace': 1.0, // no data
  'Leveraged Farming': 0.9, // expert
  Farm: 0.7, // expert
  'Anchor BTC': 0.9, // expert
  'Decentralized BTC': 0.9, // expert
  // No priced sample and no expert signal in the analysis: neutral, and said so.
  'Cross Chain Bridge': 1.0, // no data, no expert signal — neutral
  'Dual-Token Stablecoin': 1.0, // no data, no expert signal — neutral
  Indexes: 1.0, // no data, no expert signal — neutral
  'Interest Rate Derivatives': 1.0, // no data, no expert signal — neutral
  'Uncollateralized Lending': 1.0, // no data, no expert signal — neutral
  'Crypto Card Issuer': 1.0, // no data, no expert signal — neutral
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    category_weight: number;
    age_multiplier: number;
    growth_multiplier: number;
    chains_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_weight: number;
  age_multiplier: number;
  growth_multiplier: number;
  chains_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  category_weights: Record<string, CategoryWeight>;
  ols_all: OlsFit;
  ols_listed: OlsFit;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Clip a number into [low, high]. */
function clip(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The OLS slope and R² of ln(mcap) on ln(TVL) for the protocols given. */
function olsFit(priced: SnapshotProtocol[]): OlsFit {
  const xs = priced.map((p) => Math.log(p.tvl_usd));
  const ys = priced.map((p) => Math.log(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return { n, slope: round4(sxy / sxx), r2: round4((sxy * sxy) / (sxx * syy)) };
}

/**
 * Fit the model from the snapshot: the global median mcap/TVL, the anchor it implies,
 * and one weight per category. Categories with at least 5 priced protocols get a
 * weight fitted from the snapshot at runtime; smaller samples take the expert weight
 * from EXPERT_CATEGORY_WEIGHTS (seeded even where the snapshot has no priced
 * protocol in the category, so the board never scores one at a silent 1.0).
 */
export function fitModel(snapshot: Snapshot): FittedModel {
  const priced = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalMedian = median(priced.map((p) => p.mcap_usd! / p.tvl_usd));
  const anchor = TUNING.floor_usd * globalMedian;
  const byCat = new Map<string, number[]>();
  for (const p of priced) {
    const c = p.category ?? 'Other';
    const arr = byCat.get(c) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(c, arr);
  }
  const weights: Record<string, CategoryWeight> = {};
  for (const [c, weight] of Object.entries(EXPERT_CATEGORY_WEIGHTS)) {
    const arr = byCat.get(c);
    weights[c] = { n: arr?.length ?? 0, median: arr ? round4(median(arr)) : null, weight, source: 'expert' };
  }
  for (const [c, arr] of byCat) {
    if (arr.length >= TUNING.category_min_n) {
      const med = median(arr);
      weights[c] = {
        n: arr.length,
        median: round4(med),
        weight: round4(clip(0.5 + 0.5 * (med / globalMedian), TUNING.category_clip_low, TUNING.category_clip_high)),
        source: 'runtime',
      };
    } else if (weights[c] === undefined) {
      // A priced category the expert table never scored: neutral, and said so.
      weights[c] = { n: arr.length, median: round4(median(arr)), weight: 1.0, source: 'neutral' };
    }
  }
  const constants: ModelConstants = {
    anchor_usd: Math.round(anchor),
    floor_usd: TUNING.floor_usd,
    tvl_exponent: TUNING.tvl_exponent,
    global_median: round4(globalMedian),
    growth_rate: TUNING.growth_rate,
    growth_clip: TUNING.growth_clip,
    missing_growth_mult: TUNING.missing_growth_mult,
    chains_step: TUNING.chains_step,
    chains_cap: TUNING.chains_cap,
    category_min_n: TUNING.category_min_n,
    category_clip_low: TUNING.category_clip_low,
    category_clip_high: TUNING.category_clip_high,
  };
  return {
    constants,
    category_weights: weights,
    ols_all: olsFit(priced),
    ols_listed: olsFit(priced.filter((p) => p.listed_at !== null)),
  };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The launch-window multiplier: a protocol's chance of issuing a token peaks once its
 * TVL is proven (180–540 days of tracking) and fades when it has run for years with
 * no token. No date on record is neutral, never a penalty.
 */
export function ageMultiplier(age: number | null): number {
  if (age === null) return 0.6;
  if (age < 30) return 0.35;
  if (age < 90) return 0.55;
  if (age < 180) return 0.85;
  if (age <= 540) return 1.0;
  if (age <= 730) return 0.9;
  if (age <= 1100) return 0.7;
  return 0.45;
}

/** The seven-day growth multiplier: exp(0.015 x change, clipped to ±25%); no value → 0.95. */
export function growthMultiplier(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return TUNING.missing_growth_mult;
  return Math.exp(TUNING.growth_rate * clip(change7d, -TUNING.growth_clip, TUNING.growth_clip));
}

/** The multi-chain multiplier: 1 + 0.05 per extra chain, capped at 8 extra chains. */
export function chainsMultiplier(chainCount: number): number {
  return 1 + TUNING.chains_step * Math.min(Math.max(chainCount - 1, 0), TUNING.chains_cap);
}

/** A category's fitted weight, or 1.0 when the snapshot carries no priced protocol in it. */
export function categoryWeightOf(fitted: FittedModel, category: string | null): number {
  const w = fitted.category_weights[category ?? 'Other'];
  return w === undefined ? 1.0 : w.weight;
}

/** The five factors and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
): { implied: number; base: number; categoryWeight: number; ageMult: number; growthMult: number; chainsMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const c = fitted.constants;
  const base = c.anchor_usd * Math.pow(protocol.tvl_usd / c.floor_usd, c.tvl_exponent);
  const categoryWeight = categoryWeightOf(fitted, protocol.category);
  const ageMult = ageMultiplier(age);
  const growthMult = growthMultiplier(protocol.change_7d);
  const chainsMult = chainsMultiplier(protocol.chains.length);
  const implied = Math.max(1, Math.round(base * categoryWeight * ageMult * growthMult * chainsMult));
  return { implied, base, categoryWeight, ageMult, growthMult, chainsMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped, staked or staking product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name: the house rule keeps it off the board. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories the house rule keeps off the board: exchanges and products of traded tokens. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all (no CoinGecko id, no symbol). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange, not a
 * wrapped/staked/bridged product, not a versioned pool, not an exchange-named one.
 * This is the house watchlist rule without its $50M floor — the floor is never the
 * whole board, and the early radar is the protocols below it.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// FARM-PLAN-BEGIN
// The farm plan, shared verbatim between lib/model.ts and dashboard/app.js: the same
// function scores the same protocol the same way in the board and in the page.
// Amounts come from the protocol's TVL, hold times from its age and category —
// never from its name. Each step is "action. Cost: … Time: …", 20–600 characters.

/** How much capital one farm position needs, from the protocol's own TVL. */
function farmCapitalFor(tvlUsd) {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age; curators, allocators and chains hold longer. */
function farmHoldDaysFor(ageDays, longHold) {
  var hold;
  if (ageDays === null || ageDays === undefined) hold = 30;
  else if (ageDays < 180) hold = 60;
  else if (ageDays < 365) hold = 45;
  else hold = 30;
  return longHold ? hold + 28 : hold;
}

/** The category's main action, in the words a farmer can follow. */
function farmMainAction(category, name, chain, capital) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' across 2–3 pools (a stablecoin and ETH or BTC) and keep the position open.';
  if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leverag') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
  if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivat') >= 0 || c.indexOf('option') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position.';
  if (c.indexOf('prediction') >= 0) return 'Fund ' + name + ' with $' + capital + ' on ' + chain + ' and place positions on 2–3 markets.';
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
  if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
  if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it for the daily accrual.';
  if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
  if (c === 'chain') return 'Stake or delegate $' + capital + ' through ' + name + ' and use 2–3 of its ecosystem apps on the same address.';
  if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep a balance on the same address.';
  if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

/** The second product to touch, so the address is more than a single deposit. */
function farmSecondAction(category, name, chain) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow against the deposit and repay it twice, so the address shows both sides of the market.';
  if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leverag') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity') >= 0) return 'Make 5–10 swaps a week of $50–200 on ' + name + ', so the address counts as a trader, not only a depositor.';
  if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Put the receipt token to work in one DeFi pool on ' + chain + ' instead of letting it sit idle.';
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivat') >= 0 || c.indexOf('option') >= 0) return 'Add $500–2000 of liquidity to one ' + name + ' pool on ' + chain + ' beside the margin position.';
  if (c.indexOf('prediction') >= 0) return 'Settle and re-enter 2–3 markets a month instead of placing one position and leaving.';
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Split the deposit across 2–3 different vaults, so no single curator carries the whole position.';
  if (c.indexOf('stable') >= 0) return 'Use the minted stable asset in one lending or liquidity pool on ' + chain + ' instead of holding it idle.';
  if (c.indexOf('rwa') >= 0) return "Check the program's allowlist on " + name + "'s own site and confirm the address is on it.";
  if (c.indexOf('insurance') >= 0) return 'Extend the cover before it lapses, so the policy stays continuous through the snapshot.';
  if (c === 'chain') return "Join the network's testnet or governance vote from the same address when one opens.";
  return 'Use one more of the protocol’s products on the same address — a swap, a borrow, a vault or a vote.';
}

/** What to do with the yield, or how to vote: the step that keeps the position alive. */
function farmReinvestAction(category) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('rwa') >= 0) return "Reinvest each month's coupon back into the same pool instead of withdrawing it.";
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return "Put the borrowed asset into the protocol's own liquidity pool, then repay the loan in full.";
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Vote on the curator's next allocation or metric when a vote opens.";
  if (c === 'chain') return 'Delegate any new rewards back to the same validator and keep the stake compounding.';
  if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leverag') >= 0 || c.indexOf('liquidity') >= 0) return "Claim the pool's rewards weekly and add them back to the same position.";
  if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the staking rewards weekly instead of claiming them to the wallet.';
  return 'Make one more qualifying action each week — a deposit, a swap, a borrow or a vote.';
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function farmStepText(step) {
  var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from
 * a hand-written list of names.
 */
function farmStepsFor(category, name, chain, tvlUsd, ageDays) {
  var capital = farmCapitalFor(tvlUsd);
  var c = (category || '').toLowerCase();
  var longHold = c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c === 'chain';
  var hold = farmHoldDaysFor(ageDays, longHold);
  var isRwa = c.indexOf('rwa') >= 0;
  var steps = [];
  if (isRwa) {
    steps.push({ text: "Complete the protocol's identity check on its own site first, with the documents it asks for, then farm from a fresh wallet that holds only the funds you plan to use.", cost: 'no fee for the check itself; under $3 of gas for the first transaction', time: '20–40 minutes for the check, 5 minutes for the wallet' });
  } else {
    steps.push({ text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' });
  }
  steps.push({ text: farmMainAction(category, name, chain, capital), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' });
  if (longHold) {
    steps.push({ text: farmSecondAction(category, name, chain), cost: 'the $' + capital + ' split across the vaults, plus about $5 of gas', time: '20 minutes, once' });
  } else {
    steps.push({ text: farmSecondAction(category, name, chain), cost: 'about $2–5 of gas a week', time: '10–30 minutes a week' });
  }
  steps.push({ text: 'Hold the position for at least ' + hold + ' days, and do not withdraw in the 48 hours before any snapshot or announcement.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' });
  steps.push({ text: "Open the protocol's own points or rewards page once a week and check the address is earning; stay in the first half of the table.", cost: 'no fee to check', time: '5 minutes a week' });
  steps.push({ text: farmReinvestAction(category), cost: 'about $5–20 of gas', time: '10–15 minutes' });
  steps.push({ text: 'Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' });
  return steps.map(farmStepText);
}
// FARM-PLAN-END

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A protocol's farm plan: seven concrete steps with cost and time, from its own record. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  return farmStepsFor(p.category, p.name, chainOf(p), p.tvl_usd, age);
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const fitted = fitModel(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // Every rankable protocol is the board: the watchlist is the floor, never the ceiling.
  for (const p of snapshot.protocols) {
    if (isRankable(p)) chosen.set(p.slug, p);
  }
  // The watchlist is the floor: every slug, even one the rankable rule would leave out.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.has(slug)) chosen.set(slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fitted);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_usd: Math.round(s.base),
      category_weight: round4(s.categoryWeight),
      age_multiplier: round4(s.ageMult),
      growth_multiplier: round4(s.growthMult),
      chains_multiplier: round4(s.chainsMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
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
    category_weight: row.model.category_weight,
    age_multiplier: row.model.age_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    chains_multiplier: row.model.chains_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fitted = fitModel(snapshot);
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: fitted.constants,
    model_version: MODEL_VERSION,
    category_weights: fitted.category_weights,
    ols_all: fitted.ols_all,
    ols_listed: fitted.ols_listed,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watch)),
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
