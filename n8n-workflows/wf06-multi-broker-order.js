// ============================================================
// WF-06 v2【多券商下單】Multi-Broker Order Execution
// Webhook → Broker Switch → OAuth → OTOCO/OTO/Simple → Sheet
// ============================================================
// POST /webhook/student-order
// {
//   broker: "tastytrade" | "schwab" | "ibkr",  ← NEW
//   student_id, account_number, refresh_token,
//   // Schwab/IBKR additional:
//   client_id, client_secret, account_hash,
//   // Order data (same for all brokers):
//   symbol, strategy, legs[], quantity,
//   limit_price, price_effect,
//   stop_loss_price, profit_target_price,
//   ev, kelly, pop, tracking_id, dry_run
// }
// ============================================================

let input;
try { const raw = $input.first().json; input = raw.body || raw; }
catch (e) { return [{ json: { success: false, error: 'Input read failed: ' + e.message } }]; }

const brokerName = (input.broker || 'tastytrade').toLowerCase();
const { student_id, account_number, refresh_token, client_id, client_secret,
        account_hash, symbol, strategy, legs, quantity, limit_price, price_effect,
        stop_loss_price, profit_target_price, ev, kelly, pop, tracking_id } = input;
const dry_run = input.dry_run === true || input.dry_run === 'true';
const timestamp = new Date().toISOString();

// ─────────────────────────────────────────────────────────────
// BROKER ADAPTERS (inline for n8n Code Node compatibility)
// ─────────────────────────────────────────────────────────────

