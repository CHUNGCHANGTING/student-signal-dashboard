// WF-02: pickModule + risk filter + event risk + bias check + OI tier
// Synced with Dashboard commit 1bebc78
const items = $input.all();
const results = [];

// === 2026 Key Economic Events Calendar ===
const KEY_EVENTS = [
  '2026-01-09','2026-01-13','2026-01-28','2026-02-11','2026-02-13',
  '2026-03-06','2026-03-11','2026-03-18','2026-04-03','2026-04-10',
  '2026-04-29','2026-05-08','2026-05-12','2026-06-05','2026-06-10',
  '2026-06-17','2026-07-02','2026-07-14','2026-07-29','2026-08-07',
  '2026-08-12','2026-09-04','2026-09-11','2026-09-16','2026-10-02',
  '2026-10-14','2026-10-28','2026-11-06','2026-11-10','2026-12-04',
  '2026-12-09','2026-12-10'
];
const EVENT_NAMES = {
  '01-09':'NFP','01-13':'CPI','01-28':'FOMC','02-11':'NFP','02-13':'CPI',
  '03-06':'NFP','03-11':'CPI','03-18':'FOMC','04-03':'NFP','04-10':'CPI',
  '04-29':'FOMC','05-08':'NFP','05-12':'CPI','06-05':'NFP','06-10':'CPI',
  '06-17':'FOMC','07-02':'NFP','07-14':'CPI','07-29':'FOMC','08-07':'NFP',
  '08-12':'CPI','09-04':'NFP','09-11':'CPI','09-16':'FOMC','10-02':'NFP',
  '10-14':'CPI','10-28':'FOMC','11-06':'NFP','11-10':'CPI','12-04':'NFP',
  '12-09':'FOMC','12-10':'CPI'
};

function checkEventRisk() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const in2days = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  return KEY_EVENTS.filter(d => d >= today && d <= in2days).map(d => {
    const daysUntil = Math.ceil((new Date(d+'T00:00:00').getTime() - now.getTime()) / 86400000);
    return { date: d, type: EVENT_NAMES[d.slice(5)] || '?', daysUntil };
  });
}

// === OI Liquidity Tier ===
const OI_T1 = ['SPY','QQQ','SPX','IWM','/ES','/NQ'];
const OI_T2 = ['AAPL','MSFT','AMZN','TSLA','META','GOOGL','NVDA','AMD','INTC','NFLX','DIS','BA','UBER','SOFI','PLTR','COIN','PYPL','BABA','NIO','ARKK','GLD','TLT','XLE','XLF','XLK','SMH','TQQQ','SQQQ'];
const OI_T3 = ['KO','JNJ','PG','JPM','BAC','WMT','HD','V','MA','UNH','MRK','PFE','ABBV','CVX','XOM','LLY','COST','AVGO','CRM','ORCL','ADBE','CSCO','MCD','NKE','SBUX','GS','MS','C','BLK','SCHW'];

function oiTier(sym) {
  if (OI_T1.includes(sym)) return { tier: 1, label: '極高' };
  if (OI_T2.includes(sym)) return { tier: 2, label: '充足' };
  if (OI_T3.includes(sym)) return { tier: 3, label: 'OK' };
  return { tier: 4, label: '需確認' };
}

const upcomingEvents = checkEventRisk();
const hasEventRisk = upcomingEvents.length > 0;
const eventNames = upcomingEvents.map(e => e.date.slice(5) + ' ' + e.type + '(' + e.daysUntil + '天後)').join(', ');

