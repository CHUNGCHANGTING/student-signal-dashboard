// ============================================================
// WF-09【訂單監控】Account Order Monitor
// Schedule (every 2 min during market hours) → Check orders → Alert
// ============================================================

const TT_API = 'https://api.tastyworks.com';
const TT_CLIENT_ID = 'ec8b4453-d7e5-418e-8170-43e9b3e0b460';
const TT_CLIENT_SECRET = 'b09387c27e0cd0325cae0a910e43fc5f158ca109';
const LINE_TOKEN = 'y7xe8HwlQP5M0WQ3a9jzALbSSZ6/HtOyf4yQs4Eve0QJKa/JKgLFMYZiR7u4ErA/mvHoe8qRJBwiD21VSL1rb7BsJUmxzx+7OtvRXMChRRkwU87nWDRaC1dhXaYSafma3k2+Pk/QcSRwm7oG2VmxawdB04t89/1O/w1cDnyilFU=';
const TG_TOKEN = '8680833770:AAHutju73oP6c5X90GErYXn3hTvqjZIb7po';
const TG_CHAT = '-1003799249092';

// ─── Market Hours Check ───
const now = new Date();
const utcHour = now.getUTCHours();
const utcDay = now.getUTCDay();
if (utcDay === 0 || utcDay === 6) return [{ json: { skipped: true, reason: 'Weekend' } }];
if (utcHour < 13 || utcHour > 21) return [{ json: { skipped: true, reason: 'Outside market hours' } }];

// ─── Student Accounts ───
const STUDENTS = [
  { student_id: 'S001', name: '老師', account_number: '5WZ90854',
    refresh_token: 'eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCIsImtpZCI6ImxycXg3Wm5RNXJ3cHp6WXRTVjRhTjdMODhET0lWODEtRGpQZTVhVkdrcVUiLCJqa3UiOiJodHRwczovL2ludGVyaW9yLWFwaS5hcjIudGFzdHl0cmFkZS5zeXN0ZW1zL29hdXRoL2p3a3MifQ.eyJpc3MiOiJodHRwczovL2FwaS50YXN0eXRyYWRlLmNvbSIsInN1YiI6IlU1Y2FkZGU1ZS1kOGUzLTQyYmItYTljOC03YThiYjg5NWM2NTkiLCJpYXQiOjE3NzQzNzA3NTIsImF1ZCI6ImVjOGI0NDUzLWQ3ZTUtNDE4ZS04MTcwLTQzZTliM2UwYjQ2MCIsImdyYW50X2lkIjoiRzAyNGY3ZDIwLTk2MDgtNGVmYy1iYzVmLTQ3YzU2MWZlYzVhYSIsInNjb3BlIjoicmVhZCB0cmFkZSBvcGVuaWQifQ.iBKlWkK3DYbHxe3EkBOaU8tQghSq2_MlZpMcBLDgj32wPAew9nwJ-WV397ftK6ilWv_WiOPCuVfN0NNrQDg4Dw',
    line_user_id: 'U457d141fef9c4ccc372dc32dd0c8f45c' }
];

const allEvents = [];

