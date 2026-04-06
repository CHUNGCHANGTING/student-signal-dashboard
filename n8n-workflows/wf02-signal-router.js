// WF-02: pickModule + risk filter
const items = $input.all();
const results = [];

for (const item of items) {
  const d = item.json.body || item.json;
  const symbol = (d.symbol || '').toUpperCase();
  const strategy = (d.strategy || '').toUpperCase();
  const ivr = parseFloat(d.ivr) || 0;
  const dte = parseInt(d.dte) || 0;
  const event_risk = String(d.event_risk).toLowerCase() === 'true';
  const pop = parseFloat(d.pop) || 0;
  const credit_received = parseFloat(d.credit_received) || 0;
  const debit_paid = parseFloat(d.debit_paid) || 0;
  const max_loss = parseFloat(d.max_loss) || 0;
  const bias = (d.bias || '').toLowerCase();

  // --- pickModule ---
  const spx_qqq = ['SPX', 'QQQ', '/ES', '/NQ'];
  const is_index = spx_qqq.includes(symbol);
  const income_strats = ['IRON_CONDOR', 'BULL_PUT_CREDIT_SPREAD', 'BEAR_CALL_CREDIT_SPREAD', 'CREDIT_VERTICAL'];
  const debit_strats = ['BULL_CALL_DEBIT_SPREAD', 'BEAR_PUT_DEBIT_SPREAD'];

  let module = 'UNKNOWN';
  let module_resolved = 'UNKNOWN';

  if (income_strats.includes(strategy)) {
    if (strategy === 'IRON_CONDOR') {
      module = is_index ? 'IC_INDEX' : 'IC_EQUITY';
    } else if (strategy === 'BULL_PUT_CREDIT_SPREAD') {
      module = is_index ? 'BPCS_INDEX' : 'BPCS_EQUITY';
    } else if (strategy === 'BEAR_CALL_CREDIT_SPREAD') {
      module = is_index ? 'BCCS_INDEX' : 'BCCS_EQUITY';
    } else {
      module = 'CREDIT_VERTICAL';
    }
    module_resolved = module;
  } else if (debit_strats.includes(strategy)) {
    module = strategy === 'BULL_CALL_DEBIT_SPREAD' ? 'BCDS' : 'BPDS';
    module_resolved = module;
  }

  // --- risk filter ---
  let decision = 'APPROVED';
  let reject_reason = null;

  if (event_risk) {
    decision = 'REJECTED';
    reject_reason = 'event_risk=true';
  } else if (income_strats.includes(strategy) && ivr < 25) {
    decision = 'REJECTED';
    reject_reason = 'IVR too low: ' + ivr;
  } else if (income_strats.includes(strategy) && pop < 0.65) {
    decision = 'REJECTED';
    reject_reason = 'POP too low: ' + pop;
  } else if (dte < 14) {
    decision = 'REJECTED';
    reject_reason = 'DTE too short: ' + dte + ' (min 14)';
  } else if (dte > 45) {
    decision = 'REJECTED';
    reject_reason = 'DTE too long: ' + dte + ' (max 45)';
  }

  // --- student note ---
  const note_map = {
    'IRON_CONDOR': 'Range-bound, IVR ' + ivr + ', theta income',
    'BULL_PUT_CREDIT_SPREAD': 'Bullish income, IVR ' + ivr,
    'BEAR_CALL_CREDIT_SPREAD': 'Bearish income, IVR ' + ivr,
    'BULL_CALL_DEBIT_SPREAD': 'Bullish breakout, limited risk',
    'BEAR_PUT_DEBIT_SPREAD': 'Bearish breakdown, limited risk',
    'CREDIT_VERTICAL': 'High IV directional'
  };
  const note = note_map[strategy] || strategy;

  // --- build signal ID ---
  const now = new Date();
  const sig_id = 'SIG-' +
    now.toISOString().slice(0, 10).replace(/-/g, '') + '-' +
    symbol + '-' +
    Math.floor(Math.random() * 1000);

  results.push({
    json: {
      symbol,
      strategy,
      module,
      module_resolved,
      decision,
      reject_reason,
      note,
      sig_id,
      ivr,
      dte,
      pop,
      credit_received,
      debit_paid,
      max_loss,
      created_at: now.toISOString().slice(0, 16).replace('T', ' ')
    }
  });
}

return results;