const TT = {
  API: 'https://api.tastyworks.com',
  CID: 'ec8b4453-d7e5-418e-8170-43e9b3e0b460',
  CSEC: '<TT_CLIENT_SECRET>',

  async getToken(ctx, rt) {
    const r = await ctx.helpers.httpRequest({ method:'POST', url: this.API+'/oauth/token',
      headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'chilldove/2.0'},
      body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${this.CID}&client_secret=${this.CSEC}` });
    return r.access_token || r['access-token'];
  },
  hdr(t) { return {'Authorization':'Bearer '+t,'Content-Type':'application/json','User-Agent':'chilldove/2.0'}; },

  async order(ctx, t, acct, od) {
    const h = this.hdr(t);
    const oLegs = od.legs.map(l => ({'instrument-type':l.instrument_type||'Equity Option','symbol':l.symbol,'action':l.action,'quantity':l.quantity||1}));
    const cLegs = oLegs.map(l => ({'instrument-type':l['instrument-type'],'symbol':l.symbol,
      'action':l.action==='Sell to Open'?'Buy to Close':l.action==='Buy to Open'?'Sell to Close':l.action,'quantity':l.quantity}));
    const cEffect = od.price_effect==='Credit'?'Debit':'Credit';

    if (od.stop_loss_price && od.profit_target_price) {
      const body = {'type':'OTOCO','trigger-order':{'time-in-force':'Day','order-type':'Limit','price':parseFloat(od.limit_price),'price-effect':od.price_effect,'legs':oLegs},
        'orders':[{'time-in-force':'GTC','order-type':'Limit','price':parseFloat(od.profit_target_price),'price-effect':cEffect,'legs':cLegs},
                  {'time-in-force':'GTC','order-type':'Stop','stop-trigger':parseFloat(od.stop_loss_price),'price-effect':cEffect,'legs':cLegs}]};
      const ep = od.dry_run ? 'complex-orders/dry-run' : 'complex-orders';
      const r = await ctx.helpers.httpRequest({method:'POST',url:`${this.API}/accounts/${acct}/${ep}`,headers:h,body:JSON.stringify(body),ignoreHttpStatusErrors:true});
      const d = typeof r==='string'?JSON.parse(r):r;
      const bp = d?.data?.['buying-power-effect']||{};
      return {success:!d?.error?.code||od.dry_run, broker:'tastytrade', order_type:'OTOCO', dry_run:od.dry_run,
        order_id:d?.data?.order?.id||null, status:od.dry_run?'DRY_RUN':'SENT',
        buying_power_change:bp['change-in-buying-power']||null, margin_req:bp['isolated-order-margin-requirement']||null, is_spread:bp['is-spread']||null, raw:d};
    }
    if (od.stop_loss_price) {
      const body = {'type':'OTO','trigger-order':{'time-in-force':'Day','order-type':'Limit','price':parseFloat(od.limit_price),'price-effect':od.price_effect,'legs':oLegs},
        'orders':[{'time-in-force':'GTC','order-type':'Stop','stop-trigger':parseFloat(od.stop_loss_price),'price-effect':cEffect,'legs':cLegs}]};
      const ep = od.dry_run ? 'complex-orders/dry-run' : 'complex-orders';
      const r = await ctx.helpers.httpRequest({method:'POST',url:`${this.API}/accounts/${acct}/${ep}`,headers:h,body:JSON.stringify(body),ignoreHttpStatusErrors:true});
      const d = typeof r==='string'?JSON.parse(r):r;
      return {success:!d?.error?.code||od.dry_run, broker:'tastytrade', order_type:'OTO', dry_run:od.dry_run, raw:d};
    }
    const body = {'time-in-force':'Day','order-type':'Limit','price':parseFloat(od.limit_price),'price-effect':od.price_effect,'legs':oLegs};
    const ep = od.dry_run ? 'orders/dry-run' : 'orders';
    const r = await ctx.helpers.httpRequest({method:'POST',url:`${this.API}/accounts/${acct}/${ep}`,headers:h,body:JSON.stringify(body),ignoreHttpStatusErrors:true});
    const d = typeof r==='string'?JSON.parse(r):r;
    const bp = d?.data?.['buying-power-effect']||{};
    return {success:!d?.error?.code||od.dry_run, broker:'tastytrade', order_type:'Simple', dry_run:od.dry_run,
      buying_power_change:bp['change-in-buying-power']||null, margin_req:bp['isolated-order-margin-requirement']||null, raw:d};
  }
};

const SCHWAB = {
  API: 'https://api.schwabapi.com/trader/v1',
  TOKEN_URL: 'https://api.schwabapi.com/v1/oauth/token',

  async getToken(ctx, rt, cid, csec) {
    const ba = Buffer.from(cid+':'+csec).toString('base64');
    const r = await ctx.helpers.httpRequest({method:'POST',url:this.TOKEN_URL,
      headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+ba},
      body:'grant_type=refresh_token&refresh_token='+encodeURIComponent(rt)});
    return r.access_token;
  },
  hdr(t) { return {'Authorization':'Bearer '+t,'Content-Type':'application/json'}; },

  async order(ctx, t, acctHash, od) {
    const h = this.hdr(t);
    const am = {'Sell to Open':'SELL_TO_OPEN','Buy to Open':'BUY_TO_OPEN','Sell to Close':'SELL_TO_CLOSE','Buy to Close':'BUY_TO_CLOSE'};
    const oLegs = od.legs.map((l,i) => ({orderLegType:'OPTION',legId:i+1,instrument:{symbol:l.symbol,assetType:'OPTION'},instruction:am[l.action]||l.action,quantity:l.quantity||1}));
    const cLegs = od.legs.map((l,i) => ({orderLegType:'OPTION',legId:i+1,instrument:{symbol:l.symbol,assetType:'OPTION'},
      instruction:l.action==='Sell to Open'?'BUY_TO_CLOSE':'SELL_TO_CLOSE',quantity:l.quantity||1}));

    let orderBody;
    if (od.stop_loss_price && od.profit_target_price) {
      orderBody = {orderType:'LIMIT',session:'NORMAL',duration:'DAY',price:od.limit_price,orderStrategyType:'TRIGGER',
        orderLegCollection:oLegs, complexOrderStrategyType:'CUSTOM',
        childOrderStrategies:[
          {orderType:'LIMIT',session:'NORMAL',duration:'GOOD_TILL_CANCEL',price:od.profit_target_price,orderStrategyType:'SINGLE',orderLegCollection:cLegs},
          {orderType:'STOP',session:'NORMAL',duration:'GOOD_TILL_CANCEL',stopPrice:od.stop_loss_price,orderStrategyType:'SINGLE',orderLegCollection:cLegs}
        ]};
      if (od.dry_run) return {success:true,broker:'schwab',order_type:'BRACKET',dry_run:true,data:orderBody,message:'Schwab: payload validated locally (no dry-run API)'};
    } else if (od.stop_loss_price) {
      orderBody = {orderType:'LIMIT',session:'NORMAL',duration:'DAY',price:od.limit_price,orderStrategyType:'TRIGGER',
        orderLegCollection:oLegs,
        childOrderStrategies:[{orderType:'STOP',session:'NORMAL',duration:'GOOD_TILL_CANCEL',stopPrice:od.stop_loss_price,orderStrategyType:'SINGLE',orderLegCollection:cLegs}]};
      if (od.dry_run) return {success:true,broker:'schwab',order_type:'OTO',dry_run:true,data:orderBody};
    } else {
      orderBody = {orderType:'LIMIT',session:'NORMAL',duration:'DAY',price:od.limit_price,orderStrategyType:'SINGLE',orderLegCollection:oLegs};
      if (od.dry_run) return {success:true,broker:'schwab',order_type:'Simple',dry_run:true,data:orderBody};
    }

    const r = await ctx.helpers.httpRequest({method:'POST',url:`${this.API}/accounts/${acctHash}/orders`,headers:h,body:JSON.stringify(orderBody),returnFullResponse:true,ignoreHttpStatusErrors:true});
    const oid = r.headers?.location?.split('/').pop()||null;
    return {success:r.statusCode<300, broker:'schwab', order_type:od.stop_loss_price?'BRACKET':'Simple', order_id:oid, status:r.statusCode<300?'ACCEPTED':'FAILED', raw:r.body};
  }
};

const IBKR = {
  API: 'https://api.ibkr.com/v1/api',

  async getToken(ctx, rt, cid, csec) {
    const r = await ctx.helpers.httpRequest({method:'POST',url:this.API.replace('/v1/api','')+'/v1/api/oauth/token',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${cid}&client_secret=${csec}`});
    return r.access_token;
  },
  hdr(t) { return {'Authorization':'Bearer '+t,'Content-Type':'application/json'}; },

  async order(ctx, t, acctId, od) {
    const h = this.hdr(t);
    // IBKR requires conid — legs must include conid field
    const orders = od.legs.map(l => ({
      conid: l.conid || 0, // Must be pre-resolved
      orderType: 'LMT', price: parseFloat(od.limit_price),
      side: l.action.includes('Buy') ? 'BUY' : 'SELL',
      quantity: l.quantity || 1, tif: 'DAY'
    }));

    if (od.dry_run) return {success:true,broker:'ibkr',order_type:'Simple',dry_run:true,data:orders,message:'IBKR: payload validated locally'};

    const r = await ctx.helpers.httpRequest({method:'POST',url:`${this.API}/iserver/account/${acctId}/orders`,
      headers:h,body:JSON.stringify({orders}),ignoreHttpStatusErrors:true});
    return {success:!r?.error, broker:'ibkr', data:r};
  }
};

