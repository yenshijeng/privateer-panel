/* 星域私掠者 面板核心邏輯 game.js（v0.6：加入船塢——換船、改裝、補飛彈、特殊裝備效果、短躍引擎耗時、任務危險提示）
 * 純邏輯、不碰 DOM。瀏覽器掛 window.XYGame，Node 用 module.exports。
 * 面板是唯一的數值來源；存檔鍵 xy1_save，存檔版本 2（Sonnet-05 新增欄位缺少時自動補預設，不升版）。
 * 價格全部由 econ.js（XYEcon）計算，這裡不再有價格公式。
 */
(function (root) {
  'use strict';
  var isNode = (typeof module !== 'undefined' && module.exports);
  var Combat = isNode ? require('./combat.js') : root.XYCombat;
  var Econ = isNode ? require('./econ.js') : root.XYEcon;
  var MisFactory = isNode ? require('./missions.js') : root.XYMissionsFactory;
  var Mis = null; // 任務電腦（missions.js），在檔案最後建立

  var D = null; // 索引後的資料
  var SAVE_KEY = 'xy1_save';
  var SAVE_VER = 2;
  var TIERS = [
    { key: 'nemesis', name: '仇敵', min: -100 }, { key: 'hostile', name: '敵視', min: -49 },
    { key: 'neutral', name: '中立', min: -14 }, { key: 'friendly', name: '友善', min: 15 },
    { key: 'ally', name: '盟友', min: 50 }
  ];
  var ORIGINS = [
    { id: 'pilot', name: '退役艦隊飛行員', desc: '射擊 +1；艦隊好感，赤帆敵視。', gunnery: 1, rep: { fleet: 15, redsail: -15 } },
    { id: 'merchant', name: '破產商人之後', desc: '交涉 +1；聯盟好感。', talk: 1, rep: { league: 15 } },
    { id: 'sailor', name: '前赤帆水手', desc: '駕駛 +1；赤帆好感，艦隊敵視。', pilot: 1, rep: { redsail: 15, fleet: -15 } },
    { id: 'apprentice', name: '遺環會叛逃學徒', desc: '技術 +1；遺環會敵視，能辨識遺物。', tech: 1, rep: { relic: -10 } }
  ];
  var SKILLS = ['pilot', 'gunnery', 'talk', 'tech'];
  var SKILL_NAME = { pilot: '駕駛', gunnery: '射擊', talk: '交涉', tech: '技術' };
  var XP_CUM = [0, 100, 250, 450, 700]; // 升到 2,3,4,5 級的累計經驗；每升一級，該項能力 +1
  var LOG_MAX = 200;
  // 船貸規則
  var LOAN = { start: 20000, rate: 0.02, installment: 2500, period: 168, fee: 500, repRepay: 5, repMiss: -5, destroyAdd: 8000 };
  var INS = { rate: 0.05, hours: 168 };
  var SCAN_BASE = 0.5, FINE_RATE = 0.5, SEIZE_REP = -5;

  // ---------- 小工具 ----------
  function mulberry(seed) { // 純函式版：回傳 [值, 新種子]
    var t = (seed + 0x6D2B79F5) >>> 0, s = t;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
  }
  function rand(save) { var r = mulberry(save.rng); save.rng = r[1]; return r[0]; }
  function randInt(save, a, b) { return a + Math.floor(rand(save) * (b - a + 1)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function by(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }

  // ---------- 資料 ----------
  function init(data) {
    D = {};
    D.goods = by(data.goods.goods || data.goods);
    D.goodsList = data.goods.goods || data.goods;
    D.factions = by(data.factions.factions || data.factions);
    D.factionList = data.factions.factions || data.factions;
    D.sectors = by(data.sectors.sectors || data.sectors);
    D.systems = {}; D.facs = {}; D.facSys = {}; D.systemList = [];
    (data.systemFiles || []).forEach(function (f) {
      f.systems.forEach(function (s) {
        s._sector = f.sector;
        D.systems[s.id] = s; D.systemList.push(s);
        s.facilities.forEach(function (fc) { D.facs[fc.id] = fc; D.facSys[fc.id] = s.id; });
      });
    });
    // econ.js 需要所有星區檔 systems 合併
    D.econData = { goods: D.goodsList, factions: D.factionList, systems: D.systemList };
    D.npcData = by((data.npcs && (data.npcs.npcs || data.npcs)) || []);
    D.missionTpls = data.missions ? (data.missions.templates || data.missions) : [];
    D.tpl = by(D.missionTpls);
    D.enemies = by(data.encounters.enemies);
    D.tables = by(data.encounters.tables);
    D.hulls = by(data.ships.hulls);
    D.equip = by(data.ships.equipment);
    D.combatData = {
      hulls: data.ships.hulls, equipment: data.ships.equipment,
      enemies: data.encounters.enemies,
      goods: D.goodsList.map(function (g) { return { id: g.id, cat: g.cat, name: g.name }; })
    };
    return D;
  }
  function data() { return D; }

  // ---------- 時間 ----------
  // save.t = 自第 1 天 00:00 起算的遊戲小時數
  function dayOf(t) { return Math.floor(t / 24) + 1; }
  function fmtClock(t) { return '第' + dayOf(t) + '天 ' + ('0' + (t % 24)).slice(-2) + ':00'; }
  function advance(save, h) {
    var t0 = save.t, t1 = t0 + h;
    // 船貸到期：照時間順序一期一期結算
    while (save.loan.balance > 0 && save.loan.nextDue != null && save.loan.nextDue <= t1) {
      save.t = save.loan.nextDue;
      loanDue(save);
    }
    // 保險到期
    var ins = save.insurance;
    if (ins && ins.active && ins.until != null && ins.until <= t1) {
      save.t = Math.max(save.t, ins.until);
      ins.active = false; ins.until = null;
      addLog(save, '保險到期了。');
    }
    save.t = t1;
    Econ.tick(D.econData, save, dayOf(t0), dayOf(t1));
    if (Mis) Mis.expire(save);
  }

  // ---------- 新遊戲 ----------
  function startLoadout(hullId, gunCount) { // 起始配備（規格第 3 節 6）：前方槽雷射 I、砲塔槽砲塔雷射 I、護盾 I、引擎 I、短躍引擎 I
    var H = D.hulls[hullId], n = gunCount != null ? gunCount : H.slots.gun.length, guns = [];
    for (var i = 0; i < Math.min(n, H.slots.gun.length); i++) guns.push(H.slots.gun[i].arc === 'turret' ? 'turret_mk1' : 'laser_mk1');
    return { gun: guns, missile: [], shield: H.slots.shield ? 'shield_mk1' : null, engine: H.slots.engine ? 'engine_mk1' : null, jump: H.slots.jump ? 'jump_mk1' : null };
  }
  function newGame(opts, seed) {
    var org = ORIGINS.filter(function (o) { return o.id === opts.origin; })[0] || ORIGINS[0];
    seed = (seed >>> 0) || (Date.now() >>> 0) || 1;
    var t0 = 8, H = D.hulls.donkey;
    var save = {
      v: SAVE_VER, seed: seed, rng: (Math.imul(seed, 2654435761) ^ 0x5bd1e995) >>> 0 || 1, t: t0,
      player: {
        name: (opts.name || '無名船長').slice(0, 12), gender: opts.gender || '', look: (opts.look || '').slice(0, 60),
        origin: org.id,
        stats: { pilot: 1 + (org.pilot || 0), gunnery: 1 + (org.gunnery || 0), talk: 1 + (org.talk || 0), tech: 1 + (org.tech || 0) },
        xp: { pilot: 0, gunnery: 0, talk: 0, tech: 0 }
      },
      reputation: { league: 0, fleet: 0, redsail: 0, relic: 0 },
      money: 3000,
      loan: { balance: LOAN.start, rate: LOAN.rate, installment: LOAN.installment, nextDue: t0 + LOAN.period, missed: 0, paid: 0 },
      insurance: { active: false, until: null },
      loc: { sector: 'anchor', system: 'anc_01', facility: 'anc_01_port', docked: true },
      ship: { name: ((opts.shipName || '').trim() || '驢號').slice(0, 10), hull: 'donkey', hp: { hull: H.hull, armor: H.armor }, loadout: startLoadout('donkey'), ammo: {} },
      cargo: [], market: {},
      bounties: [], log: [], battle: null, flags: { visited: { anc_01_port: true } }, pending: null,
      missions: [], npcs: {}, boards: {}, explored: { anc_01: true }, settings: { test: false, intimacy: '詳寫', every: false }, mseq: 0,
      scene: { fac: null, bar: false, present: [] }, aiPending: [], aiRejected: [], aiApplied: [], aiSeen: [], pendingDigest: 0, navSig: 0, convId: '', storySummary: '', parley: null, convTurns: 0, turnHinted: false
    };
    Object.keys(org.rep).forEach(function (k) { save.reputation[k] += org.rep[k]; });
    addLog(save, '你在錨港接下「' + save.ship.name + '」的鑰匙。負債 20,000 信用點，口袋裡只有 3,000。');
    return save;
  }

  function addLog(save, text, kind, t) {
    save.log.push({ t: t != null ? t : save.t, x: text, k: kind || 'info' });
    save.pendingDigest = Math.min((save.pendingDigest || 0) + 1, 8);
    if (save.log.length > LOG_MAX) {
      // 舊的合併成「某日摘要」
      var old = save.log.splice(0, 40), byDay = {};
      old.forEach(function (e) { var d = dayOf(e.t); byDay[d] = (byDay[d] || 0) + 1; });
      var sum = Object.keys(byDay).map(function (d) { return { t: (d - 1) * 24, x: '（第' + d + '天的 ' + byDay[d] + ' 筆舊紀錄已收合）', k: 'sum' }; });
      save.log = sum.concat(save.log);
    }
  }
  function addRep(save, fid, d) {
    if (save.reputation[fid] == null) return;
    save.reputation[fid] = clamp(save.reputation[fid] + d, -100, 100);
  }

  // ---------- 船況、貨艙 ----------
  function cargoUsed(save) { return Econ.cargoUsed(D.econData, save); }
  function cargoCap(save) { // 船體貨艙＋貨艙擴充
    var cap = D.hulls[save.ship.hull].cargo;
    ((save.ship.loadout && save.ship.loadout.cargo) || []).forEach(function (id) { var e = id && D.equip[id]; if (e && e.stats) cap += e.stats.cap || 0; });
    return cap;
  }
  function cargoFree(save) { return cargoCap(save) - cargoUsed(save); }
  function shipMax(save) { var h = D.hulls[save.ship.hull]; return { hull: h.hull, armor: h.armor + specialSum(save, 'armor_plate') }; } // 附加裝甲板：裝甲上限 +value
  function freeEntries(save, goodId) { return save.cargo.filter(function (c) { return c.id === goodId && !c.missionId && c.qty > 0; }); }
  function heldQty(save, goodId) { return freeEntries(save, goodId).reduce(function (a, c) { return a + c.qty; }, 0); }
  function heldPaid(save, goodId) { // 平均買進價
    var q = 0, p = 0; freeEntries(save, goodId).forEach(function (c) { q += c.qty; p += c.paid * c.qty; });
    return q ? p / q : 0;
  }
  function costOf(save, goodId, n) { // 賣 n 個時的成本（照賣出順序）
    var left = n, cost = 0;
    freeEntries(save, goodId).forEach(function (c) { var t = Math.min(c.qty, left); cost += t * c.paid; left -= t; });
    return cost;
  }
  function addCargo(save, goodId, qty, paid) {
    var f = freeEntries(save, goodId)[0];
    if (f) { f.paid = Math.round((f.paid * f.qty + paid * qty) / (f.qty + qty)); f.qty += qty; }
    else save.cargo.push({ id: goodId, qty: qty, paid: paid, missionId: null });
  }

  // ---------- 聲望、經驗 ----------
  function tierOf(v) {
    var t = TIERS[0];
    TIERS.forEach(function (x) { if (v >= x.min) t = x; });
    return t;
  }
  function levelFromXp(xp) { var l = 1; for (var i = 1; i < XP_CUM.length; i++) if (xp >= XP_CUM[i]) l = i + 1; return l; }
  function skillInfo(save, sk) { // 角色頁用：等級、經驗、下一級門檻、還差多少
    var xp = save.player.xp[sk], lv = levelFromXp(xp), next = lv < XP_CUM.length ? XP_CUM[lv] : null;
    return { skill: sk, name: SKILL_NAME[sk], stat: save.player.stats[sk], level: lv, xp: xp, next: next, need: next == null ? 0 : next - xp };
  }
  function gainXp(save, sk, n) {
    n = Math.max(0, Math.round(n)); if (!n || !save.player.xp[sk] && save.player.xp[sk] !== 0) return;
    var before = levelFromXp(save.player.xp[sk]);
    save.player.xp[sk] += n;
    var after = levelFromXp(save.player.xp[sk]);
    if (after > before) {
      save.player.stats[sk] += after - before; // 升級直接加能力
      addLog(save, SKILL_NAME[sk] + '升到 ' + after + ' 級，能力提升到 ' + save.player.stats[sk] + '。');
    }
  }

  // ---------- 市場（全部交給 XYEcon） ----------
  function talk(save) { return save.player.stats.talk; }
  function status(facId, goodId) { return Econ.status(D.econData, facId, goodId); }
  function banned(facId, goodId) { return status(facId, goodId) === 'banned'; }
  function board(save, facId) { return Econ.board(D.econData, save, facId || save.loc.facility, talk(save)); }
  function quote(save, facId, goodId, side, qty) { return Econ.quote(D.econData, save, facId, goodId, side, qty, talk(save)); }
  function maxBuy(save, goodId) {
    var fid = save.loc.facility, vol = D.goods[goodId].vol, m = 0;
    while (m < 999 && (m + 1) * vol <= cargoFree(save)) {
      var q = quote(save, fid, goodId, 'buy', m + 1);
      if (!q.ok || q.total > save.money) break;
      m++;
    }
    return m;
  }
  function sellPreview(save, goodId, n) {
    var fid = save.loc.facility, have = heldQty(save, goodId); n = Math.min(n, have);
    if (n < 1) return { ok: false, n: 0 };
    var q = quote(save, fid, goodId, 'sell', n);
    if (!q.ok) return { ok: false, n: n, reason: q.reason };
    var cost = costOf(save, goodId, n), total = q.total, avg = q.avg, perk = null;
    if (sellPerk(save, fid, goodId)) { // 要用賣完之後的深度算上限，所以在複本上試賣
      var cp = JSON.parse(JSON.stringify(save)); Mis.ensure(cp);
      var r = Econ.trade(D.econData, cp, fid, goodId, -n, talk(save), cargoCap(save));
      if (r.ok) { var pr = perkSellTotal(cp, fid, goodId, n, r.total); if (pr.perk) { total = pr.total; avg = Math.round(total / n); perk = pr.perk; } }
    }
    return { ok: true, n: n, total: total, avg: avg, cost: cost, profit: total - cost, perk: perk };
  }
  function marketCheck(save, goodId) {
    var fid = save.loc.facility;
    if (!save.loc.docked || !fid) return '你還沒停靠，沒辦法交易。';
    if (Mis && Mis.frozen(save, D.facs[fid])) return Mis.FROZEN_MSG + '。';
    var st = status(fid, goodId);
    if (st === 'none') return '這裡不收也不賣這種貨。';
    if (st === 'banned') return '這裡禁止這種違禁品。';
    return null;
  }
  function buy(save, goodId, qty) {
    var err = marketCheck(save, goodId); if (err) return { ok: false, msg: err };
    qty = Math.floor(qty);
    if (!(qty >= 1)) return { ok: false, msg: '數量要至少 1。' };
    var fid = save.loc.facility, vol = D.goods[goodId].vol;
    if (qty * vol > cargoFree(save)) return { ok: false, msg: '貨艙放不下（剩 ' + cargoFree(save) + ' 格）。' };
    var q = quote(save, fid, goodId, 'buy', qty);
    if (q.total > save.money) return { ok: false, msg: '信用點不夠（要 ' + q.total.toLocaleString() + '）。' };
    var r = Econ.trade(D.econData, save, fid, goodId, qty, talk(save), cargoCap(save));
    if (!r.ok) return { ok: false, msg: r.reason + '。' };
    return { ok: true, msg: '買進 ' + D.goods[goodId].name + '×' + qty + '，花 ' + r.total.toLocaleString() + '（均價 ' + r.avg.toLocaleString() + '）。', total: r.total };
  }
  function sell(save, goodId, qty) {
    var err = marketCheck(save, goodId); if (err) return { ok: false, msg: err };
    qty = Math.floor(qty);
    var have = heldQty(save, goodId);
    if (have < 1) return { ok: false, msg: '你沒有這種貨。' };
    if (!(qty >= 1)) return { ok: false, msg: '數量要至少 1。' };
    if (qty > have) qty = have;
    var cost = costOf(save, goodId, qty);
    var r = Econ.trade(D.econData, save, save.loc.facility, goodId, -qty, talk(save), cargoCap(save));
    if (!r.ok) return { ok: false, msg: r.reason + '。' };
    var total = r.total;
    if (goodId === 'relic_shard') { // 遺物掃描儀：賣遺物碎片 ×1.10（econ.js 不動，這裡補差額）
      var bonus = specialMax(save, 'relic_scanner');
      if (bonus > 0) { var t2 = Math.floor(total * (100 + bonus) / 100); save.money += t2 - total; total = t2; }
    }
    var pkr = perkSellTotal(save, save.loc.facility, goodId, qty, total);
    if (pkr.perk) { save.money += pkr.total - total; total = pkr.total; }
    syncHidden(save);
    var profit = total - cost;
    gainXp(save, 'talk', Math.max(1, Math.floor(total / 1000))); // 賣貨的交涉經驗：每 1,000 成交額 1 點（至少 1）
    return { ok: true, msg: '賣出 ' + D.goods[goodId].name + '×' + qty + '，收 ' + total.toLocaleString() + '（' + (profit >= 0 ? '賺 ' : '虧 ') + Math.abs(Math.round(profit)).toLocaleString() + '）。' + (pkr.perk ? pkr.perk + '給了人情價。' : ''), total: total, profit: profit, perk: pkr.perk };
  }

  // ---------- NPC 福利（perk）：好感達標、而且人在這座設施才生效 ----------
  function perksAt(save, facId, type) {
    var fc = D.facs[facId], out = [];
    if (!fc || !D.npcData) return out;
    (fc.npcIds || []).forEach(function (id) {
      var n = D.npcData[id], pk = n && n.perk;
      if (!pk || pk.type !== type || !Mis.NPCS[id]) return;
      if (Mis.npcState(save, id).aff >= (pk.at != null ? pk.at : 40)) out.push({ id: id, name: Mis.NPCS[id].name, value: pk.value, perk: pk });
    });
    return out;
  }
  function perkSum(save, facId, type) { return perksAt(save, facId, type).reduce(function (a, p) { return a + p.value; }, 0); }
  function perkName(save, facId, type) { var l = perksAt(save, facId, type); return l.length ? l[0].name : null; }
  var SELL_PERK_GOODS = { fence: function (g) { return g && g.cat === 'contraband'; }, appraise: function (g) { return g && (g.id === 'relic_shard' || g.id === 'antiques'); } };
  function sellPerk(save, facId, goodId) { // 這座設施賣這種貨有沒有人情價
    var v = 0, name = null;
    ['fence', 'appraise'].forEach(function (t) {
      if (!SELL_PERK_GOODS[t](D.goods[goodId])) return;
      perksAt(save, facId, t).forEach(function (p) { v += p.value; name = name || p.name; });
    });
    return v > 0 ? { v: v, name: name } : null;
  }
  // 人情價只加賣價，而且不能高過「同站現在買回去」的價錢（Opus 工單 09 §2：不能套利）
  function perkSellTotal(save, facId, goodId, qty, total) {
    var pk = sellPerk(save, facId, goodId); if (!pk) return { total: total, perk: null };
    var t2 = Math.floor(total * (1 + pk.v)), bq = quote(save, facId, goodId, 'buy', qty);
    if (bq && bq.ok) t2 = Math.min(t2, Math.floor(bq.total * 0.98));
    return t2 > total ? { total: t2, perk: pk.name } : { total: total, perk: null };
  }

  // ---------- 修理 ----------
  var REPAIR_COST = 15;
  function dockedFac(save) { return save.loc.docked && save.loc.facility ? D.facs[save.loc.facility] : null; }
  function hasService(save, sv) { var fc = dockedFac(save); return !!fc && fc.services.indexOf(sv) >= 0; }
  function repairQuote(save) {
    var fc = dockedFac(save);
    if (!fc || fc.services.indexOf('repair') < 0) return { ok: false, msg: '這裡沒有船塢。' };
    var mx = shipMax(save), dh = mx.hull - save.ship.hp.hull, da = mx.armor - save.ship.hp.armor;
    var f = 1 - perkSum(save, fc.id, 'repair'), unit = REPAIR_COST * f;
    return { ok: true, dh: dh, da: da, costH: Math.round(dh * unit), costA: Math.round(da * unit), perk: f < 1 ? perkName(save, fc.id, 'repair') : null };
  }
  function repair(save, what) { // what: 'hull' | 'armor' | 'all'
    var q = repairQuote(save); if (!q.ok) return q;
    var dh = what === 'armor' ? 0 : q.dh, da = what === 'hull' ? 0 : q.da;
    var pts = dh + da; if (pts <= 0) return { ok: false, msg: '不需要修理。' };
    var cost = (dh ? q.costH : 0) + (da ? q.costA : 0);
    if (cost > save.money) return { ok: false, msg: '信用點不夠（要 ' + cost.toLocaleString() + '）。' };
    var h = Math.max(1, Math.ceil(pts / 10));
    save.money -= cost;
    save.ship.hp.hull += dh; save.ship.hp.armor += da;
    addLog(save, '在船塢修理 ' + pts + ' 點，花 ' + cost.toLocaleString() + '，耗時 ' + h + ' 小時。');
    advance(save, h);
    return { ok: true, msg: '修好了（' + pts + ' 點，' + cost.toLocaleString() + ' 信用點，' + h + ' 小時）。' };
  }

  // ---------- 船貸 ----------
  function loanActive(save) { return save.loan.balance > 0; }
  // 本期應繳：到期時先加 2% 利息，再取 min(分期款, 餘額)。這裡用同一條公式預估。
  function loanRequired(save) {
    var b = save.loan.balance; if (b <= 0) return 0;
    return Math.min(save.loan.installment, b + Math.round(b * save.loan.rate));
  }
  function loanShort(save) { return Math.max(0, loanRequired(save) - save.loan.paid); }
  function loanHoursLeft(save) { return loanActive(save) && save.loan.nextDue != null ? save.loan.nextDue - save.t : null; }
  function loanOverdue(save) { return loanActive(save) && save.loan.missed >= 2; }
  function addDebt(save, amt) {
    if (amt <= 0) return;
    var wasClear = save.loan.balance <= 0;
    save.loan.balance += amt;
    if (wasClear || save.loan.nextDue == null) { save.loan.nextDue = save.t + LOAN.period; save.loan.paid = 0; save.loan.missed = 0; }
  }
  function loanDue(save) { // save.t 已設為到期時刻
    var L = save.loan, interest = Math.round(L.balance * L.rate);
    L.balance += interest;
    var req = Math.min(L.installment, L.balance);
    if (L.paid >= req) {
      L.missed = 0;
      addLog(save, '船貸到期：利息 ' + interest.toLocaleString() + '，本期已準時繳清。餘額 ' + L.balance.toLocaleString() + '。', 'loan');
    } else {
      L.missed += 1; L.balance += LOAN.fee;
      addRep(save, 'league', LOAN.repMiss);
      addLog(save, '船貸到期沒繳：利息 ' + interest.toLocaleString() + '、違約金 ' + LOAN.fee + '，聯盟聲望 ' + LOAN.repMiss + '。連續逾期 ' + L.missed + ' 期，餘額 ' + L.balance.toLocaleString() + '。', 'loan');
    }
    L.paid = 0; L.nextDue += LOAN.period;
  }
  function payLoan(save, amount) {
    if (!hasService(save, 'loan')) return { ok: false, msg: '這裡沒有船貸櫃檯。' };
    var L = save.loan; if (L.balance <= 0) return { ok: false, msg: '船貸已經還清了。' };
    amount = Math.floor(amount);
    if (!(amount >= 1)) return { ok: false, msg: '金額要至少 1。' };
    amount = Math.min(amount, L.balance);
    if (amount > save.money) return { ok: false, msg: '信用點不夠（要 ' + amount.toLocaleString() + '）。' };
    save.money -= amount; L.balance -= amount; L.paid += amount;
    if (L.balance > 0 && loanShort(save) <= 0) L.missed = 0;
    if (L.balance <= 0) {
      L.balance = 0; L.nextDue = null; L.paid = 0; L.missed = 0;
      addRep(save, 'league', LOAN.repRepay);
      addLog(save, '船貸全部還清了！聯盟聲望 +' + LOAN.repRepay + '。', 'loan');
      return { ok: true, msg: '船貸還清了。', cleared: true };
    }
    addLog(save, '還了船貸 ' + amount.toLocaleString() + '，餘額 ' + L.balance.toLocaleString() + '。', 'loan');
    if (L.missed > 0 && L.paid >= loanRequired(save)) { L.missed = 0; addLog(save, '本期款項補齊，催收解除。', 'loan'); }
    return { ok: true, msg: '已還 ' + amount.toLocaleString() + '，餘額 ' + L.balance.toLocaleString() + '。' };
  }
  function payLoanPeriod(save) {
    var s = loanShort(save);
    if (save.loan.balance <= 0) return { ok: false, msg: '船貸已經還清了。' };
    if (s <= 0) return { ok: false, msg: '本期已經繳過了。' };
    return payLoan(save, s);
  }

  // ---------- 賞金 ----------
  function bountyTotal(save) { return save.bounties.reduce(function (a, b) { return a + b.amount; }, 0); }
  function canClaimBounty(save) {
    var fc = dockedFac(save);
    return !!fc && (fc.owner === 'fleet' || fc.owner === 'league') && save.bounties.length > 0;
  }
  function claimBounties(save) {
    if (!canClaimBounty(save)) return { ok: false, msg: '這裡沒有賞金可以領。' };
    var n = bountyTotal(save), cnt = save.bounties.length;
    save.money += n; save.bounties = [];
    addLog(save, '在' + dockedFac(save).name + '領取 ' + cnt + ' 筆賞金，共 ' + n.toLocaleString() + ' 信用點。');
    return { ok: true, msg: '領到賞金 ' + n.toLocaleString() + ' 信用點。', total: n };
  }

  // ---------- 保險 ----------
  function insured(save) { var i = save.insurance; return !!(i && i.active && i.until != null && save.t < i.until); }
  function insurancePremium(save) { return Math.round(D.hulls[save.ship.hull].price * INS.rate); }
  function buyInsurance(save) {
    if (!hasService(save, 'insurance')) return { ok: false, msg: '這裡沒有保險櫃檯。' };
    if (insured(save)) return { ok: false, msg: '保險還有效（到' + fmtClock(save.insurance.until) + '）。' };
    var p = insurancePremium(save);
    if (p > save.money) return { ok: false, msg: '信用點不夠（保費 ' + p.toLocaleString() + '）。' };
    save.money -= p;
    save.insurance = { active: true, until: save.t + INS.hours };
    addLog(save, '投保 7 天，保費 ' + p.toLocaleString() + '，到' + fmtClock(save.insurance.until) + '。');
    return { ok: true, msg: '已投保 7 天（' + p.toLocaleString() + '）。' };
  }

  // ---------- 星圖與跳躍 ----------
  function curSystem(save) { return D.systems[save.loc.system]; }
  function neighbors(save) {
    return curSystem(save).links.map(function (l) {
      var s = D.systems[l.to];
      return { id: l.to, dist: l.dist, flight: flightHours(save, l.dist), known: !!s, name: s ? s.name : '（尚未開放）', danger: s ? s.danger : null };
    });
  }
  function tableOfSystem(sysId) { var s = D.systems[sysId]; return s ? D.tables[s.encounter] : null; }
  var ENC_NAME = { patrol: '巡邏艦', pirate: '赤帆海盜', rust: '鏽蜂', distress: '求救訊號', derelict: '漂流殘骸', elite: '精英敵艦' };
  // ---- 精英（Sonnet-11）：名字前加「★精英」；不進交涉；擊毀後聲望照這張表（精英不套一般赤帆擊毀的聲望）----
  var ELITE_REP = { enemy_elite_flagship: { redsail: -5, fleet: 3 }, enemy_elite_warden: { relic: 3 }, enemy_elite_mother: {} };
  function isElite(id) { return !!(D.enemies[id] && D.enemies[id].elite); }
  function eliteTag(name) { return '★精英' + name; }
  function eliteNames(enc) {
    var cnt = {}; (enc.enemies || []).forEach(function (id) { cnt[id] = (cnt[id] || 0) + 1; });
    return Object.keys(cnt).map(function (id) { var d = D.enemies[id], n = d ? d.name : id; return (isElite(id) ? eliteTag(n) : n) + '×' + cnt[id]; }).join('、');
  }
  function travelPreview(save, toId) {
    var l = curSystem(save).links.filter(function (x) { return x.to === toId; })[0];
    if (!l) return null;
    var s = D.systems[toId], tb = tableOfSystem(toId), likely = [];
    if (tb) {
      var tot = tb.entries.reduce(function (a, e) { return a + e.weight; }, 0), seen = {};
      tb.entries.forEach(function (e) { seen[e.type] = (seen[e.type] || 0) + e.weight / tot; });
      likely = Object.keys(seen).map(function (k) { return { type: k, name: ENC_NAME[k] || k, p: seen[k] }; }).sort(function (a, b) { return b.p - a.p; });
    }
    var flight = flightHours(save, l.dist);
    return { to: toId, name: s ? s.name : '（尚未開放）', dist: l.dist, flight: flight, hours: flight + 1, danger: s ? s.danger : null, chance: tb ? tb.chance : 0, likely: likely, open: !!s };
  }
  function rollEncounter(save, toId) {
    var tb = tableOfSystem(toId); if (!tb) return null;
    if (rand(save) >= tb.chance) return null;
    var tot = tb.entries.reduce(function (a, e) { return a + e.weight; }, 0), r = rand(save) * tot, pick = tb.entries[0];
    for (var i = 0; i < tb.entries.length; i++) { r -= tb.entries[i].weight; if (r < 0) { pick = tb.entries[i]; break; } }
    var enc = { type: pick.type, faction: pick.faction || null };
    if (pick.fleets) { // 精英：固定編隊，依 w 加權挑一組
      var ft = pick.fleets.reduce(function (a, f) { return a + f.w; }, 0), fr = rand(save) * ft, fl = pick.fleets[0];
      for (var fi = 0; fi < pick.fleets.length; fi++) { fr -= pick.fleets[fi].w; if (fr < 0) { fl = pick.fleets[fi]; break; } }
      enc.enemies = fl.enemies.slice(); enc.elite = true;
    } else if (pick.pool) {
      var n = randInt(save, pick.count[0], pick.count[1]);
      enc.enemies = [];
      for (var k = 0; k < n; k++) enc.enemies.push(pick.pool[randInt(save, 0, pick.pool.length - 1)]);
    }
    return enc;
  }

  // ---------- 巡邏查緝 ----------
  function scanChance(save) { // 訊號干擾器：被掃到的機率減去數值，兩個不疊加，取最高
    return Math.max(0, SCAN_BASE - specialMax(save, 'scan_jam') / 100);
  }
  // 沒藏起來的數量。任務貨一律整筆藏或整筆不藏（藏一半的任務貨當成沒藏）
  function visibleQty(c) {
    if (c.missionId) return (c.hid || 0) >= c.qty ? 0 : c.qty;
    return c.qty - Math.min(c.qty, c.hid || 0);
  }
  // 回傳 {contraband, scanned, fine, paid, debt, goods}；會直接改存檔。藏在夾層裡的貨不會被掃到、不會被沒收
  function patrolCheck(save, factionId) {
    var f = D.factions[factionId], ban = f ? (f.banned || []) : [];
    var hits = save.cargo.filter(function (c) { return ban.indexOf(c.id) >= 0 && c.qty > 0 && visibleQty(c) > 0; });
    if (!hits.length) return { contraband: false, scanned: false };
    if (rand(save) >= scanChance(save)) return { contraband: true, scanned: false };
    var value = 0, names = [];
    hits.forEach(function (c) { var n = visibleQty(c); value += D.goods[c.id].base * n; names.push(D.goods[c.id].name + '×' + n); });
    var fine = Math.round(value * FINE_RATE);
    hits.forEach(function (c) { c.qty -= visibleQty(c); });
    save.cargo = save.cargo.filter(function (c) { return c.qty > 0; });
    syncHidden(save);
    var pay = Math.min(fine, save.money), debt = fine - pay;
    save.money -= pay;
    if (debt > 0) addDebt(save, debt);
    addRep(save, factionId, SEIZE_REP);
    return { contraband: true, scanned: true, fine: fine, paid: pay, debt: debt, goods: names };
  }

  // 出航：先扣時間，擲遭遇；戰鬥以外的遭遇只寫日誌，之後到站。opts.enc 可指定遭遇（測試用）
  function depart(save, toId, opts) {
    opts = opts || {};
    if (save.battle) return { ok: false, msg: '戰鬥還沒結束。' };
    if (save.parley) return { ok: false, msg: '海盜還擋在航道上，先處理交涉。' };
    var pv = travelPreview(save, toId);
    if (!pv || !pv.open) return { ok: false, msg: '那個方向還沒開放。' };
    var from = curSystem(save).name;
    save.loc.docked = false;
    save.scene = { fac: null, bar: false, present: [] };
    advance(save, pv.hours);
    var enc = opts.enc || Mis.forcedEncounter(save, toId) || (opts.noEncounter ? null : rollEncounter(save, toId));
    var res = { ok: true, to: toId, enc: enc, battle: false };
    if (enc && enc.enemies && enc.type === 'pirate') { // 海盜：先交涉。赤帆聲望夠高就直接放行
      if ((save.reputation.redsail || 0) >= 15) {
        addLog(save, '從' + from + '出航往' + pv.name + '。赤帆的船閃了閃燈，放你過去了。', 'enc');
        res.passed = true; res.notes = arrive(save, toId); return res;
      }
      save.parley = makeParley(save, enc, toId);
      addLog(save, '從' + from + '出航往' + pv.name + '，途中被赤帆海盜攔下，對方要求：' + demandText(save.parley.demand) + '。', 'enc');
      res.parley = true; return res;
    }
    if (enc && enc.enemies) {
      startBattle(save, enc, toId);
      res.battle = true;
      addLog(save, '從' + from + '出航往' + pv.name + '，途中遭遇' + (enc.elite ? '精英敵艦〔' + eliteNames(enc) + '〕，對方不談條件' : enc.type === 'mission' ? '任務目標' : ENC_NAME[enc.type]) + '。', 'enc');
      return res;
    }
    var head = '從' + from + '出航往' + pv.name + '。';
    if (enc && enc.type === 'patrol') {
      var fs = D.factions[enc.faction] ? D.factions[enc.faction].short : '', pc = patrolCheck(save, enc.faction);
      res.patrol = pc;
      if (!pc.contraband) addLog(save, head + fs + '巡邏艦攔下你，簡單查驗後放行。', 'enc');
      else if (!pc.scanned) addLog(save, head + fs + '巡邏艦掃描了一下，沒發現什麼。', 'enc');
      else addLog(save, head + fs + '巡邏艦掃出違禁品，沒收 ' + pc.goods.join('、') + '，罰款 ' + pc.fine.toLocaleString() +
        (pc.debt > 0 ? '（現金不夠，差額 ' + pc.debt.toLocaleString() + ' 加進船貸）' : '') + '，' + fs + '聲望 ' + SEIZE_REP + '。', 'enc');
    } else if (enc) {
      var txt = { distress: '收到一道微弱的求救訊號，你沒有停下來。', derelict: '航線旁漂著一具舊殘骸，掃描後沒有可回收的東西。' }[enc.type];
      addLog(save, head + txt, 'enc');
    } else addLog(save, '從' + from + '跳躍到' + pv.name + '，途中無事。');
    res.notes = arrive(save, toId);
    return res;
  }
  // ---------- 交涉（parley） ----------
  function demandText(d) {
    if (d.cargo) return '交出 ' + d.cargo.map(function (c) { return D.goods[c.id].name + '×' + c.qty; }).join('、');
    return '支付 ' + d.money.toLocaleString() + ' 信用點';
  }
  function makeParley(save, enc, toId) {
    var best = null;
    save.cargo.forEach(function (c) {
      var vis = c.missionId ? 0 : c.qty - Math.min(c.qty, c.hid || 0); // 只要看得到的、非任務貨
      if (vis < 1) return;
      var val = D.goods[c.id].base * vis;
      if (!best || val > best.val) best = { id: c.id, vis: vis, val: val };
    });
    var demand;
    if (best) demand = { cargo: [{ id: best.id, qty: Math.max(1, Math.floor(best.vis / 2)) }] };
    else if (save.money > 0) demand = { money: Math.min(Math.round(save.money), Math.max(300, Math.round(save.money * 0.2))) };
    else demand = { money: 300 };
    var rate = Math.min(0.6, 0.15 + save.player.stats.talk * 0.08 + ((save.reputation.redsail || 0) > 0 ? 0.1 : 0));
    return { enc: enc, toId: toId, demand: demand, leaveOk: rand(save) < rate, since: save.t };
  }
  function takeFree(save, goodId, n) { // 從看得到的貨裡拿走 n 個
    var left = n;
    save.cargo.forEach(function (c) {
      if (c.id !== goodId || c.missionId || left <= 0) return;
      var vis = c.qty - Math.min(c.qty, c.hid || 0), t = Math.min(vis, left);
      c.qty -= t; left -= t;
    });
    save.cargo = save.cargo.filter(function (c) { return c.qty > 0; });
    syncHidden(save);
    return n - left;
  }
  function parleyEnemyText(enc) {
    var cnt = {}; (enc.enemies || []).forEach(function (id) { cnt[id] = (cnt[id] || 0) + 1; });
    return Object.keys(cnt).map(function (id) { return (D.enemies[id] ? D.enemies[id].name : id) + '×' + cnt[id]; }).join('、');
  }
  function resolveParley(save, result) {
    var p = save.parley; if (!p) return { ok: false, msg: '現在沒有人在跟你交涉。' };
    var to = D.systems[p.toId].name;
    if (result === 'pay') {
      if (p.demand.cargo) {
        var c0 = p.demand.cargo[0];
        if (visibleFree(save, c0.id) < c0.qty) return { ok: false, msg: '你交不出對方要的貨。' };
        takeFree(save, c0.id, c0.qty);
      } else {
        if (save.money < p.demand.money) return { ok: false, msg: '信用點不夠（要 ' + p.demand.money.toLocaleString() + '）。' };
        save.money -= p.demand.money;
      }
      addRep(save, 'redsail', 1);
      save.parley = null;
      addLog(save, '你照赤帆的要求' + demandText(p.demand).replace('交出', '交了').replace('支付', '付了') + '，他們讓開了航道。', 'enc');
      return { ok: true, msg: '付了買路錢，赤帆讓開了航道。', paid: true, said: '我' + demandText(p.demand).replace('交出', '交出了').replace('支付', '付了') + '，赤帆讓開了航道。', notes: arrive(save, p.toId) };
    }
    if (result === 'leave') {
      save.parley = null;
      if (p.leaveOk) {
        addLog(save, '你跟赤帆談了一陣，他們放你過去。', 'enc');
        return { ok: true, msg: '談判奏效，他們放你過去。', said: '談判奏效，他們放我過去。', notes: arrive(save, p.toId) };
      }
      startBattle(save, p.enc, p.toId);
      addLog(save, '談判破裂，赤帆開火了。', 'enc');
      return { ok: true, msg: '他們不買帳，開火了！', battle: true };
    }
    if (result === 'fight') {
      save.parley = null; startBattle(save, p.enc, p.toId);
      addLog(save, '你拒絕了赤帆的條件，雙方開火。', 'enc');
      return { ok: true, msg: '開火！', battle: true };
    }
    if (result === 'surrender') {
      var lost = save.cargo.filter(function (c) { return c.qty > 0; }), fine = Math.floor(save.money * 0.1);
      save.money -= fine;
      var mids = {}; lost.forEach(function (c) { if (c.missionId) mids[c.missionId] = 1; });
      save.cargo = [];
      Object.keys(mids).forEach(function (id) { var m = Mis.byId(save, id); if (m) Mis.failOne(save, m, 'failed', '貨被赤帆搶走'); });
      save.parley = null;
      addLog(save, '你向赤帆投降：貨艙被搬空，另外交了 ' + fine.toLocaleString() + ' 信用點，然後被放行。', 'enc');
      return { ok: true, msg: '投降了：貨全沒了，另外被拿走 ' + fine.toLocaleString() + ' 信用點。', said: '我投降了，貨被搬空，還被拿走 ' + fine.toLocaleString() + ' 信用點。', notes: arrive(save, p.toId) };
    }
    return { ok: false, msg: '沒有這種選擇。' };
  }
  function visibleFree(save, goodId) {
    return save.cargo.reduce(function (a, c) { return a + (c.id === goodId && !c.missionId ? c.qty - Math.min(c.qty, c.hid || 0) : 0); }, 0);
  }
  function parleyInfo(save) {
    var p = save.parley; if (!p) return null;
    var canPay = p.demand.cargo ? visibleFree(save, p.demand.cargo[0].id) >= p.demand.cargo[0].qty : save.money >= p.demand.money;
    return { foes: parleyEnemyText(p.enc), demand: demandText(p.demand), canPay: canPay, to: D.systems[p.toId].name };
  }

  // ---------- 送禮 ----------
  function giftCheck(save, npcId) {
    var n = D.npcData && D.npcData[npcId];
    if (!n || !Mis.NPCS[npcId]) return { ok: false, why: '她不在這裡' };
    if (!save.loc.docked || !save.scene || !save.scene.bar || (save.scene.present || []).indexOf(npcId) < 0) return { ok: false, why: '她不在場' };
    var st = Mis.npcState(save, npcId);
    if (st.giftDay === dayOf(save.t)) return { ok: false, why: '今天已經送過了' };
    var goods = (n.giftGoods || []).filter(function (id) { return D.goods[id] && heldQty(save, id) > 0; });
    if (!goods.length) return { ok: false, why: '貨艙沒有她喜歡的東西', want: (n.giftGoods || []).map(function (id) { return D.goods[id] ? D.goods[id].name : id; }) };
    return { ok: true, goods: goods };
  }
  function giftPay(save, npcId, goodId) { // 只負責扣貨與記日；好感由 ai.js 的 apply 加（要吃每日上限）
    var c = giftCheck(save, npcId);
    if (!c.ok) return { ok: false, msg: c.why + '。' };
    if (c.goods.indexOf(goodId) < 0) return { ok: false, msg: '她不收這個。' };
    var left = 1;
    save.cargo.forEach(function (e) { if (left > 0 && e.id === goodId && !e.missionId && e.qty > 0) { e.qty--; left--; } });
    save.cargo = save.cargo.filter(function (e) { return e.qty > 0; });
    syncHidden(save);
    Mis.npcState(save, npcId).giftDay = dayOf(save.t);
    addLog(save, '送了一份' + D.goods[goodId].name + '給' + Mis.NPCS[npcId].name + '。');
    return { ok: true, name: Mis.NPCS[npcId].name, good: D.goods[goodId].name };
  }

  // 抵達：沒有設施的系統不能停靠（docked=false，只能繼續出航）；第一次抵達標記已探索
  function arrive(save, toId) {
    var s = D.systems[toId], fc = s.facilities[0];
    Mis.ensure(save);
    save.loc = { sector: s._sector || save.loc.sector, system: toId, facility: fc ? fc.id : null, docked: !!fc };
    if (fc) { save.flags.visited = save.flags.visited || {}; save.flags.visited[fc.id] = true; }
    var first = !save.explored[toId]; save.explored[toId] = true;
    save.pending = null;
    save.scene = { fac: null, bar: false, present: [] };
    var notes = Mis.onArrive(save, toId);
    if (first) notes.unshift('第一次抵達「' + s.name + '」，已標記為探索過。');
    return notes;
  }
  function isExplored(save, sysId) { return !!(save.explored && save.explored[sysId]); }

  // ---------- 戰鬥 ----------
  function startBattle(save, enc, toId) {
    var seed = randInt(save, 1, 2147483646);
    var ambush = rand(save) < 0.15;
    var p = save.player;
    var cd = clone(D.combatData);
    cd.enemies.forEach(function (e) { if (e.elite) e.name = eliteTag(e.name); }); // 戰鬥畫面、戰報、擊毀紀錄都會帶標籤
    var st = Combat.create({
      data: cd,
      player: { name: p.name, stats: { pilot: p.stats.pilot, gunnery: p.stats.gunnery },
        ship: { hull: save.ship.hull, hp: { hull: save.ship.hp.hull, armor: save.ship.hp.armor }, loadout: save.ship.loadout, ammo: save.ship.ammo } },
      enemies: enc.enemies, seed: seed,
      opening: ambush ? { range: 'near', ambush: true } : { range: 'mid' }
    });
    delete st.player.hp;
    save.battle = { state: st, dest: toId, enc: enc, mission: enc.mission || null };
    if (ambush) st.log.push({ t: 1, k: 'start', x: '你被伏擊了，對方已經貼近。' });
    if (enc.enemies.indexOf('enemy_elite_flagship') >= 0) st.log.push({ t: 1, k: 'start', x: '血旗艦的通訊只有一句：「血旗艦不談條件。」' });
    return st;
  }
  function battleStep(save, order) {
    var b = save.battle; if (!b || b.state.over) return null;
    Combat.step(b.state, order);
    return b.state;
  }
  function claimBattle(save) {
    var b = save.battle; if (!b || !b.state.over) return null;
    var st = b.state, sm = Combat.summary(st), notes = [];
    var out = { result: st.over, summary: sm, notes: notes };
    if (st.over === 'lose') {
      var home = D.systems.anc_01, hullId = save.ship.hull;
      if (insured(save)) {
        // 有保險：不扣現金、船貸不加，拿回同型船體與起始配備；保險隨之失效
        var H = D.hulls[hullId];
        save.ship = { name: save.ship.name, hull: hullId, hp: { hull: H.hull, armor: H.armor }, loadout: startLoadout(hullId), ammo: {} };
        save.insurance = { active: false, until: null };
        notes.push('有保險：領回同型船體與起始配備，現金與船貸不受影響。');
        out.insured = true;
      } else {
        var keep = Math.floor(save.money * 0.3), H2 = D.hulls.donkey;
        save.money = keep;
        save.ship = { name: save.ship.name, hull: 'donkey', hp: { hull: H2.hull, armor: H2.armor }, loadout: startLoadout('donkey', 1), ammo: {} };
        addDebt(save, LOAN.destroyAdd);
        notes.push('逃生艙被送回錨港。現金剩 ' + keep.toLocaleString() + '，船貸 +8,000。');
        out.insured = false;
      }
      save.cargo = []; save.bounties = [];
      Mis.failAll(save, '船被擊毀');
      save.loc = { sector: 'anchor', system: 'anc_01', facility: home.facilities[0].id, docked: true };
      save.battle = null;
      addLog(save, out.insured
        ? '你的船被擊毀，逃生艙漂了一天後被送回錨港。保險理賠：領回同型船體與起始配備，貨物全失。'
        : '你的船被擊毀，逃生艙漂了一天後被送回錨港。現金剩 30%，領到一艘只有 1 門雷射的舊驢，船貸加了 8,000。', 'lose');
      advance(save, 24);
      save.scene = { fac: null, bar: false, present: [] };
      save.flags.rescuedAt = save.t;
      return out;
    }
    // 船況寫回（彈藥在 save.ship.ammo）
    save.ship.hp.hull = sm.hp.hull; save.ship.hp.armor = sm.hp.armor;
    save.ship.ammo = save.ship.ammo || {};
    Object.keys(sm.ammo).forEach(function (k) { save.ship.ammo[k] = sm.ammo[k]; });
    // 掉落
    var dropped = [];
    sm.loot.forEach(function (l) {
      var g = D.goods[l.item]; if (!g) return;
      var can = Math.min(l.qty, Math.floor(cargoFree(save) / g.vol));
      if (can > 0) addCargo(save, l.item, can, 0);
      if (can < l.qty) dropped.push(g.name + '×' + (l.qty - can));
    });
    if (dropped.length) notes.push('貨艙放不下，丟棄：' + dropped.join('、') + '。');
    // 賞金（待領）
    if (sm.bounty > 0) {
      sm.kills.forEach(function (k) {
        var def = D.enemies[k.id];
        if (def && def.bounty > 0) save.bounties.push({ enemy: def.name, amount: def.bounty, faction: def.faction, t: save.t });
      });
      notes.push('賞金 ' + sm.bounty.toLocaleString() + ' 已記下，要到艦隊或聯盟設施才能領。');
    }
    // 經驗（駕駛、射擊各自累計）與聲望
    gainXp(save, 'pilot', sm.xp.pilot);
    gainXp(save, 'gunnery', sm.xp.gunnery);
    sm.kills.forEach(function (k) {
      if (ELITE_REP[k.id]) { Object.keys(ELITE_REP[k.id]).forEach(function (f) { addRep(save, f, ELITE_REP[k.id][f]); }); return; }
      if (k.faction === 'redsail') { addRep(save, 'redsail', -3); addRep(save, 'fleet', 2); addRep(save, 'league', 1); }
    });
    addLog(save, sm.text, 'battle');
    var dest = b.dest;
    save.battle = null;
    advance(save, 1); // 善後
    if (b.mission) Mis.onBattleDone(save, b, { result: st.over, kills: sm.kills }).forEach(function (n) { notes.push(n); });
    arrive(save, dest).forEach(function (n) { notes.push(n); });
    return out;
  }

  // ---------- 船塢：裝備、改裝、換船、補飛彈（Sonnet-06，規格第 2、3 節） ----------
  var SLOT_TYPE = { gun: 'gun', missile: 'missile', shield: 'shield', engine: 'engine', jump: 'jumpdrive', cargo: 'cargo', special: 'special' };
  var SLOT_NAME = { gun: '武器', missile: '飛彈架', shield: '護盾', engine: '引擎', jump: '短躍引擎', cargo: '貨艙擴充', special: '特殊' };
  var SLOT_ORDER = ['gun', 'missile', 'shield', 'engine', 'jump', 'cargo', 'special'];
  var SINGLE = { shield: 1, engine: 1, jump: 1 };
  var SWAP_HOURS = 4, REFIT_HOURS = 1, SELL_RATE = 0.5, TRADE_RATE = 0.6;
  var TIER_ORDER = ['nemesis', 'hostile', 'neutral', 'friendly', 'ally'];
  var HEAVY_FOES = ['enemy_pirate_heavy', 'enemy_rust_hunter', 'enemy_elite_flagship', 'enemy_elite_mother', 'enemy_elite_warden'];

  function padArr(a, n) { var o = []; for (var i = 0; i < n; i++) o.push(a && a[i] ? a[i] : null); return o; }
  function slotCount(H, kind) {
    var s = H.slots;
    if (kind === 'gun') return s.gun.length;
    if (kind === 'missile') return s.missile | 0;
    if (kind === 'cargo') return s.cargoExt | 0;
    if (kind === 'special') return s.special | 0;
    return s[kind] ? 1 : 0;
  }
  function normLoadoutFor(lo, H) { // 依船體槽位補齊成固定長度（空槽是 null）；不改原物件
    lo = lo || {};
    return { gun: padArr(lo.gun, slotCount(H, 'gun')), missile: padArr(lo.missile, slotCount(H, 'missile')),
      shield: slotCount(H, 'shield') ? (lo.shield || null) : null, engine: slotCount(H, 'engine') ? (lo.engine || null) : null, jump: slotCount(H, 'jump') ? (lo.jump || null) : null,
      special: padArr(lo.special, slotCount(H, 'special')), cargo: padArr(lo.cargo, slotCount(H, 'cargo')) };
  }
  function normLoadout(save) { var lo = normLoadoutFor(save.ship.loadout, D.hulls[save.ship.hull]); save.ship.loadout = lo; return lo; }
  function loadoutView(save) { return normLoadoutFor(save.ship.loadout, D.hulls[save.ship.hull]); }
  function slotGet(lo, kind, idx) { return SINGLE[kind] ? lo[kind] : lo[kind][idx]; }
  function slotSet(lo, kind, idx, id) { if (SINGLE[kind]) lo[kind] = id; else lo[kind][idx] = id; }
  function clampHp(save) {
    var mx = shipMax(save);
    save.ship.hp.hull = Math.min(save.ship.hp.hull, mx.hull); save.ship.hp.armor = Math.min(save.ship.hp.armor, mx.armor);
  }
  function specialVals(save, effect) {
    return ((save.ship.loadout && save.ship.loadout.special) || []).map(function (id) {
      var e = id && D.equip[id]; return e && e.stats && e.stats.effect === effect ? (e.stats.value || 0) : 0;
    });
  }
  function specialMax(save, effect) { return Math.max.apply(null, [0].concat(specialVals(save, effect))); }
  function specialSum(save, effect) { return specialVals(save, effect).reduce(function (a, b) { return a + b; }, 0); }
  function jumpMult(save) {
    var j = save.ship.loadout && save.ship.loadout.jump, e = j && D.equip[j];
    return e && e.stats && e.stats.timeMult != null ? e.stats.timeMult : 1;
  }
  function flightHours(save, dist) { return Math.max(1, Math.round(dist * jumpMult(save))); } // 短躍引擎：航程 × timeMult，四捨五入，至少 1
  function equipValue(id) { return Math.round(D.equip[id].price * SELL_RATE); }
  function isTurretWeapon(e) { return !!e && e.type === 'gun' && e.id.indexOf('turret_') === 0; }

  // ---- 藏貨夾層 ----
  function holdCap(save) { return specialMax(save, 'hidden_hold'); } // 最多藏幾格（兩個夾層不疊加）
  function goodVol(c) { return D.goods[c.id] ? D.goods[c.id].vol : 1; }
  function hiddenGrids(save) { return save.cargo.reduce(function (a, c) { return a + Math.min(c.qty, c.hid || 0) * goodVol(c); }, 0); }
  function syncHidden(save) { // 賣掉、沒收、拆夾層之後，把標記修正到合法狀態
    save.cargo.forEach(function (c) {
      if (c.hid) c.hid = Math.min(c.hid, c.qty);
      if (c.hid && c.missionId && c.hid < c.qty) c.hid = 0;
      if (!c.hid) delete c.hid;
    });
    var cap = holdCap(save);
    if (hiddenGrids(save) <= cap) return;
    if (cap <= 0) { save.cargo.forEach(function (c) { delete c.hid; }); return; }
    for (var i = save.cargo.length - 1; i >= 0 && hiddenGrids(save) > cap; i--) {
      var c = save.cargo[i]; if (!c.hid) continue;
      if (c.missionId) { delete c.hid; continue; }
      while (c.hid > 0 && hiddenGrids(save) > cap) c.hid--;
      if (!c.hid) delete c.hid;
    }
  }
  function holdInfo(save) { return { cap: holdCap(save), used: hiddenGrids(save) }; }
  // 走私任務的任務貨可以藏；其他任務的任務貨不行。任務貨只能整筆藏、整筆取消
  function canHide(save, c) {
    if (!c.missionId) return null;
    var m = Mis.byId(save, c.missionId);
    return m && m.type === 'smuggle' ? null : '這是任務貨，不能藏。';
  }
  function setHidden(save, idx, n) {
    var c = save.cargo[idx], cap = holdCap(save);
    if (!c || !(c.qty > 0)) return { ok: false, msg: '沒有這筆貨。' };
    if (cap <= 0) return { ok: false, msg: '船上沒有藏貨夾層。' };
    var why = canHide(save, c); if (why) return { ok: false, msg: why };
    n = Math.floor(n);
    if (!(n >= 0) || n > c.qty) return { ok: false, msg: '數量不對。' };
    if (c.missionId && n !== 0 && n !== c.qty) return { ok: false, msg: '任務貨只能整批一起藏。' };
    var other = hiddenGrids(save) - Math.min(c.qty, c.hid || 0) * goodVol(c);
    if (other + n * goodVol(c) > cap) return { ok: false, msg: '夾層放不下（' + cap + ' 格，已用 ' + other + ' 格）。' };
    if (n > 0) c.hid = n; else delete c.hid;
    return { ok: true, msg: n > 0 ? '藏起來 ' + D.goods[c.id].name + '×' + n + '。' : '已取消藏貨。' };
  }

  // ---- 船塢服務的前提 ----
  function yardGate(save) {
    var fc = dockedFac(save);
    if (!fc) return { ok: false, msg: '你還沒停靠，沒有船塢。' };
    if (save.battle) return { ok: false, msg: '戰鬥還沒結束。' };
    if (fc.services.indexOf('shipyard') < 0) return { ok: false, msg: '這裡沒有造船服務。' };
    if (Mis.frozen(save, fc)) return { ok: false, msg: Mis.FROZEN_MSG + '。' };
    return { ok: true, fac: fc, tier: fc.shipyardTier || 1 };
  }
  function yardTier(save) { var g = yardGate(save); return g.ok ? g.tier : 0; }

  // ---- 裝備能不能買 ----
  function lockOk(save, lock) {
    if (!lock) return true;
    return TIER_ORDER.indexOf(tierOf(save.reputation[lock.faction] || 0).key) >= TIER_ORDER.indexOf(lock.tier);
  }
  function lockText(lock) {
    var f = D.factions[lock.faction], nm = { ally: '盟友', friendly: '友善', neutral: '不敵視' }[lock.tier] || lock.tier;
    return '要' + (f ? f.short : lock.faction) + nm;
  }
  // 階級：船塢 1 級賣第 1～2 階、2 級賣第 1～3 階、3 級賣第 1～4 階；第 5 階不看船塢等級，只看聲望
  function needYardTier(e) { return e.tier >= 5 ? 0 : Math.max(1, e.tier - 1); }
  function equipPrice(save, e) { // 船塢買裝備：好感夠的 NPC 給折扣
    var fc = dockedFac(save), v = fc ? perkSum(save, fc.id, 'gear_discount') : 0;
    return v > 0 ? Math.round(e.price * (1 - v)) : e.price;
  }
  function equipBuyCheck(save, e, tier) { // 回傳 null＝買得到，字串＝原因
    if (!e || !(e.price > 0)) return '這件不賣。';
    if (tier < needYardTier(e)) return '要 ' + needYardTier(e) + ' 級以上船塢';
    if (!lockOk(save, e.lock)) return lockText(e.lock);
    return null;
  }
  function slotFit(H, kind, idx, e) {
    if (!e || e.type !== SLOT_TYPE[kind]) return '種類不合這個槽位';
    if (kind === 'gun' && H.slots.gun[idx].arc === 'front' && isTurretWeapon(e)) return '前方槽不能裝砲塔雷射';
    return null;
  }
  // 改裝畫面用：這個槽位可以選的裝備（含買不到的，附原因）
  function slotOptions(save, kind, idx) {
    var H = D.hulls[save.ship.hull], tier = yardTier(save), out = [];
    Object.keys(D.equip).forEach(function (id) {
      var e = D.equip[id]; if (e.type !== SLOT_TYPE[kind] || !(e.price > 0)) return;
      var why = slotFit(H, kind, idx, e) || equipBuyCheck(save, e, tier);
      var pp = equipPrice(save, e);
      if (!why && pp > save.money) why = '信用點不夠';
      out.push({ id: id, equip: e, price: pp, listPrice: e.price, perk: pp < e.price ? perkName(save, dockedFac(save).id, 'gear_discount') : null, reason: why });
    });
    out.sort(function (a, b) { return a.equip.tier - b.equip.tier || a.price - b.price; });
    return out;
  }
  function refitCheck(save, kind, idx) {
    var g = yardGate(save); if (!g.ok) return g;
    var H = D.hulls[save.ship.hull];
    if (!SLOT_TYPE[kind] || !(idx >= 0 && idx < slotCount(H, kind))) return { ok: false, msg: '這艘船沒有這個槽位。' };
    return { ok: true, tier: g.tier, H: H };
  }
  function installEquip(save, kind, idx, equipId) {
    var c = refitCheck(save, kind, idx); if (!c.ok) return c;
    var lo = normLoadout(save), e = D.equip[equipId];
    if (!e) return { ok: false, msg: '沒有這件裝備。' };
    var cur = slotGet(lo, kind, idx);
    if (cur) return { ok: false, msg: '這個槽位已經有「' + D.equip[cur].name + '」，要先拆下。' };
    var why = slotFit(c.H, kind, idx, e) || equipBuyCheck(save, e, c.tier);
    if (why) return { ok: false, msg: why + '。' };
    // 同一種特殊裝備只能裝一個（Opus 審查 Sonnet-06：附加裝甲板不疊加）
    if (e.type === 'special' && (lo.special || []).some(function (x) { return x && D.equip[x] && D.equip[x].stats.effect === e.stats.effect; }))
      return { ok: false, msg: '同一種特殊裝備只能裝一個。' };
    var pay = equipPrice(save, e);
    if (pay > save.money) return { ok: false, msg: '信用點不夠（要 ' + pay.toLocaleString() + '）。' };
    save.money -= pay;
    slotSet(lo, kind, idx, equipId);
    if (e.type === 'missile') { save.ship.ammo = save.ship.ammo || {}; if (save.ship.ammo[equipId] == null) save.ship.ammo[equipId] = e.stats.ammo; }
    clampHp(save);
    addLog(save, '在船塢裝上「' + e.name + '」，花 ' + pay.toLocaleString() + '，耗時 ' + REFIT_HOURS + ' 小時。');
    advance(save, REFIT_HOURS);
    return { ok: true, msg: '裝上「' + e.name + '」（' + pay.toLocaleString() + '，' + REFIT_HOURS + ' 小時）。' };
  }
  function removeEquip(save, kind, idx) {
    var c = refitCheck(save, kind, idx); if (!c.ok) return c;
    var lo = normLoadout(save), id = slotGet(lo, kind, idx);
    if (!id) return { ok: false, msg: '這個槽位是空的。' };
    var e = D.equip[id], val = equipValue(id);
    slotSet(lo, kind, idx, null); // 先試拆，貨艙放不下就還原
    if (cargoUsed(save) > cargoCap(save)) { slotSet(lo, kind, idx, id); return { ok: false, msg: '拆掉之後貨艙放不下（' + cargoUsed(save) + '／' + cargoCap(save) + ' 格），先賣掉一些貨。' }; }
    save.money += val;
    if (e.type === 'missile' && lo.missile.indexOf(id) < 0 && save.ship.ammo) delete save.ship.ammo[id];
    syncHidden(save); clampHp(save);
    addLog(save, '在船塢拆下「' + e.name + '」賣掉，收 ' + val.toLocaleString() + '，耗時 ' + REFIT_HOURS + ' 小時。');
    advance(save, REFIT_HOURS);
    return { ok: true, msg: '拆下「' + e.name + '」，賣得 ' + val.toLocaleString() + '（' + REFIT_HOURS + ' 小時）。' };
  }

  // ---- 補飛彈 ----
  function ammoStatus(save) {
    var lo = loadoutView(save), am = save.ship.ammo || {}, out = [];
    lo.missile.forEach(function (id, i) {
      if (!id) return;
      var e = D.equip[id], mx = e.stats.ammo, cur = am[id] != null ? Math.min(am[id], mx) : mx;
      out.push({ slot: i, id: id, name: e.name, cur: cur, max: mx, price: e.stats.ammoPrice, cost: (mx - cur) * e.stats.ammoPrice });
    });
    return out;
  }
  function refillAmmo(save) {
    var g = yardGate(save); if (!g.ok) return g;
    var st = ammoStatus(save); if (!st.length) return { ok: false, msg: '船上沒有飛彈架。' };
    var cost = st.reduce(function (a, x) { return a + x.cost; }, 0), n = st.reduce(function (a, x) { return a + (x.max - x.cur); }, 0);
    if (cost <= 0) return { ok: false, msg: '彈藥已經是滿的。' };
    if (cost > save.money) return { ok: false, msg: '信用點不夠（要 ' + cost.toLocaleString() + '）。' };
    save.money -= cost; save.ship.ammo = save.ship.ammo || {};
    st.forEach(function (x) { save.ship.ammo[x.id] = x.max; });
    addLog(save, '在船塢補了 ' + n + ' 發飛彈，花 ' + cost.toLocaleString() + '。');
    return { ok: true, msg: '補了 ' + n + ' 發飛彈，花 ' + cost.toLocaleString() + '。', cost: cost, n: n };
  }

  // ---- 換船 ----
  function firstFree(arr, okAt) { for (var i = 0; i < arr.length; i++) if (!arr[i] && okAt(i)) return i; return -1; }
  // 把舊船的裝備照順序放進新船：能放的移過去，放不下的賣掉。回傳 {loadout, keep:[{kind,id,slot}], sell:[{kind,id,value}]}
  function planSwap(save, newHull) {
    var old = loadoutView(save), H = newHull, out = normLoadoutFor({}, H), keep = [], sell = [];
    function moveOrSell(kind, id, i) {
      if (i >= 0) { slotSet(out, kind, i, id); keep.push({ kind: kind, id: id, slot: i }); } else sell.push({ kind: kind, id: id, value: equipValue(id) });
    }
    // 武器：先讓只能裝砲塔槽的砲塔雷射占到砲塔槽，其他的依序放進第一個空槽
    var rest = [];
    old.gun.filter(Boolean).forEach(function (id) {
      if (isTurretWeapon(D.equip[id])) moveOrSell('gun', id, firstFree(out.gun, function (j) { return H.slots.gun[j].arc === 'turret'; }));
      else rest.push(id);
    });
    rest.forEach(function (id) { moveOrSell('gun', id, firstFree(out.gun, function () { return true; })); });
    ['missile', 'cargo', 'special'].forEach(function (kind) {
      old[kind].filter(Boolean).forEach(function (id) { moveOrSell(kind, id, firstFree(out[kind], function () { return true; })); });
    });
    ['shield', 'engine', 'jump'].forEach(function (kind) {
      if (old[kind]) moveOrSell(kind, old[kind], slotCount(H, kind) ? 0 : -1);
    });
    return { loadout: out, keep: keep, sell: sell };
  }
  function hullCap(H, lo) { var cap = H.cargo; lo.cargo.forEach(function (id) { if (id) cap += D.equip[id].stats.cap || 0; }); return cap; }
  function yardHulls(save) { // 這座船塢買得到的船（依價格）
    var tier = yardTier(save), fc = dockedFac(save), fid = fc ? fc.id : null;
    return Object.keys(D.hulls).map(function (k) { return D.hulls[k]; }).filter(function (H) { return H.shipyard != null && H.shipyard <= tier && (!H.soldAt || H.soldAt.indexOf(fid) >= 0); }).sort(function (a, b) { return a.price - b.price; });
  }
  // 試算：不改存檔。ok＝現在能不能換；reason＝不能的原因；有算出金額時一律附上，畫面才能顯示
  function hullLock(save, H) { return H && H.lock && !lockOk(save, H.lock) ? lockText(H.lock) : null; } // null＝買得到
  function swapQuote(save, hullId) {
    var g = yardGate(save); if (!g.ok) return { ok: false, reason: g.msg };
    var H = D.hulls[hullId];
    if (!H || H.shipyard == null) return { ok: false, reason: '這種船不賣。' };
    if (H.shipyard > g.tier) return { ok: false, reason: '要 ' + H.shipyard + ' 級以上船塢。' };
    if (H.soldAt && H.soldAt.indexOf(g.fac.id) < 0) return { ok: false, reason: '這種船只在特定船塢賣。' };
    if (hullLock(save, H)) return { ok: false, reason: hullLock(save, H), locked: true, price: H.price };
    if (hullId === save.ship.hull) return { ok: false, reason: '你已經開著這種船了。' };
    var cur = D.hulls[save.ship.hull], mx = shipMax(save);
    var repairFee = Math.max(0, mx.hull - save.ship.hp.hull + mx.armor - save.ship.hp.armor) * REPAIR_COST;
    var base = Math.round(cur.price * TRADE_RATE), tradeIn = Math.max(0, base - repairFee);
    var plan = planSwap(save, H), equipSale = plan.sell.reduce(function (a, x) { return a + x.value; }, 0);
    var net = H.price - tradeIn - equipSale, newCap = hullCap(H, plan.loadout);
    var q = { ok: true, hull: H, price: H.price, tradeBase: base, repairFee: repairFee, tradeIn: tradeIn, keep: plan.keep, sell: plan.sell, equipSale: equipSale,
      net: net, newCap: newCap, used: cargoUsed(save), hours: SWAP_HOURS, loadout: plan.loadout };
    if (q.used > newCap) { q.ok = false; q.reason = '貨艙放不下新船（' + q.used + '／' + newCap + ' 格），先賣掉一些貨。'; }
    else if (net > save.money) { q.ok = false; q.reason = '信用點不夠（還差 ' + (net - save.money).toLocaleString() + '）。'; }
    return q;
  }
  function swapShip(save, hullId) {
    var q = swapQuote(save, hullId); if (!q.ok) return { ok: false, msg: q.reason };
    var H = q.hull, oldName = D.hulls[save.ship.hull].name, am = save.ship.ammo || {}, na = {};
    q.loadout.missile.forEach(function (id) { if (id && am[id] != null) na[id] = am[id]; });
    save.money -= q.net;
    save.ship = { name: save.ship.name, hull: hullId, hp: { hull: H.hull, armor: H.armor }, loadout: q.loadout, ammo: na };
    save.ship.hp.armor = shipMax(save).armor; // 新船滿血（含移過去的附加裝甲板）
    syncHidden(save);
    addLog(save, '在船塢把' + oldName + '換成' + H.name + '：新船 ' + q.price.toLocaleString() + '，舊船折價 ' + q.tradeIn.toLocaleString() +
      '，移過去 ' + q.keep.length + ' 件、賣掉 ' + q.sell.length + ' 件裝備（' + q.equipSale.toLocaleString() + '），實付 ' + q.net.toLocaleString() + '，耗時 ' + SWAP_HOURS + ' 小時。');
    advance(save, SWAP_HOURS);
    return { ok: true, msg: '換成「' + H.name + '」了（實付 ' + q.net.toLocaleString() + '，' + SWAP_HOURS + ' 小時）。', quote: q };
  }

  // ---- 任務危險提示 ----
  // 回傳 null 或 {level:'warn'|'bad', text}。o＝任務卡（可接任務或進行中任務）
  function missionWarn(save, o) {
    var t = o && o.tpl ? D.tpl[o.tpl] : null, en = t && t.enemies, foes = (o && o.foes) || [], possible = foes.slice(), maxN = foes.length;
    if (en) { possible = possible.concat(en.fixed || [], en.pool || []); maxN = Math.max(maxN, (en.fixed || []).length + (en.count ? en.count[1] : 0)); }
    if (!possible.some(function (f) { return HEAVY_FOES.indexOf(f) >= 0; }) && maxN < 3) return null;
    var lo = loadoutView(save), weapons = lo.gun.concat(lo.missile).filter(Boolean);
    var weak = save.ship.hull === 'donkey' && weapons.every(function (id) { return D.equip[id].tier === 1; });
    return weak ? { level: 'bad', text: '以你現在的船很難打贏' } : { level: 'warn', text: '危險：建議隼以上、第 2 階裝備' };
  }

  // ---------- 存檔 ----------
  function isLegacySave(s) { return !!s && typeof s === 'object' && s.v === 1; }
  function validateSave(s) {
    if (!s || typeof s !== 'object') return '不是有效的存檔。';
    if (s.v === 1) return '這是舊版測試存檔，請重新開始。';
    if (s.v !== SAVE_VER) return '存檔版本不符。';
    var need = ['seed', 'rng', 't', 'player', 'reputation', 'money', 'loan', 'insurance', 'loc', 'ship', 'cargo', 'market', 'log'];
    for (var i = 0; i < need.length; i++) if (s[need[i]] == null) return '存檔缺少欄位：' + need[i];
    if (!Array.isArray(s.cargo)) return '貨艙格式不對。';
    if (!s.player.xp || !s.player.stats) return '角色資料不完整。';
    if (!D.hulls[s.ship.hull]) return '存檔裡的船體不存在。';
    if (!D.systems[s.loc.system]) return '存檔裡的位置不存在。';
    var lo = s.ship.loadout || {}, bad = null;
    ['gun', 'missile', 'special', 'cargo'].forEach(function (k) { (Array.isArray(lo[k]) ? lo[k] : []).forEach(function (id) { if (id && !D.equip[id]) bad = id; }); });
    ['shield', 'engine', 'jump'].forEach(function (k) { if (lo[k] && !D.equip[lo[k]]) bad = lo[k]; });
    if (bad) return '存檔裡的裝備不存在：' + bad + '。';
    if (typeof s.money !== 'number' || !isFinite(s.money)) return '信用點不正常。';
    if (typeof s.loan.balance !== 'number' || !isFinite(s.loan.balance)) return '船貸資料不正常。';
    return null;
  }
  function exportSave(save) { return JSON.stringify(save); }
  function importSave(text) {
    var s; try { s = JSON.parse(text); } catch (e) { return { ok: false, msg: '看不懂這段文字（不是 JSON）。' }; }
    var err = validateSave(s); if (err) return { ok: false, msg: err, legacy: isLegacySave(s) };
    s.bounties = s.bounties || []; s.flags = s.flags || {}; s.battle = s.battle || null;
    Mis.ensure(s);
    s.ship.ammo = s.ship.ammo || {};
    normLoadout(s); syncHidden(s); clampHp(s);
    return { ok: true, save: s };
  }

  // ---------- 給 AI 的【航行資料】（協定 3.2；本版只產生文字） ----------
  function loanLine(save) {
    var L = save.loan;
    if (L.balance <= 0) return '已還清';
    var s = '餘額 ' + L.balance.toLocaleString() + '｜下一期 ' + loanRequired(save).toLocaleString() + '，' + fmtClock(L.nextDue) + ' 到期';
    if (L.paid > 0 && loanShort(save) <= 0) s += '（本期已繳）';
    if (L.missed > 0) s += '｜已連續逾期 ' + L.missed + ' 期';
    return s;
  }
  // 在場 NPC 的一行文字與親密狀態（協定 3.2、第 6 節）
  function presentInfo(save) {
    var out = [];
    if (!save.scene || !save.scene.bar || !save.loc.docked) return out;
    (save.scene.present || []).forEach(function (id) {
      var n = Mis.NPCS[id]; if (!n) return;
      var st = Mis.npcState(save, id), stage = Mis.STAGES[0].n;
      Mis.STAGES.forEach(function (x) { if (st.aff >= x.min) stage = x.n; });
      out.push({ id: id, name: n.name, role: n.role, stage: stage, open: st.aff >= 60 && st.step >= 2, talk: st.pending === 'talk' });
    });
    return out;
  }
  function navDataText(save, opts) {
    opts = opts || {};
    var p = save.player, h = D.hulls[save.ship.hull], mx = shipMax(save), sys = curSystem(save);
    var fac = D.facs[save.loc.facility], org = ORIGINS.filter(function (o) { return o.id === p.origin; })[0];
    var cargo = save.cargo.filter(function (c) { return c.qty > 0; }).map(function (c) { return D.goods[c.id].name + '×' + c.qty; });
    var rep = D.factionList.filter(function (f) { return f.id !== 'rust'; }).map(function (f) { return f.name + ' ' + tierOf(save.reputation[f.id] || 0).name; });
    var nRec = Math.min(8, save.pendingDigest != null ? save.pendingDigest : 8, save.log.length);
    var recent = nRec > 0 ? save.log.slice(-nRec).map(function (e) { return '・' + fmtClock(e.t) + ' ' + e.x; }) : [];
    var pr = presentInfo(save), pref = (save.settings && save.settings.intimacy) || '詳寫';
    var L = [];
    L.push('【航行資料】以下由艦橋計算，是唯一數值來源。照抄，不要自己算、不要補發。');
    L.push('時間：' + fmtClock(save.t));
    L.push('位置：' + (D.sectors[save.loc.sector] ? D.sectors[save.loc.sector].name : '') + '・' + sys.name + (fac ? '・' + fac.name : '') + (save.loc.docked ? '（已停靠）' : '（航行中）'));
    L.push('船長：' + p.name + '｜' + (p.gender || '未填') + '｜出身：' + (org ? org.name : ''));
    L.push('船：' + h.name + '級' + h.class + '「' + save.ship.name + '」｜船體 ' + save.ship.hp.hull + '/' + mx.hull + '｜裝甲 ' + save.ship.hp.armor + '/' + mx.armor);
    L.push('貨艙：' + (cargo.length ? cargo.join('、') : '空') + '（' + cargoUsed(save) + '/' + cargoCap(save) + ' 格）');
    L.push('信用點：' + Math.round(save.money).toLocaleString());
    L.push('船貸：' + loanLine(save));
    L.push('聲望：' + rep.join('｜'));
    Mis.navLines(save).forEach(function (x) { L.push(x); });
    if (save.bounties.length) L.push('待領賞金：' + bountyTotal(save).toLocaleString() + ' 信用點');
    if (save.battle && save.battle.enc && save.battle.enc.elite) L.push('遭遇：精英敵艦〔' + eliteNames(save.battle.enc) + '〕（精英），對方不談條件，直接開打');
    if (save.parley) L.push('交涉中：赤帆海盜〔' + parleyEnemyText(save.parley.enc) + '〕要求〔' + demandText(save.parley.demand) + '〕');
    if (pr.length) L.push('在場：' + pr.map(function (x) { return x.name + '（' + x.role + '）好感 ' + x.stage + '｜親密互動：' + (x.open ? '已開放' : '未開放') + (x.talk ? '｜委託待談' : ''); }).join('；'));
    if (!opts.core) {
      L.push('最近發生：');
      if (recent.length) L = L.concat(recent); else L.push('・（無）');
    }
    L.push('偏好：親密場景＝' + pref + '（玩家偏好，不是已經發生的事）｜回覆語言＝繁體中文');
    L.push('本輪約定：');
    L.push('・數字照抄航行資料；任何人（含 NPC）都不能替玩家買賣、移動、改裝；不寫船飛到別的系統');
    if (save.parley) L.push('・對方的條件是「' + demandText(save.parley.demand) + '」；玩家的選擇只能寫成 parley 事件，不要自己決定結果');
    if (!save.loc.docked) L.push('・現在在太空中，沒有酒吧與市場；只描寫艦橋、通訊與窗外');
    pr.forEach(function (x) {
      if (x.open) L.push('・' + x.name + '的親密互動已開放，須雙方合意；玩家沒有表示意願時不主動推進');
      else L.push('・' + x.name + '的親密互動尚未開放：可以曖昧、可以靠近，但對方會在越線前停下或轉移話題');
    });
    if (pref === '淡出') L.push('・親密場景寫到關燈或關門為止，用時間跳接帶過');
    if (save.flags && save.flags.rescuedAt != null && save.t - save.flags.rescuedAt <= 36) L.push('・玩家剛失去船，寫狼狽與重新開始，不寫成輕鬆度假');
    if (Mis.frozen(save, { owner: 'league' })) L.push('・聯盟帳戶已凍結（船貸連續逾期 ' + save.loan.missed + ' 期）：聯盟設施的市場與任務電腦關閉，只剩船貸與修理');
    if (loanOverdue(save)) L.push('・聯盟的催收已經開始，可以在劇情中出現催收人員，但不得寫扣款金額');
    return L.join('\n');
  }

  var API = {
    init: init, data: data, SAVE_KEY: SAVE_KEY, SAVE_VER: SAVE_VER, ORIGINS: ORIGINS, TIERS: TIERS, SKILLS: SKILLS, SKILL_NAME: SKILL_NAME, LOAN: LOAN,
    newGame: newGame, startLoadout: startLoadout, addLog: addLog, dayOf: dayOf, fmtClock: fmtClock, advance: advance,
    cargoUsed: cargoUsed, cargoCap: cargoCap, cargoFree: cargoFree, shipMax: shipMax, tierOf: tierOf,
    heldQty: heldQty, heldPaid: heldPaid, addCargo: addCargo,
    status: status, banned: banned, board: board, quote: quote, maxBuy: maxBuy, sellPreview: sellPreview, buy: buy, sell: sell,
    repairQuote: repairQuote, repair: repair, REPAIR_COST: REPAIR_COST, dockedFac: dockedFac, hasService: hasService,
    loanActive: loanActive, loanRequired: loanRequired, loanShort: loanShort, loanHoursLeft: loanHoursLeft, loanOverdue: loanOverdue,
    payLoan: payLoan, payLoanPeriod: payLoanPeriod, addDebt: addDebt,
    bountyTotal: bountyTotal, canClaimBounty: canClaimBounty, claimBounties: claimBounties,
    insured: insured, insurancePremium: insurancePremium, buyInsurance: buyInsurance,
    curSystem: curSystem, rollEncounter: rollEncounter, neighbors: neighbors, travelPreview: travelPreview, depart: depart, arrive: arrive, ENC_NAME: ENC_NAME,
    patrolCheck: patrolCheck, scanChance: scanChance,
    startBattle: startBattle, battleStep: battleStep, claimBattle: claimBattle,
    validateSave: validateSave, isLegacySave: isLegacySave, exportSave: exportSave, importSave: importSave, navDataText: navDataText, presentInfo: presentInfo,
    resolveParley: resolveParley, parleyInfo: parleyInfo, giftCheck: giftCheck, giftPay: giftPay, perksAt: perksAt, perkName: perkName, equipPrice: equipPrice, sellPerk: sellPerk,
    levelFromXp: levelFromXp, XP_CUM: XP_CUM, skillInfo: skillInfo, gainXp: gainXp, rand: rand,
    // 船塢（Sonnet-06）
    SLOT_NAME: SLOT_NAME, SLOT_ORDER: SLOT_ORDER, SWAP_HOURS: SWAP_HOURS, REFIT_HOURS: REFIT_HOURS,
    normLoadout: normLoadout, loadoutView: loadoutView, slotCount: slotCount, equipValue: equipValue, flightHours: flightHours,
    yardGate: yardGate, yardTier: yardTier, yardHulls: yardHulls, hullLock: hullLock, swapQuote: swapQuote, isElite: isElite, eliteNames: eliteNames, swapShip: swapShip,
    slotOptions: slotOptions, equipBuyCheck: equipBuyCheck, installEquip: installEquip, removeEquip: removeEquip,
    ammoStatus: ammoStatus, refillAmmo: refillAmmo,
    holdInfo: holdInfo, setHidden: setHidden, canHide: canHide, syncHidden: syncHidden, visibleQty: visibleQty, missionWarn: missionWarn
  };
  // ---------- 任務電腦（missions.js） ----------
  Mis = MisFactory({
    D: function () { return D; }, dayOf: dayOf, fmtClock: fmtClock, addLog: addLog, addRep: addRep, advance: advance, cargoFree: cargoFree, perksAt: perksAt
  });
  function missionsOpen(save) { // 任務電腦開不開：回傳 null＝開、字串＝不開的原因
    var fc = dockedFac(save);
    if (!fc) return '你還沒停靠，沒有任務電腦。';
    if (fc.services.indexOf('missions') < 0) return '這裡沒有任務電腦。';
    if (Mis.frozen(save, fc)) return Mis.FROZEN_MSG + '。';
    return null;
  }
  function ensure(save) { return Mis.ensure(save); }
  API.Mis = Mis; API.missionsOpen = missionsOpen; API.ensure = ensure; API.isExplored = isExplored;
  if (isNode) module.exports = API;
  else root.XYGame = API;
})(typeof window !== 'undefined' ? window : this);
