'use strict';
(() => {
  const N = 16, CELLS = N * N, EMPTY = '.'.repeat(CELLS);
  const PAL = window.FROGGY_PALETTE;
  const PICS = window.FROGGY_PICTURES.map(p => ({ name: p.name, art: p.rows.join('') }));
  const COLORS = [
    { name: 'Red', hex: '#ff5252' }, { name: 'Orange', hex: '#ff9f1a' }, { name: 'Yellow', hex: '#ffe14d' },
    { name: 'Green', hex: '#5fd35f' }, { name: 'Turquoise', hex: '#2ee6c8' }, { name: 'Blue', hex: '#4d9dff' },
    { name: 'Purple', hex: '#b36bff' }, { name: 'Pink', hex: '#ff7ac8' },
  ];
  const MAX_PLAYERS = COLORS.length;
  COLORS.forEach((c, i) => { c.frog = window.FROGGY_FROGS[i].name; });

  const ROUND_CHOICES = [3, 5, 8, 12, PICS.length], SECS_CHOICES = [45, 60, 90, 120, 180];
  const COUNTDOWN = 3000;  // ms of "3, 2, 1" before each round
  const GRACE = 1500;      // ms the host waits after time is up for everyone's last strokes to arrive
  const SEND_GAP = 300;    // ms between uploads of your drawing while you draw
  // Board cells (0-8, row by row) around the picture in cell 4. You always sit at the bottom middle.
  const SEATS = [7, 0, 1, 2, 3, 5, 6, 8];

  // Bump with the ?v= on the scripts in index.html whenever what goes in the room changes.
  // Devices on different versions can't play together, and phones can hang on to an old copy of the page.
  const VERSION = 4;
  const OUTDATED = 'That room is using a different version of Froggy Draw. Everyone needs to refresh the page.';
  const ROOMS = 'froggydraw/rooms';

  const db = window.firebase ? (firebase.initializeApp({
    apiKey:            'AIzaSyAsJboNGVuESMhkivllUD0o8MUB5LUCMRQ',
    authDomain:        'kvgames.firebaseapp.com',
    databaseURL:       'https://kvgames-default-rtdb.firebaseio.com',
    projectId:         'kvgames',
    storageBucket:     'kvgames.firebasestorage.app',
    messagingSenderId: '463308384695',
    appId:             '1:463308384695:web:5d57623ebd52101ad26032',
  }), firebase.database()) : null;
  let clockOffset = 0;  // server clock minus ours, so every device agrees on when a round ends
  if (db) db.ref('.info/serverTimeOffset').on('value', s => { clockOffset = s.val() || 0; });
  const now = () => Date.now() + clockOffset;

  const $ = id => document.getElementById(id);
  const show = id => { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  // ── Sounds ───────────────────────────────────────────────────────────────
  // Made on the fly with Web Audio, so there are no sound files. Phones only allow sound after a tap,
  // so the first tap anywhere wakes it up.
  const sfx = (() => {
    let ac = null, master = null, muted = store.get('froggy-mute') === '1';
    const last = {};
    function ctx() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.6;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    // One note: frequency (sliding to `to`), length in seconds, starting `at` seconds from now.
    function tone(freq, dur, { type = 'sine', vol = 0.2, to = null, at = 0 } = {}) {
      const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    function noise(dur, { vol = 0.15, from = 3000, to = 300, at = 0 } = {}) {
      const t = ac.currentTime + at, len = Math.ceil(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = buf;
      f.type = 'bandpass';
      f.frequency.setValueAtTime(from, t);
      f.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(master);
      src.start(t);
    }
    function croak(at = 0, pitch = 1) {  // two buzzy throaty bursts: rib-bit
      for (const [dt, f] of [[0, 150], [0.16, 190]]) {
        const t = ac.currentTime + at + dt, o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * pitch, t);
        o.frequency.linearRampToValueAtTime(f * pitch * 0.8, t + 0.11);
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(lp).connect(g).connect(master);
        o.start(t);
        o.stop(t + 0.14);
      }
    }
    // A hum: a soft, round tone (like "mmm" with your mouth closed) with a little vibrato.
    // Each note is [start, length, starting pitch, ending pitch] in seconds and Hz.
    function hum(notes, { wobble = 4, wobbleSpeed = 5.5, vol = 0.35 } = {}) {
      const t0 = ac.currentTime;
      for (const [at, dur, from, to] of notes) {
        const t = t0 + at, o = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
        const vib = ac.createOscillator(), vibAmt = ac.createGain();
        o.type = 'triangle';
        o2.type = 'sine';
        for (const [osc, mult] of [[o, 1], [o2, 2]]) {
          osc.frequency.setValueAtTime(from * mult, t);
          osc.frequency.exponentialRampToValueAtTime(to * mult, t + dur);
        }
        vib.frequency.value = wobbleSpeed;
        vibAmt.gain.value = wobble;
        vib.connect(vibAmt).connect(o.frequency);
        const g2 = ac.createGain();
        g2.gain.value = 0.25;
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        o.connect(lp);
        o2.connect(g2).connect(lp);
        lp.connect(g).connect(master);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
        g.gain.setValueAtTime(vol, t + Math.max(0.05, dur - 0.08));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        for (const n of [o, o2, vib]) { n.start(t); n.stop(t + dur + 0.02); }
      }
    }
    // What each frog hums when you pick it, in COLORS order: each at its own pitch, in its own mood.
    const frogHums = [
      () => hum([[0, 0.18, 175, 165], [0.2, 0.4, 150, 105]], { wobble: 6, wobbleSpeed: 9 }),  // angry: low, grumbly "hm-HMPH"
      () => hum([[0, 0.55, 250, 370]]),                                                       // confused: "hmm?" rising
      () => hum([[0, 0.14, 392, 392], [0.17, 0.32, 523, 587]]),                               // happy: bouncy "hm-HM!"
      () => hum([[0, 0.25, 300, 280], [0.27, 0.4, 260, 190]], { wobble: 10, wobbleSpeed: 12 }), // grossed out: queasy "mm-mmm"
      () => hum([[0, 0.7, 340, 360]], { wobble: 30, wobbleSpeed: 9 }),                         // aqua: wavy, bubbly hum
      () => hum([[0, 0.8, 300, 185]], { wobble: 3, wobbleSpeed: 4 }),                          // sad: slow, falling "hmmm"
      () => hum([[0, 0.45, 110, 104], [0.45, 0.6, 104, 92]], { wobble: 2, vol: 0.45 }),        // dark sorcerer: deep, spooky hum
      () => hum([[0, 0.22, 587, 587], [0.24, 0.5, 784, 659]], { wobble: 6 }),                  // heart eyes: sweet, high "mm-mmm"
    ];
    const notes = [523, 587, 659, 698, 784, 880, 988, 1047];
    const sounds = {
      paint(i) { tone(notes[i % notes.length], 0.06, { type: 'triangle', vol: 0.12 }); },
      erase() { noise(0.06, { vol: 0.12, from: 2500, to: 1200 }); },
      fill() { noise(0.25, { vol: 0.12, from: 600, to: 3000 }); tone(300, 0.25, { to: 900, vol: 0.1 }); },
      pick() { tone(1200, 0.03, { type: 'square', vol: 0.05 }); },
      undo() { tone(700, 0.12, { to: 350, type: 'triangle', vol: 0.15 }); },
      clear() { noise(0.35, { vol: 0.2, from: 4000, to: 200 }); },
      count() { tone(660, 0.15, { type: 'square', vol: 0.12 }); },
      go() { tone(990, 0.35, { type: 'square', vol: 0.14 }); },
      tick() { tone(1500, 0.04, { type: 'square', vol: 0.06 }); },
      timeup() { tone(220, 0.5, { type: 'sawtooth', vol: 0.15, to: 160 }); },
      done() { tone(880, 0.12, { vol: 0.2 }); tone(1320, 0.25, { vol: 0.2, at: 0.1 }); },
      undone() { tone(1320, 0.1, { vol: 0.15 }); tone(880, 0.15, { vol: 0.15, at: 0.08 }); },
      pop() { tone(500, 0.08, { to: 900, vol: 0.12 }); },
      ribbit(pitch) { croak(0, pitch); },
      frog(i) { frogHums[i](); },
      results() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.18, at: i * 0.09 })); },
      win() {
        [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i === 7 ? 0.6 : 0.16, { type: 'square', vol: 0.1, at: [0, .15, .3, .45, .6, .8, .95, 1.1][i] }));
        croak(1.8);
      },
    };
    return {
      // gap: skip the sound if it played less than this many ms ago (for fast drawing)
      play(name, arg, gap = 0) {
        if (muted || !ctx()) return;
        const t = performance.now();
        if (gap && t - (last[name] || -1e9) < gap) return;
        last[name] = t;
        try { sounds[name](arg); } catch {}
      },
      wake() { if (!muted) ctx(); },
      get muted() { return muted; },
      toggle() { muted = !muted; store.set('froggy-mute', muted ? '1' : '0'); if (!muted) this.play('pop'); },
    };
  })();
  document.addEventListener('pointerdown', () => sfx.wake(), true);
  function markSound() { for (const b of document.querySelectorAll('.sound')) b.textContent = sfx.muted ? '🔇' : '🔊'; }
  for (const b of document.querySelectorAll('.sound')) b.onclick = () => { sfx.toggle(); markSound(); };
  markSound();

  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

  // Each player color has its own frog face, drawn once into an image.
  const frogURLs = [];
  function frogURL(i) {
    if (frogURLs[i]) return frogURLs[i];
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d'), ink = window.FROGGY_FROG_INK;
    cv.width = cv.height = N;
    const hex = COLORS[i].hex, dark = '#' + [1, 3, 5].map(k => Math.floor(parseInt(hex.slice(k, k + 2), 16) / 2).toString(16).padStart(2, '0')).join('');
    window.FROGGY_FROGS[i].rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = ch === 'B' ? hex : ch === 'D' || ch === 'M' ? dark : ink[ch];
      ctx.fillRect(x, y, 1, 1);
    }));
    return (frogURLs[i] = cv.toDataURL());
  }
  const frogImg = (i, cls = 'frog') => `<img class="${cls}" src="${frogURL(i)}" alt="" title="${esc(COLORS[i].frog)} frog">`;
  $('menu-frogs').innerHTML = COLORS.map((_, i) => frogImg(i, '')).join('');

  const myId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // Same color in a spot the picture fills is worth 1, a different color there ½. Spots that are
  // empty in both don't count, so a blank page scores 0 and scribbling outside the picture costs you.
  function score(drawn, target) {
    let got = 0, total = 0;
    for (let i = 0; i < CELLS; i++) {
      const a = drawn[i], t = target[i];
      if (a === '.' && t === '.') continue;
      total++;
      if (a === t) got += 1;
      else if (a !== '.' && t !== '.') got += 0.5;
    }
    return total ? Math.round(100 * got / total) : 0;
  }

  function paintArt(canvas, art, grid) {
    const css = Math.min(canvas.clientWidth, canvas.clientHeight || canvas.clientWidth);
    if (!css) return;
    const px = Math.round(css * (window.devicePixelRatio || 1));
    if (canvas.width !== px) canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d'), s = px / N, at = i => Math.round(i * s);
    for (let i = 0; i < CELLS; i++) {
      const x = i % N, y = (i / N) | 0, ch = art[i];
      ctx.fillStyle = ch === '.' ? ((x + y) & 1 ? '#dfe5ee' : '#d3dae5') : PAL[ch].hex;
      ctx.fillRect(at(x), at(y), at(x + 1) - at(x), at(y + 1) - at(y));
    }
    if (!grid) return;
    // Thin lines around every pixel and darker ones every 4, to help count where things go.
    for (let i = 1; i < N; i++) {
      ctx.fillStyle = i % 4 ? '#00000022' : '#00000066';
      const w = i % 4 ? Math.max(1, s / 24) : Math.max(1, s / 10);
      ctx.fillRect(at(i) - w / 2, 0, w, px);
      ctx.fillRect(0, at(i) - w / 2, px, w);
    }
  }

  // ── Your drawing ─────────────────────────────────────────────────────────
  let art = EMPTY.split(''), undo = [], paint = 'k', tool = 'pen', stroke = null;
  let room = null;      // online: { code, ref, st (latest room data), round, ... }
  let practice = null;  // solo: { pic, checked }

  const easel = $('easel');
  function cellAt(e) {
    const r = easel.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * N), y = Math.floor((e.clientY - r.top) / r.height * N);
    return x >= 0 && x < N && y >= 0 && y < N ? { x, y } : null;
  }
  function flood({ x, y }, ch) {
    const from = art[y * N + x];
    if (from === ch) return;
    const todo = [y * N + x];
    while (todo.length) {
      const i = todo.pop();
      if (art[i] !== from) continue;
      art[i] = ch;
      const cx = i % N;
      if (cx > 0) todo.push(i - 1);
      if (cx < N - 1) todo.push(i + 1);
      if (i >= N) todo.push(i - N);
      if (i < CELLS - N) todo.push(i + N);
    }
  }
  function line(a, b, ch) {  // every pixel between two touch points, so a fast swipe leaves no gaps
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    let n2 = 0;
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      const i = Math.round(a.y + (b.y - a.y) * t) * N + Math.round(a.x + (b.x - a.x) * t);
      if (art[i] !== ch) { art[i] = ch; n2++; }
    }
    return n2;
  }
  function paintSound(ch, changedCount) {
    if (!changedCount) return;
    if (ch === '.') sfx.play('erase', 0, 60);
    else sfx.play('paint', Object.keys(PAL).indexOf(ch), 45);
  }
  function changed() {
    paintArt(easel, art, true);
    const mine = document.querySelector('.cell.me canvas');
    if (mine) paintArt(mine, art);
    if (room) scheduleSend();
  }
  function remember() {
    undo.push(art.join(''));
    if (undo.length > 80) undo.shift();
  }
  easel.addEventListener('pointerdown', e => {
    const c = cellAt(e);
    if (!c || !canDraw()) return;
    easel.setPointerCapture(e.pointerId);
    remember();
    if (tool === 'fill') {
      const before = art.join('');
      flood(c, paint);
      if (art.join('') !== before) sfx.play('fill');
    } else { stroke = { id: e.pointerId, last: c }; paintSound(paint, line(c, c, paint)); }
    changed();
  });
  easel.addEventListener('pointermove', e => {
    if (!stroke || e.pointerId !== stroke.id) return;
    const c = cellAt(e);
    if (!c || !canDraw()) return;
    paintSound(paint, line(stroke.last, c, paint));
    stroke.last = c;
    changed();
  });
  const endStroke = e => {
    if (stroke && e.pointerId !== stroke.id) return;
    stroke = null;
    if (undo.length && undo[undo.length - 1] === art.join('')) undo.pop();  // the tap changed nothing
  };
  easel.addEventListener('pointerup', endStroke);
  easel.addEventListener('pointercancel', endStroke);

  for (const ch of [...Object.keys(PAL), '.']) {
    const b = document.createElement('button');
    b.dataset.ch = ch;
    if (ch === '.') { b.className = 'eraser'; b.textContent = '🧽'; b.title = 'Eraser'; }
    else { b.style.background = PAL[ch].hex; b.title = PAL[ch].name; }
    b.onclick = () => { paint = ch; markTools(); sfx.play('pick'); };
    $('palette').append(b);
  }
  function markTools() {
    for (const b of $('palette').children) b.classList.toggle('on', b.dataset.ch === paint);
    $('tool-pen').classList.toggle('on', tool === 'pen');
    $('tool-fill').classList.toggle('on', tool === 'fill');
  }
  markTools();
  $('tool-pen').onclick = () => { tool = 'pen'; markTools(); sfx.play('pick'); };
  $('tool-fill').onclick = () => { tool = 'fill'; markTools(); sfx.play('pick'); };
  $('btn-undo').onclick = () => {
    if (!undo.length || !canDraw()) return;
    art = undo.pop().split('');
    sfx.play('undo');
    changed();
  };
  $('btn-clear').onclick = () => {
    if (!canDraw() || art.every(c => c === '.')) return;
    remember();
    art = EMPTY.split('');
    sfx.play('clear');
    changed();
  };
  $('btn-done').onclick = () => {
    if (practice) { practice.checked = true; sfx.play('results'); renderPractice(); return; }
    if (!room || !room.st || room.st.phase !== 'draw' || now() >= room.st.ends) return;
    sfx.play(isDone() ? 'undone' : 'done');
    if (isDone()) room.ref.child(`done/${myId}`).remove();
    else room.ref.update({ [`art/${myId}`]: art.join(''), [`done/${myId}`]: true });  // together, so the host scores your last strokes
  };

  function isDone() { return !!(room && room.st && room.st.done && room.st.done[myId]); }
  function canDraw() {
    if (practice) return !practice.checked;
    const st = room && room.st;
    return !!st && st.phase === 'draw' && st.round === room.round && now() >= st.starts && now() < st.ends && !isDone();
  }
  function resetDrawing() { art = EMPTY.split(''); undo = []; stroke = null; }

  // ── Board ────────────────────────────────────────────────────────────────
  const board = $('board');
  for (let i = 0; i < 9; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    c.innerHTML = '<canvas></canvas><div class="mark"></div><div class="label"></div>';
    board.append(c);
  }
  const cells = [...board.children];
  // Hold the picture to see it bigger.
  cells[4].addEventListener('pointerdown', () => {
    const pic = currentPic();
    if (!pic) return;
    $('zoom').hidden = false;
    $('zoom-name').textContent = pic.name;
    paintArt($('zoom').querySelector('canvas'), pic.art, true);
  });
  const unzoom = () => { $('zoom').hidden = true; };
  window.addEventListener('pointerup', unzoom);
  window.addEventListener('pointercancel', unzoom);

  function currentPic() {
    if (practice) return withMix(PICS[practice.pic], practice.mix);
    const st = room && room.st;
    if (!st || st.pic == null || (st.phase === 'draw' && now() < st.starts)) return null;
    return withMix(PICS[st.pic], st.mix);
  }

  // Color Craze: every color in the picture swaps for a different one (the same swap everywhere in it).
  // mix[i] is the color that palette color i turns into.
  const KEYS = Object.keys(PAL);
  function crazeMix(pic) {
    const used = new Set(pic.art.replace(/\./g, ''));
    let mix;
    for (let tries = 0; tries < 100; tries++) {
      mix = [...KEYS];
      for (let i = mix.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [mix[i], mix[j]] = [mix[j], mix[i]]; }
      if (KEYS.every((k, i) => !used.has(k) || mix[i] !== k)) break;
    }
    return mix.join('');
  }
  function withMix(pic, mix) {
    if (!mix) return pic;
    return { name: pic.name, art: pic.art.replace(/[^.]/g, ch => mix[KEYS.indexOf(ch)]), craze: true };
  }
  const crazeLabel = on => `🌈 Color Craze: ${on ? 'On' : 'Off'}`;

  // [{ id, name, color, score, last }] by when they joined
  function playerList(st) {
    return Object.entries(st.players || {}).filter(([, p]) => p && p.name)
      .map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.at || 0) - (b.at || 0) || (a.id < b.id ? -1 : 1));
  }

  function renderBoard(players, opts) {
    const seat = Array(9).fill(null), others = players.filter(p => p.id !== myId);
    const me = players.find(p => p.id === myId);
    if (me) seat[SEATS[0]] = me;
    others.forEach((p, i) => { seat[SEATS[i + 1]] = p; });
    cells.forEach((c, i) => {
      const [canvas, mark, label] = c.children;
      c.className = 'cell';
      c.style.background = '';
      mark.textContent = '';
      if (i === 4) {
        const pic = currentPic();
        c.classList.add('target');
        label.textContent = pic ? pic.name : '?';
        paintArt(canvas, pic ? pic.art : EMPTY, true);
        return;
      }
      const p = seat[i];
      label.hidden = !p;
      canvas.hidden = !p;
      if (!p) return;
      if (p.id === myId) c.classList.add('me');
      c.style.background = COLORS[p.color].hex;
      label.innerHTML = frogImg(p.color) + esc(p.name) + (opts.done && opts.done[p.id] ? ' ✓' : '');
      paintArt(canvas, p.id === myId && !opts.results ? art.join('') : opts.art(p.id));
      if (opts.results && p.last != null) mark.textContent = `${p.last}%`;
    });
  }

  function layout() {
    const stage = $('stage'), W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const drawing = !$('desk').hidden, wide = W > H * 1.15, GAP = 10;
    stage.classList.toggle('wide', wide);
    const DESK = 2 * 32 + 4 + 38 + 2 * 8;  // palette rows, tools, gaps under the easel
    let side, easelSide = 0;
    if (!drawing) side = wide ? Math.min(H, W * 0.55) : Math.min(W, H * 0.55);
    else if (wide) {
      side = Math.min(H, (W - GAP) * 0.5);
      easelSide = Math.min(H - DESK, W - side - GAP, 560);
    } else {
      const avail = H - GAP - DESK;
      easelSide = Math.min(W, avail * 0.56, 560);
      side = Math.min(W, avail - easelSide);
      easelSide = Math.min(W, avail - side, 560);
    }
    board.style.width = board.style.height = `${Math.floor(side)}px`;
    easel.style.width = easelSide && `${Math.floor(easelSide)}px`;
    easel.style.height = easelSide && `${Math.floor(easelSide)}px`;
    $('desk').style.width = `${Math.floor(Math.min(W, Math.max(easelSide, 300)))}px`;
  }
  window.addEventListener('resize', () => { if (!$('play').hidden) { layout(); renderPlay(); } });

  // ── Menu ─────────────────────────────────────────────────────────────────
  $('name').value = store.get('froggy-name') || '';
  function myName() {
    const n = $('name').value.trim().slice(0, 14);
    if (!n) { $('menu-error').textContent = 'Type your name first.'; $('name').focus(); return null; }
    store.set('froggy-name', n);
    return n;
  }
  function busy(on) { for (const id of ['btn-create', 'btn-join', 'btn-practice']) $(id).disabled = on; }
  $('btn-practice').onclick = () => {
    $('menu-error').textContent = '';
    showPicker();
  };

  // Practice: choose which picture to copy.
  PICS.forEach((pic, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<canvas></canvas>${esc(pic.name)}`;
    b.onclick = () => startPractice(i);
    $('pick-grid').append(b);
  });
  let crazePractice = store.get('froggy-craze') === '1';
  function markPickCraze() {
    $('pick-craze').textContent = crazeLabel(crazePractice);
    $('pick-craze').classList.toggle('on', crazePractice);
    $('pick-hint').textContent = crazePractice ? 'The picture will come in wild new colors!' : '';
  }
  $('pick-craze').onclick = () => { crazePractice = !crazePractice; store.set('froggy-craze', crazePractice ? '1' : '0'); markPickCraze(); };
  function showPicker() {
    practice = null;
    markPickCraze();
    show('pick');
    for (const [i, b] of [...$('pick-grid').children].entries()) paintArt(b.firstChild, PICS[i].art);
  }
  function startPractice(n) {
    practice = { pic: n, checked: false, mix: crazePractice ? crazeMix(PICS[n]) : null };
    resetDrawing();
    show('play');
    renderPractice();
  }
  $('btn-pick-random').onclick = () => startPractice(Math.floor(Math.random() * PICS.length));
  $('btn-pick-back').onclick = () => show('menu');
  $('btn-create').onclick = () => { const n = myName(); if (n) createRoom(n); };
  $('btn-join').onclick = () => {
    const code = $('join-code').value.trim().toUpperCase(), n = myName();
    if (!n) return;
    if (!/^[A-Z0-9]{4}$/.test(code)) { $('menu-error').textContent = 'Type the 4-letter room code.'; return; }
    joinRoom(code, n);
  };
  $('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });

  // ── Practice ─────────────────────────────────────────────────────────────
  function renderPractice() {
    const pic = currentPic(), pct = score(art.join(''), pic.art);
    $('what').innerHTML = `Practice${pic.craze ? ' 🌈' : ''} <small>· copy the ${esc(pic.name)}</small>`;
    $('timer').textContent = '';
    $('desk').hidden = practice.checked;
    $('results').hidden = !practice.checked;
    $('btn-done').textContent = '✅ Check';
    if (practice.checked) {
      $('results-title').textContent = `You scored ${pct}%`;
      $('results-list').innerHTML = '';
      $('btn-next').textContent = 'Pick another picture';
      $('btn-next').hidden = false;
      $('results-wait').innerHTML = '<button id="btn-fix">Keep fixing this one</button>';
      $('btn-fix').onclick = () => { practice.checked = false; renderPractice(); };
    }
    layout();
    const me = { id: myId, name: $('name').value.trim() || 'You', color: Number(store.get('froggy-color')) || 0, last: pct };
    renderBoard([me], { results: practice.checked, art: () => art.join(''), done: {} });
    if (!practice.checked) paintArt(easel, art, true);
  }

  // ── Online ───────────────────────────────────────────────────────────────
  function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
  function prefColor() { const c = Number(store.get('froggy-color')); return c >= 0 && c < MAX_PLAYERS ? c : 0; }

  async function createRoom(name) {
    if (!db) { $('menu-error').textContent = "Can't reach the game server. Check the internet connection."; return; }
    busy(true);
    $('menu-error').textContent = '';
    try {
      let code, ref;
      for (let i = 0; i < 10; i++) {
        code = genCode();
        ref = db.ref(`${ROOMS}/${code}`);
        if (!(await ref.get()).exists()) break;
      }
      await ref.set({
        host: myId, v: VERSION, created: firebase.database.ServerValue.TIMESTAMP, phase: 'lobby', rounds: 5, secs: 90, craze: false,
        players: { [myId]: { name, color: prefColor(), at: now(), score: 0 } },
      });
      ref.onDisconnect().remove();
      await enterRoom(code, ref);
    } catch (e) {
      $('menu-error').textContent = "Couldn't create a room. Check the internet connection.";
    }
    busy(false);
  }

  async function joinRoom(code, name) {
    if (!db) { $('menu-error').textContent = "Can't reach the game server. Check the internet connection."; return; }
    busy(true);
    $('menu-error').textContent = '';
    const ref = db.ref(`${ROOMS}/${code}`);
    try {
      const st = await enterRoom(code, ref, true);
      const problem = !st || !st.host ? `There's no room ${code}.` : st.v !== VERSION ? OUTDATED
        : playerList(st).length >= MAX_PLAYERS ? 'That room is full (8 players).' : null;
      if (problem) throw new Error(problem);
      // A transaction, so two people joining at once can't both take the last seat or the same color.
      const res = await ref.child('players').transaction(cur => {
        if (!cur) return;
        const ps = Object.values(cur).filter(p => p && p.name);
        if (ps.length >= MAX_PLAYERS) return;
        const taken = new Set(ps.map(p => p.color));
        let color = prefColor();
        if (taken.has(color)) color = COLORS.findIndex((_, i) => !taken.has(i));
        cur[myId] = { name, color, at: now(), score: 0 };
        return cur;
      });
      if (!res.committed) throw new Error('That room is full (8 players).');
      for (const k of ['players', 'art', 'done']) ref.child(`${k}/${myId}`).onDisconnect().remove();
      room.joining = false;
      render();
    } catch (e) {
      leaveRoom();
      show('menu');
      $('menu-error').textContent = e.message && !/^FIREBASE|permission/i.test(e.message) ? e.message
        : "Couldn't join. Check the code and the internet connection.";
    }
    busy(false);
  }

  // Start listening to the room. Resolves with its first data, so a join can check it before taking a seat.
  function enterRoom(code, ref, joining = false) {
    leaveRoom();
    room = { code, ref, st: null, round: 0, joining, lastSend: 0, sendTimer: null, ending: 0, flushed: 0 };
    const r = room;
    return new Promise(resolve => {
      r.listener = ref.on('value', snap => {
        if (room !== r) return;
        r.st = snap.val();
        if (resolve) { const f = resolve; resolve = null; f(r.st); if (joining) return; }
        if (!r.joining) render();
      }, () => { if (resolve) { const f = resolve; resolve = null; f(null); } });
    });
  }
  function leaveRoom() {
    const r = room;
    if (!r) return;
    room = null;
    r.ref.off('value', r.listener);
    clearTimeout(r.sendTimer);
    const st = r.st;
    if (st && st.host === myId) { r.ref.onDisconnect().cancel(); r.ref.remove(); }
    else if (!r.joining) for (const k of ['players', 'art', 'done']) {
      const c = r.ref.child(`${k}/${myId}`);
      c.onDisconnect().cancel();
      c.remove();
    }
  }
  window.addEventListener('pagehide', leaveRoom);

  function closed(msg) {
    leaveRoom();
    show('menu');
    $('menu-error').textContent = msg;
  }

  function render() {
    const r = room, st = r && r.st;
    if (!r) return;
    if (!st || !st.host || !st.players || !st.players[st.host]) return closed('The host left the game.');
    if (!st.players[myId]) return closed('You were disconnected from the room.');
    if (st.phase === 'lobby') { r.round = 0; renderLobby(); }
    else if (st.phase === 'draw' || st.phase === 'results') renderPlay();
    else if (st.phase === 'over') renderOver();
  }

  function renderLobby() {
    const st = room.st, players = playerList(st), host = st.host === myId;
    const ids = players.map(p => p.id).join();
    if (room.seen != null && ids.length > room.seen.length && $('lobby').hidden === false) sfx.play('ribbit', 1.2);
    room.seen = ids;
    show('lobby');
    $('lobby-code').textContent = room.code;
    $('lobby-players').innerHTML = players.map(p => `<li>${frogImg(p.color)}`
      + `${esc(p.name)}<span class="tag">${[p.id === st.host && 'host', p.id === myId && 'you'].filter(Boolean).join(' · ')}</span></li>`).join('');
    const mine = st.players[myId].color, taken = new Set(players.filter(p => p.id !== myId).map(p => p.color));
    $('lobby-colors').innerHTML = '';
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.innerHTML = frogImg(i, '');
      b.title = `${c.frog} frog`;
      b.className = i === mine ? 'mine' : '';
      b.disabled = taken.has(i);
      b.onclick = () => pickColor(i);
      $('lobby-colors').append(b);
    });
    $('frog-name').textContent = `You're the ${COLORS[mine].frog} frog`;
    for (const [id, choices, key, unit] of [['set-rounds', ROUND_CHOICES, 'rounds', ''], ['set-secs', SECS_CHOICES, 'secs', ' s']]) {
      const sel = $(id);
      sel.innerHTML = choices.map(v => `<option value="${v}">${v === PICS.length && key === 'rounds' ? `${v} (every picture)` : v + unit}</option>`).join('');
      sel.value = st[key];
      sel.disabled = !host;
      sel.onchange = () => room.ref.update({ [key]: Number(sel.value) });
    }
    $('set-craze').textContent = crazeLabel(st.craze);
    $('set-craze').classList.toggle('on', !!st.craze);
    $('set-craze').disabled = !host;
    $('set-craze').onclick = () => room.ref.update({ craze: !st.craze });
    $('btn-start').hidden = !host;
    $('btn-start').disabled = players.length < 2;
    const hostName = (players.find(p => p.id === st.host) || {}).name;
    $('lobby-info').textContent = !host ? `Waiting for ${hostName} to start…`
      : players.length < 2 ? 'You need at least 2 players.' : `${players.length} players. Ready when you are!`;
    renderChat(st);
  }

  // ── Waiting-room chat ────────────────────────────────────────────────────
  // Frog emojis are typed as :angry:, :confused: and so on, and show as that frog's face.
  const FROG_CODES = ['angry', 'confused', 'happy', 'grossed', 'aqua', 'sad', 'sorcerer', 'hearts'];
  const CHAT_KEEP = 40;  // older messages are deleted
  const withFrogs = text => esc(text).replace(/:([a-z]+):/g, (m, code) => {
    const i = FROG_CODES.indexOf(code);
    return i < 0 ? m : frogImg(i, 'emo').replace('alt=""', `alt=":${code}:"`);
  });
  // A frog face copied out of the game pastes as a long "data:image/png;base64,…" picture address.
  // Turn each one back into that frog's code by comparing its pixels with the frogs (another browser may
  // write the same picture out differently), and drop any other pasted pictures.
  function framePixels(img) {
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    cv.width = cv.height = N;
    ctx.drawImage(img, 0, 0, N, N);
    return ctx.getImageData(0, 0, N, N).data.join();
  }
  const loadImg = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  let frogPixels = null;
  async function unpasteFrogs(text) {
    const urls = text.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g);
    if (!urls) return text;
    frogPixels = frogPixels || await Promise.all(COLORS.map(async (_, i) => framePixels(await loadImg(frogURL(i)))));
    for (const url of urls) {
      const im = await loadImg(url), px = im && im.width === N && im.height === N ? framePixels(im) : null;
      const i = px ? frogPixels.indexOf(px) : -1;
      text = text.replace(url, i < 0 ? '' : `:${FROG_CODES[i]}:`);
    }
    return text;
  }
  FROG_CODES.forEach((code, i) => {
    const b = document.createElement('button');
    b.innerHTML = frogImg(i, '');
    b.title = `${COLORS[i].frog} frog`;
    b.onclick = () => {  // put the frog where the cursor is
      const inp = $('chat-text'), at = inp.selectionStart ?? inp.value.length, add = `:${code}:`;
      if (inp.value.length + add.length > inp.maxLength) return;
      inp.value = inp.value.slice(0, at) + add + inp.value.slice(inp.selectionEnd ?? at);
      inp.focus();
      inp.setSelectionRange(at + add.length, at + add.length);
      showPreview();
      sfx.play('pick');
    };
    $('chat-frogs').append(b);
  });
  function showPreview() {
    const v = $('chat-text').value;
    $('chat-preview').innerHTML = /:[a-z]+:/.test(v) ? withFrogs(v) : '';
  }
  $('chat-text').addEventListener('input', showPreview);
  $('chat-text').addEventListener('paste', async e => {  // the box only holds 120 characters, too few for a picture address
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (!text || !/data:image\//.test(text)) return;
    e.preventDefault();
    const inp = $('chat-text'), at = inp.selectionStart ?? inp.value.length, end = inp.selectionEnd ?? at;
    const add = await unpasteFrogs(text);
    inp.value = (inp.value.slice(0, at) + add + inp.value.slice(end)).slice(0, inp.maxLength);
    inp.setSelectionRange(at + add.length, at + add.length);
    showPreview();
  });
  function sendChat() {
    const text = $('chat-text').value.trim().slice(0, 120), st = room && room.st;
    if (!text || !st || !st.players[myId]) return;
    const me = st.players[myId];
    room.ref.child('chat').push({ id: myId, name: me.name, color: me.color, text, at: firebase.database.ServerValue.TIMESTAMP });
    const old = Object.keys(st.chat || {}).sort();
    for (const k of old.slice(0, Math.max(0, old.length + 1 - CHAT_KEEP))) room.ref.child(`chat/${k}`).remove();
    $('chat-text').value = '';
    showPreview();
    sfx.play('pop');
  }
  $('chat-send').onclick = sendChat;
  $('chat-text').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  function renderChat(st) {
    const msgs = Object.entries(st.chat || {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, m]) => ({ k, ...m }));
    const log = $('chat-log'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    // Messages can arrive out of order (your own shows up before one sent a moment earlier), so compare them all.
    const keys = msgs.map(m => m.k).join();
    if (keys === room.chatShown && log.children.length) return;  // nothing new to draw
    if (room.chatShown != null && msgs.some(m => m.id !== myId && !room.chatShown.includes(m.k))) sfx.play('pop');
    room.chatShown = keys;
    log.innerHTML = msgs.length ? msgs.map(m => `<li>${frogImg(COLORS[m.color] ? m.color : 0, 'emo')} <b style="color:${(COLORS[m.color] || COLORS[0]).hex}">${esc(m.name)}</b>${withFrogs(m.text)}</li>`).join('')
      : '<li class="empty">Say hi while you wait! Tap a frog to add it to your message.</li>';
    if (atBottom || msgs.length && msgs[msgs.length - 1].id === myId) log.scrollTop = log.scrollHeight;
  }

  function pickColor(i) {
    sfx.play('frog', i);
    store.set('froggy-color', i);
    room.ref.child('players').transaction(cur => {
      if (!cur || !cur[myId]) return;
      if (Object.entries(cur).some(([id, p]) => id !== myId && p && p.color === i)) return;
      cur[myId].color = i;
      return cur;
    });
  }

  // Host: the next round's room changes. Round numbers start at 1.
  function roundUpdate(st, n, order) {
    const t = now();
    const pic = order[n - 1];
    return { phase: 'draw', round: n, pic, mix: st.craze ? crazeMix(PICS[pic]) : null, starts: t + COUNTDOWN, ends: t + COUNTDOWN + st.secs * 1000, art: null, done: null };
  }
  $('btn-start').onclick = () => {
    const st = room.st, players = playerList(st);
    if (st.host !== myId || players.length < 2) return;
    const order = PICS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    order.length = Math.min(st.rounds, PICS.length);
    const up = { order, ...roundUpdate(st, 1, order) };
    for (const p of players) { up[`players/${p.id}/score`] = 0; up[`players/${p.id}/last`] = null; }
    room.ref.update(up);
  };
  $('btn-lobby-leave').onclick = () => { leaveRoom(); show('menu'); };

  function endRound() {
    const st = room.st, pic = withMix(PICS[st.pic], st.mix).art, up = { phase: 'results', [`art/${myId}`]: art.join('') };
    room.ending = st.round;
    for (const p of playerList(st)) {
      const pct = score(p.id === myId ? art.join('') : (st.art && st.art[p.id]) || EMPTY, pic);
      up[`players/${p.id}/last`] = pct;
      up[`players/${p.id}/score`] = (p.score || 0) + pct;
    }
    room.ref.update(up);
  }
  $('btn-next').onclick = () => {
    if (practice) { showPicker(); return; }
    const st = room && room.st;
    if (!st || st.host !== myId || st.phase !== 'results') return;
    room.ref.update(st.round >= st.order.length ? { phase: 'over' } : roundUpdate(st, st.round + 1, st.order));
  };

  function scheduleSend() {
    if (room.sendTimer) return;
    room.sendTimer = setTimeout(sendArt, Math.max(0, room.lastSend + SEND_GAP - Date.now()));
  }
  function sendArt() {
    const r = room;
    if (!r) return;
    clearTimeout(r.sendTimer);
    r.sendTimer = null;
    r.lastSend = Date.now();
    if (r.st && r.st.phase === 'draw' && r.st.round === r.round) r.ref.child(`art/${myId}`).set(art.join(''));
  }

  function renderPlay() {
    const st = room.st, players = playerList(st), results = st.phase === 'results';
    if (st.round !== room.round) {  // a new round
      room.round = st.round;
      resetDrawing();
      $('btn-leave').textContent = 'Leave';
    }
    show('play');
    const doneNow = Object.keys(st.done || {}).filter(id => id !== myId);
    if (st.phase === 'draw' && doneNow.some(id => !(room.doneSeen || []).includes(id))) sfx.play('pop');
    room.doneSeen = doneNow;
    if (results && room.resultsSound !== st.round) { room.resultsSound = st.round; sfx.play('results'); }
    const pic = currentPic();
    $('what').innerHTML = `Round ${st.round} of ${st.order.length}${st.mix ? ' 🌈' : ''} <small>· ${pic ? esc(pic.name) : 'get ready'}</small>`;
    $('desk').hidden = results;
    $('results').hidden = !results;
    $('btn-done').textContent = isDone() ? '✋ Not done' : '✅ Done';
    $('btn-done').classList.toggle('on', isDone());
    if (results) {
      const last = st.round >= st.order.length, host = st.host === myId;
      $('results-title').textContent = `Round ${st.round} scores`;
      $('results-list').innerHTML = [...players].sort((a, b) => (b.score || 0) - (a.score || 0)).map(p =>
        `<li>${frogImg(p.color)}${esc(p.name)}`
        + `<span class="tag">+${p.last || 0}</span><span class="pts">${p.score || 0}</span></li>`).join('');
      $('btn-next').hidden = !host;
      $('btn-next').textContent = last ? 'See who won' : 'Next round';
      const hostName = (players.find(p => p.id === st.host) || {}).name;
      $('results-wait').textContent = host ? '' : `Waiting for ${hostName}…`;
    }
    layout();
    renderBoard(players, { results, done: results ? {} : st.done || {}, art: id => (st.art && st.art[id]) || EMPTY });
    if (!results) paintArt(easel, art, true);
    tick();
  }

  function renderOver() {
    const st = room.st, players = playerList(st).sort((a, b) => (b.score || 0) - (a.score || 0));
    if ($('over').hidden) sfx.play('win');
    show('over');
    const top = players[0].score || 0, winners = players.filter(p => (p.score || 0) === top);
    $('over-frogs').innerHTML = winners.map(p => frogImg(p.color, '')).join('');
    $('over-title').textContent = winners.length > 1
      ? `${winners.map(p => p.name).join(' and ')} tie!` : `${winners[0].name} wins!`;
    $('over-list').innerHTML = players.map((p, i) => `<li>${['🥇', '🥈', '🥉'][i] || ''}`
      + `${frogImg(p.color)}${esc(p.name)}<span class="pts">${p.score || 0}</span></li>`).join('');
    const host = st.host === myId;
    $('btn-again').hidden = !host;
    $('over-wait').textContent = host ? '' : 'The host can start another game.';
  }
  $('btn-again').onclick = () => {
    if (room && room.st.host === myId) room.ref.update({ phase: 'lobby', art: null, done: null, round: 0 });
  };
  $('btn-over-leave').onclick = () => { leaveRoom(); show('menu'); };

  // Leave asks once more first, since it drops you out of the game.
  $('btn-leave').onclick = () => {
    if (practice) { practice = null; show('menu'); return; }
    const b = $('btn-leave');
    if (b.textContent !== 'Sure?') {
      b.textContent = 'Sure?';
      setTimeout(() => { b.textContent = 'Leave'; }, 3000);
      return;
    }
    leaveRoom();
    show('menu');
  };

  // Timer, countdown, and (on the host) ending the round. Runs a few times a second.
  function tick() {
    const st = room && room.st;
    if (!st || $('play').hidden || (st.phase !== 'draw' && st.phase !== 'results')) {
      $('countdown').hidden = true;
      return;
    }
    const t = now(), draw = st.phase === 'draw' && st.round === room.round;
    const waiting = draw && t < st.starts;
    $('countdown').hidden = !waiting;
    if (waiting) {
      const n = Math.ceil((st.starts - t) / 1000);
      $('countdown').innerHTML = `${n}<small>Round ${st.round}</small>`;
      if (room.counted !== `${st.round}:${n}`) { room.counted = `${st.round}:${n}`; sfx.play('count'); }
    } else if (draw && room.went !== st.round && t < st.ends) { room.went = st.round; sfx.play('go'); }
    if (draw && !waiting && board.querySelector('.target .label').textContent === '?') renderPlay();  // reveal the picture
    const left = draw ? Math.max(0, Math.ceil((st.ends - t) / 1000)) : 0;
    $('timer').textContent = draw ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    $('timer').classList.toggle('low', draw && left <= 10);
    if (draw && !waiting && left > 0 && left <= 5 && room.ticked !== `${st.round}:${left}`) { room.ticked = `${st.round}:${left}`; sfx.play('tick'); }
    easel.style.opacity = draw && !canDraw() ? 0.6 : 1;
    if (!draw) return;
    if (t >= st.ends && room.flushed !== st.round) { room.flushed = st.round; sendArt(); sfx.play('timeup'); }
    if (st.host === myId && room.ending !== st.round) {
      const players = playerList(st);
      if (t >= st.ends + GRACE || players.every(p => st.done && st.done[p.id])) endRound();
    }
  }
  setInterval(tick, 200);
})();