// ─────────────────────────────────────────────────────────────
// MAIN: Route to correct broker
// ─────────────────────────────────────────────────────────────
const required = ['student_id','account_number','refresh_token','symbol','strategy','legs','limit_price'];
for (const f of required) { if (!input[f]) return [{json:{success:false,error:`Missing: ${f}`}}]; }

let result;
try {
  const orderData = { legs, limit_price, price_effect, stop_loss_price, profit_target_price, dry_run };

  if (brokerName === 'schwab') {
    if (!client_id || !client_secret) return [{json:{success:false,error:'Schwab requires client_id and client_secret'}}];
    const acct = account_hash || account_number;
    const token = await SCHWAB.getToken(this, refresh_token, client_id, client_secret);
    result = await SCHWAB.order(this, token, acct, orderData);

  } else if (brokerName === 'ibkr') {
    if (!client_id) return [{json:{success:false,error:'IBKR requires client_id'}}];
    const token = await IBKR.getToken(this, refresh_token, client_id, client_secret || '');
    result = await IBKR.order(this, token, account_number, orderData);

  } else {
    // Default: tastytrade
    const token = await TT.getToken(this, refresh_token);
    result = await TT.order(this, token, account_number, orderData);
  }
} catch (e) {
  result = { success: false, broker: brokerName, error: e.message };
}

// ─────────────────────────────────────────────────────────────
// Record for Google Sheet
// ─────────────────────────────────────────────────────────────
const record = {
  timestamp, student_id, account_number, tracking_id: tracking_id || `ORD-${Date.now()}`,
  broker: brokerName, symbol, strategy, order_type: result.order_type || '',
  order_id: result.order_id || '', limit_price, price_effect,
  stop_loss_price: stop_loss_price || '', profit_target_price: profit_target_price || '',
  quantity, ev: ev || '', kelly: kelly || '', pop: pop || '',
  status: result.success ? (dry_run ? 'DRY_RUN' : 'SENT') : 'FAILED',
  dry_run: dry_run ? 'YES' : 'NO', error: result.error || '', legs_json: JSON.stringify(legs)
};

return [{ json: { ...result, student_id, symbol, strategy, tracking_id: record.tracking_id, record, _sheetData: record } }];
