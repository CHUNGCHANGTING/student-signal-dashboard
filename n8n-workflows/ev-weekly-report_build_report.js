// ═══════════════════════════════════════════════════════
// 每週勝率報告 — 讀取 signal_tracking，計算統計，推播
// ═══════════════════════════════════════════════════════

const allSignals = $('Read All Signals').all().map(i => i.json);
const now = new Date();
const oneWeekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
const today = now.toISOString().slice(0, 10);

// 全部信號
const total = allSignals.length;
const settled = allSignals.filter(s => s.outcome && s.outcome !== '');
const pending = allSignals.filter(s => !s.outcome || s.outcome === '');

// 本週信號（過去 7 天推播的）
const thisWeek = allSignals.filter(s => (s.push_time || '').slice(0, 10) >= oneWeekAgo);
const thisWeekSettled = thisWeek.filter(s => s.outcome && s.outcome !== '');

// 統計函數
function calcStats(signals) {
  const s = signals.filter(x => x.outcome);
  const wins = s.filter(x => x.outcome === 'WIN').length;
  const losses = s.filter(x => x.outcome === 'LOSS' || x.outcome === 'STOPPED').length;
  const t = wins + losses;
  const pnl = s.reduce((sum, x) => sum + (parseFloat(x.actual_pnl) || 0), 0);
  return { total: t, wins, losses, winRate: t > 0 ? (wins/t*100).toFixed(1) : 'N/A', pnl: pnl.toFixed(2) };
}

// 按策略
const strategies = {};
for (const s of settled) {
  const key = s.strategy || 'unknown';
  if (!strategies[key]) strategies[key] = [];
  strategies[key].push(s);
}

// 按方向
const directions = {};
for (const s of settled) {
  const key = s.direction || 'unknown';
  if (!directions[key]) directions[key] = [];
  directions[key].push(s);
}

// 按盤勢
const regimes = {};
for (const s of settled) {
  const key = s.market_regime || 'unknown';
  if (!regimes[key]) regimes[key] = [];
  regimes[key].push(s);
}

// 各篩選條件的正確率
function filterWinRate(signals, field, trueVal) {
  const withFlag = signals.filter(s => {
    const v = s[field];
    return v === true || v === 'true' || v === trueVal;
  });
  const withoutFlag = signals.filter(s => {
    const v = s[field];
    return v !== true && v !== 'true' && v !== trueVal;
  });
  const wWith = calcStats(withFlag);
  const wWithout = calcStats(withoutFlag);
  return { with: wWith, without: wWithout };
}

const allStats = calcStats(settled);
const weekStats = calcStats(thisWeekSettled);

// ─── 組裝訊息 ───
const twDate = new Date(now.getTime() + 8*3600000);
const dateStr = `${twDate.getFullYear()}/${twDate.getMonth()+1}/${twDate.getDate()}`;

let msg = `📊 正EV週勝率報告 ${dateStr}\n`;
msg += `━━━━━━━━━━━━━━\n\n`;

// 總覽
msg += `📈 累計統計\n`;
msg += `  總信號: ${total} 筆 | 已結算: ${settled.length} | 待結算: ${pending.length}\n`;
msg += `  勝率: ${allStats.winRate}% (${allStats.wins}勝 ${allStats.losses}敗)\n`;
msg += `  累計P&L: $${allStats.pnl}\n\n`;

// 本週
msg += `📅 本週 (${oneWeekAgo} ~ ${today})\n`;
msg += `  新信號: ${thisWeek.length} 筆 | 已結算: ${thisWeekSettled.length}\n`;
if (thisWeekSettled.length > 0) {
  msg += `  本週勝率: ${weekStats.winRate}% (${weekStats.wins}勝 ${weekStats.losses}敗)\n`;
  msg += `  本週P&L: $${weekStats.pnl}\n`;
} else {
  msg += `  本週尚無結算\n`;
}
msg += `\n`;

