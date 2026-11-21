/* 星域私掠者 面板畫面 ui.js（v0.10：艦橋圖片） */
(function () {
  'use strict';
  var G = window.XYGame, C = window.XYCombat, AI = window.XYAI, Br = window.XYBridge;
  var S = null;                       // 存檔
  var legacy = false;                 // 讀到舊版（v1）存檔
  var tab = 'map', selDest = null, selSys = null, mapView = 'global', selMis = null, openGood = null, qtyMap = {}, moreOpen = { log: true }, loanAmt = '';
  var B = { m: null, target: null, fire: {}, ftarget: {}, alloc: null, all: false }; // 戰鬥畫面的暫存選擇（不進存檔）
  var $ = function (id) { return document.getElementById(id); };
  // 橋接狀態（不進存檔）
  var busy = false, lastStory = null, lastStoryAt = 0, storyNew = false, lastConvId = '', resumeFor = null, Q = [], lastSendAt = 0, flushT = null;
  var XO = '[[' + 'XYS]]', XC = '[[' + '/XYS]]', XS = '[[' + 'XYS:story]]', XE = '[[' + 'XYS:story-end]]';

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c == null) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function fmt(n) { return Math.round(n).toLocaleString(); }
  // ---------- 圖片（Sonnet-10）：載入失敗一律隱藏，不擋畫面 ----------
  var IMG_BASE = 'https://res.cloudinary.com/zerzrnhd/image/upload/v1795268376/';
  var NPC_IMG = { npc_ke_xuetang: 'ke', npc_ge_li: 'ge', npc_lei_zhilan: 'lei', npc_yi_man: 'yi', npc_lu_shuang: 'lu', npc_qiao_wei: 'qiao' };
  var SHIP_IMG = { donkey: 1, falcon: 1, albatross: 1, badger: 1, whaleshark: 1 };
  function imgUrl(name) { return IMG_BASE + 'ss_' + name + '.png'; }
  // 固定高度的容器＋裡面 width:100% 的圖（cover）。失敗時整個容器隱藏
  function picBox(name, boxStyle, pos, attrs) {
    var box = h('div', Object.assign({ class: 'pic', style: 'width:100%;overflow:hidden;background:#0a0f20;' + (boxStyle || '') }, attrs || {}), []);
    box.appendChild(h('img', { src: imgUrl(name), loading: 'lazy', alt: '', style: 'width:100%;height:100%;display:block;object-fit:cover;object-position:' + (pos || 'center'), onerror: function () { box.style.display = 'none'; } }));
    return box;
  }
  function avatar(npcId) { // 送禮、委託提示旁的小頭像
    var n = NPC_IMG[npcId]; if (!n) return null;
    var box = h('div', { class: 'avatar', style: 'width:38px;height:38px;flex:none;border-radius:50%;overflow:hidden;background:#0a0f20' }, []);
    box.appendChild(h('img', { src: imgUrl('npc_' + n), loading: 'lazy', alt: '', style: 'width:100%;height:100%;display:block;object-fit:cover;object-position:center 8%;transform:scale(1.9);transform-origin:50% 12%', onerror: function () { box.style.display = 'none'; } }));
    return box;
  }
  function npcCard(p) {
    var n = NPC_IMG[p.id];
    // 直式半身像放左邊（寬 110、高 160），臉在畫面上方約兩成處；橫向裁切會只剩頭頂（11/21 真機）
    var pic = n ? picBox('npc_' + n, 'width:110px;height:160px;flex:none', 'center 12%') : null;
    return h('div', { class: 'card npccard', 'data-npccard': p.id, style: 'padding:0;overflow:hidden;flex:1 1 44%;min-width:230px;margin:0;display:flex;align-items:stretch' }, [
      pic,
      h('div', { style: 'padding:8px 10px;display:flex;flex-direction:column;justify-content:center;gap:2px' }, [h('b', { text: p.name }), h('div', { class: 'sm dim', text: p.role }), h('div', { class: 'sm', text: p.stage + (p.talk ? '｜委託待談' : '') })])]);
  }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.style.display = 'none'; }, 2600); }
  function modal(node) { var m = $('modal'); m.firstChild.innerHTML = ''; m.firstChild.appendChild(node); m.style.display = 'flex'; }
  function closeModal() { $('modal').style.display = 'none'; }
  function persist() {
    try { var raw = G.exportSave(S); localStorage.setItem(G.SAVE_KEY, raw); if (S.convId) backupConv(S.convId, raw); } catch (e) { toast('存檔失敗：瀏覽器空間不足或被禁止。'); }
  }
  // 對話備份：xy.c.<convId>，索引 xy.cidx 記最近 6 個（最新在最後）
  function cidx() { try { var a = JSON.parse(localStorage.getItem('xy.cidx') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function backupConv(id, raw) {
    var a = cidx().filter(function (x) { return x !== id; }); a.push(id);
    while (a.length > 6) { try { localStorage.removeItem('xy.c.' + a.shift()); } catch (e) { } }
    localStorage.setItem('xy.c.' + id, raw); localStorage.setItem('xy.cidx', JSON.stringify(a));
  }
  function dropConv(id) { try { localStorage.removeItem('xy.c.' + id); localStorage.setItem('xy.cidx', JSON.stringify(cidx().filter(function (x) { return x !== id; }))); } catch (e) { } }
  function loadConv(id) { // 回傳存檔或 null
    try { var raw = localStorage.getItem('xy.c.' + id); if (!raw) return null; var r = G.importSave(raw); return r.ok ? r.save : null; } catch (e) { return null; }
  }
  function bar(v, mx, color) { return h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.max(0, Math.min(100, mx ? v / mx * 100 : 0)) + '%;background:' + color })]); }
  function act(r, okFn) { toast(r.msg); if (r.ok) { persist(); if (okFn) okFn(r); } render(); }

  // ---------- 開機 ----------
  var FILES = ['goods', 'factions', 'sectors', 'sector_anchor', 'sector_bastion', 'sector_mist', 'sector_wreck', 'encounters', 'ships', 'missions', 'npcs'];
  function boot() {
    if (location.protocol === 'file:') {
      $('view').innerHTML = '<div class="card"><h3>請用網頁伺服器開啟</h3><p>直接雙擊 index.html 時，瀏覽器不讓程式讀取資料檔。請在 panel 資料夾執行 <b>npx http-server panel</b>，或用 VS Code 的 Live Server 開啟。</p></div>';
      return;
    }
    Promise.all(FILES.map(function (f) { return fetch('data/' + f + '.json?v=' + (window.XY_BUILD || Date.now())).then(function (r) { if (!r.ok) throw new Error(f); return r.json(); }); }))
      .then(function (a) {
        G.init({ goods: a[0], factions: a[1], sectors: a[2], systemFiles: [a[3], a[4], a[5], a[6]], encounters: a[7], ships: a[8], missions: a[9], npcs: a[10] });
        var raw = null; try { raw = localStorage.getItem(G.SAVE_KEY); } catch (e) { }
        if (raw) {
          var r = G.importSave(raw);
          if (r.ok) S = r.save;
          else if (r.legacy) legacy = true;
          else toast('舊存檔讀不了：' + r.msg);
        }
        render();
        Br.init(onBridge);
      })
      .catch(function (e) { $('view').innerHTML = '<div class="card"><h3>資料讀取失敗</h3><p>找不到 ' + e.message + '.json，請確認 panel/data 資料夾完整。</p></div>'; });
  }

  // ---------- 總繪製 ----------
  var TABS = [['story', '劇情'], ['map', '星圖'], ['market', '市場'], ['missions', '任務'], ['yard', '船塢'], ['more', '更多']];
  function render() {
    if (!S) { if (legacy) renderLegacy(); else renderCreate(); $('top').innerHTML = ''; $('tabs').innerHTML = ''; $('battle').style.display = 'none'; Br.disarm(); return; }
    fixScene(); checkLoanFlip();
    renderTop(); renderTabs(); syncArm();
    if (S.battle) { renderBattle(); $('view').innerHTML = ''; return; }
    $('battle').style.display = 'none';
    var v = $('view'), keep = v.scrollTop; v.innerHTML = '';
    ({ story: viewStory, map: viewMap, market: viewMarket, missions: viewMissions, yard: viewYard, more: viewMore })[tab](v);
    v.scrollTop = keep;
  }
  function renderTop() {
    var sys = G.curSystem(S), mx = G.shipMax(S), fc = S.loc.facility ? G.data().facs[S.loc.facility] : null;
    var t = $('top'); t.innerHTML = '';
    [['', G.fmtClock(S.t)], ['', sys.name + (fc && S.loc.docked ? '・' + fc.name : '（航行中）')], ['信用 ', fmt(S.money)],
    ['船體 ', S.ship.hp.hull + '/' + mx.hull + '　裝甲 ' + S.ship.hp.armor + '/' + mx.armor], ['貨艙 ', G.cargoUsed(S) + '/' + G.cargoCap(S)]]
      .forEach(function (c) { t.appendChild(h('span', { class: 'chip' }, [c[0] ? c[0] : '', h('b', { text: c[1] })])); });
    var hl = G.loanHoursLeft(S);
    if (G.loanActive(S) && S.loan.missed > 0) t.appendChild(h('span', { class: 'chip bad', id: 'loanchip' }, [h('b', { text: '船貸逾期 ' + S.loan.missed + ' 期' })]));
    else if (hl != null && hl > 0 && hl <= 24 && G.loanShort(S) > 0) t.appendChild(h('span', { class: 'chip warn', id: 'loanchip' }, [h('b', { text: '船貸 ' + hl + ' 小時後到期' })]));
    if (G.insured(S)) t.appendChild(h('span', { class: 'chip' }, [h('b', { text: '保險中' })]));
    if (busy) t.appendChild(h('span', { class: 'chip warn', id: 'busychip' }, [h('b', { text: 'AI 回覆中…' })]));
  }
  function renderTabs() {
    var t = $('tabs'); t.innerHTML = '';
    TABS.forEach(function (x) { t.appendChild(h('button', { class: tab === x[0] ? 'on' : '', 'data-tab': x[0], onclick: function () { setTab(x[0]); render(); } }, [x[1], x[0] === 'story' && storyNew && tab !== 'story' ? h('span', { class: 'dot', id: 'storydot', text: '●' }) : null])); });
    t.style.display = S.battle ? 'none' : 'flex';
  }

  // ---------- 舊存檔 ----------
  function renderLegacy() {
    var v = $('view'); v.innerHTML = ''; v.style.top = '0';
    v.appendChild(h('div', { class: 'card' }, [h('h3', { text: '這是舊版測試存檔，請重新開始' }),
    h('div', { class: 'sm dim', text: '存檔格式已經升級到版本 2，舊的測試存檔沒辦法接續。按「重來」會清掉舊存檔，重新建立角色。' }),
    h('div', { style: 'margin-top:12px' }, [h('button', { class: 'btn red', id: 'legacyReset', text: '重來', onclick: function () {
      try { localStorage.removeItem(G.SAVE_KEY); } catch (e) { } legacy = false; v.style.top = ''; render();
    } })])]));
  }

  // ---------- 建立角色 ----------
  function renderCreate() {
    var v = $('view'); v.innerHTML = ''; $('view').style.top = '0';
    var sel = 'pilot';
    var card = h('div', { class: 'card' });
    var cover = picBox('cover', 'height:210px;border-radius:8px;margin-bottom:8px', 'center 30%', { id: 'coverpic' });
    var name = h('input', { placeholder: '船長名字（最多 12 字）', maxlength: 12 });
    var shipName = h('input', { placeholder: '船名（最多 10 字，不填就叫驢號）', maxlength: 10, id: 'shipname' });
    var gender = h('select', null, ['男', '女', '其他'].map(function (g) { return h('option', { text: g }); }));
    var look = h('input', { placeholder: '外貌（選填，例如：短髮、左眉有疤）', maxlength: 60 });
    var list = h('div');
    function drawOrigins() {
      list.innerHTML = '';
      G.ORIGINS.forEach(function (o) {
        list.appendChild(h('div', { class: 'opt' + (sel === o.id ? ' on' : ''), onclick: function () { sel = o.id; drawOrigins(); } },
          [h('b', { text: o.name }), h('div', { class: 'dim sm', text: o.desc })]));
      });
    }
    drawOrigins();
    [cover, h('h3', { text: '星域私掠者' }), h('div', { class: 'dim sm', text: '你分到一艘舊驢號貨船、3,000 信用點，和一筆 20,000 的船貸。先跑貨還債，再看要不要走偏門。' }),
    h('label', { text: '名字' }), name, h('label', { text: '船名' }), shipName, h('label', { text: '性別' }), gender, h('label', { text: '外貌' }), look,
    h('label', { text: '出身（決定小幅加成與初始人脈）' }), list,
    h('div', { style: 'margin-top:12px' }, [h('button', { class: 'btn', text: '出發', onclick: function () {
      S = G.newGame({ name: name.value.trim(), shipName: shipName.value, gender: gender.value, look: look.value, origin: sel }, (Date.now() ^ (Math.random() * 4294967296)) >>> 0);
      S.convId = lastConvId || '';
      persist(); $('view').style.top = '';
      var f0 = G.dockedFac(S); if (f0) { S.flags.dockT = S.flags.dockT || {}; S.flags.dockT[f0.id] = S.t; narrate('【停靠】我把船停進' + f0.name + '。'); }
      render();
    } })])].forEach(function (x) { card.appendChild(x); });
    v.appendChild(card);
  }

  // ---------- 賞金卡（星圖與船塢共用） ----------
  function bountyCard() {
    if (!G.canClaimBounty(S)) return null;
    return h('div', { class: 'card', id: 'bountycard' }, [h('div', { class: 'row sb' }, [
      h('div', null, [h('b', { text: '待領賞金' }), h('div', { class: 'sm dim', text: S.bounties.length + ' 筆，這裡可以領。' })]),
      h('button', { class: 'btn', id: 'claimBounty', text: '領取賞金 ' + fmt(G.bountyTotal(S)) + ' 信用點', onclick: function () { act(G.claimBounties(S)); } })])]);
  }

  // ---------- 星圖 ----------
  var DCOL = ['#4fd18b', '#a6d94f', '#ffb347', '#ff6b6b', '#d04bff', '#ff3b9a'];
  var SECT_COL = { anchor: '#2f6fd0', bastion: '#c0392b', mist: '#8e44ad', wreck: '#b9770e' };
  var DNAME = ['很安全', '還算安全', '有點危險', '危險', '很危險', '極度危險'];
  function viewMap(v) {
    var pcm = parleyCard(); if (pcm) v.appendChild(pcm);
    var D = G.data(), all = D.systemList, cur = G.curSystem(S);
    var nbIds = G.neighbors(S).map(function (n) { return n.id; });
    var sects = Object.keys(D.sectors), bb = {};
    sects.forEach(function (k) {
      var xs = [], ys = []; all.forEach(function (s) { if (s._sector === k) { xs.push(s.pos.x); ys.push(1000 - s.pos.y); } });
      bb[k] = { x0: Math.min.apply(null, xs) - 55, x1: Math.max.apply(null, xs) + 55, y0: Math.min.apply(null, ys) - 85, y1: Math.max.apply(null, ys) + 45 };
    });
    // 星區框不可重疊：上下相疊又左右相交的兩框，從兩框之間的空隙中線切開（各留 6 的間距）
    sects.forEach(function (a) { sects.forEach(function (c) {
      var A = bb[a], C = bb[c]; if (a >= c || A.x1 <= C.x0 || C.x1 <= A.x0) return;
      var up = A.y0 < C.y0 ? A : C, dn = up === A ? C : A;
      if (up.y1 <= dn.y0) return;
      var mid = (up.y1 + dn.y0) / 2; up.y1 = mid - 6; dn.y0 = mid + 6;
    }); });
    var vb;
    if (mapView === 'sector') { var b0 = bb[cur._sector]; vb = [b0.x0 - 20, b0.y0 - 20, b0.x1 - b0.x0 + 40, b0.y1 - b0.y0 + 40]; }
    else vb = [0, 0, 1000, 1000];
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', vb.join(' ')); svg.setAttribute('id', 'starmap'); svg.setAttribute('data-view', mapView);
    svg.setAttribute('style', 'width:100%;background:#0a0f20;border-radius:10px;border:1px solid var(--line)');
    function se(parent, tag, a, txt) { var e = document.createElementNS(NS, tag); Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); if (txt) e.textContent = txt; parent.appendChild(e); return e; }
    var big = mapView === 'global' ? 1 : 0.62;  // 全域檢視字級放大，手機才讀得到
    var defs = document.createElementNS(NS, 'defs'); svg.appendChild(defs);
    sects.forEach(function (k) { // 各星區框的淡背景（失敗就沒有）
      var b0 = bb[k], cp = document.createElementNS(NS, 'clipPath'); cp.setAttribute('id', 'clip_' + k); defs.appendChild(cp);
      se(cp, 'rect', { x: b0.x0, y: b0.y0, width: b0.x1 - b0.x0, height: b0.y1 - b0.y0, rx: 30 });
      var im = document.createElementNS(NS, 'image'); [['href', imgUrl('sector_' + k)], ['x', b0.x0], ['y', b0.y0], ['width', b0.x1 - b0.x0], ['height', b0.y1 - b0.y0], ['preserveAspectRatio', 'xMidYMid slice'], ['opacity', k === 'anchor' ? 0.65 : 0.5], ['style', k === 'anchor' ? 'filter:brightness(2.4)' : 'filter:brightness(1.6)'], ['clip-path', 'url(#clip_' + k + ')'], ['data-sectorpic', k]].forEach(function (a) { im.setAttribute(a[0], a[1]); });
      im.addEventListener('error', function () { im.style.display = 'none'; }); svg.appendChild(im);
    });
    sects.forEach(function (k) {
      var b0 = bb[k]; se(svg, 'rect', { x: b0.x0, y: b0.y0, width: b0.x1 - b0.x0, height: b0.y1 - b0.y0, rx: 30, fill: SECT_COL[k], 'fill-opacity': 0.13, stroke: SECT_COL[k], 'stroke-opacity': 0.35, 'stroke-width': 3, 'data-sector': k });
      se(svg, 'text', { x: b0.x0 + 16, y: b0.y0 + 36 * big + 8, 'paint-order': 'stroke', stroke: '#05080d', 'stroke-linejoin': 'round', 'stroke-width': 6, fill: SECT_COL[k], 'font-size': 36 * big, 'font-weight': 700, 'fill-opacity': 0.9 }, D.sectors[k].name);
    });
    var drawn = {};
    all.forEach(function (s) {
      s.links.forEach(function (l) {
        var t = D.systems[l.to]; if (!t) return;
        var key = [s.id, l.to].sort().join('|'); if (drawn[key]) return; drawn[key] = 1;
        var near = (cur.id === s.id || cur.id === l.to), choke = s._sector !== t._sector;
        se(svg, 'line', { x1: s.pos.x, y1: 1000 - s.pos.y, x2: t.pos.x, y2: 1000 - t.pos.y, stroke: near ? '#5b8be0' : choke ? '#7a6a3a' : '#26325a', 'stroke-width': near ? 4 : 2.5, 'stroke-dasharray': choke ? '10 8' : '' });
        se(svg, 'text', { x: (s.pos.x + t.pos.x) / 2, y: (2000 - s.pos.y - t.pos.y) / 2 - 6, 'paint-order': 'stroke', stroke: '#05080d', 'stroke-linejoin': 'round', 'stroke-width': 4, fill: '#8f9cd0', 'font-size': 20 * (mapView === 'global' ? 1.2 : 1) , 'text-anchor': 'middle' }, G.flightHours(S, l.dist) + 'h');
      });
    });
    all.forEach(function (s) {
      var here = cur.id === s.id, nb = nbIds.indexOf(s.id) >= 0, ex = G.isExplored(S, s.id), r = (here ? 28 : 21) * (mapView === 'global' ? 1.1 : 1);
      var g = se(svg, 'g', { style: 'cursor:pointer', 'data-sys': s.id });
      se(g, 'circle', { cx: s.pos.x, cy: 1000 - s.pos.y, r: r, fill: DCOL[s.danger] || '#888', stroke: selSys === s.id ? '#fff' : here ? '#4fb3ff' : '#0a0f20', 'stroke-width': here || selSys === s.id ? 6 : 3, opacity: here || nb || ex ? 1 : 0.6 });
      if (!s.facilities.length) se(g, 'circle', { cx: s.pos.x, cy: 1000 - s.pos.y, r: r * 0.4, fill: '#0a0f20' });   // 空心＝沒有設施，不能停靠
      if (!ex) se(g, 'text', { x: s.pos.x, y: 1000 - s.pos.y + 8, fill: '#0a0f20', 'font-size': 24, 'font-weight': 700, 'text-anchor': 'middle' }, '?');
      se(g, 'text', { x: s.pos.x, y: 1000 - s.pos.y + r + 26 * (mapView === 'global' ? 1.15 : 1), 'paint-order': 'stroke', stroke: '#05080d', 'stroke-linejoin': 'round', 'stroke-width': 5, fill: '#e6ebff', 'font-size': 24 * (mapView === 'global' ? 1.15 : 1), 'text-anchor': 'middle' }, s.name);
      g.addEventListener('click', function () { selSys = s.id; selDest = nb ? s.id : null; render(); });
    });
    var bc = bountyCard(); if (bc) v.appendChild(bc);
    var seg = h('div', { class: 'seg' }, [['global', '全域'], ['sector', '目前星區']].map(function (x) {
      return h('button', { class: 'btn ' + (mapView === x[0] ? '' : 'sec') + ' sm', 'data-view': x[0], text: x[1], onclick: function () { mapView = x[0]; render(); } });
    }));
    v.appendChild(h('div', { class: 'card' }, [h('h3', { text: mapView === 'global' ? '全星圖' : D.sectors[cur._sector].name }),
      h('div', { class: 'sm dim', style: 'margin-bottom:4px', html: '危險度：<span style="color:' + DCOL[0] + '">●</span>低 <span style="color:' + DCOL[2] + '">●</span>中 <span style="color:' + DCOL[3] + '">●</span>高　藍圈＝你在這裡　空心＝沒有設施（不能停靠）　？＝還沒去過' }), seg, svg]));

    // 選到的系統的資料
    if (selSys && D.systems[selSys]) v.appendChild(sysCard(D.systems[selSys], cur));
    var list = h('div', { class: 'card' }, [h('h3', { text: '從' + cur.name + '出航' })]);
    G.neighbors(S).forEach(function (n) {
      list.appendChild(h('div', { class: 'opt' + (selDest === n.id ? ' on' : ''), 'data-nb': n.id, onclick: function () { selSys = n.id; selDest = n.id; render(); } },
        [h('div', { class: 'row sb' }, [h('b', { text: n.name + (G.isExplored(S, n.id) ? '' : '（未探索）') }), h('span', { class: 'dim', text: n.flight + ' 小時' })]),
        h('div', { class: 'sm dim', text: '危險度：' + DNAME[n.danger] + (D.sectors[D.systems[n.id]._sector].id !== cur._sector ? '｜通往' + D.sectors[D.systems[n.id]._sector].name : '') })]));
    });
    v.appendChild(list);
    if (selDest && G.travelPreview(S, selDest)) {
      var pv = G.travelPreview(S, selDest);
      v.appendChild(h('div', { class: 'card', id: 'departcard' }, [h('h3', { text: '前往 ' + pv.name }),
        h('div', { html: '航程 <b>' + pv.flight + '</b> 小時' + (pv.flight !== pv.dist ? '（短躍引擎縮短，原本 ' + pv.dist + ' 小時）' : '') + '，加上離港 1 小時，共 <b>' + pv.hours + '</b> 小時（抵達約 ' + G.fmtClock(S.t + pv.hours) + '）' }),
        h('div', { html: '危險度：<b style="color:' + DCOL[pv.danger] + '">' + DNAME[pv.danger] + '</b>；途中遇到事情的機率約 <b>' + Math.round(pv.chance * 100) + '%</b>' }),
        h('div', { class: 'sm', text: '可能遇到：' + pv.likely.map(function (x) { return x.name + ' ' + Math.round(x.p * 100) + '%'; }).join('、') + '（以上是「遇到事情」時的比例）' }),
        h('div', { style: 'margin-top:10px' }, [h('button', { class: 'btn', id: 'goBtn', text: '出航', onclick: function () { doDepart(selDest); } })])]));
    }
  }
  function sysCard(s, cur) {
    var D = G.data(), ex = G.isExplored(S, s.id), card = h('div', { class: 'card', id: 'syscard' }, [h('div', { class: 'row sb' }, [h('h3', { text: s.name }), h('span', { class: 'sm dim', text: D.sectors[s._sector].name })])]);
    card.appendChild(h('div', { html: '危險度：<b style="color:' + DCOL[s.danger] + '">' + DNAME[s.danger] + '</b>' }));
    if (!ex) { card.appendChild(h('div', { class: 'sm dim', text: '還沒去過，只知道名字和危險度。第一次抵達後會記下這裡的設施。' })); return card; }
    card.appendChild(h('div', { class: 'sm dim', text: s.desc }));
    if (!s.facilities.length) card.appendChild(h('div', { class: 'sm warn', text: '沒有任何設施：可以經過，但不能停靠，到了之後只能繼續出航。' }));
    s.facilities.forEach(function (f) { card.appendChild(h('div', { class: 'sm', text: f.name + '：' + f.services.map(function (x) { return { market: '市場', missions: '任務', shipyard: '造船', bar: '酒吧', insurance: '保險', repair: '修理', loan: '船貸' }[x]; }).join('、') })); });
    return card;
  }
  function doDepart(to) {
    if (S.loc.facility && S.loc.docked) { S.flags.dockT = S.flags.dockT || {}; S.flags.dockT[S.loc.facility] = S.t; }
    var r = G.depart(S, to); selDest = null; B = { m: null, target: null, fire: {}, ftarget: {}, alloc: null, all: false };
    persist();
    if (!r.ok) { toast(r.msg); render(); return; }
    if (r.parley) { toast('赤帆的船擋住了航道。'); if (!narrate('【遭遇】赤帆的船擋住航道，對方發來通訊。')) tab = 'map'; render(); return; }
    if (!r.battle && S.loc.docked) {
      var af = G.dockedFac(S), lastT = S.flags.dockT && S.flags.dockT[af.id];
      if (af && (lastT == null || S.t - lastT >= 48 || (S.settings && S.settings.every))) { S.flags.dockT[af.id] = S.t; narrate('【停靠】我把船停進' + af.name + '。'); }
    }
    if (!r.battle) { var last = S.log[S.log.length - 1]; toast((r.notes && r.notes.length ? r.notes.join(' ') + ' ' : '') + (last ? last.x : '抵達。')); tab = 'map'; }
    render();
  }

  // ---------- 交涉（Sonnet-09） ----------
  function parleyCard() {
    var pi = G.parleyInfo(S); if (!pi) return null;
    var row = h('div', { class: 'row wrap', style: 'gap:8px;margin-top:8px' });
    [['pay', '付給他們', !pi.canPay], ['leave', '試著談判', false], ['fight', '開火', false], ['surrender', '投降', false]].forEach(function (b) {
      row.appendChild(h('button', { class: 'btn' + (b[0] === 'fight' ? ' red' : b[0] === 'pay' ? '' : ' sec'), 'data-parley': b[0], disabled: b[2] || busy, text: b[1], onclick: function () { doParley(b[0]); } }));
    });
    return h('div', { class: 'card', id: 'parleyCard' }, [h('h3', { text: '赤帆海盜攔住了航道' }), h('div', { text: '對方〔' + pi.foes + '〕要求：' + pi.demand }),
      h('div', { class: 'sm dim', style: 'margin-top:4px', text: '你原本要去：' + pi.to + '。' + (pi.canPay ? '' : '你付不起這個價碼。') }), row]);
  }
  function afterParley(r) { // 開戰：切到戰鬥畫面、不送 AI；其餘：把結果一句話送給 AI
    if (r.battle) { tab = 'map'; return; }
    if (r.ok && r.said) { var f = G.dockedFac(S); if (f) { S.flags.dockT = S.flags.dockT || {}; S.flags.dockT[f.id] = S.t; } if (!narrate('【遭遇】' + r.said)) tab = 'map'; }
  }
  function doParley(result) {
    var r = G.resolveParley(S, result); toast(r.msg);
    if (!r.ok) { render(); return; }
    persist(); afterParley(r); render();
  }

  // ---------- 劇情頁與橋接（Sonnet-08） ----------
  function djb(s) { var x = 5381; for (var i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x; }
  function setTab(t) { tab = t; if (t === 'story') storyNew = false; }
  function fixScene() {
    if (!S.scene) S.scene = { fac: null, bar: false, present: [] };
    if (S.scene.bar && (!S.loc.docked || S.scene.fac !== S.loc.facility)) S.scene = { fac: null, bar: false, present: [] };
  }
  function checkLoanFlip() { /* 逾期訊息併入 narrate；這裡只負責不重複 */ S.flags = S.flags || {}; if (S.flags.missedSeen == null) S.flags.missedSeen = S.loan ? S.loan.missed : 0; if (S.loan && S.loan.missed < S.flags.missedSeen) S.flags.missedSeen = S.loan.missed; }
  function navCoreSig() { return djb(G.navDataText(S, { core: true })); }
  function syncArm() {
    if (!Br.live || !S) return;
    var sig = navCoreSig();
    if (sig !== S.navSig) Br.arm(G.navDataText(S), sig); else Br.disarm();
  }
  function sendRaw(text) {
    lastSendAt = Date.now();
    // 送出後留在艦橋、切到劇情頁等 AI 回覆（11/21 真機：原本 keep:false 會把艦橋縮到右下角）
    Br.send(text, { keep: true });
    if (tab !== 'story' && !(S && S.battle)) { setTab('story'); try { render(); } catch (e) {} }
  }
  function flushQ() {
    clearTimeout(flushT); flushT = null;
    if (!Q.length) return;
    if (busy || Date.now() - lastSendAt < 4000) { flushT = setTimeout(flushQ, 1500); return; }
    var text = Q.shift(); sendRaw(text);
    if (Q.length) flushT = setTimeout(flushQ, 4200);
  }
  // 面板自己組的訊息：句子＋【航行資料】。回傳是否真的送出
  function narrate(sentence, free) {
    if (!Br.live || !S) return false;
    var text = sentence;
    if (!free) {
      if (S.loan && S.loan.missed > (S.flags.missedSeen || 0)) { text += '\n【航行紀錄】船貸又逾期了一期（連續 ' + S.loan.missed + ' 期）。'; }
      if (S.loan) S.flags.missedSeen = S.loan.missed;
      text += '\n\n' + XO + '\n' + G.navDataText(S) + '\n' + XC;
      S.navSig = navCoreSig(); S.pendingDigest = 0;
    }
    persist();
    setTab('story');
    if (busy || Date.now() - lastSendAt < 4000 || Q.length) { Q.push(text); flushQ(); } else sendRaw(text);
    return true;
  }
  function sendFree(sentence) { if (narrate(sentence, true)) render(); else toast('目前不在對話裡。'); }
  // act 之後要演出一句：fn(r) 回傳句子或 null
  function actN(r, fn) {
    toast(r.msg);
    if (r.ok) { persist(); var s = fn ? fn(r) : null; if (s) narrate(s); }
    render();
  }
  function doGift(id) {
    var gc = G.giftCheck(S, id); if (!gc.ok) { toast(gc.why + '。'); return; }
    var gp = G.giftPay(S, id, gc.goods[0]); if (!gp.ok) { toast(gp.msg); render(); return; }
    var x = AI.apply(S, { type: 'affection', npc: id, delta: 3 });
    S.aiApplied = (S.aiApplied || []).concat([x && x.msg ? x.msg : '送禮']).slice(-10);
    toast('送了' + gp.good + '給' + gp.name + '。' + (x && x.msg ? x.msg : '')); persist();
    narrate('【酒吧】我把一份' + gp.good + '送給' + gp.name + '。'); render();
  }
  function enterBar() {
    var fac = G.dockedFac(S); if (!fac) return;
    S.scene = { fac: fac.id, bar: true, present: Mi().npcsAt(S, fac.id) };
    persist();
    if (!narrate('【酒吧】我走進' + fac.name + '的酒吧。')) toast('已走進酒吧。');
    render();
  }
  function evtText(e) {
    var D = G.data(), nm = function (id) { var n = Mi().NPCS[id]; return n ? n.name : id; };
    if (e.type === 'tip') return '收下 ' + Math.round(e.amount) + ' 信用點' + (e.reason ? '（' + e.reason + '）' : '');
    if (e.type === 'item') return '收下 ' + (D.goods[e.good] ? D.goods[e.good].name : e.good) + '×' + e.qty + (e.reason ? '（' + e.reason + '）' : '');
    if (e.type === 'chain') return '和' + nm(e.npc) + '談完她的委託';
    if (e.type === 'affection') return nm(e.npc) + ' 好感 ' + (e.delta >= 0 ? '+' : '') + e.delta;
    if (e.type === 'time') return '過了 ' + e.hours + ' 小時';
    return e.type + (e.text ? '：' + e.text : '');
  }
  function ingest(d, tries) {
    if (!S) { Br.reply('ingested', { id: d.id, status: 'nosave', msg: '還沒有存檔' }); return; }
    // AI 還在寫：區塊可能不完整、正文也還沒寫完，請載入器下一輪再送（status:'later' 不會被標記已處理）
    if (busy) { Br.reply('ingested', { id: d.id, status: 'later' }); return; }
    // 載入器是先送 events、再送 story：先等一下，讓這一則的 story 進來，才用新的正文比對 quote
    if (!tries) { d.at = Date.now(); setTimeout(function () { ingest(d, 1); }, 700); return; }
    if ((!lastStory || lastStoryAt < d.at) && tries < 4) { setTimeout(function () { ingest(d, tries + 1); }, 800); return; }
    var rt = lastStory ? AI.replyText(lastStory.blocks) : '';
    // 在場：酒吧場景用 scene.present；沒進酒吧但已停靠時，這座設施的常駐 NPC 也算在場（玩家常用打字或 AI 的按鈕走進酒吧）
    var pres = (S.scene && S.scene.bar) ? S.scene.present : (S.loc.docked && S.loc.facility ? Mi().npcsAt(S, S.loc.facility) : []);
    var r = AI.process(S, d.text, rt, { present: pres || [], parley: !!S.parley, id: d.id });
    var msgs = [], after = null;
    if (r.dup) { Br.reply('ingested', { id: d.id, status: 'ok', msg: '已處理過' }); return; }
    if (!r.ok) { S.aiRejected = (S.aiRejected || []).concat([{ evt: { type: '區塊' }, reason: r.reason }]).slice(-10); }
    else {
      r.auto.forEach(function (e) {
        var x = AI.apply(S, e);
        if (x && x.parley) { var pr = G.resolveParley(S, x.parley); msgs.push(pr.msg); if (pr.ok) after = pr; else toast(pr.msg); return; }
        if (x && x.msg) msgs.push(x.msg);
      });
      S.aiPending = (S.aiPending || []).concat(r.confirm);
      S.aiRejected = (r.rejected || []).slice(-10);
    }
    S.aiApplied = (S.aiApplied || []).concat(msgs).slice(-10);
    persist(); if (after) afterParley(after); render();
    Br.reply('ingested', { id: d.id, status: 'ok', msg: msgs.join('、') || (r.ok ? '' : r.reason || '') });
  }
  function onBridge(d) {
    if (!d || !d.t) return;
    if (d.t === 'events') ingest(d, 0);
    else if (d.t === 'story') {
      var newId = !lastStory || lastStory.id !== d.id;
      lastStory = { id: d.id, blocks: d.blocks || [] }; busy = !!d.busy; lastStoryAt = Date.now();
      if (S && newId) { S.convTurns = (S.convTurns || 0) + 1; persist(); }
      var all = lastStory.blocks.map(function (b) { return b.t || ''; }).join('\n'), i = all.indexOf(XS), j = all.indexOf(XE);
      if (S && i >= 0 && j > i) { S.storySummary = all.slice(i + XS.length, j).trim(); persist(); }
      if (tab !== 'story') storyNew = true;
      if (S) render();
    }
    else if (d.t === 'busy') { busy = !!d.on; if (!busy) flushQ(); if (S) render(); }
    else if (d.t === 'consumed') { if (S) { S.navSig = Br.armedSig() || navCoreSig(); S.pendingDigest = 0; persist(); } }
    else if (d.t === 'fillres') { if (d.s) toast(d.s); }
    else if (d.t === 'conv') onConv(d);
  }
  function onConv(d) {
    if (!d.id) return;
    lastConvId = d.id;
    if (!S) return;
    if (!S.convId) { S.convId = d.id; persist(); return; }
    if (S.convId === d.id) return;
    var bk = loadConv(d.id);
    if (bk) { // 切回有備份的舊對話＝回到那時的進度（目前這份已經在自己的備份裡）
      persist(); S = bk; S.convId = d.id; Mis().ensure(S); persist();
      lastStory = null; Q = []; storyNew = false; toast('已切換到這個對話的進度'); render(); return;
    }
    if (d.u > 0) { S.convId = d.id; persist(); return; }
    var box = h('div', { id: 'resumeModal' }, [h('h3', { text: '這是新的對話' }), h('p', { class: 'sm', text: '艦橋找到一份舊進度。要接著玩，還是重新開始？' })]);
    box.appendChild(h('button', { class: 'btn', id: 'resumeBtn', style: 'width:100%;margin:6px 0', text: '接續目前進度', onclick: function () {
      S.convId = d.id; S.convTurns = 0; S.turnHinted = false; persist(); closeModal();
      narrate('【接續進度】請依下面的資料接著演。\n' + (S.storySummary || '（尚無劇情摘要）'));
      render();
    } }));
    box.appendChild(h('button', { class: 'btn sec', id: 'restartBtn', style: 'width:100%', text: '重新開始', onclick: function () {
      try { localStorage.setItem('xy.bak.' + Date.now(), G.exportSave(S)); localStorage.removeItem(G.SAVE_KEY); } catch (e) { }
      lastConvId = d.id; S = null; Q = []; lastStory = null; closeModal(); tab = 'story'; render();
    } }));
    modal(box);
  }

  function viewStory(v) {
    var fac = G.dockedFac(S), pcs = parleyCard(), secK = G.curSystem(S)._sector;
    if (S.scene.bar) v.appendChild(picBox('bar_' + secK, 'height:140px;border-radius:10px;margin-bottom:8px', 'center', { id: 'storybanner', 'data-banner': 'bar' }));
    else if (!S.loc.docked) v.appendChild(picBox('sector_' + secK, 'height:140px;border-radius:10px;margin-bottom:8px', 'center', { id: 'storybanner', 'data-banner': 'sector' }));
    if (pcs) v.appendChild(pcs);
    if ((S.convTurns || 0) >= 80 && !S.turnHinted) v.appendChild(h('div', { class: 'card', id: 'turnHint' }, [h('div', { text: '這段對話已經很長了，建議先存劇情摘要，再開新對話。' }),
      h('div', { class: 'row', style: 'gap:8px;margin-top:6px' }, [h('button', { class: 'btn sm', text: '📜 存劇情摘要', disabled: !Br.live || busy, onclick: function () { S.turnHinted = true; persist(); sendFree('【劇情存檔】請依約定格式寫目前的劇情摘要。'); } }),
        h('button', { class: 'btn sec sm', 'data-turnhint-ok': 1, text: '知道了', onclick: function () { S.turnHinted = true; persist(); render(); } })])]));
    if (fac && fac.services.indexOf('bar') >= 0 && Mi().npcsAt(S, fac.id).length && !S.scene.bar)
      v.appendChild(h('button', { class: 'btn', id: 'enterBar', style: 'width:100%;margin-bottom:8px', disabled: busy, text: '🍸 進酒吧', onclick: enterBar }));
    var pinfo = G.presentInfo(S);
    if (pinfo.length) v.appendChild(h('div', { id: 'npcrow', style: 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px' }, pinfo.map(npcCard)));
    if (!Br.live) v.appendChild(h('div', { class: 'card' }, [h('div', { class: 'dim', text: '目前不在對話裡' }), h('div', { class: 'sm dim', text: '其他頁面都能照常使用。' })]));
    var card = h('div', { class: 'card', id: 'storyCard' });
    if (Br.live && !lastStory) card.appendChild(h('div', { class: 'dim', text: '還沒有 AI 的回覆。在下面的對話框說些什麼，或用上方的按鈕開始。' }));
    if (lastStory) lastStory.blocks.forEach(function (b) {
      if (b.k === 'st') card.appendChild(h('div', { class: 'sm dim', style: 'margin-bottom:6px', text: b.t }));
      else if (b.k === 'p') card.appendChild(h('p', { text: b.t }));
      else if (b.k === 'd') card.appendChild(h('p', null, [b.s ? h('b', { text: b.s + '：' }) : null, b.t]));
    });
    if (Br.live) v.appendChild(card);
    (S.aiPending || []).forEach(function (e, i) {
      v.appendChild(h('div', { class: 'card', 'data-confirm': i }, [
        h('div', null, [h('b', { text: evtText(e) })]),
        e.quote ? h('div', { class: 'sm dim', text: '「' + e.quote + '」' }) : null,
        e._noQuote ? h('div', { class: 'sm warn', text: '正文裡沒找到這段描寫' }) : null,
        h('div', { class: 'row', style: 'gap:8px;margin-top:6px' }, [
          h('button', { class: 'btn sm', 'data-accept': i, text: '收下', onclick: function () {
            var x = AI.apply(S, e); S.aiPending.splice(i, 1);
            if (x && x.ok === false) S.aiPending.splice(i, 0, e);
            if (x && x.ok) S.aiApplied = (S.aiApplied || []).concat([x.msg || evtText(e)]).slice(-10);
            toast((x && x.msg) || '完成'); persist(); render(); } }),
          h('button', { class: 'btn sec sm', 'data-reject': i, text: '不要', onclick: function () { S.aiPending.splice(i, 1); persist(); render(); } })])]));
    });
    var opts = lastStory ? AI.options(lastStory.blocks) : [];
    var box = h('div', { id: 'storyActions' });
    opts.forEach(function (o) {
      box.appendChild(h('button', { class: 'btn sec hc', style: 'width:100%;margin:4px 0;text-align:left', disabled: busy && (!o.tab || o.tab === 'bar'), 'data-send': o.send, text: o.label, onclick: function () {
        if (o.tab === 'bar') { if (busy) return; enterBar(); } else if (o.tab) { setTab(o.tab); render(); } else { Br.live ? sendFree(o.send) : toast('目前不在對話裡。'); } } }));
    });
    if (Br.live && !opts.length && lastStory) {
      [['繼續', '繼續', 0], ['離開酒吧', '我離開酒吧。', 1], ['回船上', '我回到船上。', 1]].forEach(function (g) {
        if (g[2] && !(fac && S.scene.bar)) return;
        box.appendChild(h('button', { class: 'btn sec', style: 'width:100%;margin:4px 0', disabled: busy, text: g[0], onclick: function () {
          if (g[0] === '離開酒吧') { S.scene = { fac: null, bar: false, present: [] }; persist(); }
          sendFree(g[1]); } }));
      });
    }
    v.appendChild(box);
    var Mm = Mi();
    if (S.scene.bar) S.scene.present.forEach(function (id) {
      var gc = G.giftCheck(S, id), nm = Mm.NPCS[id].name;
      v.appendChild(h('div', { class: 'row', style: 'gap:8px;align-items:center;margin:4px 0' }, [avatar(id),
        h('button', { class: 'btn sec sm', 'data-gift': id, disabled: !gc.ok || busy, text: '🎁 送禮', onclick: function () { doGift(id); } }),
        h('span', { class: 'sm dim', text: nm + (gc.ok ? '：' + gc.goods.map(function (x) { return G.data().goods[x].name; }).join('、') + ' 可以送' : '：' + gc.why + (gc.want ? '（她喜歡：' + gc.want.join('、') + '）' : '')) })]));
    });
    (S.scene.bar ? S.scene.present : (fac ? Mm.npcsAt(S, fac.id) : [])).forEach(function (id) {
      var n = Mm.npcInfo(S, id);
      if (n.pending === 'talk') v.appendChild(h('div', { class: 'row', style: 'gap:8px;align-items:center;margin:4px 0' }, [avatar(id), h('button', { class: 'btn sm', 'data-talkto': id, disabled: busy || !Br.live, text: '去找' + n.name + '談', onclick: function () { sendFree('我去找' + n.name + '談。'); } })]));
    });
    var ap = (S.aiApplied || []), rj = (S.aiRejected || []);
    if (ap.length || rj.length) v.appendChild(sect('aiRej', 'AI 提出但未採用', function (b) {
      ap.forEach(function (x) { b.appendChild(h('div', { class: 'sm', text: '已採用：' + x })); });
      rj.forEach(function (r) { b.appendChild(h('div', { class: 'sm dim', 'data-rejected': 1, text: evtText(r.evt) + '　— ' + r.reason })); });
    }));
  }

  // ---------- 市場 ----------
  var ST_TAG = { produce: ['產出', 'p'], demand: ['需求', 'd'], normal: ['一般', 'n'], banned: ['違禁', 'x'] };
  function viewMarket(v) {
    var D = G.data(), fid = S.loc.facility, fc = fid ? D.facs[fid] : null;
    if (!fc || !S.loc.docked || fc.services.indexOf('market') < 0) { v.appendChild(h('div', { class: 'card', id: 'nomarket', text: !S.loc.docked ? '你還沒停靠，沒有市場。' + (G.curSystem(S).facilities.length ? '' : '這個系統沒有任何設施，只能繼續出航。') : '這裡沒有市場。' })); return; }
    if (G.Mis.frozen(S, fc)) { v.appendChild(h('div', { class: 'card', id: 'frozen' }, [h('h3', { text: fc.name }), h('div', { class: 'bad', text: G.Mis.FROZEN_MSG }), h('div', { class: 'sm dim', text: '到船塢頁的船貸櫃檯補齊本期款項就會解除。船貸櫃檯和修理照常開放。' })])); return; }
    v.appendChild(h('div', { class: 'card' }, [h('h3', { text: fc.name }), h('div', { class: 'sm dim', text: fc.desc }),
    h('div', { class: 'sm dim', style: 'margin-top:4px', text: '「產出」的貨在這裡便宜、「需求」的貨在這裡賣得貴，「一般」是正常價。換個地方賣，才有價差。' })]));
    var hc = cargoCard(); if (hc) v.appendChild(hc);
    var card = h('div', { class: 'card' });
    G.board(S, fid).forEach(function (g) {
      var held = G.heldQty(S, g.id), tg = ST_TAG[g.status] || ['', ''], isBan = g.status === 'banned';
      var head = h('div', { class: 'row sb', 'data-good': g.id, onclick: function () { openGood = openGood === g.id ? null : g.id; render(); } }, [
        h('div', null, [h('b', { text: g.name }), tg[0] ? h('span', { class: 'tag ' + tg[1], text: tg[0] }) : null,
        h('div', { class: 'sm dim', text: held ? '持有 ' + held + '（均價 ' + fmt(G.heldPaid(S, g.id)) + '）' : '' })]),
        h('div', { style: 'text-align:right' }, isBan ? [h('span', { class: 'bad sm', text: '這裡不收' })] : [h('div', { class: 'sm' }, ['買 ', h('b', { text: fmt(g.buy) })]), h('div', { class: 'sm' }, ['賣 ', h('b', { text: fmt(g.sell) })])])]);
      var row = h('div', { class: 'mrow' }, [head]);
      if (openGood === g.id && !isBan) row.appendChild(tradeBox(g, fid, held));
      card.appendChild(row);
    });
    v.appendChild(card);
  }
  function tradeBox(g, fid, held) {
    var n = qtyMap[g.id] || 1; var box = h('div', { class: 'qty' });
    var info = h('div', { class: 'sm', style: 'width:100%' });
    var nEl = h('span', { class: 'n', text: n });
    function upd() {
      var bq = G.quote(S, fid, g.id, 'buy', n);
      var txt = '買 ' + n + ' 個：總價 ' + fmt(bq.total) + '（均價 ' + fmt(bq.avg) + '）';
      if (held) {
        var sp = G.sellPreview(S, g.id, n);
        if (sp.ok) txt += '　｜　賣 ' + sp.n + ' 個：總價 ' + fmt(sp.total) + '（均價 ' + fmt(sp.avg) + '），比買進價' + (sp.profit >= 0 ? '賺 ' : '虧 ') + fmt(Math.abs(sp.profit)) + (sp.perk ? '　〔' + sp.perk + '的人情價〕' : '');
      }
      info.textContent = txt; nEl.textContent = n;
    }
    [h('button', { class: 'btn sec sm', text: '−', onclick: function () { n = Math.max(1, n - 1); qtyMap[g.id] = n; upd(); } }), nEl,
    h('button', { class: 'btn sec sm', text: '＋', onclick: function () { n = Math.min(99, n + 1); qtyMap[g.id] = n; upd(); } }),
    h('button', { class: 'btn sec sm', text: '全部', onclick: function () { n = Math.max(1, held || G.maxBuy(S, g.id)); qtyMap[g.id] = n; upd(); } }),
    h('button', { class: 'btn sm', text: '買入', onclick: function () { act(G.buy(S, g.id, n)); } }),
    h('button', { class: 'btn sec sm', text: '賣出', disabled: !held, onclick: function () { act(G.sell(S, g.id, n)); } }), info].forEach(function (x) { box.appendChild(x); });
    upd(); return box;
  }

  // ---------- 任務、船塢 ----------
  // ---------- 任務電腦 ----------
  var Mi = function () { return G.Mis; };
  var Mis = Mi;
  function dueText(m) { var left = m.deadline - S.t; return G.fmtClock(m.deadline) + '（還有 ' + Math.max(0, left) + ' 小時）'; }
  function offerCard(o) {
    var M = Mi(), D = G.data(), err = M.checkAccept(S, o);
    var el = h('div', { class: 'mis', 'data-offer': o.oid, 'data-type': o.type }, [
      h('div', { class: 'hd' }, [h('b', { text: o.name }), h('span', { class: 'tag n', text: M.TYPE_NAME[o.type] })]),
      h('div', { class: 'sm dim', text: '發布：' + o.giverName }),
      h('div', { class: 'sm', style: 'margin:4px 0', text: o.text }),
      h('div', { class: 'sm', html: '目的地 <b>' + o.destName + '</b>（' + o.jumps + ' 段跳躍，危險度 <b style="color:' + DCOL[o.danger] + '">' + DNAME[o.danger] + '</b>' + (o.destFac ? '' : '，沒有設施') + '）' }),
      h('div', { class: 'sm', html: '報酬 <b>' + fmt(o.reward) + '</b> 信用點｜期限 ' + o.dl + ' 小時' + (o.good ? '｜貨物 ' + D.goods[o.good].name + '×' + o.qty + '（' + o.qty * D.goods[o.good].vol + ' 格）' + (o.type === 'cargo' || o.type === 'smuggle' ? '' : '，到了現場回收') : '') }),
      o.via ? h('div', { class: 'sm', text: '巡邏路線：' + M.routeText(o) }) : null,
      o.foes && o.foes.length ? h('div', { class: 'sm warn', text: '可能遇到：' + M.foeNames(o) + '（' + ({ route: '出發後第一段', dest: '抵達目的地時', target: '抵達目的地時' }[o.foesAt]) + '）' }) : null,
      warnLine(o),
      o.type === 'smuggle' ? h('div', { class: 'sm warn', text: '違禁品：路上的巡邏艦掃到會沒收並罰款。' }) : null,
      h('div', { style: 'margin-top:6px' }, [h('button', { class: 'btn sm', 'data-accept': o.oid, disabled: !!err, text: err ? '不能接' : '接受', onclick: function () { actN(M.accept(S, o.oid), function (r) { var m = r.mission; return m && (m.giverName || m.npc) ? '【委託】我接下了任務「' + m.name + '」：' + M.line(S, m) + '。' : null; }); } }), err ? h('span', { class: 'sm bad', style: 'margin-left:8px', text: err }) : null])]);
    return el;
  }
  function activeCard(m) {
    var M = Mi(), D = G.data();
    var el = h('div', { class: 'mis', 'data-mid': m.id, 'data-type': m.type }, [
      h('div', { class: 'hd' }, [h('b', { text: m.name }), h('span', { class: 'tag n', text: M.TYPE_NAME[m.type] })]),
      h('div', { class: 'sm', text: M.line(S, m) }),
      h('div', { class: 'sm ' + (m.deadline - S.t <= 12 ? 'warn' : 'dim'), text: '期限 ' + dueText(m) + '｜報酬 ' + fmt(m.reward) }),
      h('div', { class: 'sm', text: '現況：' + M.stateNote(S, m) }),
      m.foes && m.foes.length && !m.fought ? h('div', { class: 'sm warn', text: '可能遇到：' + M.foeNames(m) }) : null,
      m.foes && m.foes.length && !m.fought ? warnLine(m) : null]);
    var row = h('div', { class: 'row wrap', style: 'margin-top:6px;gap:6px' });
    M.actionsOf(S, m).forEach(function (a) { row.appendChild(h('button', { class: 'btn sm', 'data-act': a.id, 'data-mid': m.id, text: a.label, onclick: function () { actN(M.act(S, m.id, a.id), a.id === 'deliver' ? function (r) { return r.done ? '【委託】我把任務「' + m.name + '」交差了。' : null; } : null); } })); });
    row.appendChild(h('button', { class: 'btn sec sm', text: '放棄', onclick: function () { modal(h('div', null, [h('h3', { text: '放棄任務？' }), h('div', { class: 'sm dim', text: '「' + m.name + '」會當成失敗處理，扣聲望，任務貨也會收回。' }), h('div', { class: 'row', style: 'margin-top:10px' }, [h('button', { class: 'btn red', 'data-confirm-abandon': m.id, text: '放棄', onclick: function () { closeModal(); act(M.act(S, m.id, 'abandon')); } }), h('button', { class: 'btn sec', text: '取消', onclick: closeModal })])])); } }));
    el.appendChild(row); return el;
  }
  function viewMissions(v) {
    var M = Mi(), act0 = M.actives(S);
    var top = h('div', { class: 'card', id: 'activecard' }, [h('div', { class: 'row sb' }, [h('h3', { text: '進行中的任務' }), h('span', { class: 'sm dim', text: act0.length + '/' + M.MAX_ACTIVE })])]);
    if (!act0.length) top.appendChild(h('div', { class: 'dim sm', text: '目前沒有進行中的任務。' }));
    act0.forEach(function (m) { top.appendChild(activeCard(m)); });
    v.appendChild(top);
    var why = G.missionsOpen(S), fac = G.dockedFac(S);
    if (why) {
      v.appendChild(h('div', { class: 'card', id: 'boardclosed' }, [h('h3', { text: '任務電腦' }), h('div', { class: why.indexOf('凍結') >= 0 ? 'bad' : 'dim', text: why }),
        why.indexOf('凍結') >= 0 ? h('div', { class: 'sm dim', text: '到船塢頁的船貸櫃檯補齊本期款項就會解除。船貸櫃檯和修理照常開放。' }) : null]));
    } else {
      var bi = M.boardInfo(S, fac.id), card = h('div', { class: 'card', id: 'boardcard' }, [h('div', { class: 'row sb' }, [h('h3', { text: fac.name + '的任務電腦' }), h('span', { class: 'sm dim', text: '每天重新整理（第 ' + G.dayOf(S.t) + ' 天）' })])]);
      if (!bi.offers.length) card.appendChild(h('div', { class: 'dim sm', text: '今天的任務都接完了，明天再來看看。' }));
      bi.offers.forEach(function (o) { card.appendChild(offerCard(o)); });
      v.appendChild(card);
    }
    var fin = S.missions.filter(function (m) { return m.status !== 'active'; }).slice(-5).reverse();
    if (fin.length) v.appendChild(h('div', { class: 'card' }, [h('b', { text: '最近結束的任務' })].concat(fin.map(function (m) {
      return h('div', { class: 'sm ' + (m.status === 'done' ? 'ok' : 'bad'), style: 'padding:2px 0', text: m.name + '：' + ({ done: '完成', failed: '失敗', expired: '逾期' }[m.status]) });
    }))));
  }
  // ---------- 船塢：改裝、補飛彈、換船（Sonnet-06） ----------
  function warnLine(o) {
    var w = G.missionWarn(S, o);
    return w ? h('div', { class: 'sm ' + (w.level === 'bad' ? 'bad' : 'warn'), 'data-warn': w.level, text: w.text }) : null;
  }
  function cargoCard() { // 市場頁、船塢頁都放：貨艙持有清單，有藏貨夾層才能藏
    var hi = G.holdInfo(S); if (hi.cap <= 0) return null;
    var D = G.data(), card = h('div', { class: 'card', id: 'holdcard' }, [
      h('div', { class: 'row sb' }, [h('h3', { text: '貨艙・藏貨夾層' }), h('span', { class: 'sm dim', id: 'holdused', text: '已藏 ' + hi.used + '／' + hi.cap + ' 格' })]),
      h('div', { class: 'sm dim', text: '藏起來的貨不會被巡邏艦掃到，仍佔貨艙。走私任務的貨可以整批一起藏；其他任務貨不能藏。' })]);
    if (!S.cargo.length) card.appendChild(h('div', { class: 'sm dim', style: 'margin-top:6px', text: '貨艙是空的。' }));
    S.cargo.forEach(function (c, i) {
      var g = D.goods[c.id], why = G.canHide(S, c), n = Math.min(c.qty, c.hid || 0);
      var head = h('div', { class: 'row sb' }, [h('span', null, [h('b', { text: g.name + '×' + c.qty }), c.missionId ? h('span', { class: 'tag d', text: '任務貨' }) : null]), h('span', { class: 'sm ' + (n ? 'ok' : 'dim'), text: n ? '藏 ' + n : '沒藏' })]);
      var ctl = h('div', { class: 'row wrap', style: 'margin-top:4px;gap:6px' });
      if (why) ctl.appendChild(h('span', { class: 'sm dim', text: why }));
      else if (c.missionId) ctl.appendChild(h('button', { class: 'btn sec sm', 'data-hide': i, text: n ? '取消藏起來' : '藏起來（整批）', onclick: function () { act(G.setHidden(S, i, n ? 0 : c.qty)); } }));
      else [h('button', { class: 'btn sec sm', 'data-hide-dec': i, text: '−', onclick: function () { act(G.setHidden(S, i, n - 1)); } }), h('span', { class: 'n', text: String(n) }),
        h('button', { class: 'btn sec sm', 'data-hide-inc': i, text: '＋', onclick: function () { act(G.setHidden(S, i, n + 1)); } }),
        h('button', { class: 'btn sec sm', 'data-hide-all': i, text: '盡量藏', onclick: function () { var k = c.qty; while (k > 0 && !G.setHidden(S, i, k).ok) k--; act(G.setHidden(S, i, k)); } })].forEach(function (x) { ctl.appendChild(x); });
      card.appendChild(h('div', { class: 'mrow', 'data-cargo': i }, [head, ctl]));
    });
    return card;
  }
  function yardShop(v) {
    var g = G.yardGate(S);
    if (!g.ok) { if (G.hasService(S, 'shipyard')) v.appendChild(h('div', { class: 'card', id: 'yardblocked' }, [h('h3', { text: '船塢' }), h('div', { class: 'bad', text: g.msg })])); return; }
    yardRefit(v, g); yardAmmo(v); yardSwap(v, g);
  }
  function slotLabel(H, kind, i) { return G.SLOT_NAME[kind] + (G.slotCount(H, kind) > 1 || kind === 'gun' ? ' ' + (i + 1) : '') + (kind === 'gun' ? (H.slots.gun[i].arc === 'turret' ? '（砲塔）' : '（前方）') : ''); }
  function yardRefit(v, g) {
    var D = G.data(), H = D.hulls[S.ship.hull], lo = G.loadoutView(S), card = h('div', { class: 'card', id: 'refitcard' }, [h('h3', { text: '改裝（' + g.fac.name + '，船塢 ' + g.tier + ' 級）' }),
      h('div', { class: 'sm dim', text: '裝上 ' + G.REFIT_HOURS + ' 小時、拆下 ' + G.REFIT_HOURS + ' 小時；拆下的裝備直接賣掉（買價的一半）。槽位滿了要先拆。' })]);
    G.SLOT_ORDER.forEach(function (kind) {
      for (var i = 0; i < G.slotCount(H, kind); i++) (function (i) {
        var id = (kind === 'shield' || kind === 'engine' || kind === 'jump') ? lo[kind] : lo[kind][i], e = id ? D.equip[id] : null, key = kind + ':' + i;
        var row = h('div', { class: 'mrow', 'data-slot': key }, [h('div', { class: 'row sb' }, [h('span', null, [h('span', { class: 'dim sm', text: slotLabel(H, kind, i) + '　' }), h('b', { text: e ? e.name : '（空）' })]),
          e ? h('button', { class: 'btn sec sm', 'data-remove': key, text: '拆下（+' + fmt(G.equipValue(id)) + '）', onclick: function () { act(G.removeEquip(S, kind, i)); } })
            : h('button', { class: 'btn sm', 'data-install': key, text: '裝上', onclick: function () { pickEquip(kind, i); } })])]);
        if (e) row.appendChild(h('div', { class: 'sm dim', text: e.desc }));
        card.appendChild(row);
      })(i);
    });
    v.appendChild(card);
  }
  function pickEquip(kind, i) {
    var H = G.data().hulls[S.ship.hull], opts = G.slotOptions(S, kind, i), box = h('div', { style: 'max-height:62vh;overflow-y:auto' }, [h('h3', { text: '裝上：' + slotLabel(H, kind, i) }),
      h('div', { class: 'sm dim', text: '你有 ' + fmt(S.money) + ' 信用點。灰色的買不到，原因寫在旁邊。' })]);
    if (!opts.length) box.appendChild(h('div', { class: 'sm dim', text: '沒有可裝的裝備。' }));
    opts.forEach(function (o) {
      var e = o.equip, off = !!o.reason;
      box.appendChild(h('div', { class: 'opt', 'data-pick': o.id, style: off ? 'opacity:.5' : '' }, [h('div', { class: 'row sb' }, [h('span', null, [h('b', { text: e.name }), h('span', { class: 'tag n', text: e.tier + ' 階' })]), h('b', { text: fmt(o.price) })]),
        o.perk ? h('div', { class: 'sm ok', 'data-perk': 1, text: '〔' + o.perk + '的人情價〕原價 ' + fmt(o.listPrice) }) : null,
        h('div', { class: 'sm dim', text: e.desc }), off ? h('div', { class: 'sm bad', text: o.reason }) : null,
        h('button', { class: 'btn sm', style: 'margin-top:6px', 'data-pick-btn': o.id, disabled: off, text: '買下裝上', onclick: function () { closeModal(); act(G.installEquip(S, kind, i, o.id)); } })]));
    });
    box.appendChild(h('div', { style: 'margin-top:8px' }, [h('button', { class: 'btn sec', text: '取消', onclick: closeModal })]));
    modal(box);
  }
  function yardAmmo(v) {
    var st = G.ammoStatus(S); if (!st.length) return;
    var total = st.reduce(function (a, x) { return a + x.cost; }, 0), card = h('div', { class: 'card', id: 'ammocard' }, [h('h3', { text: '補飛彈' })]);
    st.forEach(function (x) { card.appendChild(h('div', { class: 'row sb', 'data-ammo': x.id }, [h('span', { text: x.name + '　' + x.cur + '／' + x.max }), h('span', { class: 'sm dim', text: '每發 ' + fmt(x.price) })])); });
    card.appendChild(h('button', { class: 'btn', id: 'refill', style: 'margin-top:8px', disabled: total <= 0 || S.money < total, text: total > 0 ? '補滿（' + fmt(total) + '）' : '彈藥已滿', onclick: function () { act(G.refillAmmo(S)); } }));
    v.appendChild(card);
  }
  function cmpSpan(a, b, lowerBetter) {
    if (a === b) return h('span', { class: 'dim', text: '＝' });
    var better = lowerBetter ? a < b : a > b;
    return h('span', { class: better ? 'ok' : 'bad', text: a > b ? '↑' : '↓' });
  }
  function hullStats(H, cur) {
    var rows = [['價格', 'price', 1], ['船體', 'hull'], ['裝甲', 'armor'], ['能量', 'energy'], ['敏捷', 'agility'], ['速度', 'speed'], ['貨艙', 'cargo'], ['脫離回合', 'jumpCharge', 0, 1]];
    var cells = rows.map(function (r) { var a = H[r[1]], b = cur[r[1]]; return h('span', { style: 'margin-right:10px;white-space:nowrap' }, [r[0] + ' ' + (r[2] ? fmt(a) : a) + ' ', r[2] ? null : cmpSpan(a, b, !!r[3])]); });
    return h('div', { class: 'sm' }, [h('div', null, cells), h('div', { class: 'dim', text: '槽位：武器 ' + H.slots.gun.length + '（' + H.slots.gun.filter(function (x) { return x.arc === 'turret'; }).length + ' 砲塔）、飛彈 ' + H.slots.missile + '、特殊 ' + H.slots.special + '、貨艙擴充 ' + H.slots.cargoExt })]);
  }
  function yardSwap(v, g) {
    var D = G.data(), cur = D.hulls[S.ship.hull], card = h('div', { class: 'card', id: 'swapcard' }, [h('h3', { text: '換船' }),
      h('div', { class: 'sm dim', text: '目前：' + cur.name + '「' + S.ship.name + '」。換船 ' + G.SWAP_HOURS + ' 小時，新船滿血、船名沿用；保險繼續有效到期，下次保費照新船算。' })]);
    G.yardHulls(S).forEach(function (H) {
      var isCur = H.id === S.ship.hull;
      var thumb = SHIP_IMG[H.id] ? h('div', { style: 'width:84px;flex:none;margin-right:10px' }, [picBox('ship_' + H.id, 'aspect-ratio:1/1;border-radius:8px', 'center', { 'data-shippic': H.id })]) : null;
      var body = h('div', { style: 'flex:1;min-width:0' }, [h('div', { class: 'row sb' }, [h('span', null, [h('b', { text: H.name }), h('span', { class: 'sm dim', text: '　' + H.class }), isCur ? h('span', { class: 'tag p', text: '目前' }) : null]), h('b', { text: fmt(H.price) })]),
        h('div', { class: 'sm dim', text: H.desc }), hullStats(H, cur),
        isCur ? null : h('button', { class: 'btn sm', style: 'margin-top:6px', 'data-swap': H.id, text: '試算換船', onclick: function () { swapModal(H.id); } })]);
      card.appendChild(h('div', { class: 'opt' + (isCur ? ' on' : ''), 'data-hull': H.id, style: 'display:flex;align-items:flex-start' }, [thumb, body]));
    });
    v.appendChild(card);
  }
  function swapModal(hullId) {
    var D = G.data(), q = G.swapQuote(S, hullId), box = h('div', { style: 'max-height:66vh;overflow-y:auto', id: 'swapquote' });
    if (!q.hull) { box.appendChild(h('div', { class: 'bad', text: q.reason })); box.appendChild(h('button', { class: 'btn sec', text: '關閉', onclick: closeModal })); modal(box); return; }
    var nm = function (x) { return D.equip[x.id].name; };
    box.appendChild(h('h3', { text: '換成「' + q.hull.name + '」' }));
    [['新船價格', fmt(q.price)], ['舊船折價（船體價 60%＝' + fmt(q.tradeBase) + '，扣修理費 ' + fmt(q.repairFee) + '）', '−' + fmt(q.tradeIn)], ['賣掉塞不下的裝備（' + q.sell.length + ' 件）', '−' + fmt(q.equipSale)]].forEach(function (r) {
      box.appendChild(h('div', { class: 'row sb sm' }, [h('span', { text: r[0] }), h('span', { text: r[1] })]));
    });
    box.appendChild(h('div', { class: 'row sb', style: 'margin:6px 0;font-size:16px' }, [h('b', { text: q.net >= 0 ? '實付' : '找回' }), h('b', { id: 'swapnet', text: fmt(Math.abs(q.net)) })]));
    box.appendChild(h('div', { class: 'sm', style: 'margin-top:6px' }, [h('b', { text: '會移過去的裝備（' + q.keep.length + ' 件）' })]));
    box.appendChild(h('div', { class: 'sm dim', 'data-keep': q.keep.length, text: q.keep.length ? q.keep.map(nm).join('、') : '（沒有）' }));
    box.appendChild(h('div', { class: 'sm', style: 'margin-top:6px' }, [h('b', { text: '會賣掉的裝備（' + q.sell.length + ' 件）' })]));
    box.appendChild(h('div', { class: 'sm dim', 'data-sell': q.sell.length, text: q.sell.length ? q.sell.map(function (x) { return nm(x) + '（+' + fmt(x.value) + '）'; }).join('、') : '（沒有）' }));
    box.appendChild(h('div', { class: 'sm', style: 'margin-top:6px', text: '貨艙：' + q.used + '／' + q.newCap + ' 格　耗時 ' + q.hours + ' 小時' }));
    if (!q.ok) box.appendChild(h('div', { class: 'bad sm', id: 'swapwhy', style: 'margin-top:6px', text: q.reason }));
    box.appendChild(h('div', { class: 'row', style: 'margin-top:10px' }, [h('button', { class: 'btn', id: 'confirmSwap', disabled: !q.ok, text: '確認換船', onclick: function () { closeModal(); act(G.swapShip(S, hullId)); } }), h('button', { class: 'btn sec', text: '取消', onclick: closeModal })]));
    modal(box);
  }

  function viewYard(v) {
    var fc = G.dockedFac(S), any = false;
    if (!fc) { v.appendChild(h('div', { class: 'card', text: '你還沒停靠，沒有船塢服務。' })); return; }
    var bc = bountyCard(); if (bc) { v.appendChild(bc); any = true; }
    var q = G.repairQuote(S);
    if (q.ok) { any = true; yardRepair(v, q); }
    if (G.hasService(S, 'shipyard')) { any = true; yardShop(v); }
    var hc = cargoCard(); if (hc) { any = true; v.appendChild(hc); }
    if (G.hasService(S, 'loan')) { any = true; yardLoan(v); }
    if (G.hasService(S, 'insurance')) { any = true; yardInsurance(v); }
    if (!any) v.appendChild(h('div', { class: 'card', text: '這裡沒有船塢服務。' }));
  }
  function yardRepair(v, q) {
    var mx = G.shipMax(S), card = h('div', { class: 'card' }, [h('h3', { text: '修理' }),
    h('div', null, ['船體 ' + S.ship.hp.hull + '/' + mx.hull]), bar(S.ship.hp.hull, mx.hull, '#4fd18b'),
    h('div', null, ['裝甲 ' + S.ship.hp.armor + '/' + mx.armor]), bar(S.ship.hp.armor, mx.armor, '#4fb3ff'),
    h('div', { class: 'sm dim', text: '每點 ' + G.REPAIR_COST + ' 信用點；每 10 點耗時 1 小時（至少 1 小時）。' }),
    q.perk ? h('div', { class: 'sm ok', id: 'repairPerk', text: '〔' + q.perk + '的人情價〕修理費打折' }) : null]);
    function btn(label, what, pts, cost) {
      return h('button', { class: 'btn' + (what === 'all' ? '' : ' sec'), style: 'margin:8px 8px 0 0', disabled: pts <= 0, text: label + (pts > 0 ? '（' + fmt(cost) + '）' : ''), onclick: function () { act(G.repair(S, what)); } });
    }
    card.appendChild(btn('全部修好', 'all', q.dh + q.da, q.costH + q.costA)); card.appendChild(btn('只修船體', 'hull', q.dh, q.costH)); card.appendChild(btn('只修裝甲', 'armor', q.da, q.costA));
    v.appendChild(card);
  }
  function yardLoan(v) {
    var L = S.loan, card = h('div', { class: 'card', id: 'loancard' }, [h('h3', { text: '船貸' })]);
    if (L.balance <= 0) { card.appendChild(h('div', { class: 'ok', text: '船貸已經還清了。' })); v.appendChild(card); return; }
    var req = G.loanRequired(S), short = G.loanShort(S), hl = G.loanHoursLeft(S);
    card.appendChild(h('div', { html: '餘額 <b>' + fmt(L.balance) + '</b>' }));
    card.appendChild(h('div', { html: '本期應繳 <b>' + fmt(req) + '</b>，本期已繳 <b>' + fmt(L.paid) + '</b>' + (short > 0 ? '，還差 <b class="warn">' + fmt(short) + '</b>' : '，<span class="ok">本期已繳清</span>') }));
    card.appendChild(h('div', { class: 'sm ' + (hl <= 24 ? 'warn' : 'dim'), text: '下次到期：' + G.fmtClock(L.nextDue) + '（還有 ' + hl + ' 小時）' }));
    if (L.missed > 0) card.appendChild(h('div', { class: 'sm bad', text: '已連續逾期 ' + L.missed + ' 期。' }));
    card.appendChild(h('div', { class: 'sm dim', style: 'margin-top:4px', text: '每 7 天一期，到期先加 2% 利息；沒繳要加 500 違約金、聯盟聲望 −5。到期時間不會因為提早繳而延後。' }));
    var row = h('div', { class: 'row wrap', style: 'margin-top:8px' });
    row.appendChild(h('button', { class: 'btn', id: 'payPeriod', disabled: short <= 0 || S.money < short, text: '繳本期' + (short > 0 ? '（' + fmt(short) + '）' : ''), onclick: function () { act(G.payLoanPeriod(S)); } }));
    card.appendChild(row);
    var inp = h('input', { type: 'number', id: 'loanAmt', min: 1, inputmode: 'numeric', placeholder: '多還一點：輸入金額', value: loanAmt, oninput: function (e) { loanAmt = e.target.value; } });
    card.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, [inp, h('button', { class: 'btn sec', id: 'payExtra', style: 'white-space:nowrap', text: '還款', onclick: function () {
      var r = G.payLoan(S, parseInt(loanAmt, 10) || 0); if (r.ok) loanAmt = ''; act(r);
    } })]));
    v.appendChild(card);
  }
  function yardInsurance(v) {
    var card = h('div', { class: 'card', id: 'inscard' }, [h('h3', { text: '保險' })]), p = G.insurancePremium(S);
    if (G.insured(S)) card.appendChild(h('div', { class: 'ok', text: '保險有效，到' + G.fmtClock(S.insurance.until) + '。' }));
    else card.appendChild(h('div', { class: 'dim', text: '目前沒有保險。' }));
    card.appendChild(h('div', { class: 'sm dim', style: 'margin:4px 0', text: '保費是目前船體價格的 5%，保 7 天。有保險時船被擊毀：不扣現金、船貸不加，領回同型船體與起始配備（貨物與待領賞金照樣全失）；理賠後保險失效。沒保險：現金剩 30%、換成只有 1 門雷射的舊驢、船貸 +8,000。' }));
    card.appendChild(h('button', { class: 'btn', id: 'buyIns', disabled: G.insured(S) || S.money < p, text: '投保 7 天（' + fmt(p) + '）', onclick: function () { act(G.buyInsurance(S)); } }));
    v.appendChild(card);
  }

  // ---------- 更多 ----------
  function sect(key, title, fn) {
    var d = h('details', moreOpen[key] ? { open: true } : null, [h('summary', { text: title })]);
    d.addEventListener('toggle', function () { moreOpen[key] = d.open; });
    var body = h('div'); fn(body); d.appendChild(body); return d;
  }
  function shipCard(b) {
    var D = G.data(), H = D.hulls[S.ship.hull], mx = G.shipMax(S);
    var row = h('div', { class: 'row', style: 'gap:12px;align-items:flex-start' }, [
      SHIP_IMG[S.ship.hull] ? h('div', { style: 'width:132px;flex:none' }, [picBox('ship_' + S.ship.hull, 'aspect-ratio:1/1;border-radius:10px', 'center', { id: 'shippic' })]) : null,
      h('div', { style: 'flex:1;min-width:0' }, [h('b', { text: '「' + S.ship.name + '」' }), h('div', { class: 'sm dim', text: H.name + '級' + H.class }),
        h('div', { class: 'sm', style: 'margin-top:6px', text: '船體 ' + S.ship.hp.hull + '／' + mx.hull }), h('div', { class: 'sm', text: '裝甲 ' + S.ship.hp.armor + '／' + mx.armor }),
        h('div', { class: 'sm', text: '貨艙 ' + (G.cargoCap(S) - G.cargoFree(S)) + '／' + G.cargoCap(S) })])]);
    b.appendChild(row);
  }
  function viewMore(v) {
    v.appendChild(sect('ship', '船況', shipCard));
    v.appendChild(sect('log', '航行日誌', function (b) {
      var L = S.log.slice().reverse(); if (!L.length) b.appendChild(h('div', { class: 'dim', text: '還沒有紀錄。' }));
      L.slice(0, 60).forEach(function (e) { b.appendChild(h('div', { class: 'sm', style: 'padding:3px 0;border-bottom:1px solid var(--line)' }, [h('span', { class: 'dim', text: G.fmtClock(e.t) + '　' }), e.x])); });
      if (L.length > 60) b.appendChild(h('div', { class: 'dim sm', text: '（只顯示最新 60 筆）' }));
    }));
    v.appendChild(sect('rep', '聲望與船長', function (b) {
      var D = G.data(), p = S.player, org = G.ORIGINS.filter(function (o) { return o.id === p.origin; })[0];
      b.appendChild(h('div', { html: '<b>' + p.name + '</b>　' + (p.gender || '') + '　' + (org ? org.name : '') }));
      b.appendChild(h('div', { class: 'sm dim', text: '座艦：「' + S.ship.name + '」（' + D.hulls[S.ship.hull].name + '級' + D.hulls[S.ship.hull].class + '）' }));
      if (p.look) b.appendChild(h('div', { class: 'sm dim', text: p.look }));
      b.appendChild(h('div', { class: 'sec-t', text: '能力（用得越多，升級越快，升級直接加能力）' }));
      G.SKILLS.forEach(function (sk) {
        var i = G.skillInfo(S, sk);
        b.appendChild(h('div', { class: 'row sb', 'data-skill': sk, style: 'padding:3px 0' }, [h('span', null, [h('b', { text: i.name + ' ' + i.stat })]),
        h('span', { class: 'sm ' + (i.next == null ? 'ok' : 'dim'), text: i.next == null ? '經驗 ' + i.xp + '，已達上限' : '經驗 ' + i.xp + '／' + i.next + '，距離下一級還差 ' + i.need })]));
        b.appendChild(bar(i.next == null ? 1 : i.xp - G.XP_CUM[i.level - 1], i.next == null ? 1 : i.next - G.XP_CUM[i.level - 1], '#4fb3ff'));
      });
      b.appendChild(h('div', { class: 'sec-t', text: '聲望' }));
      D.factionList.filter(function (f) { return f.id !== 'rust'; }).forEach(function (f) {
        var val = S.reputation[f.id] || 0, t = G.tierOf(val);
        b.appendChild(h('div', { class: 'row sb', style: 'padding:4px 0' }, [h('span', { html: '<span style="color:' + f.color + '">●</span> ' + f.name }), h('span', null, [h('b', { text: t.name }), h('span', { class: 'dim sm', text: '（' + val + '）' })])]));
      });
      var bt = G.bountyTotal(S);
      b.appendChild(h('div', { class: 'sm dim', style: 'margin-top:6px', text: '船貸餘額 ' + fmt(S.loan.balance) + (bt ? '｜待領賞金 ' + fmt(bt) + '（到艦隊或聯盟設施領取）' : '') }));
    }));
    v.appendChild(sect('bar', '酒吧', function (b) {
      var M = Mi(), fac = G.dockedFac(S), ids = fac ? M.npcsAt(S, fac.id) : [];
      if (!fac || fac.services.indexOf('bar') < 0) { b.appendChild(h('div', { class: 'dim', text: !fac ? '你還沒停靠，沒有酒吧。' : '這裡沒有酒吧。' })); return; }
      b.appendChild(h('div', { class: 'sm dim', text: fac.name + '的酒吧' }));
      if (!ids.length) { b.appendChild(h('div', { class: 'dim', text: '今天沒有你認識的人在這裡。' })); return; }
      ids.forEach(function (id) {
        var n = M.npcInfo(S, id), box = h('div', { class: 'mis', 'data-npc': id }, [
          h('div', { class: 'hd' }, [h('b', { text: n.name }), h('span', { class: 'tag n', text: n.stage + '（好感 ' + n.aff + '）' })]),
          h('div', { class: 'sm dim', text: n.role }),
          h('div', { class: 'sm', text: '委託進度：' + n.step + '/3' + (n.active ? '｜進行中：' + n.active.name : '') })]);
        if (n.pending === 'talk') {
          box.appendChild(h('div', { class: 'sm warn', style: 'margin-top:4px', text: '任務完成了，回去找她談。' }));
          box.appendChild(h('button', { class: 'btn sm', 'data-talkdone': id, style: 'margin-top:6px', text: '談完了', onclick: function () { actN(M.npcTalkDone(S, id), function () { return '【委託】我和' + n.name + '談完了她的委託。'; }); } }));
        } else if (n.step >= 3) box.appendChild(h('div', { class: 'sm ok', text: '委託鏈已經走完。' }));
        else {
          box.appendChild(h('div', { class: 'sm', style: 'margin-top:4px', text: '下一段：' + (n.tpl ? n.tpl.name.replace(/^.*的委託・/, '') : '（尚無）') + '（需要好感 ' + n.need + '）' }));
          box.appendChild(h('button', { class: 'btn sm', 'data-take': id, disabled: !n.canTake, style: 'margin-top:6px', text: n.canTake ? '接下委託' : '還不能接', onclick: function () { actN(M.npcTake(S, id), function (r) { return r.mission ? '【委託】我接下了' + n.name + '的委託「' + r.mission.name + '」。' : null; }); } }));
          if (!n.canTake) box.appendChild(h('span', { class: 'sm dim', style: 'margin-left:8px', text: n.reason }));
        }
        if (S.settings && S.settings.test) {
          box.appendChild(h('div', { class: 'row wrap', style: 'margin-top:6px;gap:6px' }, [h('span', { class: 'sm warn', text: '測試：' })].concat([[-5, '−5'], [5, '＋5'], [20, '＋20'], [100, '拉滿']].map(function (x) {
            return h('button', { class: 'btn sec sm', 'data-aff': id + ':' + x[0], text: x[1], onclick: function () { act(M.npcAdjust(S, id, x[0])); } });
          }))));
        }
        b.appendChild(box);
      });
    }));
    v.appendChild(sect('settings', '設定', function (b) {
      b.appendChild(h('label', { class: 'row', style: 'gap:8px;align-items:center' }, [h('input', { type: 'checkbox', id: 'testMode', checked: !!(S.settings && S.settings.test), onchange: function (e) { S.settings = S.settings || {}; S.settings.test = e.target.checked; persist(); render(); } }), h('span', { text: '測試模式（顯示調整好感的測試按鈕）' })]));
      b.appendChild(h('div', { class: 'sm dim', text: '給開發測試用，一般玩家不需要打開。' }));
      b.appendChild(h('label', { text: '親密場景（會隨航行資料送給 AI）' }));
      b.appendChild(h('div', { class: 'seg' }, ['詳寫', '淡出'].map(function (x) {
        return h('button', { class: 'btn sm ' + (S.settings.intimacy === x ? '' : 'sec'), 'data-intimacy': x, text: x, onclick: function () { S.settings.intimacy = x; persist(); render(); } });
      })));
      b.appendChild(h('label', { class: 'row', style: 'gap:8px;align-items:center' }, [h('input', { type: 'checkbox', id: 'everyMode', checked: !!S.settings.every, onchange: function (e) { S.settings.every = e.target.checked; persist(); render(); } }), h('span', { text: '每個動作都請 AI 演出（每次停靠都送出）' })]));
    }));
    v.appendChild(sect('save', '存檔', function (b) {
      var ta = h('textarea', { placeholder: '匯出的存檔會出現在這裡；要匯入時把存檔文字貼在這裡' });
      b.appendChild(h('div', { class: 'sm dim', text: '遊戲會自動存在這個瀏覽器裡。換裝置或想備份，用下面的匯出。' }));
      b.appendChild(h('div', { class: 'row', style: 'margin:8px 0' }, [
        h('button', { class: 'btn sm', text: '匯出（複製）', onclick: function () { ta.value = G.exportSave(S); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { } if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(function () { toast('已複製到剪貼簿'); }, function () { toast(ok ? '已複製' : '請手動複製文字框的內容'); }); else toast(ok ? '已複製' : '請手動複製文字框的內容'); } }),
        h('button', { class: 'btn sec sm', text: '匯入', onclick: function () {
          var r = G.importSave(ta.value.trim()); if (!r.ok) { toast('匯入失敗：' + r.msg + '（目前的進度沒有改動）'); return; }
          S = r.save; persist(); toast('匯入完成'); render();
        } }),
        h('button', { class: 'btn red sm', text: '重來', onclick: confirmReset })]));
      b.appendChild(ta);
    }));
    v.appendChild(sect('convs', '對話存檔', function (b) {
      var ids = cidx().slice().reverse();
      b.appendChild(h('div', { class: 'sm dim', text: '每個對話各存一份進度，最多 6 份。切回舊對話時會自動載入。' }));
      if (!ids.length) b.appendChild(h('div', { class: 'dim', text: '還沒有。' }));
      ids.forEach(function (id) {
        var raw = null, sv = null; try { raw = localStorage.getItem('xy.c.' + id); sv = raw && JSON.parse(raw); } catch (e) { }
        if (!sv) return;
        b.appendChild(h('div', { class: 'row sb', 'data-conv': id, style: 'padding:5px 0;border-bottom:1px solid var(--line);gap:6px' }, [
          h('span', { class: 'sm', text: '…' + String(id).slice(-6) + '｜' + G.fmtClock(sv.t || 0) + '｜信用 ' + fmt(sv.money || 0) + (S.convId === id ? '（目前）' : '') }),
          h('span', null, [h('button', { class: 'btn sm', 'data-conv-load': id, disabled: S.convId === id, text: '載入', onclick: function () {
              var bk = loadConv(id); if (!bk) { toast('這份存檔讀不了。'); return; }
              var cur = lastConvId || S.convId || id; persist(); S = bk; S.convId = cur; Mis().ensure(S); persist(); lastStory = null; toast('已載入這份進度，之後存在目前的對話裡。'); render(); } }),
            h('button', { class: 'btn sec sm', style: 'margin-left:6px', 'data-conv-del': id, text: '刪除', onclick: function () { dropConv(id); render(); } })])]));
      });
    }));
    v.appendChild(sect('ai', '和 AI 的對話', function (b) {
      b.appendChild(h('div', { class: 'sm dim', text: Br.live ? '艦橋會在每次行動時自動把航行資料附給 AI，下面只是讓你看看送出的內容。' : '目前不在對話裡（直接用網頁開啟），航行資料只是整理成文字給你看。' }));
      b.appendChild(h('div', { class: 'row', style: 'margin:8px 0' }, [h('button', { class: 'btn sm', id: 'saveStory', disabled: !Br.live || busy, text: '📜 存劇情摘要', onclick: function () { sendFree('【劇情存檔】請依約定格式寫目前的劇情摘要。'); } })]));
      if (S.storySummary) { var sa = h('textarea', { readonly: true, id: 'storySum', style: 'min-height:140px' }); sa.value = S.storySummary; b.appendChild(h('div', { class: 'sec-t', text: '已存的劇情摘要' })); b.appendChild(sa); }
      var ta = h('textarea', { readonly: true, style: 'min-height:200px' }); ta.value = G.navDataText(S);
      b.appendChild(h('div', { class: 'sec-t', text: '航行資料' })); b.appendChild(ta);
    }));
  }
  function confirmReset() {
    var inp = h('input', { placeholder: '輸入「重來」' });
    modal(h('div', null, [h('h3', { text: '真的要重來嗎？' }), h('div', { class: 'sm dim', text: '目前的進度會全部消失。想確認的話，請輸入「重來」兩個字。' }), h('div', { style: 'margin:10px 0' }, [inp]),
    h('div', { class: 'row' }, [h('button', { class: 'btn red', text: '確定重來', onclick: function () {
      if (inp.value.trim() !== '重來') { toast('要輸入「重來」才會清除。'); return; }
      try { localStorage.removeItem(G.SAVE_KEY); } catch (e) { } S = null; tab = 'map'; closeModal(); render();
    } }), h('button', { class: 'btn sec', text: '取消', onclick: closeModal })])]));
  }

  // ---------- 戰鬥 ----------
  var ANGLE = { '0': '對頭', '1': '你佔側位', '2': '你咬住他', '-1': '他佔側位', '-2': '他咬住你' };
  var MV_HINT = { approach: '縮短距離', open: '拉開距離', flank: '搶側位（要先點選敵艦）', tail: '搶到他背後（要先點選敵艦，較難）', evade: '難被打中', flee: '全速逃，充能快，但船尾朝敵' };
  function noShield(o) { return !(o.me.maxShieldF + o.me.maxShieldR > 0); }
  function initAlloc(o) {
    var E = o.energy, gE = o.guns.reduce(function (a, g) { return a + g.energy; }, 0), w = Math.min(gE, Math.max(0, E - 2)), rest = E - w;
    if (noShield(o)) return { w: w, s: 0, e: rest }; // 沒有護盾：護盾能量是白放的，全給引擎
    var s = Math.ceil(rest / 2);
    return { w: w, s: s, e: rest - s };
  }
  function renderBattle() {
    var st = S.battle.state, o = C.options(st), el = $('battle'), inn = el.firstChild, foot = $('bfoot');
    var nosh = noShield(o);
    el.style.display = 'block'; var keep = el.scrollTop; inn.innerHTML = ''; foot.innerHTML = '';
    if (!B.alloc || B.alloc.w + B.alloc.s + B.alloc.e !== o.energy || (nosh && B.alloc.s)) B.alloc = initAlloc(o);
    if (!st.over) {
      if (!o.targets.some(function (t) { return t.id === B.target; })) B.target = o.targets[0] ? o.targets[0].id : null;
    }
    inn.appendChild(h('div', { class: 'row sb', style: 'margin:4px 0 8px' }, [h('b', { text: '第 ' + st.turn + ' 回合' }), h('span', { class: 'dim sm', text: '點敵艦卡片＝選為目標' })]));

    // 敵艦
    st.foes.forEach(function (f) {
      var t = o.targets.filter(function (x) { return x.id === f.id; })[0], gone = !t;
      var card = h('div', { class: 'foe' + (!gone && B.target === f.id ? ' sel' : ''), style: gone ? 'opacity:.4' : '', onclick: function () { if (!gone && !st.over) { B.target = f.id; renderBattle(); } } });
      card.appendChild(h('div', { class: 'row sb' }, [h('b', { text: f.name }), h('span', { class: 'sm', text: gone ? (f.fled ? '已逃走' : '已擊毀') : '距離 ' + t.rangeName + '｜' + ANGLE[String(t.adv)] })]));
      if (!gone) {
        if (f.maxShieldF + f.maxShieldR > 0) {
          card.appendChild(h('div', { class: 'sm dim', text: '護盾 前 ' + t.shieldF + '／' + f.maxShieldF + '　後 ' + t.shieldR + '／' + f.maxShieldR }));
          card.appendChild(bar(t.shieldF + t.shieldR, f.maxShieldF + f.maxShieldR, '#4fb3ff'));
        }
        card.appendChild(h('div', { class: 'sm dim', text: '裝甲 ' + t.armor + '/' + t.maxArmor + '　船體 ' + t.hull + '/' + t.maxHull }));
        card.appendChild(bar(t.armor, t.maxArmor, '#ffb347')); card.appendChild(bar(t.hull, t.maxHull, '#ff6b6b'));
      }
      inn.appendChild(card);
    });
    // 我方
    var m = o.me, mine = h('div', { class: 'card' }, [h('b', { text: '你的船' })]);
    if (!nosh) { mine.appendChild(h('div', { class: 'sm dim', text: '護盾 前 ' + m.shieldF + '／' + m.maxShieldF + '　後 ' + m.shieldR + '／' + m.maxShieldR })); mine.appendChild(bar(m.shieldF + m.shieldR, m.maxShieldF + m.maxShieldR, '#4fb3ff')); }
    else mine.appendChild(h('div', { class: 'sm warn', text: '沒有裝護盾。' }));
    [h('div', { class: 'sm dim', text: '裝甲 ' + m.armor + '/' + m.maxArmor + '　船體 ' + m.hull + '/' + m.maxHull }), bar(m.armor, m.maxArmor, '#ffb347'), bar(m.hull, m.maxHull, '#4fd18b'),
    h('div', { class: 'sm', text: '短躍充能 ' + Math.min(o.escape.charge, o.escape.need) + '/' + o.escape.need + '（敵人在「遠」距離時才會充能，貼身會中斷）' })].forEach(function (x) { mine.appendChild(x); });
    inn.appendChild(mine);

    if (st.over) { renderBattleEnd(inn, foot, st); el.scrollTop = keep; return; }

    // 1. 機動
    var c1 = h('div', { class: 'card' }, [h('b', { text: '① 機動' }), h('div', { class: 'sm dim', style: 'margin-bottom:6px', text: B.m ? MV_HINT[B.m] : '選一個動作' })]);
    var mv = h('div', { class: 'mv' });
    o.maneuvers.forEach(function (x) {
      mv.appendChild(h('button', { class: 'btn ' + (B.m === x.id ? '' : 'sec'), text: x.name, onclick: function () { B.m = x.id; renderBattle(); } }));
    });
    c1.appendChild(mv); inn.appendChild(c1);

    // 2. 開火
    var needW = 0;
    var c2 = h('div', { class: 'card' }, [h('b', { text: '② 開火' })]);
    if (!o.guns.length) c2.appendChild(h('div', { class: 'dim sm', text: '沒有武器。' }));
    o.guns.forEach(function (g) {
      var tid = B.ftarget[g.idx] && o.targets.some(function (t) { return t.id === B.ftarget[g.idx]; }) ? B.ftarget[g.idx] : B.target;
      var t = o.targets.filter(function (x) { return x.id === tid; })[0], why = null;
      if (!t) why = '沒有目標';
      else if (g.bands.indexOf(t.range) < 0) why = '射程不到';
      else if (!t.guns[g.idx].ok) why = '不在前方';
      else if (B.m === 'flee' && g.arc === 'front') why = '全速脫離時打不到';
      var checked = !!B.fire[g.idx] && !why;
      if (!why && !checked && usedW() + g.energy > B.alloc.w) why = '能量不夠';
      if (checked) needW += g.energy;
      function usedW() { return o.guns.reduce(function (a, x) { return a + (B.fire[x.idx] && x.idx !== g.idx ? x.energy : 0); }, 0); }
      var row = h('div', { class: 'gun' + (why ? ' off' : '') }, [
        h('input', { type: 'checkbox', checked: checked, disabled: !!why, onchange: function (e) { B.fire[g.idx] = e.target.checked; renderBattle(); } }),
        h('div', { class: 'grow' }, [h('div', { text: g.name + (g.arc === 'turret' ? '（砲塔）' : '') }), h('div', { class: 'sm ' + (why ? 'warn' : 'dim'), text: why || '用 ' + g.energy + ' 點武器能量' })])]);
      if (o.targets.length > 1) {
        var sel = h('select', { onchange: function (e) { B.ftarget[g.idx] = e.target.value; renderBattle(); } }, o.targets.map(function (x) { return h('option', { value: x.id, text: x.name, selected: x.id === tid }); }));
        row.appendChild(sel);
      }
      c2.appendChild(row);
    });
    o.missiles.forEach(function (ms) {
      var tid = B.target, t = o.targets.filter(function (x) { return x.id === tid; })[0], tm = t && t.missiles[ms.idx];
      var why = !t ? '沒有目標' : ms.ammo <= 0 ? '沒彈藥' : !tm.ok ? '不在前方或射程不到' : null, key = 'm' + ms.idx;
      c2.appendChild(h('div', { class: 'gun' + (why ? ' off' : '') }, [h('input', { type: 'checkbox', checked: !!B.fire[key] && !why, disabled: !!why, onchange: function (e) { B.fire[key] = e.target.checked; renderBattle(); } }),
      h('div', null, [h('div', { text: ms.name + '（剩 ' + ms.ammo + '）' }), h('div', { class: 'sm ' + (why ? 'warn' : 'dim'), text: why || '要連續鎖定 ' + ms.need + ' 回合，目前 ' + (tm ? tm.lock : 0) })])]));
    });
    inn.appendChild(c2);

    // 3. 能量（沒有護盾就不顯示護盾那一條）
    var c3 = h('div', { class: 'card' }, [h('b', { text: '③ 能量分配（共 ' + o.energy + ' 點）' })]);
    var rows = [['w', '武器', '#ff9f43']]; if (!nosh) rows.push(['s', '護盾', '#4fb3ff']); rows.push(['e', '引擎', '#4fd18b']);
    rows.forEach(function (k) {
      c3.appendChild(h('div', { class: 'eb', 'data-energy': k[0] }, [h('span', { class: 'l', text: k[1] }), h('button', { class: 'btn sec b', text: '−', onclick: function () { shift(k[0], -1); } }), bar(B.alloc[k[0]], o.energy, k[2]),
      h('button', { class: 'btn sec b', text: '＋', onclick: function () { shift(k[0], 1); } }), h('b', { text: B.alloc[k[0]], style: 'width:20px;text-align:right' })]));
    });
    c3.appendChild(h('div', { class: 'sm ' + (needW > B.alloc.w ? 'bad' : 'dim'), text: '勾選的武器需要 ' + needW + ' 點（武器能量 ' + B.alloc.w + '）。' + (nosh ? '' : '護盾能量決定回充；') + '引擎能量讓你更難被打中、搶位更容易。' }));
    inn.appendChild(c3);
    function shift(k, d) {
      var keys = nosh ? ['w', 'e'] : ['w', 's', 'e'], a = B.alloc;
      if (d > 0) { var from = keys.filter(function (x) { return x !== k && a[x] > 0; }).sort(function (x, y) { return a[y] - a[x]; })[0]; if (!from) return; a[from]--; a[k]++; }
      else { if (a[k] <= 0) return; var to = keys.filter(function (x) { return x !== k; }).sort(function (x, y) { return a[x] - a[y]; })[0]; a[k]--; a[to]++; }
      renderBattle();
    }

    // 紀錄
    var lastT = st.log.length ? st.log[st.log.length - 1].t : 1, logc = h('div', { class: 'card' }, [h('div', { class: 'row sb' }, [h('b', { text: '戰鬥紀錄' }), h('button', { class: 'btn sec sm', text: B.all ? '只看本回合' : '看全部', onclick: function () { B.all = !B.all; renderBattle(); } })])]);
    st.log.filter(function (e) { return B.all || e.t === lastT; }).forEach(function (e) { logc.appendChild(h('div', { class: 'logl ' + e.k, text: e.x })); });
    inn.appendChild(logc);

    // 確認鈕
    var bad = (B.m === 'flank' || B.m === 'tail') && !B.target;
    var btn = h('button', { class: 'btn', style: 'width:100%', text: B.m ? '確認這回合' : '先選一個機動', disabled: !B.m || bad || needW > B.alloc.w, onclick: confirmTurn });
    foot.appendChild(btn);
    el.scrollTop = keep;

    function confirmTurn() {
      var fire = [], missile = [];
      o.guns.forEach(function (g) { if (B.fire[g.idx]) fire.push({ gun: g.idx, target: B.ftarget[g.idx] && o.targets.some(function (t) { return t.id === B.ftarget[g.idx]; }) ? B.ftarget[g.idx] : B.target }); });
      o.missiles.forEach(function (ms) { if (B.fire['m' + ms.idx]) missile.push({ idx: ms.idx, target: B.target }); });
      G.battleStep(S, { m: B.m, target: B.target, alloc: { w: B.alloc.w, s: B.alloc.s, e: B.alloc.e }, fire: fire, missile: missile });
      B.m = null; B.fire = {}; B.ftarget = {}; persist(); renderBattle(); $('battle').scrollTop = 0;
    }
  }
  function renderBattleEnd(inn, foot, st) {
    var sm = C.summary(st), title = { win: '勝利', flee: '成功脫離', lose: '船被擊毀' }[st.over];
    var card = h('div', { class: 'card', style: 'border-color:' + (st.over === 'lose' ? 'var(--bad)' : 'var(--ok)') }, [h('h3', { text: title }), h('div', { class: 'sm', text: sm.text })]);
    if (sm.bounty) card.appendChild(h('div', { class: 'sm warn', text: '賞金要到艦隊或聯盟設施才能領。' }));
    if (st.over === 'lose') {
      if (G.insured(S)) card.appendChild(h('div', { class: 'sm ok', text: '有保險：領回同型船體與起始配備，現金和船貸都不受影響（貨物與待領賞金仍然全失，保險用掉了）。' }));
      else card.appendChild(h('div', { class: 'sm bad', text: '沒有保險：逃生艙會把你送回錨港，現金剩 30%，船換成只有 1 門雷射的舊驢，船貸 +8,000。' }));
    }
    inn.appendChild(card);
    var logc = h('div', { class: 'card' }, [h('b', { text: '最後幾筆紀錄' })]);
    st.log.slice(-10).forEach(function (e) { logc.appendChild(h('div', { class: 'logl ' + e.k, text: e.x })); }); inn.appendChild(logc);
    foot.appendChild(h('button', { class: 'btn', style: 'width:100%', text: '收下', onclick: function () {
      var sm0 = C.summary(S.battle.state), lost = S.battle.state.over === 'lose';
      var out = G.claimBattle(S); persist(); B = { m: null, target: null, fire: {}, ftarget: {}, alloc: null, all: false };
      tab = 'map';
      if (lost) narrate('【獲救】我的船被擊毀，逃生艙把我送回了錨港。' + (out && out.insured ? '有保險，領回了同型船體與起始配備，貨物全失。' : '沒有保險，現金只剩三成，領到一艘舊驢，船貸加了一筆。'));
      else narrate(sm0.text);
      render();
      if (out && out.notes.length) toast(out.notes.join(' '));
    } }));
  }

  // 背景音樂（Suno 嵌入）：第一次按 🎵 才載入播放器（瀏覽器要求使用者先點過才能自動播放）；
  // 之後按 🎵 只收合／展開播放器，iframe 不移除，所以切換分頁、收起艦橋都不會中斷音樂。
  var MUSIC_URL = 'https://suno.com/embed/75342d1f-182d-4c6b-8c91-7109636b9061?autoplay=1';
  (function () {
    var b = $('mbtn'), box = $('music'); if (!b || !box) return;
    b.onclick = function () {
      if (!box.firstChild) {
        var f = document.createElement('iframe');
        f.src = MUSIC_URL; f.setAttribute('allow', 'autoplay; encrypted-media'); f.setAttribute('title', '背景音樂');
        box.appendChild(f);
      }
      setShow(box.className !== 'show'); b.className = 'on';
    };
    // 播放器不要一直卡在畫面中間：展開 8 秒後自動收起（音樂照放）；點播放器以外的地方也會收起。
    // 點進播放器（焦點移到 iframe，window 會 blur）就取消自動收起，讓玩家操作。
    var tm = null;
    function setShow(on) {
      box.className = on ? 'show' : ''; clearTimeout(tm);
      if (on) tm = setTimeout(function () { setShow(false); }, 8000);
    }
    window.addEventListener('blur', function () { if (box.className === 'show') clearTimeout(tm); });
    document.addEventListener('click', function (e) {
      if (box.className === 'show' && e.target !== b && !box.contains(e.target)) setShow(false);
    }, true);
  })();
  boot();
})();