for (const item of items) {
  const d = item.json.body || item.json;
  const symbol = (d.symbol || '').toUpperCase();
  const strategy = (d.strategy || '').toUpperCase();
  const ivr = parseFloat(d.ivr) || 0;
  const dte = parseInt(d.dte) || 0;
  const event_risk_payload = String(d.event_risk).toLowerCase() === 'true';
  const pop = parseFloat(d.pop) || 0;
  const credit_received = parseFloat(d.credit_received) || 0;
  const debit_paid = parseFloat(d.debit_paid) || 0;
  const max_loss = parseFloat(d.max_loss) || 0;
  const bias = (d.bias || '').toLowerCase();
  const market_bias = (d.market_bias || '').toLowerCase(); // 大盤方向

  const spx_qqq = ['SPY', 'QQQ', '/ES', '/NQ'];
  const is_index = spx_qqq.includes(symbol);
  const income_strats = ['IRON_CONDOR', 'BULL_PUT_CREDIT_SPREAD', 'BEAR_CALL_CREDIT_SPREAD', 'CREDIT_VERTICAL'];
  const debit_strats = ['BULL_CALL_DEBIT_SPREAD', 'BEAR_PUT_DEBIT_SPREAD'];

  let module = 'UNKNOWN';
  let module_resolved = 'UNKNOWN';

  if (income_strats.includes(strategy)) {
    if (strategy === 'IRON_CONDOR') module = is_index ? 'IC_INDEX' : 'IC_EQUITY';
    else if (strategy === 'BULL_PUT_CREDIT_SPREAD') module = is_index ? 'BPCS_INDEX' : 'BPCS_EQUITY';
    else if (strategy === 'BEAR_CALL_CREDIT_SPREAD') module = is_index ? 'BCCS_INDEX' : 'BCCS_EQUITY';
    else module = 'CREDIT_VERTICAL';
    module_resolved = module;
  } else if (debit_strats.includes(strategy)) {
    module = strategy === 'BULL_CALL_DEBIT_SPREAD' ? 'BCDS' : 'BPDS';
    module_resolved = module;
  }

  const isIncome = income_strats.includes(strategy);
  const isDebit = debit_strats.includes(strategy);

  let decision = 'approved';
  let reject_reason = null;
  let event_warning = '';

  const effectiveEventRisk = hasEventRisk || event_risk_payload;

  // --- Fix 1: 大盤方向與策略方向一致性 ---
  let strategyBias = '';
  if (strategy === 'BULL_PUT_CREDIT_SPREAD' || strategy === 'BULL_CALL_DEBIT_SPREAD') strategyBias = 'bullish';
  else if (strategy === 'BEAR_CALL_CREDIT_SPREAD' || strategy === 'BEAR_PUT_DEBIT_SPREAD') strategyBias = 'bearish';
  else if (strategy === 'IRON_CONDOR') strategyBias = 'neutral';

  if (market_bias === 'bearish' && strategyBias === 'bullish') {
    decision = 'rejected';
    reject_reason = '大盤偏空 → 做多策略方向不一致';
  } else if (market_bias === 'bullish' && strategyBias === 'bearish') {
    decision = 'rejected';
    reject_reason = '大盤偏多 → 做空策略方向不一致';
  }
  // --- Fix 2: Event risk (income=block, debit=allow) ---
  else if (effectiveEventRisk && isIncome) {
    decision = 'rejected';
    reject_reason = '事件風險：' + (eventNames || 'event_risk') + ' → 賣方策略暫停推播';
    event_warning = '🚫 賣方策略封鎖（' + eventNames + '）';
  } else if (effectiveEventRisk && isDebit) {
    decision = 'approved';
    event_warning = '✅ 買方策略不受影響（IV上升有利）| 事件：' + eventNames;
  } else if (effectiveEventRisk) {
    decision = 'rejected';
    reject_reason = '事件風險：' + (eventNames || 'event_risk');
  }
  // Standard risk filters
  else if (isIncome && ivr < 25) {
    decision = 'rejected';
    reject_reason = 'IVR too low: ' + ivr;
  } else if (isIncome && pop < 0.65) {
    decision = 'rejected';
    reject_reason = 'POP too low: ' + pop;
  } else if (dte < 14) {
    decision = 'rejected';
    reject_reason = 'DTE too short: ' + dte;
  } else if (dte > 45) {
    decision = 'rejected';
    reject_reason = 'DTE too long: ' + dte;
  }

  // --- Fix 3: OI liquidity tier ---
  const oi = oiTier(symbol);

  const cn_map = {
    'IRON_CONDOR': '【盤整收租】Iron Condor, IVR ' + ivr,
    'BULL_PUT_CREDIT_SPREAD': '【偏多收租】Put Credit Spread, IVR ' + ivr,
    'BEAR_CALL_CREDIT_SPREAD': '【偏空收租】Call Credit Spread, IVR ' + ivr,
    'BULL_CALL_DEBIT_SPREAD': '【偏多進攻】Call Debit Spread',
    'BEAR_PUT_DEBIT_SPREAD': '【偏空進攻】Put Debit Spread',
    'CREDIT_VERTICAL': '【收租】Credit Vertical'
  };
  const note = cn_map[strategy] || strategy;

  const now = new Date();
  const sig_id = 'SIG-' + now.toISOString().slice(0,10).replace(/-/g,'') + '-' + symbol + '-' + Math.floor(Math.random()*1000);

  results.push({
    json: {
      symbol, strategy, module, module_resolved,
      decision, reject_reason, note, sig_id,
      ivr, dte, pop, credit_received, debit_paid, max_loss,
      event_risk: effectiveEventRisk,
      event_warning, upcoming_events: eventNames,
      oi_tier: oi.tier, oi_label: oi.label,
      market_bias, strategy_bias: strategyBias,
      created_at: now.toISOString().slice(0,16).replace('T',' ')
    }
  });
}

return results;