// 按策略
msg += `📋 策略勝率\n`;
for (const [name, sigs] of Object.entries(strategies)) {
  const st = calcStats(sigs);
  if (st.total > 0) {
    msg += `  ${name}: ${st.winRate}% (${st.wins}/${st.total}) P&L $${st.pnl}\n`;
  }
}
msg += `\n`;

// 按方向
msg += `🧭 方向勝率\n`;
for (const [name, sigs] of Object.entries(directions)) {
  const st = calcStats(sigs);
  if (st.total > 0) {
    const emoji = name === 'bullish' ? '🟢' : name === 'bearish' ? '🔴' : '⚪';
    msg += `  ${emoji} ${name}: ${st.winRate}% (${st.wins}/${st.total})\n`;
  }
}
msg += `\n`;

// 按盤勢
if (Object.keys(regimes).length > 1) {
  msg += `🏛️ 盤勢勝率\n`;
  for (const [name, sigs] of Object.entries(regimes)) {
    const st = calcStats(sigs);
    if (st.total > 0) {
      msg += `  ${name}: ${st.winRate}% (${st.wins}/${st.total})\n`;
    }
  }
  msg += `\n`;
}

// 篩選條件效果
if (settled.length >= 5) {
  msg += `🔬 篩選條件效果\n`;
  const sa = filterWinRate(settled, 'support_aligned', true);
  if (sa.with.total > 0 || sa.without.total > 0) {
    msg += `  支撐對齊: 有=${sa.with.winRate}% vs 無=${sa.without.winRate}%\n`;
  }
  const vs = filterWinRate(settled, 'volume_spike', true);
  if (vs.with.total > 0 || vs.without.total > 0) {
    msg += `  成交量爆量: 有=${vs.with.winRate}% vs 無=${vs.without.winRate}%\n`;
  }
}

msg += `\n━━━━━━━━━━━━━━\n`;
msg += `v3.4 | 自動週報 | 下次: 下週一 10:00`;

// ─── 推播 ───
const LINE_TOKEN = 'y7xe8HwlQP5M0WQ3a9jzALbSSZ6/HtOyf4yQs4Eve0QJKa/JKgLFMYZiR7u4ErA/mvHoe8qRJBwiD21VSL1rb7BsJUmxzx+7OtvRXMChRRkwU87nWDRaC1dhXaYSafma3k2+Pk/QcSRwm7oG2VmxawdB04t89/1O/w1cDnyilFU=';
const TG_TOKEN = '8680833770:AAHutju73oP6c5X90GErYXn3hTvqjZIb7po';
const TG_CHAT = '-1003799249092';

let lineResult = 'not sent';
let tgResult = 'not sent';

try {
  await this.helpers.httpRequest({
    method: 'POST', url: 'https://api.line.me/v2/bot/message/broadcast',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN },
    body: JSON.stringify({ messages: [{ type: 'text', text: msg }] }),
    returnFullResponse: true, ignoreHttpStatusErrors: true
  });
  lineResult = 'ok';
} catch(e) { lineResult = e.message; }

try {
  const tg = await this.helpers.httpRequest({
    method: 'POST', url: `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg })
  });
  tgResult = tg.ok ? 'ok' : JSON.stringify(tg);
} catch(e) { tgResult = e.message; }

// 也更新到 Dashboard webhook
try {
  await this.helpers.httpRequest({
    method: 'POST', url: 'https://chilldove.app.n8n.cloud/webhook/ev-signals-update',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp: now.toISOString(),
      weeklyReport: { allStats, weekStats, strategies: Object.fromEntries(Object.entries(strategies).map(([k,v]) => [k, calcStats(v)])), date: dateStr },
      signals: [], summary: { type: 'weekly_report', version: 'v3.4' }, raw: []
    })
  });
} catch(e) {}

return [{ json: { message: msg, lineResult, tgResult, allStats, weekStats, date: dateStr } }];
