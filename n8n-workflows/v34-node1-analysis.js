// ============================================================
// Options Trading Signal System — Node1 v3.0
// n8n Code Node (JavaScript)
// ============================================================
// Data sources:
//   • Yahoo Finance  – 60-day daily OHLCV  (technical analysis)
//   • tastytrade     – market-metrics (IVR, IV percentile)
//   • tastytrade     – option-chains/nested  (expirations)
//   • CBOE delayed   – ALL option Greeks + bid/ask/OI/volume
// ============================================================

// ─────────────────────────────────────────────────────────────
// 0.  CONFIGURATION
// ─────────────────────────────────────────────────────────────
const symbols = [
  { ticker: 'SPY',  name: 'SPY',    sector: 'index' },
  { ticker: 'QQQ',  name: 'QQQ',    sector: 'index' },
  { ticker: 'AAPL', name: 'Apple',  sector: 'tech' },
  { ticker: 'NVDA', name: 'NVIDIA', sector: 'semi' },
  { ticker: 'PLTR', name: 'Palantir', sector: 'tech' },
  { ticker: 'TSLA', name: 'Tesla',  sector: 'auto' },
  { ticker: 'META', name: 'Meta',   sector: 'tech' },
  { ticker: 'AMZN', name: 'Amazon', sector: 'tech' },
  { ticker: 'GOOGL', name: 'Google', sector: 'tech' },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'tech' },
  { ticker: 'AMD',  name: 'AMD',    sector: 'semi' },
  { ticker: 'SOFI', name: 'SoFi',   sector: 'fin' },
  { ticker: 'AMAT', name: 'Applied Materials', sector: 'semi' },
  { ticker: 'TSM',  name: 'TSM',    sector: 'semi' },
];
const MAX_PER_SECTOR = 2;      // 同產業最多推薦 2 檔
const MAX_TOTAL_SIGNALS = 5;   // 每次最多推薦 5 檔標的
const EARNINGS_BLACKOUT_DAYS = 2; // 財報前 N 天不推薦
const FINNHUB_KEY = 'd70bb2hr01qtb4ra5aagd70bb2hr01qtb4ra5ab0';

// ── DTE per strategy (aligned with Notion rules) ──
const DTE_MIN_CREDIT = 14;   // Call Credit: 14-30天 (Notion)
const DTE_MAX_CREDIT = 30;
const DTE_MIN_IC     = 20;   // Iron Condor: 20-30天 (Notion)
const DTE_MAX_IC     = 30;
const DTE_MIN_DEBIT  = 14;   // Put Debit: 14-45天
const DTE_MAX_DEBIT  = 45;
const DTE_MIN = 14;          // global floor for CBOE indexing
const DTE_MAX = 45;          // global ceiling for CBOE indexing

const LIQUIDITY_MAX_SPREAD_PCT = 0.10;   // bid-ask spread ≤ 10 %
const LIQUIDITY_MIN_OI         = 500;
const KELLY_MIN                = 0.05;   // 5 %

// ── Delta per strategy (aligned with Notion LV1 + LV2 rules) ──
// Put Credit Spread (看多賣方 LV1): 賣腿 Delta 0.20~0.25
const PCS_DELTA_MIN            = 0.20;
const PCS_DELTA_MAX            = 0.25;
// Call Credit Spread (看空賣方 LV2): 賣腿 Delta 0.15 區間
const CCS_DELTA_MIN            = 0.10;
const CCS_DELTA_MAX            = 0.20;
// Iron Condor (中性 LV3): Call/Put 0.10~0.15
const IC_DELTA_MIN             = 0.10;
const IC_DELTA_MAX             = 0.15;
// Debit Spreads (買方 LV1/LV2): 買腿 Delta 0.5 區間
const DEBIT_SPREAD_DELTA_MIN   = 0.40;
const DEBIT_SPREAD_DELTA_MAX   = 0.60;

// ── IVR/IVP thresholds (Notion rules) ──
const IVR_MIN_PCS      = 0.30;  // Put Credit Spread: IVR 30-60 (Notion LV1)
const IVR_MAX_PCS      = 0.60;
const IVR_MIN_CCS      = 0.30;  // Call Credit Spread: IVR 30-50 (Notion LV2)
const IVR_MAX_CCS      = 0.50;
const IVR_MIN_IC       = 0.30;  // IC 需 IVR > 30 (Notion LV3)
const IVP_MIN_DEBIT    = 0.20;  // Debit Spread: IVP 20-50 (Notion LV1)
const IVP_MAX_DEBIT    = 0.50;
const REWARD_RISK_MIN  = 3.0;   // Credit spread 報酬比至少 1:3 (Notion)

// ─────────────────────────────────────────────────────────────
// 1.  AUTH
// ─────────────────────────────────────────────────────────────
const accessToken = $input.first().json.access_token;
const ttHeaders = {
  'Authorization': 'Bearer ' + accessToken,
  'Accept': 'application/json',
  'User-Agent': 'chilldove-n8n/3.0',
};

const debugLog = [];
function log(msg) { debugLog.push('[' + new Date().toISOString() + '] ' + msg); }

// ─────────────────────────────────────────────────────────────
// 2.  DST AUTO-DETECT + MARKET HOURS GUARD
// ─────────────────────────────────────────────────────────────
/*
  US DST: second Sunday of March → first Sunday of November
  During US DST  : NYSE opens at 09:30 ET = 21:30 TWN (UTC+8)
  Standard time  : NYSE opens at 09:30 ET = 22:30 TWN (UTC+8)
  We run this script slightly before open, so:
    • DST     → expect Taiwan hour = 21
    • Standard→ expect Taiwan hour = 22
*/
function isUsDst(date) {
  const year = date.getUTCFullYear();
  // second Sunday of March
  const march = new Date(Date.UTC(year, 2, 1));
  const marchDay = march.getUTCDay(); // 0=Sun
  const dstStart = new Date(Date.UTC(year, 2, (14 - marchDay) % 7 + 8));
  // first Sunday of November
  const nov = new Date(Date.UTC(year, 10, 1));
  const novDay = nov.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, (7 - novDay) % 7 + 1));
  return date >= dstStart && date < dstEnd;
}

const now = new Date();
const isDst = isUsDst(now);
// Taiwan is UTC+8; no local DST
const taiwanHour = (now.getUTCHours() + 8) % 24;
const expectedOpenHour = isDst ? 21 : 22;   // hour BEFORE 30-min open window

log(`DST=${isDst}, taiwanHour=${taiwanHour}, expectedOpenHour=${expectedOpenHour}`);

// Allow execution window: expectedOpenHour to expectedOpenHour+3
const hourDiff = (taiwanHour - expectedOpenHour + 24) % 24;
if (hourDiff > 3) {
  return [{
    json: {
      skipped: true,
      reason: `Market not open — Taiwan time ${taiwanHour}:xx, expected window ${expectedOpenHour}xx-${expectedOpenHour + 3}xx (DST=${isDst})`,
      debugLog,
      analysisTime: now.toISOString(),
      version: 'v3.4',
    },
  }];
}

