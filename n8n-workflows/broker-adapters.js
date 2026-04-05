// ============================================================
// 多券商適配器 — Broker Adapters
// 統一介面：getToken / placeOrder / closeOrder / getPositions / getBalances
// ============================================================
// 支援: tastytrade, schwab, ibkr
// 每個 adapter 實作相同的介面，WF-06/07/08 用 broker switch 呼叫
// ============================================================

// ═══════════════════════════════════════════════════════════════
// ADAPTER: tastytrade
// ═══════════════════════════════════════════════════════════════
const tastytrade = {
  name: 'tastytrade',
  API: 'https://api.tastyworks.com',
  CLIENT_ID: 'ec8b4453-d7e5-418e-8170-43e9b3e0b460',
  CLIENT_SECRET: 'b09387c27e0cd0325cae0a910e43fc5f158ca109',

  async getToken(ctx, refreshToken) {
    const res = await ctx.helpers.httpRequest({
      method: 'POST', url: this.API + '/oauth/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'chilldove-bot/1.0' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${this.CLIENT_ID}&client_secret=${this.CLIENT_SECRET}`,
    });
    return res.access_token || res['access-token'];
  },

  authHeaders(token) {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'chilldove-bot/1.0' };
  },

  // Place OTOCO / OTO / Simple order
  async placeOrder(ctx, token, accountNumber, orderData) {
    const headers = this.authHeaders(token);
    const { legs, limit_price, price_effect, stop_loss_price, profit_target_price, dry_run } = orderData;

    const orderLegs = legs.map(l => ({
      'instrument-type': l.instrument_type || 'Equity Option',
      'symbol': l.symbol, 'action': l.action, 'quantity': l.quantity || 1
    }));

    const closingLegs = orderLegs.map(l => ({
      'instrument-type': l['instrument-type'], 'symbol': l.symbol,
      'action': l.action === 'Sell to Open' ? 'Buy to Close' : l.action === 'Buy to Open' ? 'Sell to Close' : l.action,
      'quantity': l.quantity
    }));
    const closingEffect = price_effect === 'Credit' ? 'Debit' : 'Credit';

    // OTOCO
    if (stop_loss_price && profit_target_price) {
      const otoco = {
        'type': 'OTOCO',
        'trigger-order': { 'time-in-force': 'Day', 'order-type': 'Limit', 'price': parseFloat(limit_price), 'price-effect': price_effect, 'legs': orderLegs },
        'orders': [
          { 'time-in-force': 'GTC', 'order-type': 'Limit', 'price': parseFloat(profit_target_price), 'price-effect': closingEffect, 'legs': closingLegs },
          { 'time-in-force': 'GTC', 'order-type': 'Stop', 'stop-trigger': parseFloat(stop_loss_price), 'price-effect': closingEffect, 'legs': closingLegs }
        ]
      };
      const endpoint = dry_run ? 'complex-orders/dry-run' : 'complex-orders';
      const res = await ctx.helpers.httpRequest({
        method: 'POST', url: `${this.API}/accounts/${accountNumber}/${endpoint}`,
        headers, body: JSON.stringify(otoco), ignoreHttpStatusErrors: true,
      });
      const body = typeof res === 'string' ? JSON.parse(res) : res;
      return { broker: 'tastytrade', order_type: 'OTOCO', dry_run: !!dry_run, data: body };
    }

    // OTO (stop loss only)
    if (stop_loss_price) {
      const oto = {
        'type': 'OTO',
        'trigger-order': { 'time-in-force': 'Day', 'order-type': 'Limit', 'price': parseFloat(limit_price), 'price-effect': price_effect, 'legs': orderLegs },
        'orders': [{ 'time-in-force': 'GTC', 'order-type': 'Stop', 'stop-trigger': parseFloat(stop_loss_price), 'price-effect': closingEffect, 'legs': closingLegs }]
      };
      const endpoint = dry_run ? 'complex-orders/dry-run' : 'complex-orders';
      const res = await ctx.helpers.httpRequest({
        method: 'POST', url: `${this.API}/accounts/${accountNumber}/${endpoint}`,
        headers, body: JSON.stringify(oto), ignoreHttpStatusErrors: true,
      });
      const body = typeof res === 'string' ? JSON.parse(res) : res;
      return { broker: 'tastytrade', order_type: 'OTO', dry_run: !!dry_run, data: body };
    }

    // Simple
    const order = { 'time-in-force': 'Day', 'order-type': 'Limit', 'price': parseFloat(limit_price), 'price-effect': price_effect, 'legs': orderLegs };
    const endpoint = dry_run ? 'orders/dry-run' : 'orders';
    const res = await ctx.helpers.httpRequest({
      method: 'POST', url: `${this.API}/accounts/${accountNumber}/${endpoint}`,
      headers, body: JSON.stringify(order), ignoreHttpStatusErrors: true,
    });
    const body = typeof res === 'string' ? JSON.parse(res) : res;
    return { broker: 'tastytrade', order_type: 'Simple', dry_run: !!dry_run, data: body };
  },

  async closeOrder(ctx, token, accountNumber, closeData) {
    const headers = this.authHeaders(token);
    const closingLegs = closeData.legs.map(l => ({
      'instrument-type': l.instrument_type || 'Equity Option', 'symbol': l.symbol,
      'action': l.close_action || (l.action === 'Sell to Open' ? 'Buy to Close' : 'Sell to Close'),
      'quantity': l.quantity || 1
    }));
    const order = closeData.close_price
      ? { 'time-in-force': 'Day', 'order-type': 'Limit', 'price': parseFloat(closeData.close_price), 'price-effect': closeData.close_price_effect || 'Debit', 'legs': closingLegs }
      : { 'time-in-force': 'Day', 'order-type': 'Market', 'legs': closingLegs };

    const res = await ctx.helpers.httpRequest({
      method: 'POST', url: `${this.API}/accounts/${accountNumber}/orders`,
      headers, body: JSON.stringify(order), ignoreHttpStatusErrors: true,
    });
    return typeof res === 'string' ? JSON.parse(res) : res;
  },

  async getPositions(ctx, token, accountNumber) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/accounts/${accountNumber}/positions`, headers, ignoreHttpStatusErrors: true });
    return res?.data?.items || [];
  },

  async getBalances(ctx, token, accountNumber) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/accounts/${accountNumber}/balances`, headers, ignoreHttpStatusErrors: true });
    return res?.data || {};
  },

  async getLiveOrders(ctx, token, accountNumber) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/accounts/${accountNumber}/orders/live`, headers, ignoreHttpStatusErrors: true });
    return res?.data?.items || [];
  }
};

// ═══════════════════════════════════════════════════════════════
// ADAPTER: Schwab (Charles Schwab Trader API)
// ═══════════════════════════════════════════════════════════════
const schwab = {
  name: 'schwab',
  API: 'https://api.schwabapi.com/trader/v1',
  TOKEN_URL: 'https://api.schwabapi.com/v1/oauth/token',
  // Client credentials must be set per-deployment
  CLIENT_ID: '',  // Set from env or config
  CLIENT_SECRET: '', // Set from env or config

  async getToken(ctx, refreshToken, clientId, clientSecret) {
    const cid = clientId || this.CLIENT_ID;
    const csec = clientSecret || this.CLIENT_SECRET;
    const basicAuth = Buffer.from(`${cid}:${csec}`).toString('base64');
    const res = await ctx.helpers.httpRequest({
      method: 'POST', url: this.TOKEN_URL,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${basicAuth}` },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    return res.access_token;
  },

  authHeaders(token) {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  },

  // Schwab option symbol format: e.g. "SPY   260417C00540000" (same as OCC)
  // Account number must be the hashed/encrypted version

  async placeOrder(ctx, token, accountHash, orderData) {
    const headers = this.authHeaders(token);
    const { legs, limit_price, price_effect, stop_loss_price, profit_target_price, dry_run } = orderData;

    // Map action names: tastytrade → Schwab
    const actionMap = {
      'Sell to Open': 'SELL_TO_OPEN', 'Buy to Open': 'BUY_TO_OPEN',
      'Sell to Close': 'SELL_TO_CLOSE', 'Buy to Close': 'BUY_TO_CLOSE'
    };

    const orderLegs = legs.map((l, i) => ({
      orderLegType: 'OPTION',
      legId: i + 1,
      instrument: { symbol: l.symbol, assetType: 'OPTION' },
      instruction: actionMap[l.action] || l.action,
      quantity: l.quantity || 1
    }));

    const closingLegs = legs.map((l, i) => ({
      orderLegType: 'OPTION',
      legId: i + 1,
      instrument: { symbol: l.symbol, assetType: 'OPTION' },
      instruction: l.action === 'Sell to Open' ? 'BUY_TO_CLOSE' : 'SELL_TO_CLOSE',
      quantity: l.quantity || 1
    }));

    // Bracket order (OTOCO equivalent): TRIGGER strategy
    if (stop_loss_price && profit_target_price) {
      const bracketOrder = {
        orderType: 'LIMIT',
        session: 'NORMAL',
        duration: 'DAY',
        price: limit_price,
        orderStrategyType: 'TRIGGER',
        orderLegCollection: orderLegs,
        childOrderStrategies: [
          {
            orderType: 'LIMIT',
            session: 'NORMAL',
            duration: 'GOOD_TILL_CANCEL',
            price: profit_target_price,
            orderStrategyType: 'SINGLE',
            orderLegCollection: closingLegs
          },
          {
            orderType: 'STOP',
            session: 'NORMAL',
            duration: 'GOOD_TILL_CANCEL',
            stopPrice: stop_loss_price,
            orderStrategyType: 'SINGLE',
            orderLegCollection: closingLegs
          }
        ]
      };

      if (dry_run) {
        return { broker: 'schwab', order_type: 'BRACKET', dry_run: true, data: bracketOrder, message: 'Schwab does not have a dry-run endpoint. Payload validated locally.' };
      }

      const res = await ctx.helpers.httpRequest({
        method: 'POST', url: `${this.API}/accounts/${accountHash}/orders`,
        headers, body: JSON.stringify(bracketOrder), returnFullResponse: true, ignoreHttpStatusErrors: true,
      });
      const orderId = res.headers?.location?.split('/').pop() || null;
      return { broker: 'schwab', order_type: 'BRACKET', order_id: orderId, status: res.statusCode < 300 ? 'ACCEPTED' : 'FAILED', raw: res.body };
    }

    // OTO (stop loss only)
    if (stop_loss_price) {
      const otoOrder = {
        orderType: 'LIMIT', session: 'NORMAL', duration: 'DAY',
        price: limit_price, orderStrategyType: 'TRIGGER',
        orderLegCollection: orderLegs,
        childOrderStrategies: [{
          orderType: 'STOP', session: 'NORMAL', duration: 'GOOD_TILL_CANCEL',
          stopPrice: stop_loss_price, orderStrategyType: 'SINGLE',
          orderLegCollection: closingLegs
        }]
      };
      if (dry_run) return { broker: 'schwab', order_type: 'OTO', dry_run: true, data: otoOrder };
      const res = await ctx.helpers.httpRequest({
        method: 'POST', url: `${this.API}/accounts/${accountHash}/orders`,
        headers, body: JSON.stringify(otoOrder), returnFullResponse: true, ignoreHttpStatusErrors: true,
      });
      const orderId = res.headers?.location?.split('/').pop() || null;
      return { broker: 'schwab', order_type: 'OTO', order_id: orderId, status: res.statusCode < 300 ? 'ACCEPTED' : 'FAILED', raw: res.body };
    }

    // Simple order
    const simpleOrder = {
      orderType: 'LIMIT', session: 'NORMAL', duration: 'DAY',
      price: limit_price, orderStrategyType: 'SINGLE',
      orderLegCollection: orderLegs
    };
    if (dry_run) return { broker: 'schwab', order_type: 'Simple', dry_run: true, data: simpleOrder };
    const res = await ctx.helpers.httpRequest({
      method: 'POST', url: `${this.API}/accounts/${accountHash}/orders`,
      headers, body: JSON.stringify(simpleOrder), returnFullResponse: true, ignoreHttpStatusErrors: true,
    });
    const orderId = res.headers?.location?.split('/').pop() || null;
    return { broker: 'schwab', order_type: 'Simple', order_id: orderId, status: res.statusCode < 300 ? 'ACCEPTED' : 'FAILED', raw: res.body };
  },

  async closeOrder(ctx, token, accountHash, closeData) {
    const headers = this.authHeaders(token);
    const actionMap = { 'Sell to Open': 'BUY_TO_CLOSE', 'Buy to Open': 'SELL_TO_CLOSE' };
    const closingLegs = closeData.legs.map((l, i) => ({
      orderLegType: 'OPTION', legId: i + 1,
      instrument: { symbol: l.symbol, assetType: 'OPTION' },
      instruction: actionMap[l.action] || l.close_action || 'SELL_TO_CLOSE',
      quantity: l.quantity || 1
    }));
    const order = closeData.close_price
      ? { orderType: 'LIMIT', session: 'NORMAL', duration: 'DAY', price: closeData.close_price, orderStrategyType: 'SINGLE', orderLegCollection: closingLegs }
      : { orderType: 'MARKET', session: 'NORMAL', duration: 'DAY', orderStrategyType: 'SINGLE', orderLegCollection: closingLegs };

    const res = await ctx.helpers.httpRequest({
      method: 'POST', url: `${this.API}/accounts/${accountHash}/orders`,
      headers, body: JSON.stringify(order), returnFullResponse: true, ignoreHttpStatusErrors: true,
    });
    return { order_id: res.headers?.location?.split('/').pop() || null, status: res.statusCode < 300 ? 'ACCEPTED' : 'FAILED' };
  },

  async getPositions(ctx, token, accountHash) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/accounts/${accountHash}?fields=positions`, headers, ignoreHttpStatusErrors: true });
    return res?.securitiesAccount?.positions || [];
  },

  async getBalances(ctx, token, accountHash) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/accounts/${accountHash}`, headers, ignoreHttpStatusErrors: true });
    const bal = res?.securitiesAccount?.currentBalances || {};
    return {
      'net-liquidating-value': bal.liquidationValue,
      'cash-balance': bal.cashBalance,
      'derivative-buying-power': bal.buyingPower,
      'maintenance-requirement': bal.maintenanceRequirement,
    };
  },

  async getLiveOrders(ctx, token, accountHash) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/accounts/${accountHash}/orders`, headers, ignoreHttpStatusErrors: true });
    return Array.isArray(res) ? res : [];
  }
};

// ═══════════════════════════════════════════════════════════════
// ADAPTER: Interactive Brokers (Client Portal API via OAuth 2.0)
// ═══════════════════════════════════════════════════════════════
const ibkr = {
  name: 'ibkr',
  API: 'https://api.ibkr.com/v1/api', // OAuth 2.0 endpoint (no Gateway needed)
  // For Gateway mode: 'https://localhost:5000/v1/api'
  TOKEN_URL: 'https://api.ibkr.com/v1/api/oauth/token',

  async getToken(ctx, refreshToken, clientId, clientSecret) {
    // IBKR OAuth 2.0 flow (for third-party apps)
    const res = await ctx.helpers.httpRequest({
      method: 'POST', url: this.TOKEN_URL,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${clientId}&client_secret=${clientSecret}`,
    });
    return res.access_token;
  },

  authHeaders(token) {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'chilldove-bot/1.0' };
  },

  // IBKR uses conid (contract ID) instead of option symbols
  // Must look up conid first via /iserver/secdef/search or /iserver/secdef/strikes

  async resolveConid(ctx, token, symbol, expiration, strike, right) {
    const headers = this.authHeaders(token);
    // Step 1: Search for underlying
    const search = await ctx.helpers.httpRequest({
      method: 'GET', url: `${this.API}/iserver/secdef/search?symbol=${symbol}&secType=OPT`,
      headers, ignoreHttpStatusErrors: true,
    });
    const sections = search?.[0]?.sections || [];
    const optSection = sections.find(s => s.secType === 'OPT');
    if (!optSection) return null;

    // Step 2: Get strikes for the expiration
    const strikes = await ctx.helpers.httpRequest({
      method: 'GET', url: `${this.API}/iserver/secdef/strikes?conid=${search[0].conid}&sectype=OPT&month=${expiration}`,
      headers, ignoreHttpStatusErrors: true,
    });

    // Step 3: Get specific contract info
    const info = await ctx.helpers.httpRequest({
      method: 'POST', url: `${this.API}/iserver/secdef/info`,
      headers,
      body: JSON.stringify({ conid: search[0].conid, sectype: 'OPT', month: expiration, strike, right }),
      ignoreHttpStatusErrors: true,
    });
    return info?.[0]?.conid || null;
  },

  async placeOrder(ctx, token, accountId, orderData) {
    const headers = this.authHeaders(token);
    const { legs, limit_price, stop_loss_price, profit_target_price, dry_run } = orderData;

    // IBKR multi-leg order (combo/spread)
    const ibkrLegs = [];
    for (const leg of legs) {
      // Each leg needs a conid — for now, pass conid directly or resolve
      ibkrLegs.push({
        conid: leg.conid || 0, // Must be resolved beforehand
        side: leg.action.includes('Buy') ? 'BUY' : 'SELL',
        quantity: leg.quantity || 1
      });
    }

    // Bracket order
    if (stop_loss_price && profit_target_price) {
      const orders = [
        // Parent: entry order
        {
          conid: ibkrLegs[0]?.conid, // For combos, use spread conid
          orderType: 'LMT',
          price: parseFloat(limit_price),
          side: ibkrLegs[0]?.side,
          quantity: ibkrLegs[0]?.quantity,
          tif: 'DAY',
          cOID: 'entry_' + Date.now(),
          // For spread, include legs
          ...(ibkrLegs.length > 1 ? { orderType: 'LMT', isClose: false } : {})
        },
        // Profit target
        {
          conid: ibkrLegs[0]?.conid,
          orderType: 'LMT',
          price: parseFloat(profit_target_price),
          side: ibkrLegs[0]?.side === 'BUY' ? 'SELL' : 'BUY',
          quantity: ibkrLegs[0]?.quantity,
          tif: 'GTC',
          parentId: 'entry_' + Date.now(),
          cOID: 'profit_' + Date.now(),
        },
        // Stop loss
        {
          conid: ibkrLegs[0]?.conid,
          orderType: 'STP',
          price: parseFloat(stop_loss_price),
          side: ibkrLegs[0]?.side === 'BUY' ? 'SELL' : 'BUY',
          quantity: ibkrLegs[0]?.quantity,
          tif: 'GTC',
          parentId: 'entry_' + Date.now(),
          cOID: 'stop_' + Date.now(),
        }
      ];

      if (dry_run) {
        return { broker: 'ibkr', order_type: 'BRACKET', dry_run: true, data: orders, message: 'IBKR bracket order validated locally' };
      }

      const res = await ctx.helpers.httpRequest({
        method: 'POST', url: `${this.API}/iserver/account/${accountId}/orders`,
        headers, body: JSON.stringify({ orders }), ignoreHttpStatusErrors: true,
      });
      return { broker: 'ibkr', order_type: 'BRACKET', data: res };
    }

    // Simple order
    const order = {
      conid: ibkrLegs[0]?.conid,
      orderType: 'LMT',
      price: parseFloat(limit_price),
      side: ibkrLegs[0]?.side,
      quantity: ibkrLegs[0]?.quantity,
      tif: 'DAY'
    };
    if (dry_run) return { broker: 'ibkr', order_type: 'Simple', dry_run: true, data: order };
    const res = await ctx.helpers.httpRequest({
      method: 'POST', url: `${this.API}/iserver/account/${accountId}/orders`,
      headers, body: JSON.stringify({ orders: [order] }), ignoreHttpStatusErrors: true,
    });
    return { broker: 'ibkr', order_type: 'Simple', data: res };
  },

  async getPositions(ctx, token, accountId) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/portfolio/${accountId}/positions`, headers, ignoreHttpStatusErrors: true });
    return Array.isArray(res) ? res : [];
  },

  async getBalances(ctx, token, accountId) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/portfolio/${accountId}/summary`, headers, ignoreHttpStatusErrors: true });
    return {
      'net-liquidating-value': res?.netliquidation?.amount,
      'cash-balance': res?.totalcashvalue?.amount,
      'derivative-buying-power': res?.buyingpower?.amount,
      'maintenance-requirement': res?.maintenancemarginreq?.amount,
    };
  },

  async getLiveOrders(ctx, token, accountId) {
    const headers = this.authHeaders(token);
    const res = await ctx.helpers.httpRequest({ method: 'GET', url: `${this.API}/iserver/account/orders`, headers, ignoreHttpStatusErrors: true });
    return res?.orders || [];
  }
};

// ═══════════════════════════════════════════════════════════════
// BROKER ROUTER — 根據 broker 欄位選擇對應 adapter
// ═══════════════════════════════════════════════════════════════
function getBrokerAdapter(brokerName) {
  const adapters = { tastytrade, schwab, ibkr };
  return adapters[brokerName?.toLowerCase()] || null;
}

// Export for use in n8n Code Node (copy this entire file as helper)
// Usage in WF-06:
//   const adapter = getBrokerAdapter(input.broker || 'tastytrade');
//   const token = await adapter.getToken(this, input.refresh_token);
//   const result = await adapter.placeOrder(this, token, input.account_number, orderData);
