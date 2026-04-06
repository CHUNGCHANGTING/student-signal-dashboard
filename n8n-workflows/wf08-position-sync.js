// === CBOE Option Chain Proxy Route ===
const inputData = $input.first().json;
const action = (inputData.body?.action || inputData.query?.action || '').toLowerCase();

if (action === 'cboe-proxy' || action === 'cboe') {
  // Batch support: ?symbols=KO,JNJ,CBOE or single ?symbol=KO
  const body = inputData.body || {};
  const query = inputData.query || {};
  const singleSym = (body.symbol || query.symbol || '').toUpperCase().replace(/[^A-Z,]/g, '');
  const multiSym = (body.symbols || query.symbols || '').toUpperCase().replace(/[^A-Z,]/g, '');
  const symbolList = (multiSym || singleSym).split(',').filter(s => s.length > 0);

  if (symbolList.length === 0) {
    return [{ json: { error: 'Missing symbol(s)', results: {} } }];
  }

  // Fetch all symbols in parallel
  const results = {};
  await Promise.all(symbolList.map(async (sym) => {
    try {
      const cboeResp = await this.helpers.httpRequest({
        method: 'GET',
        url: `https://cdn.cboe.com/api/global/delayed_quotes/options/${sym}.json`,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        returnFullResponse: true,
        ignoreHttpStatusErrors: true,
        timeout: 15000
      });
      if (cboeResp.statusCode !== 200) {
        results[sym] = { error: 'CBOE ' + cboeResp.statusCode, options: [] };
        return;
      }
      const cboeData = typeof cboeResp.body === 'string' ? JSON.parse(cboeResp.body) : cboeResp.body;
      results[sym] = {
        count: (cboeData?.data?.options || []).length,
        options: (cboeData?.data?.options || []).map(o => ({
          option: o.option, bid: o.bid, ask: o.ask, delta: o.delta,
          open_interest: o.open_interest, volume: o.volume, iv: o.iv
        }))
      };
    } catch(e) {
      results[sym] = { error: e.message, options: [] };
    }
  }));

  // Single symbol backward compat
  if (symbolList.length === 1) {
    const sym = symbolList[0];
    const r = results[sym];
    return [{ json: { symbol: sym, count: r.count || 0, options: r.options || [], error: r.error } }];
  }
  return [{ json: { batch: true, symbols: symbolList, results } }];
}

// === tastytrade OAuth Token Proxy (Dashboard uses this to get access token) ===
const TT_CLIENT_ID     = 'ec8b4453-d7e5-418e-8170-43e9b3e0b460';
const TT_CLIENT_SECRET = 'b09387c27e0cd0325cae0a910e43fc5f158ca109';
const TT_REFRESH_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCIsImtpZCI6ImxycXg3Wm5RNXJ3cHp6WXRTVjRhTjdMODhET0lWODEtRGpQZTVhVkdrcVUiLCJqa3UiOiJodHRwczovL2ludGVyaW9yLWFwaS5hcjIudGFzdHl0cmFkZS5zeXN0ZW1zL29hdXRoL2p3a3MifQ.eyJpc3MiOiJodHRwczovL2FwaS50YXN0eXRyYWRlLmNvbSIsInN1YiI6IlU1Y2FkZGU1ZS1kOGUzLTQyYmItYTljOC03YThiYjg5NWM2NTkiLCJpYXQiOjE3NzQzNzA3NTIsImF1ZCI6ImVjOGI0NDUzLWQ3ZTUtNDE4ZS04MTcwLTQzZTliM2UwYjQ2MCIsImdyYW50X2lkIjoiRzAyNGY3ZDIwLTk2MDgtNGVmYy1iYzVmLTQ3YzU2MWZlYzVhYSIsInNjb3BlIjoicmVhZCB0cmFkZSBvcGVuaWQifQ.iBKlWkK3DYbHxe3EkBOaU8tQghSq2_MlZpMcBLDgj32wPAew9nwJ-WV397ftK6ilWv_WiOPCuVfN0NNrQDg4Dw';

