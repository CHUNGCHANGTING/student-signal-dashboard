// ============================================================
// WF-06【學生下單】Student Order Execution
// n8n Webhook → OAuth Token → OTOCO Order → Record to Sheet
// ============================================================
// Endpoint: POST /webhook/student-order
// Payload: {
//   student_id, account_number, refresh_token,
//   symbol, strategy, legs[], quantity,
//   limit_price, price_effect,
//   stop_loss_price, profit_target_price,
//   ev, kelly, pop, tracking_id
// }
// ============================================================

const TT_API = 'https://api.tastyworks.com';
const TT_CLIENT_ID = 'ec8b4453-d7e5-418e-8170-43e9b3e0b460';
const TT_CLIENT_SECRET = 'b09387c27e0cd0325cae0a910e43fc5f158ca109';
const SHEET_ID = '1clv5FZE6Fhf--2002oXlQg9SfVxqojiAL-QLpkdSGS4';

const input = $input.first().json;

// ─────────────────────────────────────────────────────────────
// 1. VALIDATE INPUT
// ─────────────────────────────────────────────────────────────
const required = ['student_id', 'account_number', 'refresh_token', 'symbol', 'strategy', 'legs', 'quantity', 'limit_price', 'price_effect'];
for (const field of required) {
  if (!input[field]) {
    return [{ json: { success: false, error: `Missing required field: ${field}` } }];
  }
}

const {
  student_id,
  account_number,
  refresh_token,
  symbol,
  strategy,
  legs,
  quantity,
  limit_price,
  price_effect,
  stop_loss_price,
  profit_target_price,
  ev,
  kelly,
  pop,
  tracking_id
} = input;

