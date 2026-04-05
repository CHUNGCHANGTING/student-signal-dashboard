// ============================================================
// WF-09【Account Streamer 事件處理】
// Polls order status → Detects Filled → Updates Sheet + Notifies
// ============================================================
// NOTE: n8n Cloud does not support persistent WebSocket connections.
// This workflow uses polling (every 60s during market hours) as a
// reliable alternative to the tastytrade Account Streamer WebSocket.
//
// For true WebSocket streaming, deploy a sidecar service:
//   Node.js → wss://streamer.tastyworks.com → POST n8n webhook
// ============================================================
// Trigger: Schedule (every 60s during market hours UTC 13:30-20:00)
// ============================================================

const TT_API = 'https://api.tastyworks.com';
const TT_CLIENT_ID = 'ec8b4453-d7e5-418e-8170-43e9b3e0b460';
const TT_CLIENT_SECRET = 'b09387c27e0cd0325cae0a910e43fc5f158ca109';
const SHEET_ID = '1clv5FZE6Fhf--2002oXlQg9SfVxqojiAL-QLpkdSGS4';

// ─────────────────────────────────────────────────────────────
// 0. MARKET HOURS CHECK
// ─────────────────────────────────────────────────────────────
const now = new Date();
const utcHour = now.getUTCHours();
const utcDay = now.getUTCDay();

// Skip weekends and outside market hours (UTC 13:30 - 21:00 = US market)
if (utcDay === 0 || utcDay === 6) {
  return [{ json: { skipped: true, reason: 'Weekend' } }];
}
if (utcHour < 13 || utcHour > 21) {
  return [{ json: { skipped: true, reason: 'Outside market hours' } }];
}

// ─────────────────────────────────────────────────────────────
// 1. LOAD STUDENT ACCOUNTS (from static config or Sheet)
// ─────────────────────────────────────────────────────────────
// In production, read from Google Sheet "students" tab
const STUDENTS = [
  {
    student_id: 'S001',
    name: '老師 (Demo)',
    account_number: '5WZ90854',
    refresh_token: '', // Set from Sheet/env
    line_user_id: 'U457d141fef9c4ccc372dc32dd0c8f45c',
    telegram_chat_id: ''
  }
];

const allEvents = [];

