// ============================================================
// Dashboard 前端 — 券商 API 串接模組
// 嵌入 index.html 的 <script> 區塊
// ============================================================
// 功能:
//   1. 學生帳號綁定 (OAuth refresh_token 儲存)
//   2. Gate 4 送單 → WF-06 webhook
//   3. 平倉按鈕 → WF-07 webhook
//   4. 即時持倉載入 → WF-08 webhook
// ============================================================

// === CONFIG ===
const BROKER_WEBHOOKS = {
  order:    'https://chilldove.app.n8n.cloud/webhook/student-order',
  close:    'https://chilldove.app.n8n.cloud/webhook/student-close-position',
  dashboard:'https://chilldove.app.n8n.cloud/webhook/student-broker-dashboard',
  bind:     'https://chilldove.app.n8n.cloud/webhook/student-bind-account'
};

// === STUDENT SESSION (stored in localStorage) ===
function getStudentSession() {
  try {
    const raw = localStorage.getItem('student_broker_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveStudentSession(data) {
  localStorage.setItem('student_broker_session', JSON.stringify(data));
}

function clearStudentSession() {
  localStorage.removeItem('student_broker_session');
}

// ═══════════════════════════════════════════════════════════════
// 1. ACCOUNT BINDING — 學生綁定 tastytrade 帳號
// ═══════════════════════════════════════════════════════════════
// Student provides: account_number + refresh_token
// These are stored locally and sent with each request
// In production: stored encrypted in Google Sheet via WF

async function bindBrokerAccount(accountNumber, refreshToken) {
  const session = getStudentSession() || {};
  session.account_number = accountNumber;
  session.refresh_token = refreshToken;
  session.bound_at = new Date().toISOString();

  // Verify by fetching balances
  try {
    const res = await fetch(BROKER_WEBHOOKS.dashboard + '?student_id=' + (session.student_id || 'S001'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: session.student_id || 'S001',
        account_number: accountNumber,
        refresh_token: refreshToken,
        action: 'verify'
      })
    });
    const data = await res.json();
    if (data.success) {
      session.verified = true;
      session.net_liq = data.raw_balances?.net_liquidating_value;
      saveStudentSession(session);
      return { success: true, message: '帳號綁定成功！Net Liq: $' + session.net_liq };
    } else {
      return { success: false, message: '驗證失敗: ' + (data.error || 'Unknown error') };
    }
  } catch (e) {
    return { success: false, message: '連線失敗: ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. GATE 4 — 送單 (OTOCO with stop-loss)
// ═══════════════════════════════════════════════════════════════

async function submitBrokerOrder(orderData) {
  const session = getStudentSession();
  if (!session?.refresh_token) {
    return { success: false, error: '請先綁定券商帳號' };
  }

  // orderData should contain:
  // { symbol, strategy, legs[], quantity, limit_price, price_effect,
  //   stop_loss_price, profit_target_price, ev, kelly, pop, tracking_id }

  const payload = {
    student_id: session.student_id || 'S001',
    account_number: session.account_number,
    refresh_token: session.refresh_token,
    ...orderData
  };

  try {
    const res = await fetch(BROKER_WEBHOOKS.order, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      // Refresh positions after order
      setTimeout(() => loadBrokerPositions(), 3000);
    }
    return result;
  } catch (e) {
    return { success: false, error: '送單失敗: ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. CLOSE POSITION — 平倉
// ═══════════════════════════════════════════════════════════════

async function closeBrokerPosition(positionData) {
  const session = getStudentSession();
  if (!session?.refresh_token) {
    return { success: false, error: '請先綁定券商帳號' };
  }

  // positionData: { symbol, strategy, legs[], close_type, close_price,
  //   close_price_effect, original_credit, original_debit, note }

  const payload = {
    student_id: session.student_id || 'S001',
    account_number: session.account_number,
    refresh_token: session.refresh_token,
    ...positionData
  };

  try {
    const res = await fetch(BROKER_WEBHOOKS.close, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      // Refresh positions after close
      setTimeout(() => loadBrokerPositions(), 3000);
    }
    return result;
  } catch (e) {
    return { success: false, error: '平倉失敗: ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. LOAD LIVE POSITIONS — 即時持倉
// ═══════════════════════════════════════════════════════════════

async function loadBrokerPositions() {
  const session = getStudentSession();
  if (!session?.refresh_token) {
    console.log('No broker session - using demo data');
    return null;
  }

  try {
    const url = BROKER_WEBHOOKS.dashboard + '?student_id=' + (session.student_id || 'S001');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: session.student_id || 'S001',
        account_number: session.account_number,
        refresh_token: session.refresh_token
      })
    });
    const data = await res.json();

    if (data.success) {
      // Update Dashboard with real data
      dashboardData = data;
      renderPositions(data.positions || []);
      renderSignals(data.signals || []);
      renderRisk(data.risk || {});
      renderOrders(data.positions || []);
      updateStats(data);

      // Update status bar
      const dotEl = document.getElementById('live-dot');
      const timeEl = document.getElementById('live-time');
      const statusEl = document.getElementById('load-status');
      if (dotEl) dotEl.classList.add('online');
      if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
      if (statusEl) {
        statusEl.textContent = '✅ 已連接 tastytrade (' + (session.account_number || '') + ')';
        statusEl.className = 'load-status ok';
      }

      return data;
    }
    return null;
  } catch (e) {
    console.error('Position sync failed:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. ENHANCED executeClosePosition — 真實平倉版
// ═══════════════════════════════════════════════════════════════
// Override the existing executeClosePosition in index.html

function executeClosePositionBroker() {
  if (closingPositionIndex < 0 || !dashboardData) return;
  const p = dashboardData.positions[closingPositionIndex];
  const closeType = document.getElementById('close-type').value;
  const closePrice = document.getElementById('close-price').value;
  const closeNote = document.getElementById('close-note').value;

  const session = getStudentSession();

  if (session?.refresh_token && p.legs) {
    // Real broker close
    closeBrokerPosition({
      symbol: p.symbol,
      strategy: p.strategy,
      legs: p.legs,
      close_type: closeType,
      close_price: closePrice || undefined,
      close_price_effect: p.credit_received > 0 ? 'Debit' : 'Credit',
      original_credit: p.credit_received || 0,
      original_debit: p.debit_paid || 0,
      note: closeNote,
      tracking_id: p.tracking_id
    }).then(result => {
      if (result.success) {
        alert('✅ 平倉指令已送出！\n' + p.symbol + ' ' + p.strategy +
              '\n預估損益: $' + (result.estimated_pnl || 'pending'));
      } else {
        alert('❌ 平倉失敗: ' + (result.error || 'Unknown error'));
      }
      closeModal();
      setTimeout(() => loadBrokerPositions(), 2000);
    });
  } else {
    // Fallback: demo mode (existing behavior)
    executeClosePosition();
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. ENHANCED g4ExecuteOrder — 真實下單版
// ═══════════════════════════════════════════════════════════════

function g4ExecuteOrderBroker() {
  const session = getStudentSession();

  if (!session?.refresh_token) {
    alert('⚠️ 尚未綁定券商帳號\n請在「即時持倉 Dashboard」中先綁定您的 tastytrade 帳號');
    return;
  }

  // Collect order data from Gate 4 form
  const strategyType = document.getElementById('g4-strategy-type')?.value;
  const entryPrice = document.getElementById('g4-entry-price')?.value;
  const stopTrigger = document.getElementById('g4-stop-trigger')?.textContent?.replace('$', '');
  const stopLimit = document.getElementById('g4-stop-limit')?.textContent?.replace('$', '');

  // These would be populated from Gate 1-3 workflow state
  // For now, show confirmation dialog
  const confirmed = confirm(
    '🚀 確認送單？\n\n' +
    '策略: ' + (strategyType || 'N/A') + '\n' +
    '進場價: $' + (entryPrice || 'N/A') + '\n' +
    '止損觸發: $' + (stopTrigger || 'N/A') + '\n' +
    '止損限價: $' + (stopLimit || 'N/A') + '\n\n' +
    '帳號: ' + session.account_number
  );

  if (!confirmed) return;

  // In full implementation, orderData would be built from
  // the complete Gate 1-4 state machine
  alert('📝 送單功能需要完成 Gate 1-3 的策略選擇後才能送出\n' +
        '目前 Gate 4 的 UI 已就緒，等策略選擇流程串接完成即可實際送單');

  // Show success state
  const readyEl = document.getElementById('g4-order-ready');
  const doneEl = document.getElementById('g4-order-done');
  if (readyEl) readyEl.style.display = 'none';
  if (doneEl) doneEl.style.display = 'block';
}

// ═══════════════════════════════════════════════════════════════
// 7. AUTO-INIT — 頁面載入時自動連接
// ═══════════════════════════════════════════════════════════════
// Check if student has bound account, auto-load positions

(function initBrokerConnection() {
  const session = getStudentSession();
  if (session?.refresh_token && session?.verified) {
    console.log('[Broker] Auto-connecting for student:', session.student_id);
    // Will be called when Dashboard tab is opened
  }
})();