for (const student of STUDENTS) {
  if (!student.refresh_token) continue;

  // ─── Get Token ───
  let accessToken;
  try {
    const tokenRes = await this.helpers.httpRequest({
      method: 'POST', url: TT_API + '/oauth/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chilldove-monitor/1.0' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(student.refresh_token) + '&client_id=' + TT_CLIENT_ID + '&client_secret=' + TT_CLIENT_SECRET,
    });
    accessToken = tokenRes.access_token || tokenRes['access-token'];
    if (!accessToken) continue;
  } catch (e) { continue; }

  const authHeaders = { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'User-Agent': 'chilldove-monitor/1.0' };

  // ─── Fetch Recent Orders ───
  let recentOrders = [];
  try {
    const ordRes = await this.helpers.httpRequest({
      method: 'GET', url: TT_API + '/accounts/' + student.account_number + '/orders/live',
      headers: authHeaders, ignoreHttpStatusErrors: true,
    });
    recentOrders = ordRes?.data?.items || ordRes?.data || [];
  } catch (e) { continue; }

  // ─── Detect Events (last 3 minutes) ───
  for (const order of recentOrders) {
    const terminalAt = new Date(order['terminal-at'] || order['updated-at'] || 0);
    const diffMs = now.getTime() - terminalAt.getTime();
    if (diffMs > 180000) continue; // Skip if older than 3 minutes

    const status = order.status;
    if (!['Filled', 'Rejected', 'Cancelled', 'Expired'].includes(status)) continue;

    // Build fills info
    const fills = [];
    let totalFillPrice = 0, totalQty = 0;
    for (const leg of (order.legs || [])) {
      for (const fill of (leg.fills || [])) {
        fills.push({ symbol: leg.symbol, action: leg.action, fill_price: parseFloat(fill['fill-price'] || 0), quantity: parseInt(fill.quantity || 0), filled_at: fill['filled-at'] || '' });
        totalFillPrice += parseFloat(fill['fill-price'] || 0);
        totalQty += parseInt(fill.quantity || 0);
      }
    }
    const avgFillPrice = totalQty > 0 ? (totalFillPrice / totalQty).toFixed(4) : '0';

    const isOpening = (order.legs || []).some(l => l.action === 'Buy to Open' || l.action === 'Sell to Open');
    const isClosing = (order.legs || []).some(l => l.action === 'Buy to Close' || l.action === 'Sell to Close');

    // ─── Build Notification Message ───
    let notifyMsg = '';
    let eventType = '';

    if (status === 'Filled') {
      eventType = 'ORDER_FILLED';
      const icon = isOpening ? '🟢 開倉成交' : '🔴 平倉成交';
      const effectIcon = order['price-effect'] === 'Credit' ? '💰' : '💸';
      notifyMsg = [icon, '━━━━━━━━━━━',
        '📌 ' + order['underlying-symbol'] + ' | ' + order['order-type'],
        effectIcon + ' 成交價: $' + avgFillPrice + ' (' + (order['price-effect']||'') + ')',
        '📊 口數: ' + totalQty, '',
        ...fills.map(f => '  ' + f.action + ': ' + f.symbol.substring(0,20) + ' @ $' + f.fill_price),
        '', '🕐 ' + new Date(fills[0]?.filled_at || now).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        '📋 Order #' + order.id
      ].join('
');

    } else if (status === 'Rejected') {
      eventType = 'ORDER_REJECTED';
      notifyMsg = ['⛔ 訂單被拒絕', '━━━━━━━━━━━',
        '📌 ' + (order['underlying-symbol']||'?') + ' | ' + (order['order-type']||''),
        '❌ 原因: ' + (order['reject-reason'] || '未知原因'),
        '💲 委託價: $' + (order.price || 'N/A') + ' ' + (order['price-effect']||''),
        '', '⚠️ 請檢查: buying power / 履約價 / 市場狀態',
        '🕐 ' + now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        '📋 Order #' + order.id
      ].join('
');

    } else if (status === 'Expired') {
      eventType = 'ORDER_EXPIRED';
      notifyMsg = ['⏰ 訂單已過期', '━━━━━━━━━━━',
        '📌 ' + (order['underlying-symbol']||'?') + ' | ' + (order['order-type']||''),
        '💲 委託價: $' + (order.price || 'N/A'),
        '📊 Time-in-force: ' + (order['time-in-force']||''),
        '', '💡 Day order 未成交已自動取消',
        '🕐 ' + now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
      ].join('
');

    } else if (status === 'Cancelled') {
      eventType = 'ORDER_CANCELLED';
      notifyMsg = ['🚫 訂單已取消', '━━━━━━━━━━━',
        '📌 ' + (order['underlying-symbol']||'?') + ' | ' + (order['order-type']||''),
        '💲 委託價: $' + (order.price || 'N/A'),
        '🕐 ' + now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        '📋 Order #' + order.id
      ].join('
');
    }

    // ─── Send LINE Push ───
    if (notifyMsg && student.line_user_id) {
      try {
        await this.helpers.httpRequest({
          method: 'POST', url: 'https://api.line.me/v2/bot/message/push',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN },
          body: JSON.stringify({ to: student.line_user_id, messages: [{ type: 'text', text: notifyMsg }] }),
          ignoreHttpStatusErrors: true,
        });
      } catch (e) {}
    }

    // ─── Send Telegram ───
    if (notifyMsg && TG_CHAT) {
      try {
        await this.helpers.httpRequest({
          method: 'POST', url: 'https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHAT, text: notifyMsg }),
          ignoreHttpStatusErrors: true,
        });
      } catch (e) {}
    }

    allEvents.push({
      student_id: student.student_id, event: eventType, timestamp: now.toISOString(),
      order_id: order.id, symbol: order['underlying-symbol'] || '', status: order.status,
      order_type: order['order-type'] || '', price: order.price || '',
      price_effect: order['price-effect'] || '', avg_fill_price: avgFillPrice,
      is_opening: isOpening, is_closing: isClosing, notify_message: notifyMsg
    });
  }
}

if (allEvents.length === 0) return [{ json: { events: 0, checked_at: now.toISOString(), status: 'no_new_events' } }];
return allEvents.map(evt => ({ json: evt }));
