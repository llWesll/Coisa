/* Controles de toque: joystick flutuante + botões configuráveis (mostrar/ocultar/arrastar).
 * Usa window.__k(code, down) definido em nodeshim.js (dispara KeyboardEvents reais no document).
 */
(function () {
  'use strict';
  var BR = window.AndroidBridge;
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 };

  // x,y = centro do botão em % da tela; s = tamanho em vmin
  var DEFS = [
    { id: 'a', label: 'A', code: 13, x: 92, y: 62, s: 15, t: 'hold', name: 'A – Confirmar / Interagir' },
    { id: 'b', label: 'B', code: 27, x: 83, y: 72, s: 15, t: 'hold', name: 'B – Cancelar / Menu' },
    { id: 'run', label: 'CORRER', code: 16, x: 93, y: 86, s: 13, t: 'run', name: 'Correr (liga/desliga)' },
    { id: 'shift', label: 'SHIFT', code: 16, x: 82, y: 90, s: 11, t: 'hold', name: 'Shift – Atirar / Moeda da sorte' },
    { id: 'menu', label: '\u2630', code: 27, x: 94.5, y: 8, s: 9, t: 'hold', name: 'Menu' },
    { id: 'pgup', label: 'PgUp', code: 33, x: 4, y: 8, s: 9, t: 'hold', name: 'PgUp (página anterior)' },
    { id: 'pgdn', label: 'PgDn', code: 34, x: 10.5, y: 8, s: 9, t: 'hold', name: 'PgDn (próxima página / pular)' },
    { id: 'e', label: 'E', code: 69, x: 85, y: 28, s: 11, t: 'hold', name: 'E – Atalho do jogo' },
    { id: 't', label: 'T', code: 84, x: 93, y: 28, s: 11, t: 'hold', name: 'T – Atalho do jogo' },
    { id: 'c', label: 'C', code: 67, x: 85, y: 42, s: 11, t: 'hold', name: 'C – Atalho do jogo' },
    { id: 'm', label: 'M', code: 77, x: 93, y: 42, s: 11, t: 'hold', name: 'M – Atalho do jogo' },
    { id: 'q', label: 'Q', code: 81, x: 4, y: 24, s: 9, t: 'hold', name: 'Q (página anterior)' },
    { id: 'w', label: 'W', code: 87, x: 10.5, y: 24, s: 9, t: 'hold', name: 'W (próxima página)' },
    { id: 'tab', label: 'TAB', code: 9, x: 4, y: 40, s: 9, t: 'hold', name: 'Tab' },
    { id: 'z', label: 'Z', code: 90, x: 10.5, y: 40, s: 9, t: 'hold', name: 'Z (confirmar)' },
    { id: 'x', label: 'X', code: 88, x: 4, y: 56, s: 9, t: 'hold', name: 'X (cancelar)' },
    { id: 'ctrl', label: 'CTRL', code: 17, x: 10.5, y: 56, s: 9, t: 'hold', name: 'Ctrl' }
  ];
  var DEFAULT_HIDDEN = { q: 1, w: 1, tab: 1, z: 1, x: 1, ctrl: 1 };
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  // ------------------------------------------------------------ ajustes persistentes
  var S = { show: true, tapMove: false, dashToggle: true, fps: false, opacity: 0.55, size: 1.0, hidden: copy(DEFAULT_HIDDEN), pos: {} };
  try {
    var saved = JSON.parse(localStorage.getItem('fh2.touch2') || '{}');
    for (var k in saved) if (k in S) S[k] = saved[k];
  } catch (e) {}
  function save() { try { localStorage.setItem('fh2.touch2', JSON.stringify(S)); } catch (e) {} }
  window.__tapMove = S.tapMove;

  var padActive = false, editing = false;

  // ------------------------------------------------------------ estilos
  var css = document.createElement('style');
  css.textContent =
    'html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;overscroll-behavior:none}' +
    '#fh2-ui{position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:99999;font-family:sans-serif;' +
    'padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0);' +
    'box-sizing:border-box;--s:1;--o:.55}' +
    '#fh2-ui .g{opacity:var(--o)}' +
    '#fh2-ui.hide .g{display:none}' +
    '.fh2b{position:absolute;pointer-events:auto;border-radius:50%;background:rgba(255,255,255,.16);' +
    'border:2px solid rgba(255,255,255,.55);color:#fff;display:flex;align-items:center;justify-content:center;' +
    'font-weight:700;-webkit-tap-highlight-color:transparent;touch-action:none;box-sizing:border-box;transform:translate(-50%,-50%);white-space:nowrap}' +
    '.fh2b.on{background:rgba(255,255,255,.5)}' +
    '#fh2-ui.editing .fh2b{border-style:dashed;border-color:#ffd54a;background:rgba(255,213,74,.18)}' +
    '#fh2-zone{position:absolute;left:0;bottom:0;width:40%;height:72%;pointer-events:auto;touch-action:none}' +
    '#fh2-ui.editing #fh2-zone{pointer-events:none}' +
    '#fh2-base{position:absolute;border-radius:50%;border:2px solid rgba(255,255,255,.5);background:rgba(255,255,255,.08);pointer-events:none}' +
    '#fh2-knob{position:absolute;left:50%;top:50%;width:42%;height:42%;margin:-21% 0 0 -21%;border-radius:50%;' +
    'background:rgba(255,255,255,.4);border:2px solid rgba(255,255,255,.7)}' +
    '#fh2-gear{pointer-events:auto;opacity:.45;width:9vmin;height:9vmin;font-size:4vmin}' +
    '#fh2-ui.editing #fh2-gear{display:none}' +
    '#fh2-bar{position:absolute;left:50%;top:2vmin;transform:translateX(-50%);pointer-events:auto;display:none;background:rgba(15,15,15,.92);' +
    'color:#ffd54a;border:1px solid #ffd54a;border-radius:10px;padding:8px 12px;font-size:14px;text-align:center}' +
    '#fh2-ui.editing #fh2-bar{display:block}' +
    '#fh2-bar button,#fh2-panel button{font-size:14px;padding:8px 12px;margin:6px 6px 0 0;border-radius:8px;border:1px solid #888;background:#333;color:#fff}' +
    '#fh2-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:auto;background:rgba(15,15,15,.96);' +
    'color:#eee;border:1px solid #666;border-radius:12px;padding:14px 18px;width:min(560px,86vw);max-height:88vh;overflow:auto;display:none;font-size:14px}' +
    '#fh2-panel label.r{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:8px 0}' +
    '#fh2-panel .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;margin:6px 0}' +
    '#fh2-panel .grid label{display:flex;align-items:center;gap:8px}' +
    '#fh2-panel h4{margin:12px 0 4px;font-size:14px;color:#ffd54a}' +
    '#fh2-panel input[type=range]{width:150px}' +
    '#fh2-fps{position:absolute;left:50%;top:0;transform:translateX(-50%);color:#0f0;font:bold 12px monospace;background:rgba(0,0,0,.5);padding:1px 6px;display:none}';
  document.head.appendChild(css);

  // ------------------------------------------------------------ DOM base
  var root = document.createElement('div');
  root.id = 'fh2-ui';
  root.innerHTML =
    '<div class="g" id="fh2-g">' +
    '<div id="fh2-zone"></div>' +
    '<div id="fh2-base"><div id="fh2-knob"></div></div>' +
    '<div id="fh2-btns"></div>' +
    '</div>' +
    '<div class="fh2b" id="fh2-gear" style="left:88%;top:8%">\u2699</div>' +
    '<div id="fh2-bar">Modo edição: arraste os botões para onde quiser<br>' +
    '<button id="e-done">\u2714 Concluir</button><button id="e-reset">\u21BA Restaurar padrão</button></div>' +
    '<div id="fh2-fps">FPS</div>' +
    '<div id="fh2-panel"></div>';
  document.body.appendChild(root);
  function $(id) { return document.getElementById(id); }

  // os toques nos controles não podem chegar ao TouchInput do jogo
  ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'mousemove', 'click', 'pointerdown', 'pointerup', 'pointermove', 'wheel'].forEach(function (t) {
    root.addEventListener(t, function (e) { e.stopPropagation(); });
  });

  // ------------------------------------------------------------ teclas
  function key(code, down) { if (window.__k) window.__k(code, down, false); }
  var shiftN = 0;
  function shift(on) {
    if (on) { if (shiftN++ === 0) key(16, true); }
    else if (shiftN > 0 && --shiftN === 0) key(16, false);
  }
  var runOn = false;

  // ------------------------------------------------------------ botões
  var btnWrap = $('fh2-btns');
  var btnEls = {};
  function posOf(d) { var p = S.pos[d.id]; return p ? p : { x: d.x, y: d.y }; }
  function layoutBtn(d) {
    var el = btnEls[d.id], p = posOf(d);
    var size = d.s * S.size;
    el.style.left = p.x + '%';
    el.style.top = p.y + '%';
    el.style.width = size + 'vmin';
    el.style.height = size + 'vmin';
    el.style.fontSize = (size * (d.label.length > 3 ? 0.23 : (d.label.length > 1 ? 0.3 : 0.4))) + 'vmin';
    el.style.display = S.hidden[d.id] ? 'none' : 'flex';
  }

  function makeButton(d) {
    var el = document.createElement('div');
    el.className = 'fh2b';
    el.textContent = d.label;
    btnEls[d.id] = el;
    btnWrap.appendChild(el);
    var tid = null;

    function press(on) {
      el.classList.toggle('on', on);
      if (d.code === 16) shift(on); else key(d.code, on);
    }
    function findTouch(e) {
      for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === tid) return e.changedTouches[i];
      return null;
    }
    el.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      if (editing) { tid = t.identifier; return; }
      if (d.t === 'run' && S.dashToggle) {
        runOn = !runOn;
        el.classList.toggle('on', runOn);
        shift(runOn);
        return;
      }
      if (tid !== null) return;
      tid = t.identifier;
      press(true);
    }, { passive: false });
    el.addEventListener('touchmove', function (e) {
      if (!editing || tid === null) return;
      e.preventDefault();
      var t = findTouch(e);
      if (!t) return;
      var x = Math.max(2, Math.min(98, t.clientX / window.innerWidth * 100));
      var y = Math.max(3, Math.min(97, t.clientY / window.innerHeight * 100));
      S.pos[d.id] = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
      layoutBtn(d);
    }, { passive: false });
    function end(e) {
      if (tid === null) return;
      var t = findTouch(e);
      if (!t) return;
      e.preventDefault();
      tid = null;
      if (editing) { save(); return; }
      press(false);
    }
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  }
  DEFS.forEach(makeButton);

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
  function vmin() { return Math.min(window.innerWidth, window.innerHeight); }
  function baseSize() { return vmin() * 0.28 * S.size; }
  function placeBase(pt) {
    var bs = baseSize();
    base.style.width = bs + 'px';
    base.style.height = bs + 'px';
    var x, y;
    if (pt) { x = pt.x; y = pt.y; }
    else { x = vmin() * 0.04 + bs / 2 + 8; y = window.innerHeight - (vmin() * 0.04 + bs / 2 + 8); }
    base.style.left = (x - bs / 2) + 'px';
    base.style.top = (y - bs / 2) + 'px';
    knob.style.transform = 'translate(0,0)';
    cx = x; cy = y;
  }
  function stickMove(t) {
    var dx = t.clientX - cx, dy = t.clientY - cy;
    var R = baseSize() / 2;
    var m = Math.sqrt(dx * dx + dy * dy);
    var dead = R * 0.28;
    if (m > R) { dx = dx / m * R; dy = dy / m * R; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    if (m < dead) { releaseDirs(); return; }
    var a = Math.atan2(dy, dx) * 180 / Math.PI;
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
  var html = '<div style="font-weight:700;font-size:16px;margin-bottom:4px">Controles de toque</div>' +
    '<label class="r">Mostrar controles <input type="checkbox" id="o-show"></label>' +
    '<label class="r">Tocar na tela para andar <input type="checkbox" id="o-tap"></label>' +
    '<label class="r">Correr alternado (toque liga/desliga) <input type="checkbox" id="o-dash"></label>' +
    '<label class="r">Mostrar FPS <input type="checkbox" id="o-fps"></label>' +
    '<label class="r">Opacidade <input type="range" id="o-op" min="15" max="100"></label>' +
    '<label class="r">Tamanho <input type="range" id="o-sz" min="60" max="160"></label>' +
    '<h4>Botões visíveis</h4><div class="grid">';
  DEFS.forEach(function (d) {
    html += '<label><input type="checkbox" data-b="' + d.id + '"> ' + d.name + '</label>';
  });
  html += '</div>' +
    '<button id="o-edit">\u2725 Mover botões</button><button id="o-reset">\u21BA Padrão</button>' +
    '<button id="o-close">Fechar</button><button id="o-exit">Sair do jogo</button>';
  panel.innerHTML = html;

  function openPanel(on) { panel.style.display = on ? 'block' : 'none'; if (on) syncPanel(); }
  function syncPanel() {
    $('o-show').checked = S.show;
    $('o-tap').checked = S.tapMove;
    $('o-dash').checked = S.dashToggle;
    $('o-fps').checked = S.fps;
    $('o-op').value = Math.round(S.opacity * 100);
    $('o-sz').value = Math.round(S.size * 100);
    DEFS.forEach(function (d) { panel.querySelector('[data-b="' + d.id + '"]').checked = !S.hidden[d.id]; });
  }
  $('fh2-gear').addEventListener('touchstart', function (e) { e.preventDefault(); openPanel(panel.style.display !== 'block'); }, { passive: false });
  $('o-close').addEventListener('click', function () { openPanel(false); });
  $('o-exit').addEventListener('click', function () { if (BR) BR.exit(); });
  $('o-show').addEventListener('change', function () { S.show = this.checked; save(); apply(); });
  $('o-tap').addEventListener('change', function () { S.tapMove = this.checked; save(); apply(); });
  $('o-fps').addEventListener('change', function () { S.fps = this.checked; save(); apply(); });
  $('o-dash').addEventListener('change', function () {
    S.dashToggle = this.checked;
    if (runOn) { runOn = false; btnEls.run.classList.remove('on'); shift(false); }
    save(); apply();
  });
  $('o-op').addEventListener('input', function () { S.opacity = this.value / 100; save(); apply(); });
  $('o-sz').addEventListener('input', function () { S.size = this.value / 100; save(); apply(); });
  DEFS.forEach(function (d) {
    panel.querySelector('[data-b="' + d.id + '"]').addEventListener('change', function () {
      if (this.checked) delete S.hidden[d.id]; else S.hidden[d.id] = 1;
      save(); apply();
    });
  });
  function resetLayout() { S.pos = {}; S.hidden = copy(DEFAULT_HIDDEN); S.size = 1; save(); apply(); syncPanel(); }
  $('o-reset').addEventListener('click', resetLayout);
  $('e-reset').addEventListener('click', resetLayout);
  $('o-edit').addEventListener('click', function () {
    openPanel(false);
    releaseDirs();
    editing = true;
    S.show = true;
    apply();
  });
  $('e-done').addEventListener('click', function () { editing = false; save(); apply(); });

  // ------------------------------------------------------------ FPS
  var fpsEl = $('fh2-fps'), fpsRun = false;
  function fpsLoop() {
    var frames = 0, last = performance.now();
    function f(now) {
      if (!S.fps) { fpsRun = false; return; }
      frames++;
      if (now - last >= 1000) {
        fpsEl.textContent = frames + ' FPS';
        frames = 0;
        last = now;
      }
      requestAnimationFrame(f);
    }
    requestAnimationFrame(f);
  }

  // ------------------------------------------------------------ aplicar tudo
  function apply() {
    root.style.setProperty('--s', S.size);
    root.style.setProperty('--o', editing ? 1 : S.opacity);
    root.classList.toggle('hide', !S.show || (padActive && !editing));
    root.classList.toggle('editing', editing);
    window.__tapMove = S.tapMove;
    DEFS.forEach(layoutBtn);
    fpsEl.style.display = S.fps ? 'block' : 'none';
    if (S.fps && !fpsRun) { fpsRun = true; fpsLoop(); }
    if (stickTid === null) placeBase(null);
  }

  // ------------------------------------------------------------ gamepad físico: esconde os controles
  window.__padActive = function (on) {
    if (padActive === !!on) return;
    padActive = !!on;
    apply();
  };
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

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      releaseDirs();
      if (!S.dashToggle) shift(false);
    }
  });

  apply();
})();
