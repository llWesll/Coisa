/* Controles de toque (joystick virtual + botões) e ajustes.
 * Usa window.__k(code, down) definido em nodeshim.js (dispara KeyboardEvents reais no document).
 */
(function () {
  'use strict';
  var BR = window.AndroidBridge;
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, ESC: 27, SHIFT: 16, PGUP: 33, PGDN: 34 };

  // ------------------------------------------------------------ ajustes persistentes
  var S = { show: true, tapMove: false, dashToggle: true, opacity: 0.55, size: 1.0 };
  try {
    var saved = JSON.parse(localStorage.getItem('fh2.touch') || '{}');
    for (var k in saved) if (k in S) S[k] = saved[k];
  } catch (e) {}
  function save() { try { localStorage.setItem('fh2.touch', JSON.stringify(S)); } catch (e) {} }
  window.__tapMove = S.tapMove;

  // ------------------------------------------------------------ estilos
  var css = document.createElement('style');
  css.textContent =
    'html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;overscroll-behavior:none}' +
    '#fh2-ui{position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:99999;font-family:sans-serif;' +
    'padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0);' +
    'box-sizing:border-box;--s:1;--o:.55}' +
    '#fh2-ui .g{opacity:var(--o);transition:opacity .15s}' +
    '#fh2-ui.hide .g{display:none}' +
    '.fh2b{position:absolute;pointer-events:auto;border-radius:50%;background:rgba(255,255,255,.16);' +
    'border:2px solid rgba(255,255,255,.55);color:#fff;display:flex;align-items:center;justify-content:center;' +
    'font-weight:700;font-size:calc(5vmin*var(--s));-webkit-tap-highlight-color:transparent;touch-action:none;' +
    'width:calc(15vmin*var(--s));height:calc(15vmin*var(--s))}' +
    '.fh2b.sm{width:calc(9vmin*var(--s));height:calc(9vmin*var(--s));font-size:calc(3.6vmin*var(--s))}' +
    '.fh2b.on{background:rgba(255,255,255,.5)}' +
    '#fh2-zone{position:absolute;left:0;bottom:0;width:48%;height:72%;pointer-events:auto;touch-action:none}' +
    '#fh2-base{position:absolute;width:calc(28vmin*var(--s));height:calc(28vmin*var(--s));border-radius:50%;' +
    'border:2px solid rgba(255,255,255,.5);background:rgba(255,255,255,.08);pointer-events:none}' +
    '#fh2-knob{position:absolute;left:50%;top:50%;width:42%;height:42%;margin:-21% 0 0 -21%;border-radius:50%;' +
    'background:rgba(255,255,255,.4);border:2px solid rgba(255,255,255,.7)}' +
    '#fh2-gear{pointer-events:auto;opacity:.45}' +
    '#fh2-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:auto;background:rgba(15,15,15,.96);' +
    'color:#eee;border:1px solid #666;border-radius:12px;padding:16px 20px;min-width:260px;max-width:80vw;display:none;font-size:15px}' +
    '#fh2-panel label{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:10px 0}' +
    '#fh2-panel button{font-size:15px;padding:8px 14px;margin:8px 8px 0 0;border-radius:8px;border:1px solid #888;background:#333;color:#fff}' +
    '#fh2-panel input[type=range]{width:140px}';
  document.head.appendChild(css);

  // ------------------------------------------------------------ DOM
  var root = document.createElement('div');
  root.id = 'fh2-ui';
  root.innerHTML =
    '<div class="g" id="fh2-g">' +
    '<div id="fh2-zone"></div>' +
    '<div id="fh2-base"><div id="fh2-knob"></div></div>' +
    '<div class="fh2b" id="fh2-a" style="right:4vmin;bottom:21vmin">A</div>' +
    '<div class="fh2b" id="fh2-b" style="right:21vmin;bottom:11vmin">B</div>' +
    '<div class="fh2b" id="fh2-dash" style="right:4vmin;bottom:3vmin;font-size:calc(3.6vmin*var(--s))">CORRER</div>' +
    '<div class="fh2b sm" id="fh2-menu" style="right:2vmin;top:2vmin">☰</div>' +
    '<div class="fh2b sm" id="fh2-pgup" style="left:2vmin;top:2vmin">PgUp</div>' +
    '<div class="fh2b sm" id="fh2-pgdn" style="left:12.5vmin;top:2vmin">PgDn</div>' +
    '</div>' +
    '<div class="fh2b sm" id="fh2-gear" style="right:13vmin;top:2vmin">⚙</div>' +
    '<div id="fh2-panel">' +
    '<div style="font-weight:700;margin-bottom:6px">Controles</div>' +
    '<label>Mostrar controles <input type="checkbox" id="o-show"></label>' +
    '<label>Tocar na tela para andar <input type="checkbox" id="o-tap"></label>' +
    '<label>Correr alternado (toque liga/desliga) <input type="checkbox" id="o-dash"></label>' +
    '<label>Opacidade <input type="range" id="o-op" min="15" max="100"></label>' +
    '<label>Tamanho <input type="range" id="o-sz" min="70" max="150"></label>' +
    '<button id="o-close">Fechar</button><button id="o-exit">Sair do jogo</button>' +
    '</div>';
  document.body.appendChild(root);
  function $(id) { return document.getElementById(id); }

  // impede que os toques nos controles cheguem ao TouchInput do jogo (movimento por toque / clique)
  ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'mousemove', 'click', 'pointerdown', 'pointerup', 'pointermove', 'wheel'].forEach(function (t) {
    root.addEventListener(t, function (e) { e.stopPropagation(); });
  });

  function apply() {
    root.style.setProperty('--s', S.size);
    root.style.setProperty('--o', S.opacity);
    root.classList.toggle('hide', !S.show || padActive);
    window.__tapMove = S.tapMove;
    $('o-show').checked = S.show;
    $('o-tap').checked = S.tapMove;
    $('o-dash').checked = S.dashToggle;
    $('o-op').value = Math.round(S.opacity * 100);
    $('o-sz').value = Math.round(S.size * 100);
    placeBase(null);
  }

  // ------------------------------------------------------------ botões
  function key(code, down) { if (window.__k) window.__k(code, down, false); }

  function bindHold(el, code) {
    var tid = null;
    el.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (tid !== null) return;
      tid = e.changedTouches[0].identifier;
      el.classList.add('on');
      key(code, true);
    }, { passive: false });
    function end(e) {
      if (tid === null) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === tid) {
          e.preventDefault();
          tid = null;
          el.classList.remove('on');
          key(code, false);
          return;
        }
      }
    }
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  }
  bindHold($('fh2-a'), K.OK);
  bindHold($('fh2-b'), K.ESC);
  bindHold($('fh2-menu'), K.ESC);
  bindHold($('fh2-pgup'), K.PGUP);
  bindHold($('fh2-pgdn'), K.PGDN);

  // correr: segurar ou alternar
  var dashOn = false, dashTid = null;
  var dashEl = $('fh2-dash');
  dashEl.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (S.dashToggle) {
      dashOn = !dashOn;
      dashEl.classList.toggle('on', dashOn);
      key(K.SHIFT, dashOn);
    } else {
      dashTid = e.changedTouches[0].identifier;
      dashEl.classList.add('on');
      key(K.SHIFT, true);
    }
  }, { passive: false });
  function dashEnd(e) {
    if (S.dashToggle || dashTid === null) return;
    e.preventDefault();
    dashTid = null;
    dashEl.classList.remove('on');
    key(K.SHIFT, false);
  }
  dashEl.addEventListener('touchend', dashEnd, { passive: false });
  dashEl.addEventListener('touchcancel', dashEnd, { passive: false });

  // ------------------------------------------------------------ joystick flutuante
  var zone = $('fh2-zone'), base = $('fh2-base'), knob = $('fh2-knob');
  var stickTid = null, cx = 0, cy = 0;
  var dirs = { 37: false, 38: false, 39: false, 40: false };

  function setDir(code, on) {
    if (dirs[code] === on) return;
    dirs[code] = on;
    key(code, on);
  }
  function releaseDirs() { [37, 38, 39, 40].forEach(function (c) { setDir(c, false); }); }
  function baseSize() { return Math.min(window.innerWidth, window.innerHeight) * 0.28 * S.size; }
  function placeBase(pt) {
    var bs = baseSize();
    base.style.width = bs + 'px';
    base.style.height = bs + 'px';
    var x, y;
    if (pt) { x = pt.x; y = pt.y; }
    else { x = Math.min(window.innerWidth, window.innerHeight) * 0.04 + bs / 2 + 8; y = window.innerHeight - (Math.min(window.innerWidth, window.innerHeight) * 0.04 + bs / 2 + 8); }
    base.style.left = (x - bs / 2) + 'px';
    base.style.top = (y - bs / 2) + 'px';
    knob.style.transform = 'translate(0,0)';
    cx = x; cy = y;
  }
  function stickMove(t) {
    var dx = t.clientX - cx, dy = t.clientY - cy;
    var bs = baseSize(), R = bs / 2;
    var m = Math.sqrt(dx * dx + dy * dy);
    var dead = R * 0.28;
    if (m > R) { dx = dx / m * R; dy = dy / m * R; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    if (m < dead) { releaseDirs(); return; }
    var a = Math.atan2(dy, dx) * 180 / Math.PI; // y para baixo
    var aa = Math.abs(a);
    setDir(K.RIGHT, aa < 67.5);
    setDir(K.LEFT, aa > 112.5);
    setDir(K.DOWN, a > 22.5 && a < 157.5);
    setDir(K.UP, a < -22.5 && a > -157.5);
  }
  zone.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (stickTid !== null) return;
    var t = e.changedTouches[0];
    stickTid = t.identifier;
    placeBase({ x: t.clientX, y: t.clientY });
    stickMove(t);
  }, { passive: false });
  zone.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === stickTid) stickMove(e.changedTouches[i]);
    }
  }, { passive: false });
  function stickEnd(e) {
    if (stickTid === null) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === stickTid) {
        e.preventDefault();
        stickTid = null;
        releaseDirs();
        placeBase(null);
      }
    }
  }
  zone.addEventListener('touchend', stickEnd, { passive: false });
  zone.addEventListener('touchcancel', stickEnd, { passive: false });
  window.addEventListener('resize', function () { if (stickTid === null) placeBase(null); });

  // ------------------------------------------------------------ painel de ajustes
  var panel = $('fh2-panel');
  function openPanel(on) { panel.style.display = on ? 'block' : 'none'; }
  $('fh2-gear').addEventListener('touchstart', function (e) { e.preventDefault(); openPanel(panel.style.display !== 'block'); }, { passive: false });
  $('o-close').addEventListener('click', function () { openPanel(false); });
  $('o-exit').addEventListener('click', function () { if (BR) BR.exit(); });
  $('o-show').addEventListener('change', function () { S.show = this.checked; save(); apply(); });
  $('o-tap').addEventListener('change', function () { S.tapMove = this.checked; save(); apply(); });
  $('o-dash').addEventListener('change', function () {
    S.dashToggle = this.checked;
    if (dashOn) { dashOn = false; dashEl.classList.remove('on'); key(K.SHIFT, false); }
    save(); apply();
  });
  $('o-op').addEventListener('input', function () { S.opacity = this.value / 100; save(); apply(); });
  $('o-sz').addEventListener('input', function () { S.size = this.value / 100; save(); apply(); });

  // ------------------------------------------------------------ gamepad físico: esconde os controles
  var padActive = false;
  window.__padActive = function (on) {
    if (padActive === !!on) return;
    padActive = !!on;
    apply();
  };
  // um toque na tela (fora dos controles) volta a mostrar os controles
  document.addEventListener('touchstart', function () { if (padActive) window.__padActive(false); }, true);

  // ------------------------------------------------------------ toque no mapa: andar por toque desligado por padrão
  window.addEventListener('load', function () {
    if (window.Game_Temp && Game_Temp.prototype.setDestination) {
      var orig = Game_Temp.prototype.setDestination;
      Game_Temp.prototype.setDestination = function (x, y) {
        if (!window.__tapMove) return;
        return orig.call(this, x, y);
      };
    }
  });

  // solta tudo ao sair do app
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      releaseDirs();
      if (!S.dashToggle) key(K.SHIFT, false);
    }
  });

  apply();
})();