for (const student of STUDENTS) {
  if (!student.refresh_token) continue;

  // ─────────────────────────────────────────────────────────
  // 2. GET ACCESS TOKEN
  // ─────────────────────────────────────────────────────────
  let accessToken;
  try {
    const tokenRes = await this.helpers.httpRequest({
      method: 'POST',
      url: `${TT_API}/oauth/token`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'chilldove-streamer/1.0'
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(student.refresh_token)}&client_id=${TT_CLIENT_ID}&client_secret=${TT_CLIENT_SECRET}`,
    });
    accessToken = tokenRes['access-token'] || tokenRes.access_token;
    if (!accessToken) continue;
  } catch (e) {
    allEvents.push({
      student_id: student.student_id,
      event: 'AUTH_FAILED',
      error: e.message
    });
    continue;
  }

  const authHeaders = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'chilldove-streamer/1.0'
  };

  // ─────────────────────────────────────────────────────────
  // 3. FETCH RECENT ORDERS (last 24h)
  // ─────────────────────────────────────────────────────────
  let recentOrders = [];
  try {
    const ordRes = await this.helpers.httpRequest({
      method: 'GET',
      url: `${TT_API}/accounts/${student.account_number}/orders/live`,
      headers: authHeaders,
    });
    recentOrders = ordRes?.data?.items || ordRes?.data || [];
  } catch (e) {
    continue;
  }

  // ─────────────────────────────────────────────────────────
  // 4. DETECT NEWLY FILLED ORDERS
  // ─────────────────────────────────────────────────────────
  const filledOrders = recentOrders.filter(o => o.status === 'Filled');
  const recentFilled = filledOrders.filter(o => {
    const filledAt = new Date(o['terminal-at'] || o['updated-at'] || 0);
    const diffMs = now.getTime() - filledAt.getTime();
    return diffMs < 120000; // Filled within last 2 minutes
  });

  for (const order of recentFilled) {
    const fills = [];
    let totalFillPrice = 0;
    let totalQty = 0;

    for (const leg of (order.legs || [])) {
      for (const fill of (leg.fills || [])) {
        fills.push({
          symbol: leg.symbol,
          action: leg.action,
          fill_price: parseFloat(fill['fill-price'] || 0),
          quantity: parseInt(fill.quantity || 0),
          filled_at: fill['filled-at'] || '',
          venue: fill['destination-venue'] || ''
        });
        totalFillPrice += parseFloat(fill['fill-price'] || 0);
        totalQty += parseInt(fill.quantity || 0);
      }
    }

    const avgFillPrice = totalQty > 0 ? (totalFillPrice / totalQty).toFixed(4) : '0';

    const event = {
      student_id: student.student_id,
      student_name: student.name,
      account_number: student.account_number,
      event: 'ORDER_FILLED',
      timestamp: now.toISOString(),
      order_id: order.id,
      complex_order_id: order['complex-order-id'] || null,
      order_type: order['order-type'],
      symbol: order['underlying-symbol'],
      price: parseFloat(order.price || 0),
      price_effect: order['price-effect'],
      status: order.status,
      avg_fill_price: avgFillPrice,
      fills,
      legs: (order.legs || []).map(l => ({
        symbol: l.symbol,
        action: l.action,
        quantity: parseInt(l.quantity || 0),
        remaining: parseInt(l['remaining-quantity'] || 0)
      })),
      is_opening: (order.legs || []).some(l =>
        l.action === 'Buy to Open' || l.action === 'Sell to Open'
      ),
      is_closing: (order.legs || []).some(l =>
        l.action === 'Buy to Close' || l.action === 'Sell to Close'
      )
    };

    allEvents.push(event);

    // ─────────────────────────────────────────────────────
    // 5. NOTIFY STUDENT (LINE / Telegram)
    // ─────────────────────────────────────────────────────
    const actionIcon = event.is_opening ? '🟢 開倉' : '🔴 平倉';
    const effectIcon = order['price-effect'] === 'Credit' ? '💰' : '💸';
    const notifyMsg = [
      `${actionIcon} 成交通知`,
      `━━━━━━━━━━━`,
      `📌 ${order['underlying-symbol']} | ${event.order_type}`,
      `${effectIcon} 成交價: $${avgFillPrice} (${order['price-effect']})`,
      `📊 口數: ${totalQty}`,
      '',
      ...fills.map(f => `  ${f.action}: ${f.symbol} @ $${f.fill_price}`),
      '',
      `🕐 ${new Date(fills[0]?.filled_at || now).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
      `📋 Order ID: ${order.id}`
    ].join('\n');

    // Store for downstream LINE/Telegram node
    event.notify_message = notifyMsg;
    event.line_user_id = student.line_user_id;
    event.telegram_chat_id = student.telegram_chat_id;
  }

  // ─────────────────────────────────────────────────────────
  // 6. DETECT CANCELLED / REJECTED ORDERS
  // ─────────────────────────────────────────────────────────
  const rejectOrders = recentOrders.filter(o =>
    (o.status === 'Rejected' || o.status === 'Cancelled') &&
    (now.getTime() - new Date(o['terminal-at'] || 0).getTime()) < 120000
  );

  for (const order of rejectOrders) {
    allEvents.push({
      student_id: student.student_id,
      event: order.status === 'Rejected' ? 'ORDER_REJECTED' : 'ORDER_CANCELLED',
      timestamp: now.toISOString(),
      order_id: order.id,
      symbol: order['underlying-symbol'],
      reason: order['reject-reason'] || '',
      notify_message: `⚠️ ${order.status}: ${order['underlying-symbol']} — ${order['reject-reason'] || 'No reason'}`,
      line_user_id: student.line_user_id,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 7. RETURN EVENTS FOR DOWNSTREAM PROCESSING
// ─────────────────────────────────────────────────────────────
if (allEvents.length === 0) {
  return [{ json: { events: [], count: 0, checked_at: now.toISOString() } }];
}

// Return each event as separate item for n8n branching
return allEvents.map(evt => ({ json: evt }));
