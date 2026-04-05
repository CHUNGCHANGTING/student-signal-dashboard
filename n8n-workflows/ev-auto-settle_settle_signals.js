// ═══════════════════════════════════════════════════════
// 每日盤後自動結算 — 讀取未結信號，查到期價格，判斷 WIN/LOSS
// 觸發時間：台北 06:00（美股收盤後1小時）
// ═══════════════════════════════════════════════════════

const openSignals = $('Read Open Signals').all().map(i => i.json);
const today = new Date().toISOString().slice(0, 10);
const debugLog = [];

function log(msg) { debugLog.push(`[${new Date().toISOString()}] ${msg}`); }
log(`開始結算 — 共 ${openSignals.length} 筆信號`);

// 過濾需要結算的信號：outcome 為空 + 有到期日
const pending = openSignals.filter(s => 
  !s.outcome && s.exp_date && s.symbol && s.strategy
);
log(`待結算: ${pending.length} 筆`);

if (pending.length === 0) {
  return [{ json: { status: 'no_pending', date: today, total: openSignals.length, debugLog } }];
}

// 收集需要查價的 symbols
const symbolsToCheck = [...new Set(pending.map(s => s.symbol))];
log(`需查價標的: ${symbolsToCheck.join(', ')}`);

// 批量從 Yahoo Finance 查收盤價
const priceMap = {};
for (const sym of symbolsToCheck) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
    const data = await this.helpers.httpRequest({
      method: 'GET', url,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    const result = data?.chart?.result?.[0];
    if (result) {
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      // Build date→price map
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null) {
          const d = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
          priceMap[`${sym}_${d}`] = closes[i];
        }
      }
      // Also store latest price
      const validCloses = closes.filter(c => c != null);
      priceMap[sym] = validCloses[validCloses.length - 1];
      log(`${sym}: 最新收盤 $${priceMap[sym]?.toFixed(2)}`);
    }
  } catch(e) {
    log(`${sym}: Yahoo Finance error — ${e.message}`);
  }
}

// 結算每筆信號
const updates = [];
const now = new Date();

