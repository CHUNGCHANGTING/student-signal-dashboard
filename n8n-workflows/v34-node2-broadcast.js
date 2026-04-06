// === 正EV履約價推播 v3.0 — Node 2: 格式化 + 推播 ===
if ($input.first().json.skipped) {
  return [{ json: $input.first().json }];
}

// 盤勢全面暫停
if ($input.first().json.halted) {
  const d = $input.first().json;
  const haltMsg = `🚨 正EV推播 — 全面暫停\n━━━━━━━━━━━━━━\n\n${d.haltReason}\n\n盤勢狀態: ${d.marketRegime}\nVIX: ${d.vix?.toFixed(1) || 'N/A'}\nSPY方向: ${d.spyDirection || 'N/A'} (score=${d.spyDirScore || 0})\n\n⚠️ 極端恐慌環境，建議觀望不操作`;
  // Push halt notification to LINE + TG
  const LINE_TOKEN = 'y7xe8HwlQP5M0WQ3a9jzALbSSZ6/HtOyf4yQs4Eve0QJKa/JKgLFMYZiR7u4ErA/mvHoe8qRJBwiD21VSL1rb7BsJUmxzx+7OtvRXMChRRkwU87nWDRaC1dhXaYSafma3k2+Pk/QcSRwm7oG2VmxawdB04t89/1O/w1cDnyilFU=';
  const TG_TOKEN = '8680833770:AAHutju73oP6c5X90GErYXn3hTvqjZIb7po';
  const TG_CHAT = '-1003799249092';
  try { await this.helpers.httpRequest({ method: 'POST', url: 'https://api.line.me/v2/bot/message/broadcast', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN }, body: JSON.stringify({ messages: [{ type: 'text', text: haltMsg }] }), returnFullResponse: true, ignoreHttpStatusErrors: true }); } catch(e) {}
  try { await this.helpers.httpRequest({ method: 'POST', url: `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TG_CHAT, text: haltMsg }) }); } catch(e) {}
  // Also POST to webhook
  try { await this.helpers.httpRequest({ method: 'POST', url: 'https://chilldove.app.n8n.cloud/webhook/ev-signals-update', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timestamp: new Date().toISOString(), signals: [], summary: { halted: true, reason: d.haltReason, vix: d.vix, version: 'v3.4' }, raw: [] }) }); } catch(e) {}
  // Even halt messages get Dashboard link
  haltMsg += `\n\n📊 Dashboard:\nhttps://chungchangting.github.io/student-signal-dashboard/`;
  return [{ json: { message: haltMsg, halted: true, version: 'v3.4' } }];
}

const LINE_TOKEN = 'y7xe8HwlQP5M0WQ3a9jzALbSSZ6/HtOyf4yQs4Eve0QJKa/JKgLFMYZiR7u4ErA/mvHoe8qRJBwiD21VSL1rb7BsJUmxzx+7OtvRXMChRRkwU87nWDRaC1dhXaYSafma3k2+Pk/QcSRwm7oG2VmxawdB04t89/1O/w1cDnyilFU=';
const TG_TOKEN = '8680833770:AAHutju73oP6c5X90GErYXn3hTvqjZIb7po';
const TG_CHAT = '-1003799249092';

const data = $input.first().json;
const results = data.results || [];

const now = new Date(data.analysisTime || new Date());
const twTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
const dateStr = `${twTime.getFullYear()}/${twTime.getMonth()+1}/${twTime.getDate()}`;
const timeStr = `${twTime.getHours()}:${String(twTime.getMinutes()).padStart(2,'0')}`;

// Direction emoji
const dirEmoji = { bullish: '🟢', bearish: '🔴', neutral: '⚪' };
const dirLabel = { bullish: '看多', bearish: '看空', neutral: '中性' };
const stratLabel = {
  'Bull Put Spread': '【偏多收租】Put Credit Spread',
  'Bear Call Spread': '【偏空收租】Call Credit Spread',
  'Bull Call Spread': '【偏多進攻】Call Debit Spread',
  'Bear Put Spread': '【偏空進攻】Put Debit Spread',
  'Iron Condor': '【盤整收租】Iron Condor'
};

// Score and rank symbols
const ranked = results
  .filter(r => r.positiveEVSpreads && r.positiveEVSpreads.length > 0 && !r.error)
  .map(r => {
    const spreads = r.positiveEVSpreads;
    const bestEV = Math.max(...spreads.map(s => parseFloat(s.ev) || 0));
    const avgTrend = spreads.reduce((sum, s) => sum + (parseFloat(s.trendScore) || 0), 0) / spreads.length;
    return { ...r, bestEV, avgTrend, spreads };
  })
  .sort((a, b) => b.avgTrend - a.avgTrend)
  .slice(0, 5);

if (ranked.length === 0) {
  const noMsg = `📢 正EV履約價推播 v3.0 — ${dateStr} ${timeStr}\n━━━━━━━━━━━━━━\n\n⚠️ 今日無符合正EV條件的履約價\n篩選: Delta選價 + Greeks + IVR + 流動性\n\n少做多看，靜候佳機 🧘`;
  // Push to LINE
  try {
    await this.helpers.httpRequest({
      method: 'POST', url: 'https://api.line.me/v2/bot/message/broadcast',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN },
      body: JSON.stringify({ messages: [{ type: 'text', text: noMsg }] }),
      returnFullResponse: true, ignoreHttpStatusErrors: true
    });
  } catch(e) {}
  // Push to Telegram
  try {
    await this.helpers.httpRequest({
      method: 'POST', url: `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: noMsg })
    });
  } catch(e) {}
  return [{ json: { message: 'No positive EV today', version: 'v3.0' } }];
}

// Build message
const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
const regime = data.marketRegime || 'normal';
const vix = data.vix;
const spyDir = data.spyDirection;
const regimeMap = { normal: '🟢正常', caution: '🟡高波動警戒', bearOnly: '🔴只推Bear', halt: '🚨全面暫停' };

let msg = `🎯 正EV精選推薦 ${dateStr} ${timeStr}\n`;
msg += `━━━━━━━━━━━━━━\n`;
msg += `盤勢: ${regimeMap[regime] || regime}`;
if (vix) msg += ` | VIX:${vix.toFixed(1)}`;
if (spyDir) msg += ` | SPY:${spyDir}`;
msg += `\n\n`;

ranked.forEach((sym, idx) => {
  const de = dirEmoji[sym.direction] || '⚪';
  const dl = dirLabel[sym.direction] || '中性';

  msg += `\n${medals[idx]} #${idx+1} ${sym.ticker} ${sym.name}\n`;
  msg += `${de} ${dl} | 現價 $${sym.underlyingPrice}\n`;
  msg += `IV:${sym.iv} | IVR:${(parseFloat(sym.ivr)*100).toFixed(0)}%`;
  if (sym.ivSkew !== undefined && sym.ivSkew !== null) {
    msg += ` | Skew:${(parseFloat(sym.ivSkew)*100).toFixed(1)}%`;
  }
  msg += `\n`;
  msg += `RSI:${parseFloat(sym.rsi).toFixed(0)} | MA20:$${parseFloat(sym.ma20).toFixed(0)}`;
  if (sym.macd) msg += ` | MACD:${sym.macd.cross === 'death' ? '死叉🔴' : sym.macd.cross === 'golden' ? '金叉🟢' : (sym.macd.histogram > 0 ? '正' : '負')}`;
  if (sym.support) msg += ` | S:$${parseFloat(sym.support).toFixed(0)}`;
  if (sym.resistance) msg += ` | R:$${parseFloat(sym.resistance).toFixed(0)}`;
  msg += `\n`;

  // Best spread per strategy
  const bestByStrategy = {};
  sym.spreads.forEach(s => {
    const key = s.strategy;
    if (!bestByStrategy[key] || parseFloat(s.ev) > parseFloat(bestByStrategy[key].ev)) {
      bestByStrategy[key] = s;
    }
  });

  const sorted = Object.values(bestByStrategy).sort((a, b) =>
    parseFloat(b.trendScore || b.ev) - parseFloat(a.trendScore || a.ev)
  );

  sorted.forEach(s => {
    const isDebit = ['Bear Put', 'Bull Call'].includes(s.strategy);
    const action = isDebit ? '付' : '收';
    const amount = parseFloat(s.credit || s.debit || 0).toFixed(2);
    const wr = s.winRate ? `勝率${s.winRate}` : '';

    const sLabel = stratLabel[s.strategy] || s.strategy;
    if (s.strategy === 'Iron Condor') {
      msg += `➡️ ${sLabel} ${s.shortStrike}\n`;
    } else {
      msg += `➡️ ${sLabel} ${s.shortStrike}/${s.longStrike}\n`;
    }
    msg += `   ${action}$${amount} | EV $${parseFloat(s.ev).toFixed(2)} | Kelly ${s.kelly}\n`;
    msg += `   ${s.dte}DTE | ${wr} | Δ${s.shortDelta || '?'}\n`;

    // Stop loss / take profit
    if (s.takeProfit && s.stopLoss) {
      msg += `   🎯止盈$${s.takeProfit} | 🛑止損$${s.stopLoss}\n`;
    }

    // Margin
    if (s.margin) {
      msg += `   保證金 $${s.margin}\n`;
    }
  });
});

msg += `\n━━━━━━━━━━━━━━\n`;
msg += `v3.4 篩選:\n`;
msg += `📊 Greeks + Delta選價 + IVR\n`;
msg += `🧠 RSI/MA20/Skew方向判斷\n`;
msg += `🛡️ BidAsk<10% + OI>500\n`;
msg += `⚠️ CBOE即時數據，下單前請確認`;

// Split if too long (LINE limit 5000 chars)
const msgParts = [];
if (msg.length > 4500) {
  const lines = msg.split('\n');
  let current = '';
  for (const line of lines) {
    if ((current + line + '\n').length > 4400 && current.length > 0) {
      msgParts.push(current);
      current = '（續）\n' + line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current) msgParts.push(current);
} else {
  // Append Dashboard link
  msg += `\n\n📊 試算 Dashboard:\nhttps://chungchangting.github.io/student-signal-dashboard/`;
  msgParts.push(msg);
}

// LINE broadcast
let lineResponse = null;
for (const part of msgParts) {
  try {
    lineResponse = await this.helpers.httpRequest({
      method: 'POST', url: 'https://api.line.me/v2/bot/message/broadcast',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN },
      body: JSON.stringify({ messages: [{ type: 'text', text: part.trim() }] }),
      returnFullResponse: true, ignoreHttpStatusErrors: true
    });
  } catch (le) {
    lineResponse = { error: le.message };
  }
}

// Telegram
let tgResponse = 'not sent';
for (const part of msgParts) {
  try {
    const tgResp = await this.helpers.httpRequest({
      method: 'POST', url: `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: part.trim() })
    });
    tgResponse = tgResp.ok ? 'ok' : JSON.stringify(tgResp);
  } catch (e) {
    tgResponse = `TG Error: ${e.message}`;
  }
}

// === Google Sheet 歷史記錄寫入 ===
// Sheet: Options Dashboard Data (1clv5FZE6Fhf--2002oXlQg9SfVxqojiAL-QLpkdSGS4)
// Tab: signals (gid=637583169)
const SHEET_ID = '1clv5FZE6Fhf--2002oXlQg9SfVxqojiAL-QLpkdSGS4';
const sheetRows = [];

ranked.forEach(sym => {
  const bestByStrategy = {};
  sym.spreads.forEach(s => {
    const key = s.strategy;
    if (!bestByStrategy[key] || parseFloat(s.ev) > parseFloat(bestByStrategy[key].ev)) {
      bestByStrategy[key] = s;
    }
  });

  Object.values(bestByStrategy).forEach(s => {
    const isDebit = ['Bear Put Spread', 'Bull Call Spread'].includes(s.strategy);
    const moduleMap = {
      'Bull Put Spread': 'BPCS', 'Bear Call Spread': 'BCCS',
      'Bull Call Spread': 'BCDS', 'Bear Put Spread': 'BPDS',
      'Iron Condor': 'IC'
    };
    sheetRows.push({
      symbol: sym.ticker,
      strategy: s.strategy,
      decision: parseFloat(s.ev) > 0 ? 'GO' : 'SKIP',
      note: `EV=$${parseFloat(s.ev).toFixed(2)} Kelly=${s.kelly} Δ=${s.shortDelta || '?'} 止盈$${s.takeProfit} 止損$${s.stopLoss}`,
      module: moduleMap[s.strategy] || s.strategy,
      bias: sym.direction || 'neutral',
      iv_environment: `IVR=${(parseFloat(sym.ivr)*100).toFixed(0)}%`,
      created_at: new Date().toISOString(),
      event_risk: (function() {
        const KEY_EV = ['2026-01-09','2026-01-13','2026-01-28','2026-02-11','2026-02-13','2026-03-06','2026-03-11','2026-03-18','2026-04-03','2026-04-10','2026-04-29','2026-05-08','2026-05-12','2026-06-05','2026-06-10','2026-06-17','2026-07-02','2026-07-14','2026-07-29','2026-08-07','2026-08-12','2026-09-04','2026-09-11','2026-09-16','2026-10-02','2026-10-14','2026-10-28','2026-11-06','2026-11-10','2026-12-04','2026-12-09','2026-12-10'];
        const today = new Date().toISOString().slice(0,10);
        const in2d = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
        return KEY_EV.some(d => d >= today && d <= in2d);
      })(),
      pop: parseFloat(s.winRate) * 100 || 0,
      credit_received: parseFloat(s.credit || 0),
      debit_paid: parseFloat(s.debit || 0),
      max_loss: parseFloat(s.margin || 0),
    });
  });
});

// Write to Google Sheet via Sheets API (using service account from n8n)
let sheetWriteResult = 'not attempted';
if (sheetRows.length > 0) {
  try {
    // Use n8n's built-in Google Sheets API via httpRequest
    // Append rows to the signals sheet
    const values = sheetRows.map(r => [
      r.symbol, r.strategy, r.decision, r.note, r.module,
      r.bias, r.iv_environment, r.created_at, r.event_risk,
      r.pop, r.credit_received
    ]);

    // We'll use the Google Sheets API v4 append endpoint
    // But we need OAuth — instead, store for the webhook to pick up
    sheetWriteResult = `${sheetRows.length} rows prepared (stored in static data)`;
  } catch (e) {
    sheetWriteResult = `Sheet write error: ${e.message}`;
  }
}

// === Static Data 存儲（給 webhook 即時讀取）===
const staticData = $getWorkflowStaticData('global');
staticData.latestSignals = {
  timestamp: new Date().toISOString(),
  signals: sheetRows,
  summary: {
    symbolCount: ranked.length,
    totalSignals: sheetRows.length,
    version: 'v3.4'
  },
  raw: ranked.map(sym => ({
    ticker: sym.ticker,
    name: sym.name,
    underlyingPrice: sym.underlyingPrice,
    iv: sym.iv,
    ivr: sym.ivr,
    direction: sym.direction,
    directionScore: sym.directionScore,
    directionReasons: sym.directionReasons,
    rsi: sym.rsi,
    ma20: sym.ma20,
    support: sym.support,
    resistance: sym.resistance,
    macd: sym.macd,
    ivSkew: sym.ivSkew,
    spreads: sym.spreads,
  }))
};

// === POST 信號到勝率追蹤系統 ===
let trackingResult = 'not sent';
try {
  const trackPayload = {
    signals: sheetRows,
    tracking: {
      id: `sig-${Date.now()}`,
      pushTime: new Date().toISOString(),
      marketRegime: data.marketRegime || 'normal',
      vix: data.vix,
      symbolCount: ranked.length,
    },
    raw: ranked.map(sym => ({
      ticker: sym.ticker, name: sym.name,
      sector: sym.sector,
      underlyingPrice: sym.underlyingPrice, iv: sym.iv, ivr: sym.ivr,
      direction: sym.direction, directionScore: sym.directionScore,
      directionReasons: sym.directionReasons,
      rsi: sym.rsi, ma20: sym.ma20, support: sym.support, resistance: sym.resistance,
      macd: sym.macd, ivSkew: sym.ivSkew,
      volumeRatio: sym.volumeRatio, volumeSpike: sym.volumeSpike,
      spreads: sym.spreads,
    }))
  };
  const trackResp = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://chilldove.app.n8n.cloud/webhook/ev-signal-track',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trackPayload)
  });
  trackingResult = trackResp?.status || 'ok';
} catch (e) {
  trackingResult = `Tracking error: ${e.message}`;
}

// === POST 信號到 ev-signals webhook（供 Dashboard 即時讀取）===
let webhookResult = 'not sent';
try {
  const payload = {
    timestamp: new Date().toISOString(),
    signals: sheetRows,
    summary: { symbolCount: ranked.length, totalSignals: sheetRows.length, version: 'v3.4' },
    raw: ranked.map(sym => ({
      ticker: sym.ticker, name: sym.name,
      sector: sym.sector,
      underlyingPrice: sym.underlyingPrice, iv: sym.iv, ivr: sym.ivr,
      direction: sym.direction, directionScore: sym.directionScore,
      directionReasons: sym.directionReasons,
      rsi: sym.rsi, ma20: sym.ma20, support: sym.support, resistance: sym.resistance,
      macd: sym.macd, ivSkew: sym.ivSkew,
      volumeRatio: sym.volumeRatio, volumeSpike: sym.volumeSpike,
      marketState: sym.marketState,
      spreads: sym.spreads,
    })),
    tracking: {
      id: `sig-${Date.now()}`,
      pushTime: new Date().toISOString(),
      marketRegime: data.marketRegime,
      vix: data.vix,
      symbolCount: ranked.length,
    }
  };
  const webhookResp = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://chilldove.app.n8n.cloud/webhook/ev-signals-update',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  webhookResult = webhookResp?.status || 'ok';
} catch (e) {
  webhookResult = `Webhook error: ${e.message}`;
}

// === Google Sheet 寫入（透過 Apps Script Web App）===
let sheetResult = 'skipped';
if (sheetRows.length > 0) {
  try {
    // Use Google Sheets API v4 append via public Apps Script
    // Alternative: direct Sheets API with service account
    // For now, store in webhook static data (Dashboard reads from webhook)
    sheetResult = `${sheetRows.length} signals stored in webhook`;
  } catch(e) {
    sheetResult = e.message;
  }
}

return [{ json: {
  message: msg, lineResponse, tgResponse,
  messageCount: msgParts.length, symbolCount: ranked.length,
  webhookResult, sheetResult, trackingResult,
  signalsStored: sheetRows.length,
  version: 'v3.4'
} }];
