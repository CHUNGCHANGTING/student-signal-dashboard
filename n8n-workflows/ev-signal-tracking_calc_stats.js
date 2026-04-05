// 計算各層的信號正確率
const allSignals = $('Read All Signals').all().map(i => i.json);
const settled = allSignals.filter(s => s.outcome && s.outcome !== '');
const wins = settled.filter(s => s.outcome === 'WIN');
const losses = settled.filter(s => s.outcome === 'LOSS' || s.outcome === 'STOPPED');

const total = settled.length;
const winCount = wins.length;
const lossCount = losses.length;
const winRate = total > 0 ? (winCount / total * 100).toFixed(1) : 'N/A';

// 按策略分組
const byStrategy = {};
for (const s of settled) {
  const key = s.strategy || 'unknown';
  if (!byStrategy[key]) byStrategy[key] = { wins: 0, losses: 0, total: 0, totalPnl: 0 };
  byStrategy[key].total++;
  if (s.outcome === 'WIN') byStrategy[key].wins++;
  else byStrategy[key].losses++;
  byStrategy[key].totalPnl += parseFloat(s.actual_pnl) || 0;
}

// 按方向分組
const byDirection = {};
for (const s of settled) {
  const key = s.direction || 'unknown';
  if (!byDirection[key]) byDirection[key] = { wins: 0, losses: 0, total: 0 };
  byDirection[key].total++;
  if (s.outcome === 'WIN') byDirection[key].wins++;
  else byDirection[key].losses++;
}

// 按 market regime 分組
const byRegime = {};
for (const s of settled) {
  const key = s.market_regime || 'unknown';
  if (!byRegime[key]) byRegime[key] = { wins: 0, losses: 0, total: 0 };
  byRegime[key].total++;
  if (s.outcome === 'WIN') byRegime[key].wins++;
  else byRegime[key].losses++;
}

// 各篩選條件的正確率
const filterAccuracy = {
  support_aligned: { yes: { w: 0, l: 0 }, no: { w: 0, l: 0 } },
  volume_spike: { yes: { w: 0, l: 0 }, no: { w: 0, l: 0 } },
  vega_favorable: { yes: { w: 0, l: 0 }, no: { w: 0, l: 0 } },
};

for (const s of settled) {
  const isWin = s.outcome === 'WIN';
  // 支撐對齊
  const sa = s.support_aligned === true || s.support_aligned === 'true';
  filterAccuracy.support_aligned[sa ? 'yes' : 'no'][isWin ? 'w' : 'l']++;
  // 成交量爆量
  const vs = s.volume_spike === true || s.volume_spike === 'true';
  filterAccuracy.volume_spike[vs ? 'yes' : 'no'][isWin ? 'w' : 'l']++;
  // Vega 效益
  const vf = (s.vega_note || '').includes('✅');
  filterAccuracy.vega_favorable[vf ? 'yes' : 'no'][isWin ? 'w' : 'l']++;
}

return [{ json: {
  summary: {
    total_signals: allSignals.length,
    settled: total,
    pending: allSignals.length - total,
    wins: winCount,
    losses: lossCount,
    win_rate: winRate + '%',
    total_pnl: settled.reduce((sum, s) => sum + (parseFloat(s.actual_pnl) || 0), 0).toFixed(2),
  },
  by_strategy: Object.entries(byStrategy).map(([k, v]) => ({
    strategy: k, ...v, winRate: (v.wins / v.total * 100).toFixed(1) + '%'
  })),
  by_direction: Object.entries(byDirection).map(([k, v]) => ({
    direction: k, ...v, winRate: (v.wins / v.total * 100).toFixed(1) + '%'
  })),
  by_regime: Object.entries(byRegime).map(([k, v]) => ({
    regime: k, ...v, winRate: (v.wins / v.total * 100).toFixed(1) + '%'
  })),
  filter_accuracy: filterAccuracy,
  generated_at: new Date().toISOString(),
} }];