// === Gate 3: Account data for position checks ===
if (action === 'tt-account-data') {
  try {
    // Get fresh OAuth token
    const tokenResp = await this.helpers.httpRequest({
      method: 'POST', url: 'https://api.tastyworks.com/oauth/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chilldove-dashboard/1.0' },
      body: `grant_type=refresh_token&client_id=${TT_CLIENT_ID}&client_secret=${TT_CLIENT_SECRET}&refresh_token=${encodeURIComponent(TT_REFRESH_TOKEN)}`,
      returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 10000
    });
    const tokenData = typeof tokenResp.body === 'string' ? JSON.parse(tokenResp.body) : tokenResp.body;
    if (!tokenData.access_token) return [{ json: { error: 'token_failed' } }];
    const headers = { 'Authorization': 'Bearer ' + tokenData.access_token, 'User-Agent': 'chilldove-dashboard/1.0' };
    const acct = (inputData.body?.account || inputData.query?.account || '5WZ90854');

    // Parallel fetch: positions + balances
    const [posResp, balResp] = await Promise.all([
      this.helpers.httpRequest({ method: 'GET', url: `https://api.tastyworks.com/accounts/${acct}/positions`, headers, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 10000 }),
      this.helpers.httpRequest({ method: 'GET', url: `https://api.tastyworks.com/accounts/${acct}/balances`, headers, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 10000 })
    ]);
    const posData = typeof posResp.body === 'string' ? JSON.parse(posResp.body) : posResp.body;
    const balData = typeof balResp.body === 'string' ? JSON.parse(balResp.body) : balResp.body;

    const positions = (posData?.data?.items || []).map(p => ({
      symbol: p['underlying-symbol'] || p.symbol,
      type: p['instrument-type'],
      quantity: parseInt(p['quantity']) || 0,
      direction: p['quantity-direction'],
      strikePrice: p['strike-price'],
      optionType: p['option-type'],
      expirationDate: p['expiration-date'],
      averageOpenPrice: p['average-open-price'],
      closePrice: p['close-price'],
      currentPrice: p['mark'] || p['mark-price'],
      multiplier: parseInt(p['multiplier']) || 100,
      costEffect: p['average-daily-market-close-effect'],
    }));

    const bal = balData?.data || {};
    const balances = {
      netLiq: parseFloat(bal['net-liquidating-value']) || 0,
      cashBalance: parseFloat(bal['cash-balance']) || 0,
      optionBuyingPower: parseFloat(bal['derivative-buying-power']) || 0,
      equityBuyingPower: parseFloat(bal['equity-buying-power']) || 0,
      maintenanceRequirement: parseFloat(bal['maintenance-requirement']) || 0,
      maintenanceExcess: parseFloat(bal['maintenance-excess']) || 0,
      dayTradeExcess: parseFloat(bal['day-trade-excess']) || 0,
    };

    return [{ json: { positions, balances, account: acct } }];
  } catch(e) {
    return [{ json: { error: e.message, positions: [], balances: {} } }];
  }
}

if (action === 'tt-quote-level') {
  // Check if account has live or delayed quotes
  try {
    const tokenResp = await this.helpers.httpRequest({
      method: 'POST', url: 'https://api.tastyworks.com/oauth/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chilldove-dashboard/1.0' },
      body: `grant_type=refresh_token&client_id=${TT_CLIENT_ID}&client_secret=${TT_CLIENT_SECRET}&refresh_token=${encodeURIComponent(TT_REFRESH_TOKEN)}`,
      returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 10000
    });
    const tokenData = typeof tokenResp.body === 'string' ? JSON.parse(tokenResp.body) : tokenResp.body;
    if (!tokenData.access_token) return [{ json: { level: 'unknown', error: 'token_failed' } }];
    const quoteResp = await this.helpers.httpRequest({
      method: 'GET', url: 'https://api.tastyworks.com/api-quote-tokens',
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token, 'User-Agent': 'chilldove-dashboard/1.0' },
      returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 8000
    });
    const quoteData = typeof quoteResp.body === 'string' ? JSON.parse(quoteResp.body) : quoteResp.body;
    const level = quoteData?.data?.level || 'unknown';
    const url = quoteData?.data?.['dxlink-url'] || '';
    return [{ json: { level, dxlinkUrl: url, isLive: level === 'live' && url.includes('tasty-live') } }];
  } catch(e) {
    return [{ json: { level: 'unknown', error: e.message } }];
  }
}