// ─────────────────────────────────────────────────────────────
// 3.  HTTP HELPER
// ─────────────────────────────────────────────────────────────
async function httpGet(url, headers = {}, label = '') {
  try {
    const res = await this.helpers.httpRequest({
      method: 'GET',
      url,
      headers,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
    });
    if (res.statusCode >= 400) {
      log(`HTTP ${res.statusCode} for ${label || url}`);
      return null;
    }
    return typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  } catch (e) {
    log(`ERROR fetching ${label || url}: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 4.  TECHNICAL ANALYSIS HELPERS
// ─────────────────────────────────────────────────────────────
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calcMA(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcSupport(lows, period = 20) {
  const slice = lows.slice(-period);
  return Math.min(...slice);
}

function calcResistance(highs, period = 20) {
  const slice = highs.slice(-period);
  return Math.max(...slice);
}


// ─────────────────────────────────────────────────────────────
// 4b. VOLUME ANALYSIS
// ─────────────────────────────────────────────────────────────
function analyzeVolume(volumes, closes, period = 20) {
  if (!volumes || volumes.length < period + 1) return { avg: 0, latest: 0, ratio: 0, spike: false };
  const recent = volumes.slice(-period);
  const avg = recent.reduce((a, b) => a + b, 0) / period;
  const latest = volumes[volumes.length - 1] || 0;
  const ratio = avg > 0 ? latest / avg : 0;
  // Check if volume spiked near support (last bar close near 20-day low)
  const recentLows = closes.slice(-period);
  const support = Math.min(...recentLows);
  const nearSupport = closes[closes.length - 1] <= support * 1.02; // within 2% of support
  return { avg: Math.round(avg), latest, ratio: +ratio.toFixed(2), spike: ratio > 1.5, nearSupport };
}

// ─────────────────────────────────────────────────────────────
// 4c. VEGA/THETA ASSESSMENT
// ─────────────────────────────────────────────────────────────
function assessGreeks(strategy, shortVega, shortTheta, longVega, longTheta) {
  // Credit spreads (sellers): want negative vega (IV drop = profit), positive theta (time decay = profit)
  // Debit spreads (buyers): want positive vega (IV rise = profit), theta works against
  const isCredit = ['Bull Put Spread', 'Bear Call Spread', 'Iron Condor'].includes(strategy);
  const netVega = (shortVega || 0) - (longVega || 0); // for credit: selling short, buying long
  const netTheta = (shortTheta || 0) - (longTheta || 0);
  
  let vegaOk, thetaOk, vegaNote, thetaNote;
  if (isCredit) {
    vegaOk = netVega <= 0; // credit seller wants net negative vega
    thetaOk = netTheta >= 0; // credit seller wants net positive theta
    vegaNote = vegaOk ? 'Vega負效益✅(IV降有利)' : 'Vega正效益⚠️(IV升不利)';
    thetaNote = thetaOk ? 'Theta正衰減✅(時間有利)' : 'Theta負衰減⚠️(時間不利)';
  } else {
    vegaOk = netVega >= 0; // debit buyer wants net positive vega
    thetaOk = true; // theta always works against buyer, accepted
    vegaNote = vegaOk ? 'Vega正效益✅(IV升有利)' : 'Vega負效益⚠️(IV降不利)';
    thetaNote = `Theta衰減${Math.abs(netTheta).toFixed(3)}/天`;
  }
  return { netVega: +netVega.toFixed(4), netTheta: +netTheta.toFixed(4), vegaOk, thetaOk, vegaNote, thetaNote };
}

function calcMACD(closes) {
  // MACD = EMA(12) - EMA(26), Signal = EMA(9) of MACD
  if (closes.length < 26) return null;
  function ema(data, period) {
    const k = 2 / (period + 1);
    let e = data[0];
    for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  }
  const ema12 = ema(closes.slice(-26), 12);
  const ema26 = ema(closes.slice(-26), 26);
  const macdLine = ema12 - ema26;

  // Calculate MACD line for last 9 bars to get signal line
  const macdHistory = [];
  for (let i = closes.length - 9; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    if (slice.length < 26) continue;
    const e12 = ema(slice.slice(-26), 12);
    const e26 = ema(slice.slice(-26), 26);
    macdHistory.push(e12 - e26);
  }
  const signalLine = macdHistory.length >= 9 ? ema(macdHistory, 9) : macdLine;
  const histogram = macdLine - signalLine;

  // Detect cross: current histogram sign vs previous
  const prevMacd = macdHistory.length >= 2 ? macdHistory[macdHistory.length - 2] : macdLine;
  const prevSignal = macdHistory.length >= 2 ? ema(macdHistory.slice(0, -1), 9) : signalLine;
  const prevHist = prevMacd - prevSignal;

  let cross = 'none';
  if (histogram > 0 && prevHist <= 0) cross = 'golden'; // 金叉
  if (histogram < 0 && prevHist >= 0) cross = 'death';  // 死叉

  return { macdLine, signalLine, histogram, cross };
}

// ─────────────────────────────────────────────────────────────
// 5.  CBOE OPTION SYMBOL PARSER
// ─────────────────────────────────────────────────────────────
/*
  Format: {ROOT}{YYMMDD}{TYPE}{STRIKE*1000 padded 8 digits}
  e.g.    SPY260430P00545000
  Root length is variable; we detect it by finding the 6-digit date block.
*/
function parseCboeSymbol(sym) {
  const m = sym.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, root, yymmdd, type, strikePadded] = m;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  const year = 2000 + yy;
  const expDate = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const strike = parseInt(strikePadded, 10) / 1000;
  return { root, expDate, type, strike };
}

function daysToExpiry(expDateStr) {
  const now = new Date();
  const exp = new Date(expDateStr + 'T16:00:00-05:00'); // 4 PM ET
  return Math.round((exp - now) / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────────────────────
// 6.  LIQUIDITY CHECK
// ─────────────────────────────────────────────────────────────
function passesLiquidity(opt) {
  const bid = parseFloat(opt.bid) || 0;
  const ask = parseFloat(opt.ask) || 0;
  const oi  = parseInt(opt.open_interest, 10) || 0;
  // Fix: bid must be > 0 (zero-bid options are illiquid even if ask exists)
  if (bid <= 0 || ask <= 0) return false;
  const spreadAbs = ask - bid;
  const spreadPct = spreadAbs / ask;
  // Fix: also check absolute spread ≤ $0.15 to catch penny options with 200%+ spread
  return spreadPct <= LIQUIDITY_MAX_SPREAD_PCT && spreadAbs <= 0.15 && oi >= LIQUIDITY_MIN_OI;
}

function midPrice(opt) {
  return ((parseFloat(opt.bid) || 0) + (parseFloat(opt.ask) || 0)) / 2;
}

// EV range: best/worst case based on Bid-Ask slippage
function calcEVRange(shortOpt, longOpt, winRate, width, isCredit) {
  const sBid = parseFloat(shortOpt.bid) || 0;
  const sAsk = parseFloat(shortOpt.ask) || 0;
  const lBid = parseFloat(longOpt.bid) || 0;
  const lAsk = parseFloat(longOpt.ask) || 0;
  if (isCredit) {
    // Credit spread: sell short, buy long
    const creditBest  = sAsk - lBid;  // best fill: sell at ask, buy at bid (unlikely but possible with limit)
    const creditMid   = midPrice(shortOpt) - midPrice(longOpt);
    const creditWorst = sBid - lAsk;  // worst fill: sell at bid, buy at ask
    const mlBest  = width - creditBest;
    const mlMid   = width - creditMid;
    const mlWorst = width - creditWorst;
    return {
      evBest:  +(creditBest * winRate - mlBest * (1 - winRate)).toFixed(2),
      evMid:   +(creditMid * winRate - mlMid * (1 - winRate)).toFixed(2),
      evWorst: +(Math.max(creditWorst, 0) * winRate - (width - Math.max(creditWorst, 0)) * (1 - winRate)).toFixed(2)
    };
  } else {
    // Debit spread: buy long, sell short
    const debitBest  = lBid - sAsk;  // best: buy at bid (unlikely), sell at ask
    const debitMid   = midPrice(longOpt) - midPrice(shortOpt);
    const debitWorst = lAsk - sBid;  // worst: buy at ask, sell at bid
    const gainBest  = width - debitBest;
    const gainMid   = width - debitMid;
    const gainWorst = width - debitWorst;
    return {
      evBest:  +(winRate * gainBest - (1 - winRate) * debitBest).toFixed(2),
      evMid:   +(winRate * gainMid - (1 - winRate) * debitMid).toFixed(2),
      evWorst: +(winRate * gainWorst - (1 - winRate) * Math.max(debitWorst, 0)).toFixed(2)
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 7.  KELLY CRITERION
// ─────────────────────────────────────────────────────────────
function kelly(winRate, rewardRiskRatio) {
  // Kelly % = W - (1-W)/R
  if (rewardRiskRatio <= 0) return 0;
  return winRate - (1 - winRate) / rewardRiskRatio;
}

// ─────────────────────────────────────────────────────────────
// 8.  TREND SCORE (composite ranking)
// ─────────────────────────────────────────────────────────────
function trendScore({ ev, ivr, directionScore, winRate, spreadPct, oi }) {
  // Normalised weights
  const evScore  = Math.min(Math.max(ev / 0.50, 0), 1);           // 0-1 → ev $0-$0.50
  const ivrScore = Math.min(Math.max(ivr / 1.0,  0), 1);          // 0-1
  const dirScore = Math.min(Math.abs(directionScore) / 4, 1);     // 0-1
  const winScore = Math.min(Math.max((winRate - 0.5) / 0.4, 0), 1); // 0.5-0.9
  const liqScore = Math.min(Math.max(1 - spreadPct / 0.10, 0), 1); // tighter = better
  const oiScore  = Math.min(oi / 5000, 1);
  return (
    evScore  * 0.30 +
    ivrScore * 0.20 +
    dirScore * 0.20 +
    winScore * 0.15 +
    liqScore * 0.10 +
    oiScore  * 0.05
  );
}

// ─────────────────────────────────────────────────────────────
// 9.  SPREAD BUILDER
// ─────────────────────────────────────────────────────────────
/*
  optsByExpType: { [expDate]: { C: Map<strike, cboeOpt>, P: Map<strike, cboeOpt> } }
  underlyingPrice: float
  direction: 'bullish'|'bearish'|'neutral'
  ivr: float (0-1)
  directionScore: int
*/
function buildSpreads(optsByExpType, underlyingPrice, direction, ivr, ivPercentile, directionScore, support, resistance, volumeAnalysis) {
  const spreads = [];

  for (const [expDate, types] of Object.entries(optsByExpType)) {
    const dte = daysToExpiry(expDate);
    if (dte < DTE_MIN || dte > DTE_MAX) continue;

    // ── helpers for this expiration ──
    const putOpts  = types['P'] || new Map();
    const callOpts = types['C'] || new Map();

    // Build sorted arrays by strike
    const puts  = [...putOpts.values()].sort((a, b) => a._strike - b._strike);
    const calls = [...callOpts.values()].sort((a, b) => a._strike - b._strike);

    // ─── Bull Put Spread / Put Credit Spread (credit, 看多) ────
    // Event risk: skip income strategies when CPI/FOMC/NFP within 2 days
    if (!hasEconEventRisk && (direction === 'bullish' || direction === 'neutral')
        && ivr >= IVR_MIN_PCS && ivr <= IVR_MAX_PCS
        && dte >= DTE_MIN_CREDIT && dte <= DTE_MAX_CREDIT) {
      // Notion LV1: 賣腿 Delta 0.20-0.25, IVR 30-60, DTE 14-30
      for (const shortPut of puts) {
        const sd = Math.abs(parseFloat(shortPut.delta) || 0);
        if (sd < PCS_DELTA_MIN || sd > PCS_DELTA_MAX) continue;
        if (!passesLiquidity(shortPut)) continue;

        // Long put: strike below short, also liquid
        const longCandidates = puts.filter(p =>
          p._strike < shortPut._strike && passesLiquidity(p)
        );
        if (longCandidates.length === 0) continue;

        // Pick long put with highest OI below short
        const longPut = longCandidates.sort((a, b) =>
          (parseInt(b.open_interest, 10) || 0) - (parseInt(a.open_interest, 10) || 0)
        )[0];

        const credit   = midPrice(shortPut) - midPrice(longPut);
        if (credit <= 0) continue;
        const width    = shortPut._strike - longPut._strike;
        const maxLoss  = width - credit;
        if (maxLoss <= 0) continue;

        const winRate  = 1 - sd; // P(OTM) for short put = 1 - |delta|
        const ev       = credit * winRate - maxLoss * (1 - winRate);
        if (ev <= 0) continue;

        const k = kelly(winRate, credit / maxLoss);
        if (k < KELLY_MIN) continue;

        // Notion: 報酬比至少 1:3 (credit / maxLoss >= 1/3)
        if (credit / maxLoss < 1 / REWARD_RISK_MIN) continue;

        const spreadPct = (midPrice(shortPut) > 0)
          ? ((parseFloat(shortPut.ask) - parseFloat(shortPut.bid)) / parseFloat(shortPut.ask))
          : 1;

        const ts = trendScore({
          ev, ivr, directionScore, winRate,
          spreadPct, oi: parseInt(shortPut.open_interest, 10) || 0,
        });

        // 支撐對齊：PCS 賣腿應靠近支撐（Notion: 選在支撐線上做 PCS）
        const distToSupport = support ? Math.abs(shortPut._strike - support) / underlyingPrice : 999;
        const supportAligned = support ? distToSupport < 0.05 : true; // within 5% of support

        // Vega/Theta 評估
        const greekAssess = assessGreeks('Bull Put Spread',
          parseFloat(shortPut.vega) || 0, parseFloat(shortPut.theta) || 0,
          parseFloat(longPut.vega) || 0, parseFloat(longPut.theta) || 0);

        // 成交量確認（Notion: 觀察支撐點成交量增加）
        const volConfirm = volumeAnalysis ? (volumeAnalysis.spike && volumeAnalysis.nearSupport) : false;

        spreads.push({
          strategy: 'Bull Put Spread',
          shortStrike: shortPut._strike,
          longStrike: longPut._strike,
          supportAligned, distToSupport: +distToSupport.toFixed(4),
          vegaNote: greekAssess.vegaNote, thetaNote: greekAssess.thetaNote,
          netVega: greekAssess.netVega, netTheta: greekAssess.netTheta,
          volumeConfirm: volConfirm,
          expDate,
          dte,
          credit: +credit.toFixed(4),
          ev: +ev.toFixed(4),
          evRange: calcEVRange(shortPut, longPut, winRate, width, true),
          kelly: +k.toFixed(4),
          winRate: +winRate.toFixed(4),
          margin: +maxLoss.toFixed(4),
          returnRate: +(credit / maxLoss).toFixed(4),
          takeProfit: +(credit * 0.5).toFixed(4),   // 50% credit 止盈
          stopLoss:   +(credit * 1.3).toFixed(4),   // Notion: credit×1.3 = 虧損30%出場
          shortDelta: +(parseFloat(shortPut.delta) || 0).toFixed(4),
          shortTheta: +(parseFloat(shortPut.theta) || 0).toFixed(4),
          shortVega:  +(parseFloat(shortPut.vega)  || 0).toFixed(4),
          shortGamma: +(parseFloat(shortPut.gamma) || 0).toFixed(4),
          trendScore: +ts.toFixed(4),
        });
      }
    }

    // ─── Bear Call Spread / Call Credit Spread (credit, 看空) ────
    // Event risk: skip income strategies when CPI/FOMC/NFP within 2 days
    if (!hasEconEventRisk && (direction === 'bearish' || direction === 'neutral')
        && ivr >= IVR_MIN_CCS && ivr <= IVR_MAX_CCS
        && dte >= DTE_MIN_CREDIT && dte <= DTE_MAX_CREDIT) {
      // Notion LV2: 賣腿 Delta 0.15 區間, IVR 30-50, DTE 14-30
      for (const shortCall of calls) {
        const sd = Math.abs(parseFloat(shortCall.delta) || 0);
        if (sd < CCS_DELTA_MIN || sd > CCS_DELTA_MAX) continue;
        if (!passesLiquidity(shortCall)) continue;

        const longCandidates = calls.filter(c =>
          c._strike > shortCall._strike && passesLiquidity(c)
        );
        if (longCandidates.length === 0) continue;

        const longCall = longCandidates.sort((a, b) =>
          (parseInt(b.open_interest, 10) || 0) - (parseInt(a.open_interest, 10) || 0)
        )[0];

        const credit  = midPrice(shortCall) - midPrice(longCall);
        if (credit <= 0) continue;
        const width   = longCall._strike - shortCall._strike;
        const maxLoss = width - credit;
        if (maxLoss <= 0) continue;

        const winRate = 1 - sd; // P(OTM) for short call = 1 - |delta|
        const ev      = credit * winRate - maxLoss * (1 - winRate);
        if (ev <= 0) continue;

        const k = kelly(winRate, credit / maxLoss);
        if (k < KELLY_MIN) continue;

        // Notion: 報酬比至少 1:3
        if (credit / maxLoss < 1 / REWARD_RISK_MIN) continue;

        const spreadPct = (parseFloat(shortCall.ask) > 0)
          ? ((parseFloat(shortCall.ask) - parseFloat(shortCall.bid)) / parseFloat(shortCall.ask))
          : 1;

        const ts = trendScore({
          ev, ivr, directionScore, winRate,
          spreadPct, oi: parseInt(shortCall.open_interest, 10) || 0,
        });

        // 壓力對齊：CCS 賣腿應靠近壓力（Notion: 回測不衝破壓力即可收租）
        const distToResistance = resistance ? Math.abs(shortCall._strike - resistance) / underlyingPrice : 999;
        const resistanceAligned = resistance ? distToResistance < 0.05 : true;

        // Vega/Theta 評估
        const greekAssessCCS = assessGreeks('Bear Call Spread',
          parseFloat(shortCall.vega) || 0, parseFloat(shortCall.theta) || 0,
          parseFloat(longCall.vega) || 0, parseFloat(longCall.theta) || 0);

        spreads.push({
          strategy: 'Bear Call Spread',
          shortStrike: shortCall._strike,
          longStrike: longCall._strike,
          resistanceAligned, distToResistance: +distToResistance.toFixed(4),
          vegaNote: greekAssessCCS.vegaNote, thetaNote: greekAssessCCS.thetaNote,
          netVega: greekAssessCCS.netVega, netTheta: greekAssessCCS.netTheta,
          expDate,
          dte,
          credit: +credit.toFixed(4),
          ev: +ev.toFixed(4),
          evRange: calcEVRange(shortCall, longCall, winRate, width, true),
          kelly: +k.toFixed(4),
          winRate: +winRate.toFixed(4),
          margin: +maxLoss.toFixed(4),
          returnRate: +(credit / maxLoss).toFixed(4),
          takeProfit: +(credit * 0.5).toFixed(4),   // 50% credit 止盈
          stopLoss:   +(credit * 1.3).toFixed(4),   // Notion: credit×1.3 = 虧損30%出場
          shortDelta: +(parseFloat(shortCall.delta) || 0).toFixed(4),
          shortTheta: +(parseFloat(shortCall.theta) || 0).toFixed(4),
          shortVega:  +(parseFloat(shortCall.vega)  || 0).toFixed(4),
          shortGamma: +(parseFloat(shortCall.gamma) || 0).toFixed(4),
          trendScore: +ts.toFixed(4),
        });
      }
    }

    // ─── Bull Call Spread / Call Debit Spread (debit, 看多) ────
    if (direction === 'bullish'
        && dte >= DTE_MIN_DEBIT && dte <= DTE_MAX_DEBIT
        && ivPercentile >= IVP_MIN_DEBIT && ivPercentile <= IVP_MAX_DEBIT) {
      // Notion LV1: 買腿 Delta 0.5, IVP 20-50
      for (const longCall of calls) {
        const ld = Math.abs(parseFloat(longCall.delta) || 0);
        if (ld < DEBIT_SPREAD_DELTA_MIN || ld > DEBIT_SPREAD_DELTA_MAX) continue;
        if (!passesLiquidity(longCall)) continue;

        const shortCandidates = calls.filter(c =>
          c._strike > longCall._strike && passesLiquidity(c)
        );
        if (shortCandidates.length === 0) continue;

        // Short call: highest OI above long call
        const shortCall = shortCandidates.sort((a, b) =>
          (parseInt(b.open_interest, 10) || 0) - (parseInt(a.open_interest, 10) || 0)
        )[0];

        const debit   = midPrice(longCall) - midPrice(shortCall);
        if (debit <= 0) continue;
        const width   = shortCall._strike - longCall._strike;
        const maxGain = width - debit;
        if (maxGain <= 0) continue;

        const winRate = ld; // long call delta ≈ P(ITM)
        const ev      = maxGain * winRate - debit * (1 - winRate);
        if (ev <= 0) continue;

        const k = kelly(winRate, maxGain / debit);
        if (k < KELLY_MIN) continue;

        const spreadPct = (parseFloat(longCall.ask) > 0)
          ? ((parseFloat(longCall.ask) - parseFloat(longCall.bid)) / parseFloat(longCall.ask))
          : 1;

        const ts = trendScore({
          ev, ivr, directionScore, winRate,
          spreadPct, oi: parseInt(longCall.open_interest, 10) || 0,
        });

        spreads.push({
          strategy: 'Bull Call Spread',
          longStrike: longCall._strike,
          shortStrike: shortCall._strike,
          expDate,
          dte,
          debit: +debit.toFixed(4),
          ev: +ev.toFixed(4),
          evRange: calcEVRange(shortCall, longCall, winRate, width, false),
          kelly: +k.toFixed(4),
          winRate: +winRate.toFixed(4),
          margin: +debit.toFixed(4),
          returnRate: +(maxGain / debit).toFixed(4),
          takeProfit: +(debit * 2.0).toFixed(4),   // 100% gain
          stopLoss:   +(debit * 0.7).toFixed(4),   // Notion: debit×70% = 虧損30%出場
          shortDelta: +(parseFloat(shortCall.delta) || 0).toFixed(4),
          shortTheta: +(parseFloat(shortCall.theta) || 0).toFixed(4),
          shortVega:  +(parseFloat(shortCall.vega)  || 0).toFixed(4),
          shortGamma: +(parseFloat(shortCall.gamma) || 0).toFixed(4),
          trendScore: +ts.toFixed(4),
        });
      }
    }

    // ─── Bear Put Spread / Put Debit Spread (debit, 看空) ─────
    if (direction === 'bearish'
        && dte >= DTE_MIN_DEBIT && dte <= DTE_MAX_DEBIT
        && ivPercentile >= IVP_MIN_DEBIT && ivPercentile <= IVP_MAX_DEBIT) {
      // Notion LV2: 買腿 Delta 0.5, IVP 30-50
      for (const longPut of puts) {
        const ld = Math.abs(parseFloat(longPut.delta) || 0);
        if (ld < DEBIT_SPREAD_DELTA_MIN || ld > DEBIT_SPREAD_DELTA_MAX) continue;
        if (!passesLiquidity(longPut)) continue;

        const shortCandidates = puts.filter(p =>
          p._strike < longPut._strike && passesLiquidity(p)
        );
        if (shortCandidates.length === 0) continue;

        const shortPut = shortCandidates.sort((a, b) =>
          (parseInt(b.open_interest, 10) || 0) - (parseInt(a.open_interest, 10) || 0)
        )[0];

        const debit   = midPrice(longPut) - midPrice(shortPut);
        if (debit <= 0) continue;
        const width   = longPut._strike - shortPut._strike;
        const maxGain = width - debit;
        if (maxGain <= 0) continue;

        const winRate = ld; // long put |delta| ≈ P(ITM) for puts
        const ev      = maxGain * winRate - debit * (1 - winRate);
        if (ev <= 0) continue;

        const k = kelly(winRate, maxGain / debit);
        if (k < KELLY_MIN) continue;

        const spreadPct = (parseFloat(longPut.ask) > 0)
          ? ((parseFloat(longPut.ask) - parseFloat(longPut.bid)) / parseFloat(longPut.ask))
          : 1;

        const ts = trendScore({
          ev, ivr, directionScore, winRate,
          spreadPct, oi: parseInt(longPut.open_interest, 10) || 0,
        });

        spreads.push({
          strategy: 'Bear Put Spread',
          longStrike: longPut._strike,
          shortStrike: shortPut._strike,
          expDate,
          dte,
          debit: +debit.toFixed(4),
          ev: +ev.toFixed(4),
          evRange: calcEVRange(shortPut, longPut, winRate, longPut._strike - shortPut._strike, false),
          kelly: +k.toFixed(4),
          winRate: +winRate.toFixed(4),
          margin: +debit.toFixed(4),
          returnRate: +(maxGain / debit).toFixed(4),
          takeProfit: +(debit * 2.0).toFixed(4),   // 100% gain
          stopLoss:   +(debit * 0.7).toFixed(4),   // Notion: debit×70% = 虧損30%出場
          shortDelta: +(parseFloat(shortPut.delta) || 0).toFixed(4),
          shortTheta: +(parseFloat(shortPut.theta) || 0).toFixed(4),
          shortVega:  +(parseFloat(shortPut.vega)  || 0).toFixed(4),
          shortGamma: +(parseFloat(shortPut.gamma) || 0).toFixed(4),
          trendScore: +ts.toFixed(4),
        });
      }
    }

    // ─── Iron Condor = Bear Call + Bull Put on same expiration ───
    // Event risk: skip income strategies when CPI/FOMC/NFP within 2 days
    if (!hasEconEventRisk && direction === 'neutral'
        && ivr >= IVR_MIN_IC
        && dte >= DTE_MIN_IC && dte <= DTE_MAX_IC) {
      // Notion: IVR>30, DTE 20-30, Delta ±0.10-0.15
      // Collect qualifying bear calls and bull puts already computed above
      // We'll assemble them after the loop by pairing best bear call + best bull put.
      // (already pushed individually; Iron Condor is an additional entry)
      const bcSpreads = spreads.filter(s =>
        s.strategy === 'Bear Call Spread' && s.expDate === expDate
      );
      const bpSpreads = spreads.filter(s =>
        s.strategy === 'Bull Put Spread' && s.expDate === expDate
      );

      if (bcSpreads.length > 0 && bpSpreads.length > 0) {
        // best of each by trendScore
        const bc = [...bcSpreads].sort((a, b) => b.trendScore - a.trendScore)[0];
        const bp = [...bpSpreads].sort((a, b) => b.trendScore - a.trendScore)[0];

        // Verify no strike overlap
        if (bp.shortStrike < bc.shortStrike) {
          const combinedCredit  = +(bc.credit + bp.credit).toFixed(4);
          // Fix: IC maxLoss = wider wing width - combined credit (not max of individual margins)
          // Bear Call: longStrike > shortStrike; Bull Put: shortStrike > longStrike
          const callWing = bc.longStrike - bc.shortStrike;
          const putWing  = bp.shortStrike - bp.longStrike;
          const wingWidth = Math.max(callWing, putWing);
          const combinedMaxLoss = +(wingWidth - combinedCredit).toFixed(4);
          if (combinedMaxLoss <= 0) continue; // sanity check
          const combinedWinRate = bc.winRate * bp.winRate;         // both expire OTM
          const combinedEV      = combinedCredit * combinedWinRate
                                  - combinedMaxLoss * (1 - combinedWinRate);

          if (combinedEV > 0) {
            const k = kelly(combinedWinRate, combinedCredit / combinedMaxLoss);
            if (k >= KELLY_MIN) {
              const icTs = (bc.trendScore + bp.trendScore) / 2;
              spreads.push({
                strategy: 'Iron Condor',
                // put side
                putShortStrike: bp.shortStrike,
                putLongStrike:  bp.longStrike,
                // call side
                callShortStrike: bc.shortStrike,
                callLongStrike:  bc.longStrike,
                expDate,
                dte,
                credit:     combinedCredit,
                ev:         +combinedEV.toFixed(4),
                kelly:      +k.toFixed(4),
                winRate:    +combinedWinRate.toFixed(4),
                margin:     +combinedMaxLoss.toFixed(4),
                returnRate: +(combinedCredit / combinedMaxLoss).toFixed(4),
                takeProfit: +(combinedCredit * 0.5).toFixed(4),
                stopLoss:   +(combinedCredit * 2.0).toFixed(4),
                // Greeks from short call (primary risk leg)
                shortDelta: bc.shortDelta,
                shortTheta: bc.shortTheta,
                shortVega:  bc.shortVega,
                shortGamma: bc.shortGamma,
                trendScore: +icTs.toFixed(4),
              });
            }
          }
        }
      }
    }
  }

  return spreads.sort((a, b) => b.trendScore - a.trendScore);
}

// ─────────────────────────────────────────────────────────────
// 10.  IV SKEW
// ─────────────────────────────────────────────────────────────
/*
  For the nearest qualifying expiration, find ATM put IV and ATM call IV from CBOE.
  Skew = (ATM put IV) - (ATM call IV)
  Positive skew → investors buying more put protection → bearish sentiment.
*/
function calcIvSkew(optsByExpType, underlyingPrice) {
  // Find first expiration within DTE range
  const expDates = Object.keys(optsByExpType)
    .filter(e => { const d = daysToExpiry(e); return d >= DTE_MIN && d <= DTE_MAX; })
    .sort();
  if (expDates.length === 0) return 0;

  const exp = expDates[0];
  const puts  = [...(optsByExpType[exp]?.['P']?.values() || [])];
  const calls = [...(optsByExpType[exp]?.['C']?.values() || [])];

  if (puts.length === 0 || calls.length === 0) return 0;

  // ATM = strike closest to underlying price
  const atmPut  = puts.sort((a, b) =>
    Math.abs(a._strike - underlyingPrice) - Math.abs(b._strike - underlyingPrice)
  )[0];
  const atmCall = calls.sort((a, b) =>
    Math.abs(a._strike - underlyingPrice) - Math.abs(b._strike - underlyingPrice)
  )[0];

  const putIV  = parseFloat(atmPut?.iv)  || 0;
  const callIV = parseFloat(atmCall?.iv) || 0;
  return putIV && callIV ? putIV - callIV : 0;
}

// ─────────────────────────────────────────────────────────────
// 11.  DIRECTION SCORING
// ─────────────────────────────────────────────────────────────
function scoreDirection(rsi, price, ma20, ivSkew, macd) {
  // ── Notion 規則對齊 ──
  // RSI < 50 = 偏空（順勢做空），RSI > 50 = 偏多（順勢做多）
  // 注意：這是「趨勢跟隨」邏輯，不是「超賣反彈」邏輯
  let score = 0;
  const reasons = [];

  if (rsi !== null) {
    if (rsi < 30)      { score -= 2; reasons.push(`RSI=${rsi.toFixed(1)} <30 → 強烈偏空(-2)`); }
    else if (rsi < 50) { score -= 1; reasons.push(`RSI=${rsi.toFixed(1)} <50 → 偏空(-1)`); }
    else if (rsi > 70) { score += 2; reasons.push(`RSI=${rsi.toFixed(1)} >70 → 強烈偏多(+2)`); }
    else if (rsi > 50) { score += 1; reasons.push(`RSI=${rsi.toFixed(1)} >50 → 偏多(+1)`); }
    else { reasons.push(`RSI=${rsi.toFixed(1)} =50 中性(0)`); }
  }

  if (ma20 !== null) {
    if (price > ma20) { score += 1; reasons.push(`價格${price.toFixed(2)} > MA20 ${ma20.toFixed(2)} → 偏多(+1)`); }
    else              { score -= 1; reasons.push(`價格${price.toFixed(2)} < MA20 ${ma20.toFixed(2)} → 偏空(-1)`); }
  }

  if (ivSkew > 0.02)       { score -= 1; reasons.push(`IVSkew=${ivSkew.toFixed(4)} >0.02 → 偏空(-1)`); }
  else if (ivSkew < -0.02) { score += 1; reasons.push(`IVSkew=${ivSkew.toFixed(4)} <-0.02 → 偏多(+1)`); }
  else                      { reasons.push(`IVSkew=${ivSkew.toFixed(4)} 中性(0)`); }

  // MACD (Notion: 每個策略都要求確認)
  if (macd !== null) {
    if (macd.cross === 'death')  { score -= 1; reasons.push(`MACD死叉 → 偏空(-1)`); }
    else if (macd.cross === 'golden') { score += 1; reasons.push(`MACD金叉 → 偏多(+1)`); }
    else if (macd.histogram < 0) { reasons.push(`MACD柱狀<0 偏空(參考)`); }
    else if (macd.histogram > 0) { reasons.push(`MACD柱狀>0 偏多(參考)`); }
  }

  let direction;
  if (score >= 2)       direction = 'bullish';
  else if (score <= -2) direction = 'bearish';
  else                  direction = 'neutral';

  return { direction, directionScore: score, directionReasons: reasons };
}

// ─────────────────────────────────────────────────────────────
// 12.  MAIN LOOP
// ─────────────────────────────────────────────────────────────
const results = [];

// 12a. Fetch tastytrade market-metrics for all symbols in one call
const allTickers = symbols.map(s => s.ticker).join(',');
const metricsUrl = `https://api.tastyworks.com/market-metrics?symbols=${allTickers}`;
log(`Fetching market-metrics: ${metricsUrl}`);
const metricsData = await httpGet.call(this, metricsUrl, ttHeaders, 'market-metrics');

const metricsMap = {};
if (metricsData?.data?.items) {
  for (const item of metricsData.data.items) {
    metricsMap[item.symbol] = item;
  }
  log(`market-metrics: received ${Object.keys(metricsMap).length} symbols`);
} else {
  log('WARNING: market-metrics returned no items');
}

// 12b. MARKET REGIME — 盤勢判斷（第一層過濾）
// Fetch VIX
let vixValue = null;
let spyDirection = null;
let spyDirScore = 0;
let spyDirReasons = [];
let marketRegime = 'normal'; // normal | caution | bearOnly | halt
let marketRegimeReasons = [];

try {
  const vixUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d';
  const vixData = await httpGet.call(this, vixUrl, { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, 'YF:VIX');
  if (vixData?.chart?.result?.[0]?.meta) {
    vixValue = vixData.chart.result[0].meta.regularMarketPrice || vixData.chart.result[0].meta.previousClose;
    log(`VIX = ${vixValue}`);
  }
} catch(e) { log(`VIX fetch error: ${e.message}`); }

// Fetch SPY technicals for market direction
try {
  const spyUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=60d';
  const spyYF = await httpGet.call(this, spyUrl, { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, 'YF:SPY-regime');
  if (spyYF?.chart?.result?.[0]) {
    const q = spyYF.chart.result[0].indicators?.quote?.[0];
    if (q) {
      const spyCloses = (q.close || []).filter(c => c != null);
      const spyPrice = spyCloses[spyCloses.length - 1];
      const spyRSI = calcRSI(spyCloses, 14);
      const spyMA20 = calcMA(spyCloses, 20);
      const spyMACD = calcMACD(spyCloses);
      const spyDir = scoreDirection(spyRSI, spyPrice, spyMA20, 0, spyMACD);
      spyDirection = spyDir.direction;
      spyDirScore = spyDir.directionScore;
      spyDirReasons = spyDir.directionReasons;
      log(`SPY regime: direction=${spyDirection} score=${spyDirScore} price=${spyPrice?.toFixed(2)} RSI=${spyRSI?.toFixed(1)}`);
    }
  }
} catch(e) { log(`SPY regime fetch error: ${e.message}`); }

// Determine market regime
if (vixValue !== null && vixValue >= 35) {
  marketRegime = 'halt';
  marketRegimeReasons.push(`VIX=${vixValue.toFixed(1)} ≥ 35 → 極端恐慌，全面暫停`);
} else if (vixValue !== null && vixValue >= 25 && spyDirScore <= -2) {
  marketRegime = 'bearOnly';
  marketRegimeReasons.push(`VIX=${vixValue.toFixed(1)} ≥ 25 + SPY偏空(${spyDirScore}) → 只推 Bear 策略`);
} else if (vixValue !== null && vixValue >= 25) {
  marketRegime = 'caution';
  marketRegimeReasons.push(`VIX=${vixValue.toFixed(1)} ≥ 25 → 高波動警戒，謹慎推薦`);
} else if (spyDirScore <= -3) {
  marketRegime = 'bearOnly';
  marketRegimeReasons.push(`SPY強烈偏空(score=${spyDirScore}) → 只推 Bear 策略`);
} else {
  marketRegime = 'normal';
  if (vixValue !== null) marketRegimeReasons.push(`VIX=${vixValue.toFixed(1)} 正常`);
  if (spyDirection) marketRegimeReasons.push(`SPY方向=${spyDirection}(${spyDirScore})`);
}

log(`Market Regime: ${marketRegime} — ${marketRegimeReasons.join(', ')}`);

// If halt, skip all signals
if (marketRegime === 'halt') {
  return [{ json: {
    results: [],
    marketRegime,
    marketRegimeReasons,
    vix: vixValue,
    spyDirection, spyDirScore, spyDirReasons,
    debugLog,
    analysisTime: new Date().toISOString(),
    version: 'v3.4',
    halted: true,
    haltReason: `VIX=${vixValue?.toFixed(1)} ≥ 35，極端恐慌，全面暫停推播`,
  } }];
}

// 12c. Fetch earnings calendar (Finnhub)
let earningsMap = {};
try {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + EARNINGS_BLACKOUT_DAYS * 86400000).toISOString().slice(0, 10);
  const earnUrl = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${future}&token=${FINNHUB_KEY}`;
  const earnData = await httpGet.call(this, earnUrl, {}, 'Finnhub-earnings');
  if (earnData?.earningsCalendar) {
    for (const e of earnData.earningsCalendar) {
      earningsMap[e.symbol] = e.date;
    }
    log(`Earnings blackout: ${Object.keys(earningsMap).length} symbols have earnings in next ${EARNINGS_BLACKOUT_DAYS} days`);
  }
} catch(e) { log(`Earnings fetch error: ${e.message}`); }

// 12d-pre. Event Risk Calendar Check (2026 CPI/FOMC/NFP)
const EVENT_DATES_2026 = ['2026-01-09','2026-01-13','2026-01-28','2026-02-11','2026-02-13','2026-03-06','2026-03-11','2026-03-18','2026-04-03','2026-04-10','2026-04-29','2026-05-08','2026-05-12','2026-06-05','2026-06-10','2026-06-17','2026-07-02','2026-07-14','2026-07-29','2026-08-07','2026-08-12','2026-09-04','2026-09-11','2026-09-16','2026-10-02','2026-10-14','2026-10-28','2026-11-06','2026-11-10','2026-12-04','2026-12-09','2026-12-10'];
const EVENT_TYPE_MAP = {'01-09':'NFP','01-13':'CPI','01-28':'FOMC','02-11':'NFP','02-13':'CPI','03-06':'NFP','03-11':'CPI','03-18':'FOMC','04-03':'NFP','04-10':'CPI','04-29':'FOMC','05-08':'NFP','05-12':'CPI','06-05':'NFP','06-10':'CPI','06-17':'FOMC','07-02':'NFP','07-14':'CPI','07-29':'FOMC','08-07':'NFP','08-12':'CPI','09-04':'NFP','09-11':'CPI','09-16':'FOMC','10-02':'NFP','10-14':'CPI','10-28':'FOMC','11-06':'NFP','11-10':'CPI','12-04':'NFP','12-09':'FOMC','12-10':'CPI'};
const todayStr = new Date().toISOString().slice(0,10);
const in2daysStr = new Date(Date.now() + 2*86400000).toISOString().slice(0,10);
const upcomingEconEvents = EVENT_DATES_2026.filter(d => d >= todayStr && d <= in2daysStr);
const hasEconEventRisk = upcomingEconEvents.length > 0;
const econEventLabel = upcomingEconEvents.map(d => EVENT_TYPE_MAP[d.slice(5)] + ' ' + d.slice(5)).join(', ');
if (hasEconEventRisk) {
  log(`⚠️ Event Risk: ${econEventLabel} — income strategies will be blocked, debit strategies allowed`);
}

// 12d. Process each symbol
const sectorCount = {}; // track per-sector recommendations
for (const sym of symbols) {
  const { ticker, name } = sym;
  const sector = sym.sector || 'other';
  log(`\n=== Processing ${ticker} ===`);

  // ── 12b-i. Yahoo Finance (technical analysis) ──────────────
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=60d`;
  const yfData = await httpGet.call(this, yfUrl, {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json',
  }, `YF:${ticker}`);

  let underlyingPrice = null, rsi = null, ma20 = null, support = null, resistance = null, macd = null;
  const closes = [], highs = [], lows = [];

  if (yfData?.chart?.result?.[0]) {
    const res = yfData.chart.result[0];
    const q   = res.indicators?.quote?.[0];
    if (q) {
      const rawCloses = q.close  || [];
      const rawHighs  = q.high   || [];
      const rawLows   = q.low    || [];
      // Filter out null values
      for (let i = 0; i < rawCloses.length; i++) {
        if (rawCloses[i] != null && rawHighs[i] != null && rawLows[i] != null) {
          closes.push(rawCloses[i]);
          highs.push(rawHighs[i]);
          lows.push(rawLows[i]);
        }
      }
      underlyingPrice = closes[closes.length - 1] || null;
      rsi        = calcRSI(closes, 14);
      macd       = calcMACD(closes);
      ma20       = calcMA(closes, 20);
      support    = calcSupport(lows, 20);
      resistance = calcResistance(highs, 20);
      log(`${ticker}: price=${underlyingPrice?.toFixed(2)} RSI=${rsi?.toFixed(1)} MA20=${ma20?.toFixed(2)} MACD=${macd?.cross || 'none'}`);
    }
  } else {
    log(`${ticker}: Yahoo Finance data unavailable`);
  }

  if (!underlyingPrice) {
    log(`${ticker}: SKIP — no underlying price`);
    continue;
  }

  // ── 財報日曆黑名單 ──
  if (earningsMap[ticker]) {
    log(`${ticker}: SKIP — 財報日 ${earningsMap[ticker]}（黑名單期間 ${EARNINGS_BLACKOUT_DAYS} 天）`);
    results.push({ ticker, name, underlyingPrice: +underlyingPrice.toFixed(4), error: `財報日 ${earningsMap[ticker]} 在黑名單期間`, positiveEVSpreads: [] });
    continue;
  }

  // ── 成交量分析 ──
  const volumes = [];
  if (yfData?.chart?.result?.[0]?.indicators?.quote?.[0]?.volume) {
    const rawVols = yfData.chart.result[0].indicators.quote[0].volume;
    for (const v of rawVols) { if (v != null) volumes.push(v); }
  }
  const volumeAnalysis = analyzeVolume(volumes, closes, 20);
  log(`${ticker}: Vol ratio=${volumeAnalysis.ratio} spike=${volumeAnalysis.spike} nearSupport=${volumeAnalysis.nearSupport}`);

  // ── 盤前/盤後資料標記 ──
  const yfMeta = yfData?.chart?.result?.[0]?.meta || {};
  const marketState = yfMeta.currentTradingPeriod?.regular ? 'regular' : (yfMeta.currentTradingPeriod?.pre ? 'pre' : 'post');

  // ── 12b-ii. tastytrade market-metrics ──────────────────────
  const metrics = metricsMap[ticker] || {};
  // IVR is 0-1 decimal in tastytrade (tos-implied-volatility-index-rank)
  const ivr          = parseFloat(metrics['tos-implied-volatility-index-rank']) || 0;
  const ivPercentile = parseFloat(metrics['implied-volatility-percentile'])     || 0;
  const iv           = parseFloat(metrics['implied-volatility-index'])           || 0;
  log(`${ticker}: IVR=${ivr.toFixed(2)} IV%ile=${ivPercentile.toFixed(2)} IV=${iv.toFixed(4)}`);

  // ── 12b-iii. CBOE delayed quotes ───────────────────────────
  // CBOE uses uppercase root; for symbols with class suffix (e.g. BRK/B → BRKB) we just use the ticker
  const cboeRoot   = ticker.replace(/[^A-Z]/g, '');
  const cboeUrl    = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeRoot}.json`;
  log(`Fetching CBOE: ${cboeUrl}`);
  const cboeData   = await httpGet.call(this, cboeUrl, {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json',
  }, `CBOE:${ticker}`);

  if (!cboeData?.data?.options || cboeData.data.options.length === 0) {
    log(`${ticker}: SKIP — CBOE data unavailable or empty`);
    continue;
  }

  // Build index: { [expDate]: { C: Map<strike, opt>, P: Map<strike, opt> } }
  const optsByExpType = {};
  let cboeCount = 0;
  for (const opt of cboeData.data.options) {
    const parsed = parseCboeSymbol(opt.option || '');
    if (!parsed) continue;
    const { expDate, type, strike } = parsed;
    const dte = daysToExpiry(expDate);
    if (dte < DTE_MIN - 5 || dte > DTE_MAX + 5) continue; // ± 5 day buffer for indexing
    if (!optsByExpType[expDate]) optsByExpType[expDate] = { C: new Map(), P: new Map() };
    opt._strike = strike;  // attach parsed strike for convenience
    optsByExpType[expDate][type].set(strike, opt);
    cboeCount++;
  }
  log(`${ticker}: CBOE indexed ${cboeCount} options across ${Object.keys(optsByExpType).length} expirations`);

  if (cboeCount === 0) {
    log(`${ticker}: SKIP — no CBOE options in DTE range`);
    continue;
  }

  // ── 12b-iv. IV Skew ────────────────────────────────────────
  const ivSkew = calcIvSkew(optsByExpType, underlyingPrice);
  log(`${ticker}: IV Skew=${ivSkew.toFixed(4)}`);

  // ── 12b-v. Direction scoring ────────────────────────────────
  let { direction, directionScore, directionReasons } =
    scoreDirection(rsi, underlyingPrice, ma20, ivSkew, macd);
  
  // 盤勢過濾：根據 market regime 調整個股方向
  if (marketRegime === 'bearOnly') {
    if (direction === 'bullish') {
      direction = 'neutral'; // 降級：不做純多
      directionReasons.push(`⚠️ 盤勢bearOnly: bullish→neutral（不推Bull策略）`);
    }
  } else if (marketRegime === 'caution') {
    directionReasons.push(`⚠️ 盤勢caution: VIX偏高，信號需謹慎`);
  }
  log(`${ticker}: direction=${direction} score=${directionScore} regime=${marketRegime}`);

  // ── 12b-vi. Build spreads ───────────────────────────────────
  let positiveEVSpreads = buildSpreads(
    optsByExpType, underlyingPrice, direction, ivr, ivPercentile, directionScore, support, resistance, volumeAnalysis
  );
  log(`${ticker}: ${positiveEVSpreads.length} positive-EV spreads found`);

  // Fix: Credit fallback — if no credit spreads found and direction allows it,
  // log warning for teacher review (debit spreads may still be available)
  const hasCreditSpread = positiveEVSpreads.some(s => ['Bull Put Spread', 'Bear Call Spread', 'Iron Condor'].includes(s.strategy));
  const hasDebitSpread = positiveEVSpreads.some(s => ['Bull Call Spread', 'Bear Put Spread'].includes(s.strategy));
  if (!hasCreditSpread && (direction === 'bullish' || direction === 'bearish') && ivr >= 0.25) {
    log(`${ticker}: ⚠️ Credit fallback — no credit spreads passed filters (IVR=${(ivr*100).toFixed(0)}%, direction=${direction}). Only debit spreads available. Check if reward:risk threshold is too strict.`);
  }

  results.push({
    ticker,
    name,
    sector,
    underlyingPrice: +underlyingPrice.toFixed(4),
    volumeRatio: volumeAnalysis?.ratio || 0,
    volumeSpike: volumeAnalysis?.spike || false,
    marketState: marketState || 'unknown',
    iv:              +iv.toFixed(4),
    ivr:             +ivr.toFixed(4),
    ivPercentile:    +ivPercentile.toFixed(4),
    direction,
    directionScore,
    directionReasons,
    rsi:         rsi        !== null ? +rsi.toFixed(2)        : null,
    ma20:        ma20       !== null ? +ma20.toFixed(4)       : null,
    support:     support    !== null ? +support.toFixed(4)    : null,
    resistance:  resistance !== null ? +resistance.toFixed(4) : null,
    ivSkew:      +ivSkew.toFixed(4),
    marketRegime,
    macd:        macd ? { histogram: +macd.histogram.toFixed(4), cross: macd.cross } : null,
    positiveEVSpreads,
  });
}

// ─────────────────────────────────────────────────────────────
// 13.  OUTPUT
// ─────────────────────────────────────────────────────────────
// Sort results by trend score
results.sort((a, b) => {
  const aScore = a.positiveEVSpreads?.[0]?.trendScore || 0;
  const bScore = b.positiveEVSpreads?.[0]?.trendScore || 0;
  return bScore - aScore;
});

// 同產業限制 + 最大推薦數
const finalResults = [];
const sectorUsed = {};
for (const r of results) {
  if (!r.positiveEVSpreads || r.positiveEVSpreads.length === 0) {
    finalResults.push(r); // keep symbols with no spreads for debug
    continue;
  }
  const sec = r.sector || 'other';
  sectorUsed[sec] = (sectorUsed[sec] || 0) + 1;
  if (sec !== 'index' && sectorUsed[sec] > MAX_PER_SECTOR) {
    log(`${r.ticker}: SKIP — 同產業(${sec})已有 ${MAX_PER_SECTOR} 檔`);
    r.skippedReason = `同產業(${sec})限制`;
    r.positiveEVSpreads = []; // clear spreads
  }
  finalResults.push(r);
}

// 最大推薦數限制
const withSpreads = finalResults.filter(r => r.positiveEVSpreads?.length > 0);
if (withSpreads.length > MAX_TOTAL_SIGNALS) {
  log(`Capping from ${withSpreads.length} to ${MAX_TOTAL_SIGNALS} symbols`);
  const topTickers = new Set(withSpreads.slice(0, MAX_TOTAL_SIGNALS).map(r => r.ticker));
  for (const r of finalResults) {
    if (r.positiveEVSpreads?.length > 0 && !topTickers.has(r.ticker)) {
      r.skippedReason = `超過最大推薦數 ${MAX_TOTAL_SIGNALS}`;
      r.positiveEVSpreads = [];
    }
  }
}

const results_final = finalResults;

return [{
  json: {
    results: results_final,
    marketRegime,
    marketRegimeReasons,
    vix: vixValue,
    spyDirection, spyDirScore, spyDirReasons,
    debugLog,
    analysisTime: new Date().toISOString(),
    version: 'v3.4',
  },
}];
