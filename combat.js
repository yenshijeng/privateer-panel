/* 星域私掠者 回合制戰鬥引擎 combat.js v0.3  【T08】
 * 純邏輯、不碰 DOM；瀏覽器掛 window.XYCombat，Node 用 module.exports。
 * 狀態是純 JSON（含亂數種子），可直接存進存檔、重新整理後續打。
 *
 * 幾何模型：玩家與每個敵人之間有兩個值
 *   range：0 貼身 close、1 近 near、2 中 mid、3 遠 far
 *   adv  ：角度優勢 −2～+2（正數＝玩家佔上風）
 *      +2 玩家咬住敵人尾巴（玩家看敵人＝前，敵人看玩家＝後）
 *      +1 玩家佔側位（玩家看敵人＝前，敵人看玩家＝側）
 *       0 對頭（雙方都看對方＝前）
 *      −1 敵人佔側位（玩家看敵人＝側，敵人看玩家＝前）
 *      −2 敵人咬住玩家尾巴（玩家看敵人＝後，敵人看玩家＝前）
 */
(function (root) {
  'use strict';

  var BANDS = ['close', 'near', 'mid', 'far'];
  var BAND_NAME = { close: '貼身', near: '近', mid: '中', far: '遠' };
  var FACE_NAME = { front: '前', side: '側', rear: '後' };
  var MANEUVERS = {
    approach: '逼近', open: '拉開', flank: '繞側', tail: '繞後', evade: '迴避', flee: '全速脫離'
  };
  var PERSONA = ['reckless', 'cautious', 'swarm', 'kiter'];
  var MAX_FIRERS = 2; // 每回合最多幾艘敵艦能對玩家開火

  // ---------- 亂數（mulberry32，狀態存在 state.rng） ----------
  function rnd(st) {
    var t = (st.rng = (st.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(st, a, b) { return a + Math.floor(rnd(st) * (b - a + 1)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------- 視角 ----------
  // 從「看的人」角度：玩家看敵人、敵人看玩家
  function facePlayerSees(adv) { return adv >= 0 ? 'front' : adv === -1 ? 'side' : 'rear'; }
  function faceEnemySees(adv) { return adv <= 0 ? 'front' : adv === 1 ? 'side' : 'rear'; }

  // ---------- 從資料建立單位 ----------
  function eqIndex(data) {
    if (data._eq) return data._eq;
    var m = {};
    (data.equipment || []).forEach(function (e) { m[e.id] = e; });
    var h = {};
    (data.hulls || []).forEach(function (x) { h[x.id] = x; });
    data._eq = m; data._hull = h;
    return m;
  }

  function buildUnit(data, o) {
    // o: {id,name,side,hull(id),loadout:{gun:[],missile:[],shield,engine,jump},ammo,hp,pilot,gunnery,personality,bounty,loot,faction,enemyId}
    var eq = eqIndex(data), H = data._hull[o.hull];
    if (!H) throw new Error('未知船體 ' + o.hull);
    var lo = o.loadout || {};
    var u = {
      id: o.id, name: o.name, side: o.side, hullId: o.hull, enemyId: o.enemyId || null,
      faction: o.faction || null, personality: o.personality || 'reckless',
      pilot: o.pilot || 1, gunnery: o.gunnery || o.pilot || 1,
      maxHull: H.hull, maxArmor: H.armor,
      energy: H.energy, agility: H.agility, speed: H.speed, jumpCharge: H.jumpCharge,
      maxShieldF: 0, maxShieldR: 0, regen: 0,
      guns: [], missiles: [],
      bounty: o.bounty || 0, loot: o.loot || [],
      alive: true, fled: false
    };
    // 武器：依船體槽位的射界依序裝上
    var gunSlots = H.slots.gun || [];
    (lo.gun || []).forEach(function (gid, i) {
      if (!gid || !gunSlots[i]) return;
      var e = eq[gid]; if (!e) throw new Error('未知武器 ' + gid);
      var s = e.stats;
      u.guns.push({ eq: gid, name: e.name, arc: gunSlots[i].arc, dmg: s.dmg, bands: s.bands,
        acc: s.acc || 0, energy: s.energy || 1, vsShield: s.vsShield || 1, vsArmor: s.vsArmor || 1 });
    });
    (lo.missile || []).forEach(function (mid) {
      if (!mid) return;
      var e = eq[mid]; if (!e) throw new Error('未知飛彈 ' + mid);
      var s = e.stats, ammo = (o.ammo && o.ammo[mid] != null) ? o.ammo[mid] : s.ammo;
      u.missiles.push({ eq: mid, name: e.name, dmg: s.dmg, bands: s.bands, lockTurns: s.lockTurns, ammo: ammo,
        lock: 0, lockOn: null });
    });
    if (lo.shield) { var sh = eq[lo.shield].stats; u.maxShieldF = sh.front; u.maxShieldR = sh.rear; u.regen = sh.regen; }
    if (lo.engine) { var en = eq[lo.engine].stats; u.agility += en.agility || 0; u.speed += en.speed || 0; }
    if (lo.jump) { u.jumpCharge = Math.max(1, u.jumpCharge + (eq[lo.jump].stats.chargeMod || 0)); }
    // 特殊槽：附加裝甲板增加裝甲上限（其他特殊裝備不影響戰鬥）
    (lo.special || []).forEach(function (sid) {
      var e = sid && eq[sid];
      if (e && e.stats && e.stats.effect === 'armor_plate') u.maxArmor += e.stats.value || 0;
    });
    var hp = o.hp || {};
    u.hull = hp.hull != null ? hp.hull : u.maxHull;
    u.armor = hp.armor != null ? hp.armor : u.maxArmor;
    u.shieldF = hp.shieldF != null ? hp.shieldF : u.maxShieldF;
    u.shieldR = hp.shieldR != null ? hp.shieldR : u.maxShieldR;
    return u;
  }

  /**
   * 建立戰鬥
   * opt.player = { name, ship:{hull,hp,loadout,ammo}, stats:{pilot,gunnery} }
   * opt.enemies = ['enemy_pirate_light', ...]   （encounters.json 的敵艦 id）
   * opt.data = { hulls, equipment, enemies }      （ships.json＋encounters.json）
   * opt.seed  整數
   * opt.opening = { range:'mid'|'far'|..., adv:0, ambush:false }
   */
  function create(opt) {
    var data = opt.data, P = opt.player;
    eqIndex(data);
    var st = { v: 1, rng: (opt.seed >>> 0) || 1, turn: 1, over: null, escape: 0, log: [], stats: {
      shots: 0, hits: 0, dmgDealt: 0, dmgTaken: 0, kills: [], fledEnemies: [], startHull: 0 } };
    st.player = buildUnit(data, {
      id: 'P', name: P.name || '你', side: 'P', hull: P.ship.hull, loadout: P.ship.loadout,
      ammo: P.ship.ammo, hp: P.ship.hp, pilot: P.stats.pilot, gunnery: P.stats.gunnery
    });
    st.stats.startHull = st.player.hull + st.player.armor;
    var enemyDefs = {};
    (data.enemies || []).forEach(function (e) { enemyDefs[e.id] = e; });
    var op = opt.opening || {};
    var r0 = BANDS.indexOf(op.range || 'mid'); if (r0 < 0) r0 = 2;
    st.foes = opt.enemies.map(function (eid, i) {
      var d = enemyDefs[eid]; if (!d) throw new Error('未知敵艦 ' + eid);
      var lo = splitLoadout(data, d.hull, d.loadout);
      var u = buildUnit(data, { id: 'E' + (i + 1), name: d.name, side: 'E', hull: d.hull, loadout: lo,
        pilot: d.pilot, gunnery: d.pilot, personality: d.personality, bounty: d.bounty, loot: d.loot,
        faction: d.faction, enemyId: eid });
      u.range = r0;
      u.adv = op.adv != null ? clamp(op.adv, -2, 2) : 0;
      if (op.ambush && i === 0) u.adv = -1;
      return u;
    });
    st.focus = 'E1';
    // 掉落與摘要用的商品／裝備名稱（只存 id、cat、name，讓存檔保持精簡）
    st._goods = (data.goods || []).map(function (g) { return { id: g.id, cat: g.cat, name: g.name }; });
    st._names = {};
    st._goods.forEach(function (g) { st._names[g.id] = g.name; });
    (data.equipment || []).forEach(function (e) { st._names[e.id] = e.name; });
    say(st, 'start', '接戰：' + st.foes.map(function (f) { return f.name; }).join('、') +
      '，距離' + BAND_NAME[BANDS[r0]] + '。');
    return st;
  }

  // 敵艦的扁平 loadout → 依類型分槽
  function splitLoadout(data, hullId, list) {
    var eq = data._eq, lo = { gun: [], missile: [], shield: null, engine: null, jump: null };
    (list || []).forEach(function (id) {
      var e = eq[id]; if (!e) throw new Error('未知裝備 ' + id);
      if (e.type === 'gun') lo.gun.push(id);
      else if (e.type === 'missile') lo.missile.push(id);
      else if (e.type === 'shield') lo.shield = id;
      else if (e.type === 'engine') lo.engine = id;
      else if (e.type === 'jumpdrive') lo.jump = id;
    });
    return lo;
  }

  function say(st, kind, text) { st.log.push({ t: st.turn, k: kind, x: text }); }
  function liveFoes(st) { return st.foes.filter(function (f) { return f.alive && !f.fled; }); }
  function foeById(st, id) { for (var i = 0; i < st.foes.length; i++) if (st.foes[i].id === id) return st.foes[i]; return null; }

  // ---------- 給 UI 的可選項目 ----------
  function canGunFire(g, range, face) {
    if (g.bands.indexOf(BANDS[range]) < 0) return false;
    if (g.arc === 'front' && face !== 'front') return false;
    return true;
  }
  function canMissile(m, range, face) {
    return m.ammo > 0 && face === 'front' && m.bands.indexOf(BANDS[range]) >= 0;
  }

  function options(st) {
    var P = st.player;
    return {
      turn: st.turn, energy: P.energy, over: st.over,
      maneuvers: Object.keys(MANEUVERS).map(function (k) { return { id: k, name: MANEUVERS[k], needTarget: k === 'flank' || k === 'tail' }; }),
      targets: liveFoes(st).map(function (f) {
        var face = facePlayerSees(f.adv);
        return {
          id: f.id, name: f.name, range: BANDS[f.range], rangeName: BAND_NAME[BANDS[f.range]], adv: f.adv,
          iSee: face, theySee: faceEnemySees(f.adv),
          hull: f.hull, maxHull: f.maxHull, armor: f.armor, maxArmor: f.maxArmor,
          shieldF: Math.round(f.shieldF), shieldR: Math.round(f.shieldR),
          guns: P.guns.map(function (g, i) { return { idx: i, ok: canGunFire(g, f.range, face) }; }),
          missiles: P.missiles.map(function (m, i) {
            return { idx: i, ok: canMissile(m, f.range, face), lock: m.lockOn === f.id ? m.lock : 0, need: m.lockTurns };
          })
        };
      }),
      guns: P.guns.map(function (g, i) { return { idx: i, name: g.name, arc: g.arc, energy: g.energy, bands: g.bands }; }),
      missiles: P.missiles.map(function (m, i) { return { idx: i, name: m.name, ammo: m.ammo, need: m.lockTurns }; }),
      escape: { charge: st.escape, need: P.jumpCharge, minRange: BANDS[Math.min.apply(null, liveFoes(st).map(function (f) { return f.range; }).concat([3]))] },
      me: { hull: P.hull, maxHull: P.maxHull, armor: P.armor, maxArmor: P.maxArmor,
        shieldF: Math.round(P.shieldF), shieldR: Math.round(P.shieldR), maxShieldF: P.maxShieldF, maxShieldR: P.maxShieldR }
    };
  }

  // ---------- 對抗擲骰 ----------
  function moveScore(st, u, alloc, bonus) {
    return u.pilot * 10 + u.agility * 3 + (alloc ? alloc.e : 0) * 6 + (bonus || 0) + rint(st, 0, 40);
  }

  function normAlloc(u, a) {
    a = a || {};
    var w = Math.max(0, a.w | 0), s = Math.max(0, a.s | 0), e = Math.max(0, a.e | 0);
    var sum = w + s + e;
    if (sum === 0) { w = Math.ceil(u.energy / 3); s = Math.floor(u.energy / 3); e = u.energy - w - s; }
    else if (sum !== u.energy) {
      // 等比例縮放到總能量
      var k = u.energy / sum; w = Math.floor(w * k); s = Math.floor(s * k); e = u.energy - w - s;
    }
    return { w: w, s: s, e: e };
  }

  // ---------- 敵人 AI ----------
  function aiOrder(st, f) {
    var P = st.player, hp = (f.hull + f.armor) / (f.maxHull + f.maxArmor);
    var shieldLow = (f.shieldF + f.shieldR) < 0.3 * (f.maxShieldF + f.maxShieldR + 1);
    var m = 'approach', alloc;
    var E = f.energy;
    switch (f.personality) {
      case 'cautious':
        if (hp < 0.3) m = 'flee';
        else if (f.range < 2) m = 'open';
        else if (f.range > 2) m = 'approach';
        else if (shieldLow) m = 'evade';
        else m = f.adv < 1 ? 'flank' : 'evade';
        alloc = { w: Math.floor(E / 3), s: Math.ceil(E / 3), e: E - Math.floor(E / 3) - Math.ceil(E / 3) };
        break;
      case 'kiter':
        if (hp < 0.25) m = 'flee';
        else if (f.range <= 1) m = 'open';
        else if (f.range === 3) m = 'approach';
        else m = f.adv < 0 ? 'evade' : 'flank';
        alloc = { w: Math.ceil(E / 3), s: Math.floor(E / 3), e: E - Math.ceil(E / 3) - Math.floor(E / 3) };
        break;
      case 'swarm':
        if (f.range > 1) m = 'approach';
        else m = f.adv > -2 ? 'flank' : 'approach';
        alloc = { w: Math.ceil(E / 2), s: Math.floor(E / 4), e: E - Math.ceil(E / 2) - Math.floor(E / 4) };
        break;
      default: // reckless
        if (hp < 0.15) m = 'flee';
        else if (f.range > 1) m = 'approach';
        else m = f.adv > -2 ? 'tail' : 'approach';
        alloc = { w: Math.ceil(E / 2), s: Math.floor(E / 4), e: E - Math.ceil(E / 2) - Math.floor(E / 4) };
    }
    return { m: m, alloc: normAlloc(f, alloc) };
  }

  // ---------- 一回合 ----------
  /**
   * order = { m:'approach'|..., target:'E1', alloc:{w,s,e},
   *           fire:[{gun:0,target:'E1'}], missile:[{idx:0,target:'E1'}] }
   */
  function step(st, order) {
    if (st.over) return st;
    var P = st.player, foes = liveFoes(st);
    order = order || {};
    var pm = MANEUVERS[order.m] ? order.m : 'evade';
    var pa = normAlloc(P, order.alloc);
    var focus = foeById(st, order.target) || foes[0];
    if (focus) st.focus = focus.id;
    say(st, 'turn', '第 ' + st.turn + ' 回合：你選擇' + MANEUVERS[pm] + (focus && (pm === 'flank' || pm === 'tail') ? '（' + focus.name + '）' : '') +
      '，能量 武器' + pa.w + '／護盾' + pa.s + '／引擎' + pa.e + '。');

    // 1. 敵人決策
    var orders = {};
    foes.forEach(function (f) { orders[f.id] = aiOrder(st, f); });

    // 2. 機動結算（逐一敵人）
    foes.forEach(function (f) {
      var eo = orders[f.id], em = eo.m, ea = eo.alloc;
      var pDef = pm === 'evade' ? 15 : 0, eDef = em === 'evade' ? 15 : 0;
      // 距離
      var pDr = pm === 'approach' ? -1 : (pm === 'open' || pm === 'flee') ? 1 : 0;
      var eDr = em === 'approach' ? -1 : (em === 'open' || em === 'flee') ? 1 : 0;
      if (pDr !== 0 && eDr !== 0 && pDr !== eDr) {
        var ps = moveScore(st, P, pa, P.speed * 3 + (pm === 'flee' ? 10 : 0)), es = moveScore(st, f, ea, f.speed * 3 + (em === 'flee' ? 10 : 0));
        f.range = clamp(f.range + (ps >= es ? pDr : eDr), 0, 3);
      } else if (pDr !== 0 && pDr === eDr) {
        f.range = clamp(f.range + pDr, 0, 3); // 同向：只移一格
      } else {
        f.range = clamp(f.range + pDr + eDr, 0, 3);
      }
      // 角度
      // 搶位：玩家想讓 adv 變大（只對焦點目標），敵人想讓 adv 變小
      var pDa = 0, pBonus = 0;
      if (f === focus) {
        if (pm === 'flank') pDa = 1;
        else if (pm === 'tail') { pDa = 2; pBonus = -15; }
      }
      var eDa = 0, eBonus = 0;
      if (em === 'flank') eDa = -1;
      else if (em === 'tail') { eDa = -2; eBonus = -15; }
      var cls = f.range === 0 ? 10 : 0; // 貼身時搶位比較容易
      var d = 0;
      if (pDa > 0 && eDa < 0) {
        d = moveScore(st, P, pa, pBonus + cls) >= moveScore(st, f, ea, eBonus + cls) ? pDa : eDa;
      } else if (pDa > 0) {
        if (moveScore(st, P, pa, pBonus + cls) >= moveScore(st, f, ea, eDef)) d = pDa;
      } else if (eDa < 0) {
        if (moveScore(st, f, ea, eBonus + cls) >= moveScore(st, P, pa, pDef)) d = eDa;
      }
      if (d === 0 && f.adv !== 0) d = f.adv > 0 ? -1 : 1; // 纏鬥是流動的：沒人搶位就回到對頭
      if (pm === 'flee') d -= 1; // 轉身逃跑會把船尾露出來
      if (em === 'flee') d += 1;
      f.adv = clamp(f.adv + d, -2, 2);
      f._m = em; f._a = ea;
    });

    // 3. 開火（同時結算：先算全部，再扣傷害）
    var hits = [];
    // 玩家
    var wLeft = pa.w;
    (order.fire || []).forEach(function (fo) {
      var g = P.guns[fo.gun], t = foeById(st, fo.target);
      if (!g || !t || !t.alive || t.fled) return;
      var face = facePlayerSees(t.adv);
      if (pm === 'flee' && g.arc === 'front') return;
      if (!canGunFire(g, t.range, face) || wLeft < g.energy) return;
      wLeft -= g.energy;
      hits.push(shoot(st, P, t, g, t.range, faceEnemySees(t.adv), t._m === 'evade', t._a));
    });
    // 飛彈鎖定與發射
    P.missiles.forEach(function (m, idx) {
      var mo = (order.missile || []).filter(function (x) { return x.idx === idx; })[0];
      if (!mo) { m.lock = 0; m.lockOn = null; return; }
      var t = foeById(st, mo.target);
      if (!t || !t.alive || t.fled || !canMissile(m, t.range, facePlayerSees(t.adv)) || pm === 'flee') { m.lock = 0; m.lockOn = null; return; }
      if (m.lockOn !== t.id) { m.lockOn = t.id; m.lock = 0; }
      m.lock++;
      if (m.lock >= m.lockTurns) {
        m.ammo--; m.lock = 0; m.lockOn = null;
        hits.push(missileHit(st, P, t, m, t._m === 'evade', t._a));
      } else {
        say(st, 'lock', m.name + ' 鎖定 ' + t.name + '（' + m.lock + '/' + m.lockTurns + '）');
      }
    });
    // 敵人：每回合最多 MAX_FIRERS 艘能開火（離玩家最近、角度最好的優先）
    var shooters = foes.filter(function (f) { return f.alive; }).sort(function (a, b) {
      return (a.range - b.range) || (a.adv - b.adv);
    }).slice(0, MAX_FIRERS);
    shooters.forEach(function (f) {
      var face = faceEnemySees(f.adv), w = f._a.w;
      f.guns.forEach(function (g) {
        if (f._m === 'flee' && g.arc === 'front') return;
        if (!canGunFire(g, f.range, face) || w < g.energy) return;
        w -= g.energy;
        hits.push(shoot(st, f, P, g, f.range, facePlayerSees(f.adv), pm === 'evade', pa));
      });
    });
    hits.forEach(function (h) { if (h) applyHit(st, h); });

    // 4. 護盾回充
    regen(P, pa.s);
    foes.forEach(function (f) { if (f.alive) regen(f, f._a.s); });

    // 5. 擊毀、逃離
    foes.forEach(function (f) {
      if (!f.alive) return;
      if (f.hull <= 0) {
        f.alive = false; f.hull = 0;
        st.stats.kills.push({ id: f.enemyId, name: f.name, bounty: f.bounty, faction: f.faction, loot: rollLoot(st, f) });
        say(st, 'kill', '★ 擊毀 ' + f.name + '！');
      } else if (f._m === 'flee' && f.range === 3) {
        f.fledTurns = (f.fledTurns || 0) + 1;
        if (f.fledTurns >= 2) { f.fled = true; st.stats.fledEnemies.push(f.name); say(st, 'efled', f.name + ' 跳離戰場。'); }
      } else f.fledTurns = 0;
    });
    if (P.hull <= 0) { P.hull = 0; st.over = 'lose'; say(st, 'lose', '船體崩解，逃生艙彈出……'); return st; }
    var rest = liveFoes(st);
    if (rest.length === 0) { st.over = 'win'; say(st, 'win', '戰鬥結束，你贏了。'); return st; }
    var minR = Math.min.apply(null, rest.map(function (f) { return f.range; }));
    var gain = 0;
    if (pm === 'flee') gain = minR >= 3 ? 2 : minR >= 2 ? 1 : 0;
    else if (minR >= 3) gain = 1;
    if (gain > 0) {
      st.escape += gain;
      say(st, 'charge', '短躍引擎充能 ' + Math.min(st.escape, P.jumpCharge) + '/' + P.jumpCharge);
      if (st.escape >= P.jumpCharge) { st.over = 'flee'; say(st, 'flee', '短躍成功，脫離戰場。'); return st; }
    } else if (minR === 0 && st.escape > 0) { st.escape = 0; say(st, 'charge', '敵人貼上來，充能中斷。'); }
    st.turn++;
    if (st.turn > 40) { st.over = 'flee'; say(st, 'flee', '雙方都打不下去，各自脫離。'); }
    return st;
  }

  function hitChance(att, def, acc, range, defEvade, defAlloc) {
    var rm = [12, 6, 0, -12][range];
    var c = 62 + att.gunnery * 6 + acc + rm - def.agility * 2 - (defAlloc ? defAlloc.e : 0) * 3 - (defEvade ? 20 : 0);
    return clamp(c, 5, 95);
  }

  function shoot(st, att, def, g, range, faceHit, defEvade, defAlloc) {
    var c = hitChance(att, def, g.acc, range, defEvade, defAlloc);
    if (att.side === 'P') st.stats.shots++;
    if (rnd(st) * 100 >= c) { say(st, 'miss', att.name + ' 的' + g.name + '落空。'); return null; }
    var dmg = g.dmg * (0.85 + rnd(st) * 0.3) * (g.arc === 'turret' ? 0.8 : 1);
    if (att.side === 'P') st.stats.hits++;
    return { att: att, def: def, dmg: dmg, vsS: g.vsShield, vsA: g.vsArmor, face: faceHit, wname: g.name };
  }

  function missileHit(st, att, def, m, defEvade, defAlloc) {
    var c = clamp(80 - def.agility * 2 - (defAlloc ? defAlloc.e : 0) * 3 - (defEvade ? 25 : 0), 10, 95);
    st.stats.shots++;
    if (rnd(st) * 100 >= c) { say(st, 'miss', m.name + ' 被' + def.name + '甩掉了。'); return null; }
    st.stats.hits++;
    return { att: att, def: def, dmg: m.dmg * (0.9 + rnd(st) * 0.2), vsS: 1, vsA: 1.2, face: faceEnemySees(def.adv), wname: m.name };
  }

  function applyHit(st, h) {
    var d = h.def, raw = h.dmg, key;
    if (h.face === 'front') key = 'shieldF';
    else if (h.face === 'rear') key = 'shieldR';
    else key = d.shieldF <= d.shieldR ? 'shieldF' : 'shieldR'; // 側面：打比較薄的那一面
    var sd = raw * h.vsS, absorbed = Math.min(d[key], sd);
    d[key] -= absorbed;
    raw = (sd - absorbed) / h.vsS;
    var ad = raw * h.vsA, ab = Math.min(d.armor, ad);
    d.armor -= ab;
    raw = (ad - ab) / h.vsA;
    var hullDmg = Math.round(raw);
    d.hull -= hullDmg;
    d.armor = Math.round(d.armor);
    var total = Math.round(absorbed + ab + hullDmg);
    if (h.att.side === 'P') st.stats.dmgDealt += total; else st.stats.dmgTaken += total;
    say(st, 'hit', h.att.name + ' 的' + h.wname + '命中' + d.name + '（' + FACE_NAME[h.face] + '方）' +
      (absorbed > 0.5 ? '，護盾吸收 ' + Math.round(absorbed) : '') + (ab > 0.5 ? '，裝甲 −' + Math.round(ab) : '') +
      (hullDmg > 0 ? '，船體 −' + hullDmg : '') + '。');
  }

  function regen(u, s) {
    if (u.regen <= 0) return;
    var amt = u.regen * s / 2;
    var mf = u.maxShieldF - u.shieldF, mr = u.maxShieldR - u.shieldR;
    var half = amt / 2;
    var gf = Math.min(mf, half), gr = Math.min(mr, half);
    var left = amt - gf - gr;
    gf += Math.min(mf - gf, left); left = amt - gf - gr; gr += Math.min(mr - gr, Math.max(0, left));
    u.shieldF += gf; u.shieldR += gr;
  }

  function rollLoot(st, f) {
    var out = [];
    (f.loot || []).forEach(function (l) {
      if (rnd(st) >= l.chance) return;
      var item = l.item;
      if (item.indexOf('cat:') === 0) { // 某類商品隨機挑一種
        var pool = (st._goods || []).filter(function (g) { return g.cat === item.slice(4); });
        if (!pool.length) return;
        item = pool[rint(st, 0, pool.length - 1)].id;
      }
      out.push({ item: item, qty: rint(st, l.qty[0], l.qty[1]) });
    });
    return out;
  }

  // ---------- 結算摘要（給面板入帳與送 AI） ----------
  function summary(st) {
    var P = st.player, s = st.stats;
    var bounty = s.kills.reduce(function (a, k) { return a + (k.bounty || 0); }, 0);
    var loot = [];
    s.kills.forEach(function (k) { k.loot.forEach(function (l) { loot.push(l); }); });
    var r = {
      result: st.over, turns: st.turn, kills: s.kills.map(function (k) { return { id: k.id, name: k.name, faction: k.faction }; }),
      fled: s.fledEnemies.slice(), bounty: bounty, loot: loot,
      hp: { hull: P.hull, armor: P.armor, shieldF: Math.round(P.shieldF), shieldR: Math.round(P.shieldR) },
      maxHp: { hull: P.maxHull, armor: P.maxArmor },
      ammo: P.missiles.reduce(function (a, m) { a[m.eq] = m.ammo; return a; }, {}),
      xp: { pilot: 4 + st.turn + (st.over === 'flee' ? 3 : 0), gunnery: s.hits * 2 + s.kills.length * 5 },
      accuracy: s.shots ? Math.round(100 * s.hits / s.shots) : 0
    };
    var res = { win: '勝利', flee: '脫離', lose: '船被擊毀' }[st.over] || '進行中';
    var kn = {};
    s.kills.forEach(function (k) { kn[k.name] = (kn[k.name] || 0) + 1; });
    var parts = Object.keys(kn).map(function (n) { return n + '×' + kn[n]; });
    r.text = '【戰鬥結果】' + res + '，打了 ' + st.turn + ' 回合' +
      (parts.length ? '；擊毀 ' + parts.join('、') : '') +
      (s.fledEnemies.length ? '；逃走 ' + s.fledEnemies.join('、') : '') +
      '；船體 ' + P.hull + '/' + P.maxHull + '、裝甲 ' + P.armor + '/' + P.maxArmor +
      (bounty ? '；可領賞金 ' + bounty.toLocaleString() + ' 信用點（要到發布賞金的勢力設施領取）' : '') +
      (loot.length ? '；可回收 ' + loot.map(function (l) { return (st._names[l.item] || l.item) + '×' + l.qty; }).join('、') : '') + '。';
    return r;
  }

  var API = { create: create, step: step, options: options, summary: summary, aiOrder: aiOrder,
    BANDS: BANDS, BAND_NAME: BAND_NAME, MANEUVERS: MANEUVERS, FACE_NAME: FACE_NAME,
    facePlayerSees: facePlayerSees, faceEnemySees: faceEnemySees, ver: '0.3' };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.XYCombat = API;
})(typeof window !== 'undefined' ? window : this);