// ─────────────────────────────────────────────────────────────
// 2. GET OAUTH ACCESS TOKEN (Student's own token)
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
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh_token)}&client_id=${TT_CLIENT_ID}&client_secret=${TT_CLIENT_SECRET}`,
    returnFullResponse: false,
  });
  accessToken = tokenRes['access-token'] || tokenRes.access_token || tokenRes.token;
  if (!accessToken) throw new Error('No access token in response');
} catch (e) {
  return [{ json: {
    success: false,
    error: `OAuth failed for student ${student_id}: ${e.message}`,
    hint: 'Student may need to re-authorize their tastytrade account'
  }}];
}

const authHeaders = {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'User-Agent': 'chilldove-student-bot/1.0'
};

// ─────────────────────────────────────────────────────────────
// 3. BUILD ORDER LEGS
// ─────────────────────────────────────────────────────────────
// legs format from Dashboard:
// [{ symbol: "SPY260417P00545000", action: "Sell to Open", quantity: 1, instrument_type: "Equity Option" },
//  { symbol: "SPY260417P00540000", action: "Buy to Open",  quantity: 1, instrument_type: "Equity Option" }]

const orderLegs = legs.map(leg => ({
  'instrument-type': leg.instrument_type || 'Equity Option',
  'symbol': leg.symbol,
  'action': leg.action,
  'quantity': leg.quantity || quantity || 1
}));

// ─────────────────────────────────────────────────────────────
// 4. BUILD CLOSING LEGS (for stop-loss & profit-target)
// ─────────────────────────────────────────────────────────────
const closingLegs = orderLegs.map(leg => {
  const actionMap = {
    'Sell to Open': 'Buy to Close',
    'Buy to Open': 'Sell to Close',
    'Buy to Close': 'Sell to Open',
    'Sell to Close': 'Buy to Open'
  };
  return {
    'instrument-type': leg['instrument-type'],
    'symbol': leg.symbol,
    'action': actionMap[leg.action] || 'Sell to Close',
    'quantity': leg.quantity
  };
});

// Determine closing price-effect (opposite of opening)
const closingPriceEffect = price_effect === 'Credit' ? 'Debit' : 'Credit';

// ─────────────────────────────────────────────────────────────
// 5. DETERMINE ORDER TYPE: OTOCO vs SIMPLE
// ─────────────────────────────────────────────────────────────
let orderResult;
const timestamp = new Date().toISOString();

if (stop_loss_price && profit_target_price) {
  // ═══════════════════════════════════════════════════════════
  // OTOCO: Opening + (Stop Loss OCO Profit Target)
  // ═══════════════════════════════════════════════════════════
  const otoco = {
    'type': 'OTOCO',
    'trigger-order': {
      'time-in-force': 'Day',
      'order-type': 'Limit',
      'price': parseFloat(limit_price),
      'price-effect': price_effect,
      'legs': orderLegs
    },
    'orders': [
      // Profit target (limit order)
      {
        'time-in-force': 'GTC',
        'order-type': 'Limit',
        'price': parseFloat(profit_target_price),
        'price-effect': closingPriceEffect,
        'legs': closingLegs
      },
      // Stop loss (stop order)
      {
        'time-in-force': 'GTC',
        'order-type': 'Stop',
        'stop-trigger': parseFloat(stop_loss_price),
        'price-effect': closingPriceEffect,
        'legs': closingLegs
      }
    ]
  };

  try {
    // DRY RUN first
    const dryRun = await this.helpers.httpRequest({
      method: 'POST',
      url: `${TT_API}/accounts/${account_number}/complex-orders/dry-run`,
      headers: authHeaders,
      body: JSON.stringify(otoco),
      returnFullResponse: true,
    });

    if (dryRun.statusCode >= 400) {
      const errBody = typeof dryRun.body === 'string' ? JSON.parse(dryRun.body) : dryRun.body;
      return [{ json: {
        success: false,
        error: 'Order validation failed (dry-run)',
        details: errBody,
        order_type: 'OTOCO'
      }}];
    }

    // Parse dry-run response for buying power impact
    const dryData = typeof dryRun.body === 'string' ? JSON.parse(dryRun.body) : dryRun.body;
    const bpEffect = dryData?.data?.['buying-power-effect'] || {};

    // LIVE ORDER
    const liveRes = await this.helpers.httpRequest({
      method: 'POST',
      url: `${TT_API}/accounts/${account_number}/complex-orders`,
      headers: authHeaders,
      body: JSON.stringify(otoco),
      returnFullResponse: true,
    });

    const liveData = typeof liveRes.body === 'string' ? JSON.parse(liveRes.body) : liveRes.body;

    orderResult = {
      success: liveRes.statusCode < 400,
      order_type: 'OTOCO',
      order_id: liveData?.data?.order?.id || liveData?.data?.id || null,
      complex_order_id: liveData?.data?.['complex-order']?.id || null,
      status: liveData?.data?.order?.status || liveData?.data?.status || 'unknown',
      buying_power_change: bpEffect['change-in-buying-power'] || null,
      buying_power_effect: bpEffect['change-in-buying-power-effect'] || null,
      raw: liveData
    };

  } catch (e) {
    orderResult = {
      success: false,
      order_type: 'OTOCO',
      error: e.message
    };
  }

} else if (stop_loss_price) {
  // ═══════════════════════════════════════════════════════════
  // OTO: Opening → triggers Stop Loss
  // ═══════════════════════════════════════════════════════════
  const oto = {
    'type': 'OTO',
    'trigger-order': {
      'time-in-force': 'Day',
      'order-type': 'Limit',
      'price': parseFloat(limit_price),
      'price-effect': price_effect,
      'legs': orderLegs
    },
    'orders': [
      {
        'time-in-force': 'GTC',
        'order-type': 'Stop',
        'stop-trigger': parseFloat(stop_loss_price),
        'price-effect': closingPriceEffect,
        'legs': closingLegs
      }
    ]
  };

  try {
    const liveRes = await this.helpers.httpRequest({
      method: 'POST',
      url: `${TT_API}/accounts/${account_number}/complex-orders`,
      headers: authHeaders,
      body: JSON.stringify(oto),
      returnFullResponse: true,
    });
    const liveData = typeof liveRes.body === 'string' ? JSON.parse(liveRes.body) : liveRes.body;

    orderResult = {
      success: liveRes.statusCode < 400,
      order_type: 'OTO',
      order_id: liveData?.data?.order?.id || null,
      status: liveData?.data?.order?.status || 'unknown',
      raw: liveData
    };
  } catch (e) {
    orderResult = { success: false, order_type: 'OTO', error: e.message };
  }

} else {
  // ═══════════════════════════════════════════════════════════
  // SIMPLE: Single limit order (no stop loss)
  // ═══════════════════════════════════════════════════════════
  const simpleOrder = {
    'time-in-force': 'Day',
    'order-type': 'Limit',
    'price': parseFloat(limit_price),
    'price-effect': price_effect,
    'legs': orderLegs
  };

  try {
    const liveRes = await this.helpers.httpRequest({
      method: 'POST',
      url: `${TT_API}/accounts/${account_number}/orders`,
      headers: authHeaders,
      body: JSON.stringify(simpleOrder),
      returnFullResponse: true,
    });
    const liveData = typeof liveRes.body === 'string' ? JSON.parse(liveRes.body) : liveRes.body;

    orderResult = {
      success: liveRes.statusCode < 400,
      order_type: 'Simple',
      order_id: liveData?.data?.order?.id || null,
      status: liveData?.data?.order?.status || 'unknown',
      raw: liveData
    };
  } catch (e) {
    orderResult = { success: false, order_type: 'Simple', error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// 6. RECORD TO GOOGLE SHEET (signal_orders tab)
// ─────────────────────────────────────────────────────────────
const record = {
  timestamp,
  student_id,
  account_number,
  tracking_id: tracking_id || `ORD-${Date.now()}`,
  symbol,
  strategy,
  order_type: orderResult.order_type,
  order_id: orderResult.order_id || '',
  complex_order_id: orderResult.complex_order_id || '',
  limit_price,
  price_effect,
  stop_loss_price: stop_loss_price || '',
  profit_target_price: profit_target_price || '',
  quantity,
  ev: ev || '',
  kelly: kelly || '',
  pop: pop || '',
  status: orderResult.success ? 'SENT' : 'FAILED',
  error: orderResult.error || '',
  legs_json: JSON.stringify(legs)
};

// Return full result for downstream nodes
return [{ json: {
  ...orderResult,
  student_id,
  symbol,
  strategy,
  tracking_id: record.tracking_id,
  record,
  _sheetData: record  // for Google Sheets node downstream
}}];
