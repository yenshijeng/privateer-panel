/* 星域私掠者 AI 溝通模組 ai.js v1.0（Opus）
 * 協定：星域私掠者/協定_v1.md 第 4 節。純邏輯、不碰 DOM。
 * 瀏覽器掛 window.XYAI（需要先載入 game.js），Node 用 require('./ai.js')(G)。
 *
 * 流程：
 *   載入器掃到 ```xingyu 區塊 → 面板呼叫 AI.process(save, blockText, replyText, ctx)
 *   → 回傳 { auto:[], confirm:[], rejected:[] }
 *   → auto 直接 AI.apply；confirm 顯示「收下／確認推進」按鈕，玩家按了才 AI.apply；rejected 在戰報頁灰字顯示
 */
(function (root) {
  'use strict';
  function factory(G) {
    var TYPES = { time: 1, affection: 1, tip: 1, item: 1, parley: 1, chain: 1, intimacy: 1, note: 1 };
    var PARLEY = { pay: 1, leave: 1, fight: 1, surrender: 1 };
    var MAX_EVENTS = 4, AFF_DAY_CAP = 10;

    // ---------- 解析 ----------
    // 容錯：去掉 ``` 圍欄、全形引號與冒號換半形、尾逗號
    function clean(t) {
      return String(t || '').replace(/^[\s\S]*?```\s*xingyu\s*/i, '').replace(/```[\s\S]*$/, '')
        .replace(/[“”＂]/g, '"').replace(/[‘’]/g, "'").replace(/：(?=\s*["\[{\d-])/g, ':').replace(/，(?=\s*")/g, ',')
        .replace(/,\s*([}\]])/g, '$1').trim();
    }
    function parse(text) {
      var t = clean(text), i = t.indexOf('{'), j = t.lastIndexOf('}');
      if (i < 0 || j < i) return { ok: false, reason: '找不到 JSON' };
      try {
        var o = JSON.parse(t.slice(i, j + 1));
        if (o.protocol !== 'xingyu/v1') return { ok: false, reason: 'protocol 不是 xingyu/v1' };
        if (!Array.isArray(o.events)) return { ok: false, reason: '沒有 events 陣列' };
        return { ok: true, events: o.events };
      } catch (e) { return { ok: false, reason: 'JSON 解析失敗' }; }
    }
    // 引用比對：去掉空白與標點、全半形統一後找子字串
    function norm(s) {
      return String(s || '').replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
        .replace(/[\s　，。、！？；：「」『』（）《》〈〉…—\-,.!?;:'"()\[\]]/g, '');
    }
    function quoteOk(evt, reply) {
      var q = norm(evt.quote);
      if (q.length < 4) return false;
      return norm(reply).indexOf(q.length > 24 ? q.slice(0, 24) : q) >= 0;
    }

    // ---------- 驗證（協定 4.3／4.4） ----------
    function D() { return G.data(); }
    function npcAff(save, id) { return G.Mis.npcState(save, id); }
    function dayGain(save, id) {
      var st = npcAff(save, id), d = G.dayOf(save.t);
      if (!st.affDay || st.affDay.day !== d) st.affDay = { day: d, gained: 0 };
      return st.affDay;
    }
    function intimacyOpen(save, id) { var st = npcAff(save, id); return st.aff >= 60 && st.step >= 2; }
    function check(save, e, ctx) {
      if (!e || typeof e !== 'object' || !TYPES[e.type]) return '不在白名單的事件類型';
      var present = ctx.present || [];
      switch (e.type) {
        case 'time':
          if (!save.loc.docked) return '在太空中不能用 time';
          if (!(e.hours >= 1 && e.hours <= 12)) return '時數要在 1～12';
          return null;
        case 'affection':
          if (present.indexOf(e.npc) < 0) return 'NPC 不在場';
          if (!(e.delta >= -5 && e.delta <= 5) || e.delta === 0) return '好感變動要在 −5～+5';
          if (e.delta > 0 && dayGain(save, e.npc).gained >= AFF_DAY_CAP) return '今天好感已經加滿';
          return null;
        case 'tip': {
          var cap = 200 + save.player.stats.talk * 100;
          if (!(e.amount >= 50 && e.amount <= cap)) return '小費要在 50～' + cap;
          return null;
        }
        case 'item': {
          var g = D().goods[e.good];
          if (!g) return '沒有這種商品';
          if (!(e.qty >= 1 && e.qty <= 3)) return '數量要在 1～3';
          var fac = G.dockedFac(save);
          if (g.cat === 'contraband' && !(fac && fac.type === 'blackmarket')) return '違禁品只能在黑市給';
          if (e.qty * g.vol > G.cargoFree(save)) return '貨艙放不下';
          return null;
        }
        case 'parley':
          if (!ctx.parley) return '現在沒有在交涉';
          if (!PARLEY[e.result]) return '交涉結果不合法';
          return null;
        case 'chain': {
          if (present.indexOf(e.npc) < 0) return 'NPC 不在場';
          var st = npcAff(save, e.npc);
          if (st.pending !== 'talk') return '這位 NPC 現在沒有要談的委託';
          return null;
        }
        case 'intimacy':
          if (present.indexOf(e.npc) < 0) return 'NPC 不在場';
          if (!intimacyOpen(save, e.npc)) return '親密互動尚未開放';
          return null;
        case 'note':
          if (!e.text || String(e.text).length > 40) return '情報要在 40 字以內';
          return null;
      }
      return '未知';
    }
    var AUTO = { time: 1, affection: 1, note: 1, intimacy: 1, parley: 1 }; // 其餘（tip、item、chain）要玩家確認

    /**
     * ctx = { present:[npc id], parley:bool, id:載入器給的區塊雜湊（去重用） }
     * 回傳 { ok, auto, confirm, rejected, reason }
     */
    function process(save, blockText, replyText, ctx) {
      ctx = ctx || {};
      if (ctx.id) { // 協定 4.4-3：同一則回覆（重新生成或重掃）只結算一次
        save.aiSeen = save.aiSeen || [];
        if (save.aiSeen.indexOf(ctx.id) >= 0) return { ok: false, dup: true, reason: '這則回覆已經處理過', auto: [], confirm: [], rejected: [] };
        save.aiSeen.push(ctx.id); if (save.aiSeen.length > 200) save.aiSeen.splice(0, save.aiSeen.length - 200);
      }
      var p = parse(blockText);
      if (!p.ok) return { ok: false, reason: p.reason, auto: [], confirm: [], rejected: [] };
      var out = { ok: true, auto: [], confirm: [], rejected: [] }, seen = {};
      p.events.slice(0, MAX_EVENTS).forEach(function (e) {
        var key = e && (e.type + ':' + (e.npc || '') + ':' + (e.id || ''));
        if (seen[key]) { out.rejected.push({ evt: e, reason: '重複的事件' }); return; }
        seen[key] = 1;
        var why = check(save, e, ctx);
        if (why) { out.rejected.push({ evt: e, reason: why }); return; }
        var qok = quoteOk(e, replyText);
        if (AUTO[e.type] && qok) out.auto.push(e);
        else if (AUTO[e.type] && !qok && e.type !== 'parley') out.confirm.push(Object.assign({ _noQuote: true }, e)); // 引用對不上：降級成玩家確認
        else if (e.type === 'parley') out.auto.push(e); // 交涉結果由面板事先算好的條件結算，不需要引用
        else out.confirm.push(e);
      });
      if (p.events.length > MAX_EVENTS) p.events.slice(MAX_EVENTS).forEach(function (e) { out.rejected.push({ evt: e, reason: '一則回覆最多 4 個事件' }); });
      return out;
    }

    // ---------- 入帳 ----------
    function npcName(id) { var n = G.Mis.NPCS[id]; return n ? n.name : id; }
    function apply(save, e) {
      switch (e.type) {
        case 'time': G.advance(save, Math.round(e.hours)); G.addLog(save, '（' + e.reason + '，過了 ' + Math.round(e.hours) + ' 小時）'); return { ok: true, msg: '時間 +' + Math.round(e.hours) + ' 小時' };
        case 'affection': {
          var st = npcAff(save, e.npc), dg = dayGain(save, e.npc), d = e.delta;
          if (d > 0) { d = Math.min(d, AFF_DAY_CAP - dg.gained); dg.gained += d; }
          st.aff = Math.max(0, Math.min(100, st.aff + d));
          return { ok: true, msg: npcName(e.npc) + ' 好感 ' + (d >= 0 ? '+' : '') + d };
        }
        case 'tip': save.money += Math.round(e.amount); G.addLog(save, '收下 ' + Math.round(e.amount) + ' 信用點（' + (e.reason || '小費') + '）。'); return { ok: true, msg: '收下 ' + Math.round(e.amount) + ' 信用點' };
        case 'item':
          if (e.qty * D().goods[e.good].vol > G.cargoFree(save)) return { ok: false, msg: '貨艙放不下' };
          G.addCargo(save, e.good, e.qty, 0); G.addLog(save, '收下 ' + D().goods[e.good].name + '×' + e.qty + '（' + (e.reason || '') + '）。');
          return { ok: true, msg: '收下 ' + D().goods[e.good].name + '×' + e.qty };
        case 'chain': return G.Mis.npcTalkDone(save, e.npc);
        case 'intimacy': {
          var s2 = npcAff(save, e.npc); s2.intimacy = (s2.intimacy || 0) + 1;
          G.addLog(save, '和' + npcName(e.npc) + '度過了一段私人時間。'); return { ok: true, msg: '' };
        }
        case 'note': G.addLog(save, '情報：' + e.text, 'intel'); return { ok: true, msg: '記下情報' };
        case 'parley': return { ok: true, msg: '', parley: e.result }; // 由呼叫端依面板事先算好的條件結算
      }
      return { ok: false, msg: '未知事件' };
    }

    // ---------- 劇情頁的行動按鈕 ----------
    // blocks：載入器 parseMsg 送來的 [{k:'btn',s,t}|{k:'p',t}…]
    var PANEL_WORDS = [[/市場|買|賣|交易/, 'market'], [/出航|起飛|跳躍|離港/, 'map'], [/任務電腦|接任務/, 'missions'], [/船塢|改裝|修理|換船/, 'yard']];
    function options(blocks) {
      var out = [];
      (blocks || []).forEach(function (b) { if (b.k === 'btn') out.push({ label: b.t, send: b.s || b.t }); });
      if (!out.length) { // 退而求其次：解析【你可以】①②③
        var lines = (blocks || []).filter(function (b) { return b.k === 'p' || b.k === 'd'; }).map(function (b) { return b.t; });
        var on = false;
        lines.forEach(function (l) {
          if (/【你可以】/.test(l)) { on = true; l = l.replace(/^.*【你可以】/, ''); }
          if (!on) return;
          l.split(/(?=[①②③④⑤]|(?:^|\s)[1-5][.)、])/).forEach(function (x) {
            var t = x.replace(/^[\s①②③④⑤1-5.)、]+/, '').trim(); if (t) out.push({ label: t, send: '我選擇：' + t });
          });
        });
      }
      return out.slice(0, 5).map(function (o) {
        for (var i = 0; i < PANEL_WORDS.length; i++) if (PANEL_WORDS[i][0].test(o.label)) { o.tab = PANEL_WORDS[i][1]; break; }
        return o;
      });
    }
    function replyText(blocks) {
      return (blocks || []).filter(function (b) { return b.k === 'p' || b.k === 'd' || b.k === 'st'; }).map(function (b) { return b.t; }).join('\n');
    }

    return { parse: parse, check: check, process: process, apply: apply, options: options, replyText: replyText,
      quoteOk: quoteOk, intimacyOpen: intimacyOpen, AFF_DAY_CAP: AFF_DAY_CAP, ver: '1.0' };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  else root.XYAI = factory(root.XYGame);
})(typeof window !== 'undefined' ? window : this);
