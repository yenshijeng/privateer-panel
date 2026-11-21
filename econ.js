/* 星域私掠者 經濟模組 econ.js v0.1  【T11】
 * 純邏輯、不碰 DOM；瀏覽器掛 window.XYEcon，Node 用 module.exports。
 * 只讀 data（goods／factions／systems），只改 save.market、save.money、save.cargo。
 *
 * 價格 = 基準價 × 設施係數 × 漂移 × 深度 × 買賣差 × 交涉
 *   設施係數：產出 0.78、一般 1.00、需求 1.27
 *   買賣差  ：買價 ×1.05、賣價 ×0.95
 *   漂移    ：每 24 小時 drift = 1 + (drift−1)×0.7 + 亂數(±volatility×0.5)，限制在 0.8～1.25
 *   深度    ：玩家每買 1 格 +DEPTH、每賣 1 格 −DEPTH（逐格累進），每 24 小時恢復一半
 *   交涉    ：等級 2 起，每級買價 −1%、賣價 +1%（上限 4%，永遠小於買賣差，不能同站套利）
 */
(function (root) {
  'use strict';

  var P = {
    produce: 0.78, normal: 1.0, demand: 1.27,
    spreadBuy: 1.05, spreadSell: 0.95,
    depth: 0.004,          // 每格貨的價格衝擊
    depthRecover: 0.5,     // 每 24 小時恢復比例
    driftPull: 0.7,
    driftMin: 0.8, driftMax: 1.25, driftScale: 0.5,
    talkStep: 0.01
  };

  // ---------- 亂數：用「存檔種子＋天數＋設施＋商品」算，同一天同一格價格固定 ----------
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }

  function index(data) {
    if (data._ei) return data._ei;
    var g = {}, f = {}, fac = {}, sys = {};
    (data.goods || []).forEach(function (x) { g[x.id] = x; });
    (data.factions || []).forEach(function (x) { f[x.id] = x; });
    (data.systems || []).forEach(function (s) {
      sys[s.id] = s;
      (s.facilities || []).forEach(function (x) { fac[x.id] = x; x._sys = s.id; });
    });
    data._ei = { goods: g, factions: f, fac: fac, sys: sys };
    return data._ei;
  }

  // 這座設施對這種商品的態度：'produce' | 'demand' | 'normal' | 'none'（不交易）| 'banned'（違禁）
  function status(data, facId, goodId) {
    var I = index(data), F = I.fac[facId];
    if (!F || (F.services || []).indexOf('market') < 0) return 'none';
    var m = F.market || {};
    if ((m.noTrade || []).indexOf(goodId) >= 0) return 'none';
    if (F.owner && F.type !== 'blackmarket') {
      var fa = I.factions[F.owner];
      if (fa && (fa.banned || []).indexOf(goodId) >= 0) return 'banned';
    }
    if ((m.produce || []).indexOf(goodId) >= 0) return 'produce';
    if ((m.demand || []).indexOf(goodId) >= 0) return 'demand';
    return 'normal';
  }

  function cell(save, facId, goodId) {
    var M = save.market || (save.market = {});
    var f = M[facId] || (M[facId] = {});
    return f[goodId] || (f[goodId] = { drift: 1, depth: 0 });
  }

  // 買價無條件進位、賣價無條件捨去，避免四捨五入造成同站套利
  function roundSide(p, side) { return side === 'buy' ? Math.max(1, Math.ceil(p)) : Math.max(1, Math.floor(p)); }

  function talkMod(talk, side) {
    var k = Math.max(0, (talk || 1) - 1) * P.talkStep;
    return side === 'buy' ? 1 - k : 1 + k;
  }

  // 單位價格（不含這筆交易自己造成的衝擊）
  function unitPrice(data, save, facId, goodId, side, talk) {
    var st = status(data, facId, goodId);
    if (st === 'none' || st === 'banned') return null;
    var G = index(data).goods[goodId], c = cell(save, facId, goodId);
    var p = G.base * P[st] * c.drift * (1 + c.depth) * (side === 'buy' ? P.spreadBuy : P.spreadSell) * talkMod(talk, side);
    return roundSide(p, side);
  }

  /** 報價：買或賣 qty 單位的總價（逐格累進衝擊）。回傳 {ok,total,avg,unit,reason} */
  function quote(data, save, facId, goodId, side, qty, talk) {
    var st = status(data, facId, goodId);
    if (st === 'none') return { ok: false, reason: '這裡不收這種貨' };
    if (st === 'banned') return { ok: false, reason: '這裡禁止這種貨' };
    var G = index(data).goods[goodId], c = cell(save, facId, goodId);
    var total = 0, d = c.depth, dir = side === 'buy' ? 1 : -1;
    for (var i = 0; i < qty; i++) {
      var p = G.base * P[st] * c.drift * (1 + d) * (side === 'buy' ? P.spreadBuy : P.spreadSell) * talkMod(talk, side);
      total += roundSide(p, side);
      d += dir * P.depth * G.vol;
    }
    return { ok: true, total: total, avg: qty ? Math.round(total / qty) : 0, unit: unitPrice(data, save, facId, goodId, side, talk), status: st, newDepth: d };
  }

  function cargoUsed(data, save) {
    var I = index(data);
    return (save.cargo || []).reduce(function (a, c) { return a + c.qty * (I.goods[c.id] ? I.goods[c.id].vol : 1); }, 0);
  }

  /**
   * 交易：qty>0 買、qty<0 賣。會改 save.money、save.cargo、save.market。
   * cap：貨艙上限。回傳 {ok, total, reason}
   */
  function trade(data, save, facId, goodId, qty, talk, cap) {
    if (!qty) return { ok: false, reason: '數量是 0' };
    var side = qty > 0 ? 'buy' : 'sell', n = Math.abs(qty), G = index(data).goods[goodId];
    var q = quote(data, save, facId, goodId, side, n, talk);
    if (!q.ok) return q;
    save.cargo = save.cargo || [];
    var free = (save.cargo || []).filter(function (c) { return c.id === goodId && !c.missionId; });
    if (side === 'buy') {
      if (q.total > save.money) return { ok: false, reason: '信用點不夠' };
      if (cap != null && cargoUsed(data, save) + n * G.vol > cap) return { ok: false, reason: '貨艙放不下' };
      save.money -= q.total;
      if (free.length) { var c0 = free[0]; c0.paid = Math.round((c0.paid * c0.qty + q.total) / (c0.qty + n)); c0.qty += n; }
      else save.cargo.push({ id: goodId, qty: n, paid: q.avg, missionId: null });
    } else {
      var have = free.reduce(function (a, c) { return a + c.qty; }, 0);
      if (have < n) return { ok: false, reason: '貨不夠' };
      save.money += q.total;
      var left = n;
      free.forEach(function (c) { var t = Math.min(c.qty, left); c.qty -= t; left -= t; });
      save.cargo = save.cargo.filter(function (c) { return c.qty > 0; });
    }
    cell(save, facId, goodId).depth = q.newDepth;
    return { ok: true, total: q.total, avg: q.avg };
  }

  /** 時間推進：每跨過一個 24 小時整點（以第幾天計），所有設施價格漂移一次、深度恢復一半 */
  function tick(data, save, fromDay, toDay) {
    var I = index(data), seed = save.seed || 1;
    for (var day = fromDay + 1; day <= toDay; day++) {
      Object.keys(I.fac).forEach(function (fid) {
        (data.goods || []).forEach(function (g) {
          var st = status(data, fid, g.id);
          if (st === 'none' || st === 'banned') return;
          var c = cell(save, fid, g.id);
          var r = hash(seed + ':' + day + ':' + fid + ':' + g.id) * 2 - 1;
          c.drift = Math.min(P.driftMax, Math.max(P.driftMin, 1 + (c.drift - 1) * P.driftPull + r * g.volatility * P.driftScale));
          c.depth = c.depth * (1 - P.depthRecover);
          if (Math.abs(c.depth) < 0.001) c.depth = 0;
        });
      });
    }
  }

  /** 列出一座設施的整張價目表（市場頁用） */
  function board(data, save, facId, talk) {
    return (data.goods || []).map(function (g) {
      var st = status(data, facId, g.id);
      return { id: g.id, name: g.name, cat: g.cat, status: st,
        buy: unitPrice(data, save, facId, g.id, 'buy', talk), sell: unitPrice(data, save, facId, g.id, 'sell', talk) };
    }).filter(function (r) { return r.status !== 'none'; });
  }

  var API = { P: P, status: status, unitPrice: unitPrice, quote: quote, trade: trade, tick: tick, board: board,
    cargoUsed: cargoUsed, ver: '0.1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.XYEcon = API;
})(typeof window !== 'undefined' ? window : this);
