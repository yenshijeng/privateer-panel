/* 星域私掠者 艦橋橋接 bridge.js v1.0（Sonnet-08）
 * 和載入器（外層頁面）用 postMessage 講話。協定第 11 節：
 *   面板 → 載入器：hello、ingested、fill、arm、hint、min
 *   載入器 → 面板：events、story、busy、consumed、fillres、conv、stat
 * 只接受 e.source === window.parent 且 d.xy === 1 的訊息。沒有外層頁面（直接開網頁）就是獨立模式。
 */
(function (root) {
  'use strict';
  var parent = null, handler = null, armedText = null, armedSig = null;
  var inFrame = false;
  try { inFrame = !!(root.parent && root.parent !== root); parent = inFrame ? root.parent : null; } catch (e) { inFrame = false; }

  function post(m) {
    if (!parent) return false;
    try { parent.postMessage(Object.assign({ xy: 1 }, m), '*'); return true; } catch (e) { return false; }
  }
  function onMessage(e) {
    var d = e.data;
    if (!d || d.xy !== 1 || !parent || e.source !== parent) return;
    if (handler) { try { handler(d); } catch (err) { if (root.console) console.error('bridge handler', err); } }
  }
  if (root.addEventListener) root.addEventListener('message', onMessage);

  var Bridge = {
    live: inFrame,                       // false＝獨立模式
    init: function (fn) { handler = fn; post({ t: 'hello' }); },
    reply: function (t, o) { return post(Object.assign({ t: t }, o || {})); },
    // 把一段文字填進聊天輸入框並送出（送出後載入器會自動切回聊天）
    send: function (text, opts) {
      opts = opts || {};
      return post({ t: 'fill', text: String(text), send: opts.send !== false, keep: !!opts.keep });
    },
    // 要求載入器在玩家自己打字時附上航行資料
    arm: function (navText, sig) {
      if (!parent) return;
      armedSig = sig;
      if (navText === armedText) return;
      armedText = navText;
      post({ t: 'arm', text: navText, tail: '' });
    },
    disarm: function () {
      if (!parent || armedText === null) return;
      armedText = null; armedSig = null;
      post({ t: 'arm', off: true });
    },
    armedSig: function () { return armedSig; },
    hint: function (s) { post({ t: 'hint', s: s }); },
    min: function () { post({ t: 'min' }); },
    want: function () { post({ t: 'want', open: true }); }
  };
  root.XYBridge = Bridge;
  if (typeof module !== 'undefined' && module.exports) module.exports = Bridge;
})(typeof window !== 'undefined' ? window : this);
