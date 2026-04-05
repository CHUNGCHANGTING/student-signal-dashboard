// 接收正EV推播的信號，寫入 Google Sheet signal_tracking 分頁
const body = $input.first().json.body || $input.first().json;
const signals = body.signals || [];
const tracking = body.tracking || {};
const raw = body.raw || [];

if (signals.length === 0) {
  return [{ json: { status: 'no_signals', timestamp: new Date().toISOString() } }];
}

// 為每筆信號建立追蹤記錄
const rows = [];
for (const sig of signals) {
  // 找到對應的 raw 數據
  const rawSym = raw.find(r => r.ticker === sig.symbol) || {};
  const spreads = rawSym.spreads || [];
  const matchSpread = spreads.find(s => s.strategy === sig.strategy) || {};

  rows.push({
    tracking_id: tracking.id || `sig-${Date.now()}`,
    push_time: tracking.pushTime || new Date().toISOString(),
    symbol: sig.symbol,
    strategy: sig.strategy,
    module: sig.module,
    direction: sig.bias || rawSym.direction || '',
    direction_score: rawSym.directionScore || 0,
    market_regime: tracking.marketRegime || '',
    vix: tracking.vix || '',
    
    // 技術面快照
    rsi: rawSym.rsi || '',
    ma20: rawSym.ma20 || '',
    macd_cross: rawSym.macd?.cross || '',
    iv_skew: rawSym.ivSkew || '',
    ivr: rawSym.ivr || '',
    support: rawSym.support || '',
    resistance: rawSym.resistance || '',
    volume_ratio: rawSym.volumeRatio || '',
    volume_spike: rawSym.volumeSpike || false,
    
    // 策略參數
    short_strike: matchSpread.shortStrike || sig.short_strike || '',
    long_strike: matchSpread.longStrike || sig.long_strike || '',
    dte: matchSpread.dte || '',
    exp_date: matchSpread.expDate || '',
    credit: sig.credit_received || matchSpread.credit || '',
    debit: sig.debit_paid || matchSpread.debit || '',
    ev: matchSpread.ev || '',
    kelly: matchSpread.kelly || '',
    win_rate: matchSpread.winRate || '',
    delta: matchSpread.shortDelta || '',
    take_profit: matchSpread.takeProfit || '',
    stop_loss: matchSpread.stopLoss || '',
    support_aligned: matchSpread.supportAligned || false,
    resistance_aligned: matchSpread.resistanceAligned || false,
    vega_note: matchSpread.vegaNote || '',
    
    // 結果（待填入）
    outcome: '',           // WIN / LOSS / STOPPED / EXPIRED
    actual_pnl: '',        // 實際盈虧
    exit_price: '',        // 出場價格
    exit_date: '',         // 出場日期
    exit_reason: '',       // 止盈/止損/到期/手動
    days_held: '',         // 持有天數
    
    // 版本
    version: 'v3.4',
  });
}

return rows.map(r => ({ json: r }));
