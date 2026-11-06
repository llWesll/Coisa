/* Camada de compatibilidade NW.js -> Android WebView
 * Fornece require('fs'|'path'|'nw.gui'|'module'|...), process, nw e um loader CommonJS,
 * usando XHR síncrono contra o servidor local (/__fs/*).
 * Caminhos virtuais: "/" == pasta www do jogo.
 */
(function () {
  'use strict';
  var TOKEN = window.__ANDROID_TOKEN || '';
  var BR = window.AndroidBridge;

  function stripOrigin(s) {
    if (/^[a-z][a-z0-9+.-]*:\/\/[^\/]*/i.test(s)) {
      s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^\/]*/i, '');
      s = s.split('#')[0].split('?')[0];
      try { s = decodeURI(s); } catch (e) {}
    }
    return s;
  }

  // ---------------------------------------------------------------- path
  var path = {
    sep: '/',
    delimiter: ':',
    normalize: function (p) {
      p = stripOrigin(String(p));
      var abs = p.charAt(0) === '/';
      var parts = [];
      p.split('/').forEach(function (s) {
        if (!s || s === '.') return;
        if (s === '..') {
          if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
          else if (!abs) parts.push('..');
        } else parts.push(s);
      });
      var r = parts.join('/');
      if (abs) r = '/' + r;
      else if (!r) r = '.';
      if (/\/$/.test(p) && r !== '/' && r !== '.') r += '/';
      return r;
    },
    join: function () {
      var a = [].slice.call(arguments).filter(function (x) { return x !== '' && x != null; }).map(String);
      return a.length ? path.normalize(a.join('/')) : '.';
    },
    resolve: function () {
      var r = '';
      for (var i = arguments.length - 1; i >= 0 && r.charAt(0) !== '/'; i--) {
        var s = stripOrigin(String(arguments[i]));
        if (s) r = s + (r ? '/' + r : '');
      }
      if (r.charAt(0) !== '/') r = '/' + r;
      r = path.normalize(r);
      if (r.length > 1 && r.slice(-1) === '/') r = r.slice(0, -1);
      return r;
    },
    dirname: function (p) {
      p = stripOrigin(String(p));
      var i = p.replace(/\/+$/, '').lastIndexOf('/');
      if (i < 0) return '.';
      if (i === 0) return '/';
      return p.slice(0, i);
    },
    basename: function (p, ext) {
      p = String(p).replace(/\/+$/, '');
      var b = p.slice(p.lastIndexOf('/') + 1);
      if (ext && b.slice(-ext.length) === ext) b = b.slice(0, -ext.length);
      return b;
    },
    extname: function (p) {
      var b = path.basename(p);
      var i = b.lastIndexOf('.');
      return i > 0 ? b.slice(i) : '';
    },
    isAbsolute: function (p) { return String(p).charAt(0) === '/'; },
    relative: function (from, to) {
      var f = path.resolve(from).split('/').filter(Boolean);
      var t = path.resolve(to).split('/').filter(Boolean);
      while (f.length && t.length && f[0] === t[0]) { f.shift(); t.shift(); }
      return f.map(function () { return '..'; }).concat(t).join('/');
    }
  };
  path.posix = path;

  // ---------------------------------------------------------------- fs (XHR síncrono)
  function enoent(p, op) {
    var e = new Error("ENOENT: no such file or directory, " + (op || 'open') + " '" + p + "'");
    e.code = 'ENOENT';
    e.errno = -2;
    e.path = p;
    return e;
  }
  function url(op, p, extra) {
    return '/__fs/' + op + '?t=' + TOKEN + '&p=' + encodeURIComponent(path.resolve(p)) + (extra || '');
  }
  function xhr(method, u, body, binary) {
    var x = new XMLHttpRequest();
    x.open(method, u, false);
    x.overrideMimeType(binary ? 'text/plain; charset=x-user-defined' : 'text/plain; charset=utf-8');
    x.send(body === undefined ? null : body);
    return x;
  }
  function Stats(o) {
    this.size = o.s;
    this.mtimeMs = o.m;
    this.mtime = new Date(o.m);
    this._f = o.f;
    this._d = o.d;
  }
  Stats.prototype.isFile = function () { return !!this._f; };
  Stats.prototype.isDirectory = function () { return !!this._d; };

  function encOf(o) { return typeof o === 'string' ? o : (o && o.encoding) || null; }

  var fs = {
    existsSync: function (p) {
      try { return xhr('GET', url('exists', p)).responseText === '1'; } catch (e) { return false; }
    },
    statSync: function (p) {
      var x = xhr('GET', url('stat', p));
      if (x.status !== 200) throw enoent(p, 'stat');
      return new Stats(JSON.parse(x.responseText));
    },
    readdirSync: function (p) {
      var x = xhr('GET', url('list', p));
      if (x.status !== 200) throw enoent(p, 'scandir');
      return JSON.parse(x.responseText);
    },
    readFileSync: function (p, o) {
      var enc = encOf(o);
      var x = xhr('GET', url('read', p), undefined, !enc);
      if (x.status !== 200) throw enoent(p);
      if (enc) return x.responseText;
      var t = x.responseText, n = t.length, u = new Uint8Array(n);
      for (var i = 0; i < n; i++) u[i] = t.charCodeAt(i) & 255;
      u.toString = function (e) { return new TextDecoder(e && e !== 'utf8' ? e : 'utf-8').decode(this); };
      return u;
    },
    writeFileSync: function (p, data) {
      var body = (typeof data === 'string' || data instanceof Uint8Array) ? data : String(data);
      var x = xhr('POST', url('write', p), body);
      if (x.status !== 200) throw new Error('EIO: falha ao gravar ' + p);
    },
    appendFileSync: function (p, data) {
      var x = xhr('POST', url('write', p, '&append=1'), String(data));
      if (x.status !== 200) throw new Error('EIO: falha ao gravar ' + p);
    },
    mkdirSync: function (p) { xhr('POST', url('mkdir', p), ''); },
    unlinkSync: function (p) {
      var x = xhr('POST', url('unlink', p), '');
      if (x.status !== 200) throw enoent(p, 'unlink');
    },
    rmdirSync: function (p) { xhr('POST', url('rmdir', p), ''); },
    renameSync: function (a, b) {
      var x = xhr('POST', url('rename', a, '&to=' + encodeURIComponent(path.resolve(b))), '');
      if (x.status !== 200) throw enoent(a, 'rename');
    },
    copyFileSync: function (a, b) { fs.writeFileSync(b, fs.readFileSync(a)); }
  };
  // versões assíncronas (callback) em cima das síncronas
  ['readFile', 'writeFile', 'appendFile', 'readdir', 'stat', 'mkdir', 'unlink', 'rmdir', 'rename', 'copyFile'].forEach(function (n) {
    fs[n] = function () {
      var args = [].slice.call(arguments);
      var cb = typeof args[args.length - 1] === 'function' ? args.pop() : function () {};
      var res, err = null;
      try { res = fs[n + 'Sync'].apply(fs, args); } catch (e) { err = e; }
      setTimeout(function () { cb(err, res); }, 0);
    };
  });
  fs.exists = function (p, cb) { var r = fs.existsSync(p); setTimeout(function () { cb(r); }, 0); };

  // ---------------------------------------------------------------- nw.gui (stubs)
  function noop() {}
  var winBase = {
    x: 0, y: 0, menu: null, isFullscreen: false, zoomLevel: 0, title: document.title, window: window,
    isDevToolsOpen: function () { return false; },
    close: function () { if (BR) BR.exit(); },
    on: noop, once: noop, removeListener: noop, removeAllListeners: noop
  };
  Object.defineProperty(winBase, 'width', { get: function () { return window.innerWidth; }, set: noop });
  Object.defineProperty(winBase, 'height', { get: function () { return window.innerHeight; }, set: noop });
  var winProxy = new Proxy(winBase, {
    get: function (t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') return undefined;
      return noop;
    },
    set: function (t, k, v) { t[k] = v; return true; }
  });
  function MenuStub() { this.append = noop; this.createMacBuiltin = noop; this.items = []; }
  var nw = {
    Window: { get: function () { return winProxy; }, open: function () { return winProxy; } },
    App: { argv: [], fullArgv: [], dataPath: '/', manifest: {}, quit: function () { if (BR) BR.exit(); }, closeAllWindows: function () { if (BR) BR.exit(); }, clearCache: noop },
    Shell: { openExternal: noop, openItem: noop, showItemInFolder: noop },
    Clipboard: { get: function () { return { get: function () { return ''; }, set: noop, clear: noop }; } },
    Menu: MenuStub,
    MenuItem: MenuStub,
    Screen: { Init: noop, screens: [] }
  };

  // ---------------------------------------------------------------- process
  var t0 = performance.now();
  var proc = {
    platform: 'linux', arch: 'x64', env: {}, argv: ['nw', '/index.html'], execPath: '/nw', pid: 1,
    version: 'v0.0.0', title: 'nw',
    versions: { nw: '0.80.0', 'node-webkit': '0.80.0', chromium: '120.0.0.0' },
    mainModule: { filename: '/index.html', paths: [] },
    cwd: function () { return '/'; },
    exit: function () { if (BR) BR.exit(); },
    nextTick: function (f) { var a = [].slice.call(arguments, 1); Promise.resolve().then(function () { f.apply(null, a); }); },
    on: function () { return proc; }, once: function () { return proc; }, off: function () { return proc; },
    emit: function () { return false; }, removeListener: function () { return proc; },
    memoryUsage: function () { return { rss: 0, heapTotal: 0, heapUsed: 0 }; },
    uptime: function () { return (performance.now() - t0) / 1000; },
    hrtime: function (prev) {
      var n = performance.now();
      var s = Math.floor(n / 1000), ns = Math.floor((n % 1000) * 1e6);
      if (prev) { s -= prev[0]; ns -= prev[1]; if (ns < 0) { s--; ns += 1e9; } }
      return [s, ns];
    },
    binding: noop, stdout: { write: noop }, stderr: { write: noop }
  };

  // ---------------------------------------------------------------- CommonJS loader
  var cache = {};
  var builtins = {
    fs: fs,
    path: path,
    'nw.gui': nw,
    module: { Module: { _initPaths: noop, _load: noop, _resolveFilename: function (r) { return r; }, globalPaths: [] } },
    os: { platform: function () { return 'linux'; }, EOL: '\n', tmpdir: function () { return '/tmp'; }, homedir: function () { return '/'; }, type: function () { return 'Linux'; }, arch: function () { return 'x64'; }, cpus: function () { return []; } },
    child_process: { exec: noop, spawn: noop, execSync: function () { return ''; } }
  };

  function isFile(f) {
    try { return fs.statSync(f).isFile(); } catch (e) { return false; }
  }
  function resolveFile(base) {
    if (isFile(base)) return base;
    if (isFile(base + '.js')) return base + '.js';
    if (isFile(base + '.json')) return base + '.json';
    if (isFile(base + '.cjs')) return base + '.cjs';
    var pj = base + '/package.json';
    if (isFile(pj)) {
      try {
        var main = JSON.parse(fs.readFileSync(pj, 'utf-8')).main;
        if (main) {
          var r = resolveFile(path.join(base, main));
          if (r) return r;
        }
      } catch (e) {}
    }
    if (isFile(base + '/index.js')) return base + '/index.js';
    return null;
  }
  function resolveModule(request, from) {
    if (/^(\.{1,2}\/|\/)/.test(request)) {
      var r = resolveFile(path.resolve(from, request));
      if (r) return r;
    } else {
      var dirs = [];
      (proc.env.NODE_PATH || '').split(':').forEach(function (d) { if (d) dirs.push(d); });
      var d = path.resolve(from);
      for (;;) {
        dirs.push(path.join(d, 'node_modules'));
        if (d === '/') break;
        d = path.dirname(d);
      }
      for (var i = 0; i < dirs.length; i++) {
        var rr = resolveFile(path.join(dirs[i], request));
        if (rr) return rr;
      }
    }
    var e = new Error("Cannot find module '" + request + "'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
  }
  function loadModule(file) {
    if (cache[file]) return cache[file].exports;
    var src = fs.readFileSync(file, 'utf-8');
    var m = { exports: {}, id: file, filename: file, loaded: false };
    cache[file] = m;
    if (/\.json$/.test(file)) {
      m.exports = JSON.parse(src);
      return m.exports;
    }
    var dir = path.dirname(file);
    var fn = new Function('exports', 'require', 'module', '__filename', '__dirname', src + '\n//# sourceURL=' + file);
    try {
      fn.call(m.exports, m.exports, makeRequire(dir), m, file, dir);
    } catch (e) {
      delete cache[file];
      throw e;
    }
    m.loaded = true;
    return m.exports;
  }
  function makeRequire(from) {
    var req = function (name) {
      name = String(name);
      if (name.indexOf('node:') === 0) name = name.slice(5);
      if (Object.prototype.hasOwnProperty.call(builtins, name)) return builtins[name];
      return loadModule(resolveModule(name, from));
    };
    req.resolve = function (n) { return resolveModule(n, from); };
    req.cache = cache;
    req.main = proc.mainModule;
    return req;
  }

  window.require = makeRequire('/');
  window.process = proc;
  window.nw = nw;
  if (!window.global) window.global = window;
  window.close = function () { if (BR) BR.exit(); };

  // ---------------------------------------------------------------- teclas sintéticas (gamepad nativo / controles de toque)
  var KEYS = {
    37: ['ArrowLeft', 'ArrowLeft'], 38: ['ArrowUp', 'ArrowUp'], 39: ['ArrowRight', 'ArrowRight'], 40: ['ArrowDown', 'ArrowDown'],
    13: ['Enter', 'Enter'], 27: ['Escape', 'Escape'], 16: ['Shift', 'ShiftLeft'], 33: ['PageUp', 'PageUp'], 34: ['PageDown', 'PageDown'],
    9: ['Tab', 'Tab'], 81: ['q', 'KeyQ'], 87: ['w', 'KeyW'], 88: ['x', 'KeyX'], 90: ['z', 'KeyZ'], 32: [' ', 'Space']
  };
  window.__k = function (code, down, fromPad) {
    if (fromPad && down && window.__padActive) window.__padActive(true);
    var k = KEYS[code] || [String.fromCharCode(code), ''];
    var e = new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key: k[0], code: k[1], bubbles: true, cancelable: true, shiftKey: code === 16 && !!down
    });
    Object.defineProperty(e, 'keyCode', { get: function () { return code; } });
    Object.defineProperty(e, 'which', { get: function () { return code; } });
    document.dispatchEvent(e);
  };

  // erros de carregamento de scripts/imagens e promises rejeitadas -> console (o app mostra na tela)
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) console.error('FALHA ao carregar: ' + (t.src || t.href));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    console.error('Promise rejeitada: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
  });

  // impede o menu de contexto / seleção por toque longo
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // garante que o áudio destrave no primeiro toque
  function unlockAudio() {
    try {
      var c = window.WebAudio && WebAudio._context;
      if (c && c.state === 'suspended') c.resume();
    } catch (e) {}
  }
  document.addEventListener('touchstart', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);
})();