for (const sig of pending) {
  const expDate = sig.exp_date;
  const symbol = sig.symbol;
  const strategy = sig.strategy;
  const shortStrike = parseFloat(sig.short_strike) || 0;
  const longStrike = parseFloat(sig.long_strike) || 0;
  const credit = parseFloat(sig.credit) || 0;
  const debit = parseFloat(sig.debit) || 0;
  const stopLoss = parseFloat(sig.stop_loss) || 0;
  const takeProfit = parseFloat(sig.take_profit) || 0;
  const pushTime = sig.push_time || sig.created_at || '';

  // 到期日的收盤價
  const expPrice = priceMap[`${symbol}_${expDate}`] || null;
  // 今天的收盤價
  const currentPrice = priceMap[symbol] || null;
  
  // 判斷是否已到期
  const isExpired = today >= expDate;
  
  // 判斷是否觸發止損（用今天的價格近似）
  // Credit spread: 如果標的跌破 short strike（PCS）或漲破 short strike（CCS），接近止損
  // 更精確的判斷需要選擇權即時報價，這裡用標的價格近似
  
  let outcome = '';
  let actualPnl = 0;
  let exitReason = '';
  let exitPrice = '';
  let exitDate = '';

  if (isExpired && expPrice) {
    // ─── 到期結算 ───
    exitDate = expDate;
    exitPrice = expPrice.toFixed(2);
    
    if (strategy === 'Bull Put Spread' || strategy === 'Put Credit Spread') {
      // PCS: WIN if expPrice > shortStrike
      if (expPrice > shortStrike) {
        outcome = 'WIN';
        actualPnl = credit; // 保留全部 credit
        exitReason = `到期價$${expPrice.toFixed(2)} > 賣腿$${shortStrike} → 全額獲利`;
      } else if (expPrice <= longStrike) {
        outcome = 'LOSS';
        actualPnl = -(shortStrike - longStrike - credit); // max loss
        exitReason = `到期價$${expPrice.toFixed(2)} ≤ 買腿$${longStrike} → 最大虧損`;
      } else {
        outcome = 'LOSS';
        actualPnl = -(shortStrike - expPrice) + credit; // partial loss
        exitReason = `到期價$${expPrice.toFixed(2)} 在兩腿之間 → 部分虧損`;
      }
    }
    else if (strategy === 'Bear Call Spread' || strategy === 'Call Credit Spread') {
      // CCS: WIN if expPrice < shortStrike
      if (expPrice < shortStrike) {
        outcome = 'WIN';
        actualPnl = credit;
        exitReason = `到期價$${expPrice.toFixed(2)} < 賣腿$${shortStrike} → 全額獲利`;
      } else if (expPrice >= longStrike) {
        outcome = 'LOSS';
        actualPnl = -(longStrike - shortStrike - credit);
        exitReason = `到期價$${expPrice.toFixed(2)} ≥ 買腿$${longStrike} → 最大虧損`;
      } else {
        outcome = 'LOSS';
        actualPnl = -(expPrice - shortStrike) + credit;
        exitReason = `到期價$${expPrice.toFixed(2)} 在兩腿之間 → 部分虧損`;
      }
    }
    else if (strategy === 'Bull Call Spread' || strategy === 'Call Debit Spread') {
      // BCS debit: WIN if expPrice > longStrike + debit (breakeven)
      const breakeven = longStrike + debit;
      if (expPrice > longStrike) {
        const gain = Math.min(expPrice - longStrike, shortStrike - longStrike) - debit;
        outcome = gain > 0 ? 'WIN' : 'LOSS';
        actualPnl = gain;
        exitReason = `到期價$${expPrice.toFixed(2)} ${gain > 0 ? '>' : '<'} 損益兩平$${breakeven.toFixed(2)}`;
      } else {
        outcome = 'LOSS';
        actualPnl = -debit; // lose full debit
        exitReason = `到期價$${expPrice.toFixed(2)} < 買腿$${longStrike} → 全額虧損`;
      }
    }
    else if (strategy === 'Bear Put Spread' || strategy === 'Put Debit Spread') {
      // BPS debit: WIN if expPrice < longStrike - debit
      const breakeven = longStrike - debit;
      if (expPrice < longStrike) {
        const gain = Math.min(longStrike - expPrice, longStrike - shortStrike) - debit;
        outcome = gain > 0 ? 'WIN' : 'LOSS';
        actualPnl = gain;
        exitReason = `到期價$${expPrice.toFixed(2)} ${gain > 0 ? '<' : '>'} 損益兩平$${breakeven.toFixed(2)}`;
      } else {
        outcome = 'LOSS';
        actualPnl = -debit;
        exitReason = `到期價$${expPrice.toFixed(2)} > 買腿$${longStrike} → 全額虧損`;
      }
    }
    else if (strategy === 'Iron Condor') {
      // IC: WIN if expPrice between put short and call short
      const putShort = parseFloat(sig.put_short_strike || sig.short_strike) || 0;
      const callShort = parseFloat(sig.call_short_strike || sig.long_strike) || 0;
      if (expPrice > putShort && expPrice < callShort) {
        outcome = 'WIN';
        actualPnl = credit;
        exitReason = `到期價$${expPrice.toFixed(2)} 在翼內(${putShort}~${callShort}) → 全額獲利`;
      } else {
        outcome = 'LOSS';
        const width = parseFloat(sig.max_loss) || 0;
        actualPnl = -(width > 0 ? width : credit * 2);
        exitReason = `到期價$${expPrice.toFixed(2)} 突破翼外 → 虧損`;
      }
    }

    const daysHeld = Math.round((new Date(expDate) - new Date(pushTime)) / 86400000);
    
    updates.push({
      ...sig,
      outcome,
      actual_pnl: actualPnl.toFixed(2),
      exit_price: exitPrice,
      exit_date: exitDate,
      exit_reason: exitReason,
      days_held: daysHeld,
    });
    
    log(`${symbol} ${strategy}: ${outcome} | P&L $${actualPnl.toFixed(2)} | ${exitReason}`);
  }
  else if (!isExpired && currentPrice) {
    // ─── 未到期：檢查是否應該觸發止損 ───
    // 這裡只做標記，不自動結算（因為沒有選擇權即時報價）
    // 但可以計算「標的距離 short strike 的百分比」作為預警
    const distPct = shortStrike > 0 ? Math.abs(currentPrice - shortStrike) / shortStrike * 100 : 0;
    if (distPct < 3) {
      log(`⚠️ ${symbol} ${strategy}: 標的$${currentPrice.toFixed(2)} 距賣腿$${shortStrike} 僅${distPct.toFixed(1)}%`);
    }
  }
}

log(`結算完成: ${updates.length} 筆更新`);

if (updates.length === 0) {
  return [{ json: { status: 'no_expirations_today', date: today, pending: pending.length, debugLog } }];
}

return updates.map(u => ({ json: u }));
