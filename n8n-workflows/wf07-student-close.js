// ============================================================
// WF-07【學生平倉】Student Close Position
// n8n Webhook → OAuth Token → Close Order → P&L Calc → Update Sheet
// ============================================================
// Endpoint: POST /webhook/student-close-position
// Payload: {
//   student_id, account_number, refresh_token,
//   symbol, strategy, legs[], close_type,
//   close_price, close_price_effect,
//   original_order_id, original_credit, original_debit,
//   tracking_id, note
// }
// close_type: "profit" | "stop" | "manual" | "expiry"
// ============================================================

const TT_API = 'https://api.tastyworks.com';
const TT_CLIENT_ID = 'ec8b4453-d7e5-418e-8170-43e9b3e0b460';
const TT_CLIENT_SECRET = '<TT_CLIENT_SECRET>';

const input = $input.first().json;

const {
  student_id,
  account_number,
  refresh_token,
  symbol,
  strategy,
  legs,
  close_type = 'manual',
  close_price,
  close_price_effect,
  original_order_id,
  original_credit,
  original_debit,
  tracking_id,
  note
} = input;

// ─────────────────────────────────────────────────────────────
// 1. VALIDATE
// ─────────────────────────────────────────────────────────────
if (!student_id || !account_number || !refresh_token || !legs || !legs.length) {
  return [{ json: { success: false, error: 'Missing required fields: student_id, account_number, refresh_token, legs' } }];
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
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh_token)}&client_id=${TT_CLIENT_ID}&client_secret=${TT_CLIENT_SECRET}`,
  });
  accessToken = tokenRes.access_token || tokenRes['access-token'];
  if (!accessToken) throw new Error('No token returned');
} catch (e) {
  return [{ json: { success: false, error: `OAuth failed: ${e.message}` } }];
}

const authHeaders = {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'User-Agent': 'chilldove-student-bot/1.0'
};

// ─────────────────────────────────────────────────────────────
// 3. CHECK FOR EXISTING COMPLEX ORDERS TO CANCEL
// ─────────────────────────────────────────────────────────────
// If there's an active stop-loss (from OTOCO), cancel it first
// Otherwise closing order may conflict
let cancelledOrders = [];
try {
  const liveOrdersRes = await this.helpers.httpRequest({
    method: 'GET',
    url: `${TT_API}/accounts/${account_number}/orders/live`,
    headers: authHeaders,
  });
  const liveOrders = liveOrdersRes?.data?.items || liveOrdersRes?.data || [];

  // Find contingent/stop orders for this symbol
  for (const order of liveOrders) {
    const isRelated = order['underlying-symbol'] === symbol;
    const isContingent = order.status === 'Contingent' || order.status === 'Live';
    const isStop = order['order-type'] === 'Stop';

    if (isRelated && isContingent && isStop) {
      try {
        // Check if it's a complex order child
        if (order['complex-order-id']) {
          await this.helpers.httpRequest({
            method: 'DELETE',
            url: `${TT_API}/accounts/${account_number}/complex-orders/${order['complex-order-id']}`,
            headers: authHeaders,
          });
          cancelledOrders.push({ id: order['complex-order-id'], type: 'complex' });
        } else {
          await this.helpers.httpRequest({
            method: 'DELETE',
            url: `${TT_API}/accounts/${account_number}/orders/${order.id}`,
            headers: authHeaders,
          });
          cancelledOrders.push({ id: order.id, type: 'simple' });
        }
      } catch (cancelErr) {
        // Non-fatal: order may already be cancelled
        cancelledOrders.push({ id: order.id, error: cancelErr.message });
      }
    }
  }
} catch (e) {
  // Non-fatal: continue with close order
}

// ─────────────────────────────────────────────────────────────
// 4. BUILD CLOSING ORDER
// ─────────────────────────────────────────────────────────────
const closingLegs = legs.map(leg => ({
  'instrument-type': leg.instrument_type || 'Equity Option',
  'symbol': leg.symbol,
  'action': leg.close_action || (
    leg.action === 'Sell to Open' ? 'Buy to Close' :
    leg.action === 'Buy to Open' ? 'Sell to Close' :
    leg.action  // already a closing action
  ),
  'quantity': leg.quantity || 1
}));

// Determine order type based on close_type
let closeOrder;
if (close_price && close_type !== 'stop') {
  // Limit order for profit-taking or manual close
  closeOrder = {
    'time-in-force': 'Day',
    'order-type': 'Limit',
    'price': parseFloat(close_price),
    'price-effect': close_price_effect || 'Debit',
    'legs': closingLegs
  };
} else {
  // Market order for stop-loss or immediate close
  closeOrder = {
    'time-in-force': 'Day',
    'order-type': 'Market',
    'legs': closingLegs
  };
}

// ─────────────────────────────────────────────────────────────
// 5. SUBMIT CLOSING ORDER
// ─────────────────────────────────────────────────────────────
let closeResult;
const timestamp = new Date().toISOString();

try {
  const closeRes = await this.helpers.httpRequest({
    method: 'POST',
    url: `${TT_API}/accounts/${account_number}/orders`,
    headers: authHeaders,
    body: JSON.stringify(closeOrder),
    returnFullResponse: true,
  });

  const resData = typeof closeRes.body === 'string' ? JSON.parse(closeRes.body) : closeRes.body;

  closeResult = {
    success: closeRes.statusCode < 400,
    order_id: resData?.data?.order?.id || null,
    status: resData?.data?.order?.status || 'unknown',
    raw: resData
  };
} catch (e) {
  closeResult = { success: false, error: e.message };
}

// ─────────────────────────────────────────────────────────────
// 6. CALCULATE P&L (estimated, will be confirmed by Streamer)
// ─────────────────────────────────────────────────────────────
let estimatedPnL = null;
const origCredit = parseFloat(original_credit || 0);
const origDebit = parseFloat(original_debit || 0);
const closeP = parseFloat(close_price || 0);
const qty = parseInt(legs[0]?.quantity || 1);

if (strategy && (origCredit > 0 || origDebit > 0)) {
  if (['PCS', 'CCS', 'IC', 'BPCS', 'BCCS'].includes(strategy)) {
    // Credit strategy: profit = credit received - cost to close
    estimatedPnL = (origCredit - closeP) * qty * 100;
  } else if (['BCDS', 'BPDS'].includes(strategy)) {
    // Debit strategy: profit = close price - debit paid
    estimatedPnL = (closeP - origDebit) * qty * 100;
  }
}

// ─────────────────────────────────────────────────────────────
// 7. BUILD RECORD FOR GOOGLE SHEET
// ─────────────────────────────────────────────────────────────
const record = {
  timestamp,
  student_id,
  account_number,
  tracking_id: tracking_id || `CLS-${Date.now()}`,
  symbol,
  strategy,
  close_type,
  close_order_id: closeResult.order_id || '',
  close_price: close_price || 'MARKET',
  close_price_effect: close_price_effect || '',
  original_order_id: original_order_id || '',
  original_credit: origCredit || '',
  original_debit: origDebit || '',
  estimated_pnl: estimatedPnL !== null ? estimatedPnL.toFixed(2) : '',
  win_loss: estimatedPnL > 0 ? 'WIN' : estimatedPnL < 0 ? 'LOSS' : 'BREAK_EVEN',
  cancelled_stop_orders: JSON.stringify(cancelledOrders),
  status: closeResult.success ? 'CLOSE_SENT' : 'CLOSE_FAILED',
  error: closeResult.error || '',
  note: note || ''
};

return [{ json: {
  ...closeResult,
  student_id,
  symbol,
  strategy,
  close_type,
  estimated_pnl: estimatedPnL,
  cancelled_orders: cancelledOrders,
  tracking_id: record.tracking_id,
  record,
  _sheetData: record
}}];