if (action === 'tt-login' || action === 'tt-oauth') {
  // OAuth flow: exchange refresh token for access token (no password needed, no 2FA)
  try {
    const resp = await this.helpers.httpRequest({
      method: 'POST',
      url: 'https://api.tastyworks.com/oauth/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chilldove-dashboard/1.0' },
      body: `grant_type=refresh_token&client_id=${TT_CLIENT_ID}&client_secret=${TT_CLIENT_SECRET}&refresh_token=${encodeURIComponent(TT_REFRESH_TOKEN)}`,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
      timeout: 15000
    });
    const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
    if (data.access_token) {
      return [{ json: { data: { 'session-token': data.access_token, 'token-type': data.token_type, 'expires-in': data.expires_in }, auth: 'oauth' } }];
    } else {
      return [{ json: { error: { code: data.error || 'oauth_failed', message: data.error_description || 'OAuth token exchange failed' } } }];
    }
  } catch(e) {
    return [{ json: { error: { code: 'proxy_error', message: e.message } } }];
  }
}

// === Original WF-08 Logic Below ===
// ============================================================
// WF-08【持倉同步】Position Sync — Fetch from tastytrade → Serve to Dashboard
// ============================================================
// Two modes:
//   A) GET  /webhook/student-dashboard?student_id=S001  (Dashboard fetch)
//   B) POST /webhook/student-dashboard  (internal push to update cache)
//
// On GET: reads student's account → fetches live positions, balances,
//         orders → returns JSON for Dashboard rendering
// ============================================================

const TT_API = 'https://api.tastyworks.com';
// TT_CLIENT_ID, TT_CLIENT_SECRET, TT_REFRESH_TOKEN declared above in OAuth proxy section

let input;
try {
  const raw = $input.first().json;
  input = raw.body || raw;
} catch (e) {
  return [{ json: { success: false, error: 'Input read failed: ' + e.message } }];
}
const method = input.method || 'GET';

// ─────────────────────────────────────────────────────────────
// 1. RESOLVE STUDENT CREDENTIALS
// ─────────────────────────────────────────────────────────────
// In production, look up from Google Sheet "students" tab
// For now, accept from query params or lookup table
const STUDENT_DB = {
  'S001': {
    name: '老師 (Demo)',
    account_number: 'STUDENT_ACCOUNT',
    refresh_token: '' // Will be set via Dashboard binding
  }
  // Add more students as they bind accounts
};

const studentId = input.query?.student_id || input.student_id || 'S001';
const studentRecord = STUDENT_DB[studentId] || {};

// Direct input overrides DB lookup
const accountNumber = input.account_number || studentRecord.account_number;
const refreshToken = input.refresh_token || studentRecord.refresh_token;

if (!refreshToken || !accountNumber) {
  return [{ json: {
    success: false,
    error: 'Missing refresh_token or account_number. Pass via POST body or configure in student DB.',
    positions: [], signals: [], risk: {},
    bind_required: true,
    received_keys: Object.keys(input)
  }}];
}

