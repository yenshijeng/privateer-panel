/* 星域私掠者 任務電腦 missions.js（v0.6：來回任務報酬加倍段數）
 * 純邏輯、不碰 DOM。由 game.js 傳入內部函式後建立；瀏覽器掛 window.XYMissionsFactory，Node 用 module.exports。
 * 任務清單由 save.seed＋天數＋設施算出，不動 save.rng；快取在 save.boards。
 */
(function (root) {
  'use strict';
  function create(X) {
    var NPCS = {
      npc_ke_xuetang: { name: '柯雪棠', role: '酒吧老闆娘，前聯盟稽核員', home: 'anc_01_port' },
      npc_ge_li: { name: '葛黎', role: '船艙維修技師', home: 'anc_03_mine' },
      npc_lei_zhilan: { name: '雷芷嵐', role: '邊防艦隊中尉，巡邏隊長', home: 'bas_03_naval' },
      npc_yi_man: { name: '伊蔓', role: '黑市銷贓中間人', home: 'mis_03_sink' },
      npc_lu_shuang: { name: '陸霜', role: '退役赤帆船長，現在開酒館', home: 'mis_02_tavern' },
      npc_qiao_wei: { name: '喬薇', role: '遺物回收技師', home: 'wrk_03_outpost' }
    };
    var STAGES = [{ n: '陌生', min: 0 }, { n: '熟客', min: 20 }, { n: '信任', min: 40 }, { n: '親密', min: 60 }, { n: '伴侶', min: 80 }];
    var THR = [20, 40, 70];            // 委託鏈第 1～3 段需要的好感
    var MOODS = ['很急', '漫不經心', '壓低聲音', '一臉不耐', '神色疲憊', '笑得很客氣', '不肯多說', '頻頻看錶'];
    var MAX_ACTIVE = 4, KEEP_DONE = 12, SCOUT_H = 4, SALVAGE_H = 6;
    var NO_FAC_OK = { patrol: 1, scout: 1, salvage: 1, relic: 1 };   // 目的地可以沒有設施
    var TYPE_NAME = { cargo: '運貨', courier: '急件', escort: '護送', bounty: '賞金', patrol: '巡邏', scout: '偵察', smuggle: '走私', salvage: '回收', rescue: '救援', raid: '劫掠', relic: '遺物' };
    var RETURN_TYPES = { rescue: 1, scout: 1, salvage: 1, relic: 1 };  // 到了目的地做完事，要回發布地交付

    function D() { return X.D(); }
    function fmt(n) { return Math.round(n).toLocaleString(); }

    // ---------- 亂數：不碰 save.rng ----------
    function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
    function mk(seedStr) {
      var s = hashStr(seedStr) || 1;
      return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    function ri(rnd, a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

    // ---------- 圖搜尋 ----------
    function bfs(from) {
      var d = D(); d._bfs = d._bfs || {};
      if (d._bfs[from]) return d._bfs[from];
      var dist = {}, prev = {}; dist[from] = 0; var q = [from];
      while (q.length) {
        var c = q.shift();
        (d.systems[c].links || []).forEach(function (l) { if (d.systems[l.to] && dist[l.to] == null) { dist[l.to] = dist[c] + 1; prev[l.to] = c; q.push(l.to); } });
      }
      return (d._bfs[from] = { dist: dist, prev: prev });
    }
    function pathTo(from, to) { // 不含出發點
      var r = bfs(from), p = [], c = to;
      while (c !== from && c != null) { p.unshift(c); c = r.prev[c]; }
      return p;
    }
    function sysFac(sysId) { var s = D().systems[sysId]; return s && s.facilities.length ? s.facilities[0] : null; }
    function facName(fid) { var f = D().facs[fid]; return f ? f.name : ''; }
    function banners(faction) { var f = D().factions[faction]; return f ? (f.banned || []) : []; }

    // ---------- 帳戶凍結 ----------
    function frozen(save, fac) {
      if (!fac || fac.owner !== 'league') return false;
      return save.loan.balance > 0 && save.loan.missed >= 3;
    }
    var FROZEN_MSG = '帳戶凍結：先補齊本期船貸';

    // ---------- 狀態 ----------
    function ensure(save) {
      save.missions = save.missions || [];
      save.npcs = save.npcs || {};
      save.boards = save.boards || {};
      save.explored = save.explored || { anc_01: true };
      save.settings = save.settings || { test: false };
      if (save.settings.intimacy !== '詳寫' && save.settings.intimacy !== '淡出') save.settings.intimacy = '詳寫';
      save.settings.every = !!save.settings.every;
      if (!save.scene || typeof save.scene !== 'object') save.scene = { fac: null, bar: false, present: [] };
      save.scene.present = save.scene.present || [];
      save.aiPending = save.aiPending || []; save.aiRejected = save.aiRejected || []; save.aiApplied = save.aiApplied || []; save.aiSeen = save.aiSeen || [];
      if (save.pendingDigest == null) save.pendingDigest = 0;
      if (save.navSig == null) save.navSig = 0;
      save.convId = save.convId || ''; save.storySummary = save.storySummary || '';
      if (save.parley === undefined) save.parley = null;
      save.convTurns = save.convTurns || 0; save.turnHinted = !!save.turnHinted;
      save.flags = save.flags || {};
      save.mseq = save.mseq || 0;
      return save;
    }
    function actives(save) { return (save.missions || []).filter(function (m) { return m.status === 'active'; }); }
    function byId(save, id) { return (save.missions || []).filter(function (m) { return m.id === id; })[0] || null; }
    function npcState(save, id) { ensure(save); return save.npcs[id] || (save.npcs[id] = { aff: 0, step: 0, pending: null }); }
    function stageOf(aff) { var s = STAGES[0]; STAGES.forEach(function (x) { if (aff >= x.min) s = x; }); return s; }
    function trimDone(save) {
      var fin = save.missions.filter(function (m) { return m.status !== 'active'; });
      if (fin.length > KEEP_DONE) {
        var drop = fin.slice(0, fin.length - KEEP_DONE);
        save.missions = save.missions.filter(function (m) { return drop.indexOf(m) < 0; });
      }
    }

    // ---------- 產生 ----------
    function giverOf(tpl, fac) { // 這座設施能不能以哪個勢力的名義發這個模板
      if (!tpl.givers.length) return null;
      if (fac.owner) return tpl.givers.indexOf(fac.owner) >= 0 ? fac.owner : null;
      for (var i = 0; i < tpl.givers.length; i++) if (tpl.givers[i] === 'redsail' || tpl.givers[i] === 'relic') return tpl.givers[i];
      return null;
    }
    function eligible(save, fac, tpl) {
      if (!(tpl.weight > 0)) return null;
      var g = giverOf(tpl, fac); if (!g) return null;
      var need = (tpl.minRep || {})[g]; if (need != null && (save.reputation[g] || 0) < need) return null;
      if ((tpl.requires || []).indexOf('loanPaid') >= 0 && save.loan.balance > 0) return null;
      return g;
    }
    function pickWeighted(rnd, list) {
      var tot = list.reduce(function (a, x) { return a + x.w; }, 0), r = rnd() * tot;
      for (var i = 0; i < list.length; i++) { r -= list[i].w; if (r < 0) return list[i]; }
      return list[list.length - 1];
    }
    function candidates(tpl, origin, goodId) {
      var d = D(), r = bfs(origin), out = [];
      d.systemList.forEach(function (s) {
        var h = r.dist[s.id]; if (!h || h < tpl.jumps[0] || h > tpl.jumps[1]) return;
        if (s.danger < tpl.danger[0] || s.danger > tpl.danger[1]) return;
        if (tpl.destSector && s._sector !== tpl.destSector) return;
        if (tpl.destSystem && s.id !== tpl.destSystem) return;
        if (!s.facilities.length && !NO_FAC_OK[tpl.type]) return;
        out.push(s.id);
      });
      return out;
    }
    // 走私：優先挑「路上有系統的勢力禁止這種貨」的目的地；目的地本身要能收（無主、赤帆或黑市）
    function smuggleOk(sysId) {
      var s = D().systems[sysId], f = s.facilities[0];
      return !!f && (f.owner === null || f.owner === 'redsail' || f.type === 'blackmarket');
    }
    // 路徑上（不含出發點、含目的地）會查這種貨的系統：系統 owner 的勢力禁止它，或該系統的遭遇表有禁止它的勢力的巡邏艦
    // （照審查只看 owner 的話，現在的地圖上沒有任何合法目的地合格，所以多算了遭遇表；見交件說明）
    function checkingSystem(origin, dest, goodId) {
      var p = pathTo(origin, dest), out = [], d = D();
      p.forEach(function (sid) {
        var sys = d.systems[sid], hit = !!(sys.owner && banners(sys.owner).indexOf(goodId) >= 0), tb = d.tables[sys.encounter];
        if (!hit && tb) hit = tb.entries.some(function (e) { return e.type === 'patrol' && banners(e.faction).indexOf(goodId) >= 0; });
        if (hit) out.push(sid);
      });
      return out;
    }
    // 回傳 offer（尚未接受的任務）；rnd 是該設施當天的亂數
    function gen(save, originSys, originFac, tpl, giver, rnd, npcId) {
      var d = D(), good = null, qty = 0, pickCat = null;
      if (tpl.cargo) {
        var pk = tpl.cargo.pick;
        if (pk.indexOf('cat:') === 0) {
          var pool = d.goodsList.filter(function (g) { return g.cat === pk.slice(4) && g.cat !== 'contraband'; });
          good = pool[Math.floor(rnd() * pool.length)].id;
        } else good = pk;
        qty = ri(rnd, tpl.cargo.qty[0], tpl.cargo.qty[1]);
      }
      var cands = candidates(tpl, originSys, good);
      var qualified = null;
      if (tpl.type === 'smuggle') {
        var legal = npcId ? cands : cands.filter(smuggleOk);
        var q = legal.filter(function (c) { return checkingSystem(originSys, c, good).length > 0; });
        qualified = q.length > 0;
        cands = q.length ? q : legal;
      }
      if (!cands.length) return null;
      var dest = cands[Math.floor(rnd() * cands.length)], hops = bfs(originSys).dist[dest], ds = d.systems[dest];
      var en = tpl.enemies, foes = [], foesAt = null;
      if (en) {
        foesAt = en.at; foes = (en.fixed || []).slice();
        var n = ri(rnd, en.count[0], en.count[1]);
        for (var i = 0; i < n; i++) foes.push(en.pool[Math.floor(rnd() * en.pool.length)]);
      }
      // 要回發布地交付的任務（偵察、回收、救援、遺物）跑的是來回，跳躍段數算兩倍（Opus 審查 Sonnet-05）
      var payHops = RETURN_TYPES[tpl.type] ? hops * 2 : hops;
      var base = tpl.reward.base + tpl.reward.perJump * payHops + tpl.reward.perDanger * ds.danger;
      var reward = Math.max(100, Math.round(base * (0.9 + rnd() * 0.2) * (1 + 0.02 * save.player.stats.talk) / 10) * 10);
      var giverName = npcId ? NPCS[npcId].name : (d.factions[giver] ? d.factions[giver].name : '');
      var o = {
        tpl: tpl.id, type: tpl.type, name: tpl.name, giver: giver, giverName: giverName, npc: npcId || null, talk: !!tpl.talk,
        giverFac: originFac, dest: dest, destName: ds.name, destFac: ds.facilities.length ? ds.facilities[0].id : null,
        via: tpl.type === 'patrol' ? pathTo(originSys, dest) : null,
        good: good, qty: qty, reward: reward, rep: tpl.rep || {}, fail: tpl.fail, dl: tpl.deadline.base + tpl.deadline.perJump * hops,
        jumps: hops, danger: ds.danger, foes: foes, foesAt: foesAt, qualified: qualified
      };
      var mood = MOODS[Math.floor(rnd() * MOODS.length)];
      o.text = tpl.seed.replace(/\{giver\}/g, giverName).replace(/\{qty\}/g, qty).replace(/\{good\}/g, good ? d.goods[good].name : '')
        .replace(/\{dest\}/g, ds.name).replace(/\{target\}/g, ds.name).replace(/\{mood\}/g, mood).replace(/\{reward\}/g, fmt(reward));
      return o;
    }
    function hasElite(offers) { return offers.some(function (x) { var t = D().tpl[x.tpl]; return t && t.elite; }); }
    function boardInfo(save, facId) {
      ensure(save);
      var fac = D().facs[facId];
      if (!fac || fac.services.indexOf('missions') < 0) return { ok: false, msg: '這裡沒有任務電腦。' };
      if (frozen(save, fac)) return { ok: false, frozen: true, msg: FROZEN_MSG };
      var day = X.dayOf(save.t), b = save.boards[facId];
      if (!b || b.day !== day) {
        var rnd = mk(save.seed + '|' + day + '|' + facId), tpls = D().missionTpls || [], sysId = D().facSys[facId], offers = [], used = {};
        var want = ri(rnd, 4, 6), tries = 0;
        while (offers.length < want && tries++ < 60) {
          var pool = [];
          tpls.forEach(function (t) { var g = eligible(save, fac, t); if (g) pool.push({ t: t, g: g, w: t.weight }); });
          if (!pool.length) break;
          var pk = pickWeighted(rnd, pool);
          if (pk.t.elite && hasElite(offers)) continue; // 每張任務板每天最多 1 個精英任務
          var o = gen(save, sysId, facId, pk.t, pk.g, rnd, null);
          if (!o) continue;
          var key = o.tpl + '>' + o.dest; if (used[key]) continue; used[key] = 1;
          o.oid = day + ':' + facId + ':' + offers.length; o.taken = false; offers.push(o);
        }
        b = save.boards[facId] = { day: day, offers: offers };
      }
      // NPC 福利 intel：好感夠了，這座設施的任務板多幾個任務（可限定類型）。好感是白天才升上來的也補得上
      var slots = []; (X.perksAt ? X.perksAt(save, facId, 'intel') : []).forEach(function (p) { for (var k = 0; k < Math.max(0, Math.round(p.value)); k++) slots.push(p.perk.missionTypes || null); });
      for (var si = b.extraN || 0; si < slots.length; si++) {
        var rnd2 = mk(save.seed + '|' + day + '|' + facId + '|intel|' + si), types = slots[si], tp2 = D().missionTpls || [], got = null;
        for (var tr = 0; tr < 40 && !got; tr++) {
          var pool2 = [];
          tp2.forEach(function (t) { if (types && types.indexOf(t.type) < 0) return; if (t.elite && hasElite(b.offers)) return; var g = eligible(save, fac, t); if (g) pool2.push({ t: t, g: g, w: t.weight }); });
          if (!pool2.length) break;
          var pk2 = pickWeighted(rnd2, pool2), o2 = gen(save, D().facSys[facId], facId, pk2.t, pk2.g, rnd2, null);
          if (o2) { o2.oid = day + ':' + facId + ':' + b.offers.length; o2.taken = false; o2.perk = true; got = o2; }
        }
        if (got) b.offers.push(got);
        b.extraN = si + 1;
      }
      return { ok: true, offers: b.offers.filter(function (o) { return !o.taken; }), all: b.offers };
    }

    // ---------- 接受 ----------
    function cargoNeed(o) { return o.good ? o.qty * D().goods[o.good].vol : 0; }
    function activate(save, o) {
      save.mseq = (save.mseq || 0) + 1;
      var m = JSON.parse(JSON.stringify(o)); delete m.oid; delete m.taken; delete m.qualified;
      m.id = 'm' + save.mseq; m.status = 'active'; m.stage = 'go'; m.t0 = save.t; m.deadline = save.t + o.dl; m.fought = false; m.idx = 0;
      if (o.type === 'cargo' || o.type === 'smuggle') save.cargo.push({ id: o.good, qty: o.qty, paid: 0, missionId: m.id });
      save.missions.push(m); trimDone(save);
      X.addLog(save, '接下任務「' + o.name + '」：' + o.text, 'mission');
      return m;
    }
    function checkAccept(save, o) {
      if (!save.loc.docked) return '你還沒停靠。';
      if (actives(save).length >= MAX_ACTIVE) return '同時最多 ' + MAX_ACTIVE + ' 個進行中的任務。';
      if ((o.type === 'cargo' || o.type === 'smuggle') && cargoNeed(o) > X.cargoFree(save)) return '貨艙放不下（要 ' + cargoNeed(o) + ' 格，剩 ' + X.cargoFree(save) + ' 格）。';
      return null;
    }
    function accept(save, oid) {
      var fid = save.loc.facility, bi = fid ? boardInfo(save, fid) : { ok: false, msg: '你還沒停靠。' };
      if (!bi.ok) return { ok: false, msg: bi.msg };
      var o = bi.all.filter(function (x) { return x.oid === oid && !x.taken; })[0];
      if (!o) return { ok: false, msg: '這個任務已經被接走了。' };
      var err = checkAccept(save, o); if (err) return { ok: false, msg: err };
      o.taken = true;
      var m = activate(save, o);
      return { ok: true, msg: '接下任務「' + m.name + '」。', mission: m };
    }

    // ---------- 結案 ----------
    function removeMissionCargo(save, mid) { save.cargo = save.cargo.filter(function (c) { return c.missionId !== mid; }); }
    function gainRep(save, rep) { Object.keys(rep || {}).forEach(function (k) { X.addRep(save, k, rep[k]); }); }
    function npcAdvance(save, m) {
      if (!m.npc) return;
      var st = npcState(save, m.npc), n = NPCS[m.npc].name;
      if (m.talk) { st.pending = 'talk'; X.addLog(save, n + '的委託告一段落，回去找她談談。', 'mission'); }
      else { st.aff = Math.min(100, st.aff + 10); st.step += 1; X.addLog(save, n + '的委託完成，好感 +10。', 'mission'); }
    }
    function complete(save, m, note) {
      m.status = 'done'; m.stage = 'done';
      save.money += m.reward; gainRep(save, m.rep);
      if (m.type === 'cargo' || m.type === 'smuggle' || m.type === 'salvage' || m.type === 'relic') removeMissionCargo(save, m.id);
      X.addLog(save, '完成任務「' + m.name + '」' + (note ? '（' + note + '）' : '') + '，報酬 ' + fmt(m.reward) + ' 信用點。', 'mission');
      npcAdvance(save, m);
      return { ok: true, msg: '任務完成，報酬 ' + fmt(m.reward) + ' 信用點。', done: true };
    }
    function fail(save, m, status, why) {
      if (m.status !== 'active') return;
      m.status = status; m.stage = status;
      removeMissionCargo(save, m.id);
      var loss = Math.min(save.money, (m.fail && m.fail.money) || 0); save.money -= loss;
      gainRep(save, m.fail && m.fail.rep);
      X.addLog(save, '任務「' + m.name + '」' + (status === 'expired' ? '逾期了' : '失敗了') + (why ? '（' + why + '）' : '') + '。', 'mission');
    }
    function expire(save) {
      if (!save.missions) return;
      actives(save).forEach(function (m) { if (save.t > m.deadline) fail(save, m, 'expired'); });
    }
    function failAll(save, why) { actives(save).forEach(function (m) { fail(save, m, 'failed', why); }); }

    // ---------- 進行：出航、抵達、戰鬥 ----------
    function forcedEncounter(save, toId) {
      var list = actives(save);
      for (var i = 0; i < list.length; i++) {
        var m = list[i]; if (!m.foes || !m.foes.length || m.fought || m.stage !== 'go') continue;
        if (m.foesAt === 'route' || ((m.foesAt === 'dest' || m.foesAt === 'target') && toId === m.dest))
          return { type: 'mission', faction: null, enemies: m.foes.slice(), mission: m.id };
      }
      return null;
    }
    function hasCargo(save, m) { return save.cargo.some(function (c) { return c.missionId === m.id && c.qty > 0; }); }
    function onArrive(save, toId) {
      var out = [];
      actives(save).forEach(function (m) {
        if (m.status !== 'active') return;
        if (m.type === 'patrol') {
          if (m.via[m.idx] === toId) {
            m.idx++;
            if (m.idx >= m.via.length) out.push(complete(save, m, '巡邏完畢').msg); else X.addLog(save, '巡邏進度 ' + m.idx + '/' + m.via.length + '：已到「' + D().systems[toId].name + '」。', 'mission');
          }
        } else if ((m.type === 'cargo' || m.type === 'smuggle' || m.type === 'courier') && toId === m.dest && save.loc.docked) {
          if ((m.type !== 'courier') && !hasCargo(save, m)) { fail(save, m, 'failed', '任務貨物不見了'); out.push('任務「' + m.name + '」失敗：貨物不見了。'); }
          else out.push(complete(save, m, '送達' + m.destName).msg);
        } else if (m.type === 'escort' && toId === m.dest && m.fought) {
          out.push(complete(save, m, '護送抵達').msg);
        }
      });
      return out;
    }
    function onBattleDone(save, battle, sm) { // battle.mission = 任務 id；sm = 戰鬥 summary（非船毀）
      var m = battle.mission ? byId(save, battle.mission) : null, notes = [];
      if (!m || m.status !== 'active') return notes;
      if (m.foesAt === 'route') { m.fought = true; return notes; }
      var killed = {}; sm.kills.forEach(function (k) { killed[k.id] = (killed[k.id] || 0) + 1; });
      var need = m.type === 'raid' ? (D().tpl[m.tpl].enemies.fixed || []) : null;
      if (m.type === 'raid') {
        var ok = need.every(function (f) { return killed[f] > 0; });
        if (ok) { m.fought = true; notes.push(complete(save, m, '目標已擊毀').msg); } else notes.push('目標逃走了，任務還沒完成。離開再回來才能重新攔截。');
      } else if (m.type === 'bounty') {
        if (sm.kills.length >= m.foes.length) { m.fought = true; notes.push(complete(save, m, '指定目標全部擊毀').msg); } else notes.push('還有目標沒擊毀，任務還沒完成。離開再回來才能重新交戰。');
      } else if (sm.result === 'win') {
        m.fought = true;
        if (m.type === 'rescue') { m.stage = 'return'; notes.push('救援成功，回「' + facName(m.giverFac) + '」交付。'); }
        else notes.push('敵人清掉了，可以在任務頁' + (m.type === 'relic' || m.type === 'salvage' ? '開始回收' : '繼續') + '。');
      } else notes.push('沒有打贏，任務還沒完成。離開再回來才能重新交戰。');
      return notes;
    }

    // ---------- 任務頁的動作 ----------
    function atDest(save, m) { return save.loc.system === m.dest; }
    function needFightFirst(m) { return m.foes && m.foes.length && !m.fought && (m.foesAt === 'dest' || m.foesAt === 'target'); }
    function scout(save, mid) {
      var m = byId(save, mid); if (!m || m.status !== 'active' || m.type !== 'scout' || m.stage !== 'go') return { ok: false, msg: '現在不能偵察。' };
      if (!atDest(save, m)) return { ok: false, msg: '要先抵達「' + m.destName + '」。' };
      X.addLog(save, '在' + m.destName + '停留偵察 ' + SCOUT_H + ' 小時。', 'mission');
      X.advance(save, SCOUT_H);
      if (m.status !== 'active') return { ok: false, msg: '偵察到一半，期限過了。' };
      m.stage = 'return'; return { ok: true, msg: '偵察完成，回「' + facName(m.giverFac) + '」交付。' };
    }
    function collect(save, mid) {
      var m = byId(save, mid); if (!m || m.status !== 'active' || (m.type !== 'salvage' && m.type !== 'relic') || m.stage !== 'go') return { ok: false, msg: '現在不能回收。' };
      if (!atDest(save, m)) return { ok: false, msg: '要先抵達「' + m.destName + '」。' };
      if (needFightFirst(m)) return { ok: false, msg: '附近還有敵人，要先清掉。' };
      if (m.good && cargoNeed(m) > X.cargoFree(save)) return { ok: false, msg: '貨艙放不下（要 ' + cargoNeed(m) + ' 格，剩 ' + X.cargoFree(save) + ' 格），先清出空間。' };
      X.addLog(save, '在' + m.destName + '回收 ' + SALVAGE_H + ' 小時。', 'mission');
      X.advance(save, SALVAGE_H);
      if (m.status !== 'active') return { ok: false, msg: '回收到一半，期限過了。' };
      if (m.good) save.cargo.push({ id: m.good, qty: m.qty, paid: 0, missionId: m.id });
      m.stage = 'return'; return { ok: true, msg: '回收完成，回「' + facName(m.giverFac) + '」交付。' };
    }
    function deliver(save, mid) {
      var m = byId(save, mid); if (!m || m.status !== 'active' || m.stage !== 'return') return { ok: false, msg: '現在不能交付。' };
      if (!save.loc.docked || save.loc.facility !== m.giverFac) return { ok: false, msg: '要回「' + facName(m.giverFac) + '」才能交付。' };
      if ((m.type === 'salvage' || m.type === 'relic') && m.good && !hasCargo(save, m)) { fail(save, m, 'failed', '任務貨物不見了'); return { ok: false, msg: '任務貨物不見了，任務失敗。' }; }
      return complete(save, m, '交付');
    }
    function abandon(save, mid) {
      var m = byId(save, mid); if (!m || m.status !== 'active') return { ok: false, msg: '找不到這個任務。' };
      fail(save, m, 'failed', '放棄'); return { ok: true, msg: '放棄了任務。' };
    }
    // 該任務現在能做的動作（給畫面）
    function actionsOf(save, m) {
      var a = [];
      if (m.status !== 'active') return a;
      if (m.type === 'scout' && m.stage === 'go' && atDest(save, m)) a.push({ id: 'scout', label: '停留偵察（' + SCOUT_H + ' 小時）' });
      if ((m.type === 'salvage' || m.type === 'relic') && m.stage === 'go' && atDest(save, m) && !needFightFirst(m)) a.push({ id: 'collect', label: '開始回收（' + SALVAGE_H + ' 小時）' });
      if (m.stage === 'return' && save.loc.docked && save.loc.facility === m.giverFac) a.push({ id: 'deliver', label: '交付' });
      return a;
    }
    function act(save, mid, id) { return ({ scout: scout, collect: collect, deliver: deliver, abandon: abandon })[id](save, mid); }

    // ---------- 說明文字 ----------
    function routeText(m) { return (m.via || []).map(function (s) { return D().systems[s].name; }).join(' → '); }
    function stateNote(save, m) {
      if (m.status !== 'active') return { done: '已完成', failed: '已失敗', expired: '已逾期' }[m.status];
      if (m.type === 'patrol') return '巡邏 ' + m.idx + '/' + m.via.length;
      if (m.stage === 'return') return '回「' + facName(m.giverFac) + '」交付';
      if (needFightFirst(m)) return '到「' + m.destName + '」有一場戰鬥';
      if (m.foesAt === 'route' && !m.fought) return '第一段跳躍會遇敵';
      return atDest(save, m) ? '已在目的地' : '前往「' + m.destName + '」';
    }
    function foeNames(m) {
      var c = {}; (m.foes || []).forEach(function (f) { var e = D().enemies[f]; var n = e ? e.name : f; c[n] = (c[n] || 0) + 1; });
      return Object.keys(c).map(function (n) { return n + '×' + c[n]; }).join('、');
    }
    function line(save, m) { // 協定 3.2：・運 10 單位穀物到「灰砂殖民地」，第4天 20:00 前（港務聯盟）
      var g = m.good ? D().goods[m.good].name : '', who = m.giverName ? '（' + m.giverName + '）' : '', dest = '「' + m.destName + '」';
      var by = '，' + X.fmtClock(m.deadline) + ' 前' + who, note = m.stage === 'return' ? '【已完成，回「' + facName(m.giverFac) + '」交付】' : '';
      switch (m.type) {
        case 'cargo': return '運 ' + m.qty + ' 單位' + g + '到' + dest + by;
        case 'smuggle': return '走私 ' + m.qty + ' 單位' + g + '到' + dest + by;
        case 'courier': return '送急件到' + dest + by;
        case 'escort': return '護送船隻前往' + dest + by;
        case 'bounty': return '到' + dest + '擊毀指定目標' + by;
        case 'patrol': return '依序巡邏 ' + routeText(m) + '（' + m.idx + '/' + m.via.length + '）' + by;
        case 'scout': return '前往' + dest + '偵察' + by + note;
        case 'salvage': return '到' + dest + '回收' + g + by + note;
        case 'relic': return '到' + dest + '回收遺物' + by + note;
        case 'rescue': return '到' + dest + '救援' + by + note;
        case 'raid': return '到' + dest + '劫掠目標貨船' + by;
      }
      return m.name + by;
    }
    function navLines(save) {
      var a = actives(save); if (!a.length) return ['進行中任務：無'];
      var L = ['進行中任務：']; a.slice(0, 5).forEach(function (m) { L.push('・' + line(save, m)); });
      if (a.length > 5) L.push('・（另有 ' + (a.length - 5) + ' 件）');
      return L;
    }

    // ---------- NPC 委託鏈 ----------
    function npcTpl(id, step) { return (D().missionTpls || []).filter(function (t) { return t.npc === id && new RegExp('_' + (step + 1) + '$').test(t.id); })[0] || null; }
    function npcInfo(save, id) {
      var n = NPCS[id], st = npcState(save, id), tpl = st.step < 3 ? npcTpl(id, st.step) : null, act = actives(save).filter(function (m) { return m.npc === id; })[0];
      var info = { id: id, name: n.name, role: n.role, aff: st.aff, stage: stageOf(st.aff).n, step: st.step, pending: st.pending, tpl: tpl, active: act || null, need: st.step < 3 ? THR[st.step] : null, canTake: false, reason: '' };
      if (st.step >= 3) info.reason = '委託鏈已經走完。';
      else if (st.pending === 'talk') info.reason = '回去找她談。';
      else if (act) info.reason = '委託進行中。';
      else if (st.aff < THR[st.step]) info.reason = '好感要到 ' + THR[st.step] + '（目前 ' + st.aff + '）。';
      else if (!tpl) info.reason = '還沒有對應的委託。';
      else info.canTake = true;
      return info;
    }
    function npcTake(save, id) {
      var info = npcInfo(save, id), n = NPCS[id];
      if (save.loc.facility !== n.home || !save.loc.docked) return { ok: false, msg: '要在她所在的酒吧才能接。' };
      if (!info.canTake) return { ok: false, msg: info.reason };
      var o = gen(save, D().facSys[n.home], n.home, info.tpl, null, mk(save.seed + '|npc|' + id + '|' + info.step + '|' + X.dayOf(save.t)), id);
      if (!o) return { ok: false, msg: '現在找不到合適的目的地。' };
      var err = checkAccept(save, o); if (err) return { ok: false, msg: err };
      var m = activate(save, o); return { ok: true, msg: '接下' + n.name + '的委託。', mission: m };
    }
    function npcTalkDone(save, id) {
      var st = npcState(save, id); if (st.pending !== 'talk') return { ok: false, msg: '現在沒有要談的事。' };
      st.pending = null; st.aff = Math.min(100, st.aff + 10); st.step += 1;
      X.addLog(save, '和' + NPCS[id].name + '談完了，好感 +10。', 'mission');
      return { ok: true, msg: '談完了，好感 +10。' };
    }
    function npcAdjust(save, id, d) { // 測試模式用
      if (!save.settings || !save.settings.test) return { ok: false, msg: '要先打開測試模式。' };
      var st = npcState(save, id); st.aff = Math.max(0, Math.min(100, st.aff + d)); return { ok: true, msg: NPCS[id].name + ' 好感 ' + st.aff + '。' };
    }
    function npcsAt(save, facId) { var f = D().facs[facId]; return f ? (f.npcIds || []).filter(function (i) { return NPCS[i]; }) : []; }

    // 測試用：不經過任務電腦，直接用某個模板在某設施做一張 offer／接下它
    function forge(save, tplId, facId, seedStr) {
      var t = D().tpl[tplId], giver = t.givers.length ? t.givers[0] : null;
      var o = gen(save, D().facSys[facId], facId, t, giver, mk(seedStr || 'forge'), t.npc || null);
      if (o) { o.oid = 'forge'; o.taken = false; }
      return o;
    }
    function forgeAccept(save, o) { var err = checkAccept(save, o); if (err) return { ok: false, msg: err }; return { ok: true, mission: activate(save, o) }; }

    return {
      forge: forge, forgeAccept: forgeAccept, NPCS: NPCS, STAGES: STAGES, THR: THR, MAX_ACTIVE: MAX_ACTIVE, TYPE_NAME: TYPE_NAME, FROZEN_MSG: FROZEN_MSG,
      ensure: ensure, actives: actives, byId: byId, frozen: frozen, boardInfo: boardInfo, accept: accept, checkAccept: checkAccept,
      forcedEncounter: forcedEncounter, onArrive: onArrive, onBattleDone: onBattleDone, expire: expire, failAll: failAll, failOne: fail,
      act: act, actionsOf: actionsOf, stateNote: stateNote, foeNames: foeNames, line: line, navLines: navLines, routeText: routeText,
      npcInfo: npcInfo, npcTake: npcTake, npcTalkDone: npcTalkDone, npcAdjust: npcAdjust, npcsAt: npcsAt, npcState: npcState,
      pathTo: pathTo, bfs: bfs, checkingSystem: checkingSystem, sysFac: sysFac
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else root.XYMissionsFactory = create;
})(typeof window !== 'undefined' ? window : this);
