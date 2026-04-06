// ============================================================
// Account Streamer WebSocket Sidecar (Reference Implementation)
// ============================================================
// Deploy as standalone Node.js service (e.g., on Railway/Render)
// Connects to tastytrade Account Streamer WebSocket
// Forwards Filled/Cancelled events to n8n webhook
// ============================================================
// NOT an n8n node — this is a separate microservice
// ============================================================

const WebSocket = require('ws');

const CONFIG = {
  TT_API: 'https://api.tastyworks.com',
  TT_STREAMER: 'wss://streamer.tastyworks.com',
  TT_CLIENT_ID: 'ec8b4453-d7e5-418e-8170-43e9b3e0b460',
  TT_CLIENT_SECRET: '<TT_CLIENT_SECRET>',
  N8N_WEBHOOK: 'https://chilldove.app.n8n.cloud/webhook/streamer-event',
  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  RECONNECT_DELAY: 5000,
};

// Student accounts to monitor
const STUDENTS = [
  { student_id: 'S001', account_number: 'STUDENT_ACCOUNT', refresh_token: '' }
];

// ─────────────────────────────────────────────────────────────
// Token Management
// ─────────────────────────────────────────────────────────────
async function getSessionToken(refreshToken) {
  const res = await fetch(`${CONFIG.TT_API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'chilldove-streamer/1.0'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CONFIG.TT_CLIENT_ID,
      client_secret: CONFIG.TT_CLIENT_SECRET
    })
  });
  const data = await res.json();
  return data['access-token'] || data.session_token;
}

// ─────────────────────────────────────────────────────────────
// WebSocket Connection
// ─────────────────────────────────────────────────────────────
async function connectStreamer(student) {
  const sessionToken = await getSessionToken(student.refresh_token);
  if (!sessionToken) {
    console.error(`[${student.student_id}] Failed to get session token`);
    return;
  }

  console.log(`[${student.student_id}] Connecting to Account Streamer...`);

  const ws = new WebSocket(CONFIG.TT_STREAMER);
  let heartbeatTimer;

  ws.on('open', () => {
    console.log(`[${student.student_id}] WebSocket connected`);

    // Authenticate
    ws.send(JSON.stringify({
      action: 'auth-token',
      value: sessionToken
    }));

    // Subscribe to account updates
    ws.send(JSON.stringify({
      action: 'connect',
      value: student.account_number
    }));

    // Start heartbeat
    heartbeatTimer = setInterval(() => {
      ws.send(JSON.stringify({ action: 'heartbeat', value: '' }));
    }, CONFIG.HEARTBEAT_INTERVAL);
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);

      // ─── Handle Order Events ───
      if (msg.type === 'Order') {
        const order = msg.data;
        const status = order.status;

        // Only forward actionable events
        if (['Filled', 'Cancelled', 'Rejected', 'Expired'].includes(status)) {
          console.log(`[${student.student_id}] Order ${status}: ${order['underlying-symbol']} #${order.id}`);

          // Forward to n8n webhook
          await fetch(CONFIG.N8N_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_type: `ORDER_${status.toUpperCase()}`,
              student_id: student.student_id,
              account_number: student.account_number,
              timestamp: new Date().toISOString(),
              order_id: order.id,
              complex_order_id: order['complex-order-id'] || null,
              symbol: order['underlying-symbol'],
              status: order.status,
              order_type: order['order-type'],
              price: order.price,
              price_effect: order['price-effect'],
              stop_trigger: order['stop-trigger'],
              legs: (order.legs || []).map(l => ({
                symbol: l.symbol,
                action: l.action,
                quantity: l.quantity,
                remaining: l['remaining-quantity'],
                fills: l.fills || []
              })),
              raw: order
            })
          });
        }
      }

      // ─── Handle Position Events ───
      if (msg.type === 'AccountBalance' || msg.type === 'CurrentPosition') {
        console.log(`[${student.student_id}] ${msg.type} update`);
        // Could forward to n8n for real-time Dashboard update
      }

    } catch (e) {
      console.error(`[${student.student_id}] Parse error:`, e.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[${student.student_id}] WebSocket closed: ${code} ${reason}`);
    clearInterval(heartbeatTimer);

    // Auto-reconnect
    setTimeout(() => connectStreamer(student), CONFIG.RECONNECT_DELAY);
  });

  ws.on('error', (err) => {
    console.error(`[${student.student_id}] WebSocket error:`, err.message);
  });
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log('=== tastytrade Account Streamer Sidecar ===');
  console.log(`Monitoring ${STUDENTS.length} student accounts`);

  for (const student of STUDENTS) {
    if (student.refresh_token) {
      connectStreamer(student);
    }
  }
}

main().catch(console.error);