// ─────────────────────────────────────────────────────────────
// 2. GET OAUTH ACCESS TOKEN
// ─────────────────────────────────────────────────────────────
let accessToken;
try {
  const tokenRes = await this.helpers.httpRequest({
    method: 'POST',
    url: `${TT_API}/oauth/token`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'chilldove-student-bot/1.0'
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${TT_CLIENT_ID}&client_secret=${TT_CLIENT_SECRET}`,
  });
  accessToken = tokenRes.access_token || tokenRes['access-token'] || tokenRes.token;
  if (!accessToken) throw new Error('No token');
} catch (e) {
  return [{ json: {
    success: false,
    error: `Auth failed: ${e.message}`,
    positions: [], signals: [], risk: {},
    auth_expired: true
  }}];
}

const authHeaders = {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'User-Agent': 'chilldove-student-bot/1.0'
};

// ─────────────────────────────────────────────────────────────
// 3. FETCH POSITIONS
// ─────────────────────────────────────────────────────────────
let positions = [];
try {
  const posRes = await this.helpers.httpRequest({
    method: 'GET',
    url: `${TT_API}/accounts/${accountNumber}/positions`,
    headers: authHeaders,
    ignoreHttpStatusErrors: true,
  });
  const rawPositions = posRes?.data?.items || posRes?.data || [];

  positions = rawPositions.map(p => ({
    symbol: p['underlying-symbol'] || p.symbol,
    instrument_type: p['instrument-type'],
    option_symbol: p.symbol,
    quantity: parseInt(p['quantity-direction'] === 'Short' ? `-${p.quantity}` : p.quantity),
    direction: p['quantity-direction'] || (parseInt(p.quantity) > 0 ? 'Long' : 'Short'),
    average_open_price: parseFloat(p['average-open-price'] || 0),
    close_price: parseFloat(p['close-price'] || 0),
    mark_price: parseFloat(p['mark-price'] || p['mark'] || 0),
    cost_effect: p['cost-effect'] || '',
    unrealized_pnl: parseFloat(p['unrealized-day-gain'] || 0),
    unrealized_pnl_pct: parseFloat(p['unrealized-day-gain-percent'] || 0),
    multiplier: parseInt(p.multiplier || 100),
    expiration: p['expires-at'] || '',
    strike_price: parseFloat(p['strike-price'] || 0),
    option_type: p['option-type'] || '', // Call or Put
    created_at: p['created-at'] || '',
  }));
} catch (e) {
  positions = [];
}

// ─────────────────────────────────────────────────────────────
// 4. FETCH ACCOUNT BALANCES
// ─────────────────────────────────────────────────────────────
let balances = {};
try {
  const balRes = await this.helpers.httpRequest({
    method: 'GET',
    url: `${TT_API}/accounts/${accountNumber}/balances`,
    headers: authHeaders,
    ignoreHttpStatusErrors: true,
  });
  const b = balRes?.data || {};
  balances = {
    net_liquidating_value: parseFloat(b['net-liquidating-value'] || 0),
    cash_balance: parseFloat(b['cash-balance'] || 0),
    buying_power: parseFloat(b['derivative-buying-power'] || b['equity-buying-power'] || 0),
    maintenance_requirement: parseFloat(b['maintenance-requirement'] || 0),
    pending_cash: parseFloat(b['pending-cash'] || 0),
    day_trade_buying_power: parseFloat(b['day-trade-buying-power'] || 0),
  };
} catch (e) {
  balances = {};
}

// ─────────────────────────────────────────────────────────────
// 5. FETCH LIVE ORDERS
// ─────────────────────────────────────────────────────────────
let liveOrders = [];
try {
  const ordRes = await this.helpers.httpRequest({
    method: 'GET',
    url: `${TT_API}/accounts/${accountNumber}/orders/live`,
    headers: authHeaders,
    ignoreHttpStatusErrors: true,
  });
  const rawOrders = ordRes?.data?.items || ordRes?.data || [];

  liveOrders = rawOrders.map(o => ({
    id: o.id,
    status: o.status,
    order_type: o['order-type'],
    time_in_force: o['time-in-force'],
    symbol: o['underlying-symbol'],
    price: parseFloat(o.price || 0),
    price_effect: o['price-effect'],
    stop_trigger: parseFloat(o['stop-trigger'] || 0),
    legs: (o.legs || []).map(l => ({
      symbol: l.symbol,
      action: l.action,
      quantity: parseInt(l.quantity || 0),
      remaining: parseInt(l['remaining-quantity'] || 0),
      fills: (l.fills || []).map(f => ({
        fill_price: parseFloat(f['fill-price'] || 0),
        quantity: parseInt(f.quantity || 0),
        filled_at: f['filled-at'] || ''
      }))
    })),
    complex_order_id: o['complex-order-id'] || null,
    created_at: o['received-at'] || '',
  }));
} catch (e) {
  liveOrders = [];
}

// ─────────────────────────────────────────────────────────────
// 6. GROUP POSITIONS INTO STRATEGIES (Spread detection)
// ─────────────────────────────────────────────────────────────
const groupedPositions = [];
const optionPositions = positions.filter(p => p.instrument_type === 'Equity Option');

// Group by underlying + expiration
const groups = {};
for (const pos of optionPositions) {
  const key = `${pos.symbol}|${pos.expiration}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(pos);
}

for (const [key, legs] of Object.entries(groups)) {
  const [sym, exp] = key.split('|');
  let strategy = 'Unknown';
  let totalCredit = 0;
  let totalMark = 0;

  if (legs.length === 2) {
    const hasShort = legs.some(l => l.direction === 'Short');
    const hasLong = legs.some(l => l.direction === 'Long');
    const allPuts = legs.every(l => l.option_type === 'Put');
    const allCalls = legs.every(l => l.option_type === 'Call');

    if (hasShort && hasLong && allPuts) strategy = 'PCS';
    else if (hasShort && hasLong && allCalls) strategy = 'CCS';
    else if (hasShort && hasLong) strategy = 'Vertical Spread';
  } else if (legs.length === 4) {
    strategy = 'IC';
  }

  for (const leg of legs) {
    totalCredit += leg.average_open_price * Math.abs(leg.quantity) * leg.multiplier;
    totalMark += leg.mark_price * Math.abs(leg.quantity) * leg.multiplier;
  }

  groupedPositions.push({
    symbol: sym,
    strategy,
    expiration: exp,
    quantity: Math.abs(legs[0].quantity),
    legs: legs.map(l => ({
      symbol: l.option_symbol,
      strike_price: l.strike_price,
      option_type: l.option_type,
      direction: l.direction,
      quantity: l.quantity,
      action: l.direction === 'Short' ? 'Sell to Open' : 'Buy to Open',
      close_action: l.direction === 'Short' ? 'Buy to Close' : 'Sell to Close',
      instrument_type: 'Equity Option'
    })),
    credit_received: Math.abs(totalCredit).toFixed(2),
    mark_value: totalMark.toFixed(2),
    unrealized_pnl: (totalCredit + totalMark).toFixed(2),
    status: 'active'
  });
}

// ─────────────────────────────────────────────────────────────
// 7. CALCULATE RISK METRICS
// ─────────────────────────────────────────────────────────────
const totalExposure = groupedPositions.reduce((sum, p) => {
  return sum + Math.abs(parseFloat(p.credit_received || 0));
}, 0);

const riskBudgetUsed = balances.net_liquidating_value > 0
  ? ((balances.maintenance_requirement / balances.net_liquidating_value) * 100).toFixed(1)
  : 0;

const totalUnrealizedPnL = groupedPositions.reduce((sum, p) => {
  return sum + parseFloat(p.unrealized_pnl || 0);
}, 0);

// ─────────────────────────────────────────────────────────────
// 8. RETURN DASHBOARD-COMPATIBLE JSON
// ─────────────────────────────────────────────────────────────
return [{ json: {
  success: true,
  student_id: studentId,
  student_name: studentRecord.name,
  account_number: accountNumber,
  last_updated: new Date().toISOString(),

  // Dashboard-compatible format
  positions: groupedPositions,
  signals: [],  // To be populated by v3.4 push
  risk: {
    buying_power: `$${balances.buying_power?.toLocaleString() || 'N/A'}`,
    net_liq: `$${balances.net_liquidating_value?.toLocaleString() || 'N/A'}`,
    portfolio_delta: 'N/A', // Requires streaming Greeks
    cash_balance: `$${balances.cash_balance?.toLocaleString() || 'N/A'}`,
    maintenance_req: `$${balances.maintenance_requirement?.toLocaleString() || 'N/A'}`,
  },
  risk_budget_used_pct: riskBudgetUsed,
  unrealized_pnl: totalUnrealizedPnL.toFixed(2),

  // Live orders (for order status display)
  live_orders: liveOrders,

  // Raw data for advanced use
  raw_positions: positions,
  raw_balances: balances
}}];
