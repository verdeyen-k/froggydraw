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
  const ROUND_CHOICES = [3, 5, 8, 12, PICS.length], SECS_CHOICES = [45, 60, 90, 120, 180];
  const COUNTDOWN = 3000;  // ms of "3, 2, 1" before each round
  const GRACE = 1500;      // ms the host waits after time is up for everyone's last strokes to arrive
  const SEND_GAP = 300;    // ms between uploads of your drawing while you draw
  // Board cells (0-8, row by row) around the picture in cell 4. You always sit at the bottom middle.
  const SEATS = [7, 0, 1, 2, 3, 5, 6, 8];

  // Bump with the ?v= on the scripts in index.html whenever what goes in the room changes.
  // Devices on different versions can't play together, and phones can hang on to an old copy of the page.
  const VERSION = 2;
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
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
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
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      art[Math.round(a.y + (b.y - a.y) * t) * N + Math.round(a.x + (b.x - a.x) * t)] = ch;
    }
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
    if (tool === 'fill') flood(c, paint);
    else { stroke = { id: e.pointerId, last: c }; line(c, c, paint); }
    changed();
  });
  easel.addEventListener('pointermove', e => {
    if (!stroke || e.pointerId !== stroke.id) return;
    const c = cellAt(e);
    if (!c || !canDraw()) return;
    line(stroke.last, c, paint);
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
    b.onclick = () => { paint = ch; markTools(); };
    $('palette').append(b);
  }
  function markTools() {
    for (const b of $('palette').children) b.classList.toggle('on', b.dataset.ch === paint);
    $('tool-pen').classList.toggle('on', tool === 'pen');
    $('tool-fill').classList.toggle('on', tool === 'fill');
  }
  markTools();
  $('tool-pen').onclick = () => { tool = 'pen'; markTools(); };
  $('tool-fill').onclick = () => { tool = 'fill'; markTools(); };
  $('btn-undo').onclick = () => {
    if (!undo.length || !canDraw()) return;
    art = undo.pop().split('');
    changed();
  };
  $('btn-clear').onclick = () => {
    if (!canDraw() || art.every(c => c === '.')) return;
    remember();
    art = EMPTY.split('');
    changed();
  };
  $('btn-done').onclick = () => {
    if (practice) { practice.checked = true; renderPractice(); return; }
    if (!room || !room.st || room.st.phase !== 'draw' || now() >= room.st.ends) return;
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
    if (practice) return PICS[practice.pic];
    const st = room && room.st;
    if (!st || st.pic == null || (st.phase === 'draw' && now() < st.starts)) return null;
    return PICS[st.pic];
  }

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
      label.textContent = p.name + (opts.done && opts.done[p.id] ? ' ✓' : '');
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
  function showPicker() {
    practice = null;
    show('pick');
    for (const [i, b] of [...$('pick-grid').children].entries()) paintArt(b.firstChild, PICS[i].art);
  }
  function startPractice(n) {
    practice = { pic: n, checked: false };
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
    const pic = PICS[practice.pic], pct = score(art.join(''), pic.art);
    $('what').innerHTML = `Practice <small>· copy the ${esc(pic.name)}</small>`;
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
        host: myId, v: VERSION, created: firebase.database.ServerValue.TIMESTAMP, phase: 'lobby', rounds: 5, secs: 90,
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
    show('lobby');
    $('lobby-code').textContent = room.code;
    $('lobby-players').innerHTML = players.map(p => `<li><span class="dot" style="background:${COLORS[p.color].hex}"></span>`
      + `${esc(p.name)}<span class="tag">${[p.id === st.host && 'host', p.id === myId && 'you'].filter(Boolean).join(' · ')}</span></li>`).join('');
    const mine = st.players[myId].color, taken = new Set(players.filter(p => p.id !== myId).map(p => p.color));
    $('lobby-colors').innerHTML = '';
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.style.background = c.hex;
      b.title = c.name;
      b.className = i === mine ? 'mine' : '';
      b.disabled = taken.has(i);
      b.onclick = () => pickColor(i);
      $('lobby-colors').append(b);
    });
    for (const [id, choices, key, unit] of [['set-rounds', ROUND_CHOICES, 'rounds', ''], ['set-secs', SECS_CHOICES, 'secs', ' s']]) {
      const sel = $(id);
      sel.innerHTML = choices.map(v => `<option value="${v}">${v === PICS.length && key === 'rounds' ? `${v} (every picture)` : v + unit}</option>`).join('');
      sel.value = st[key];
      sel.disabled = !host;
      sel.onchange = () => room.ref.update({ [key]: Number(sel.value) });
    }
    $('btn-start').hidden = !host;
    $('btn-start').disabled = players.length < 2;
    const hostName = (players.find(p => p.id === st.host) || {}).name;
    $('lobby-info').textContent = !host ? `Waiting for ${hostName} to start…`
      : players.length < 2 ? 'You need at least 2 players.' : `${players.length} players. Ready when you are!`;
  }

  function pickColor(i) {
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
    return { phase: 'draw', round: n, pic: order[n - 1], starts: t + COUNTDOWN, ends: t + COUNTDOWN + st.secs * 1000, art: null, done: null };
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
    const st = room.st, pic = PICS[st.pic].art, up = { phase: 'results', [`art/${myId}`]: art.join('') };
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
    const pic = currentPic();
    $('what').innerHTML = `Round ${st.round} of ${st.order.length} <small>· ${pic ? esc(pic.name) : 'get ready'}</small>`;
    $('desk').hidden = results;
    $('results').hidden = !results;
    $('btn-done').textContent = isDone() ? '✋ Not done' : '✅ Done';
    $('btn-done').classList.toggle('on', isDone());
    if (results) {
      const last = st.round >= st.order.length, host = st.host === myId;
      $('results-title').textContent = `Round ${st.round} scores`;
      $('results-list').innerHTML = [...players].sort((a, b) => (b.score || 0) - (a.score || 0)).map(p =>
        `<li><span class="dot" style="background:${COLORS[p.color].hex}"></span>${esc(p.name)}`
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
    show('over');
    const top = players[0].score || 0, winners = players.filter(p => (p.score || 0) === top);
    $('over-title').textContent = winners.length > 1
      ? `🐸 ${winners.map(p => p.name).join(' and ')} tie!` : `🐸 ${winners[0].name} wins!`;
    $('over-list').innerHTML = players.map((p, i) => `<li>${['🥇', '🥈', '🥉'][i] || ''}`
      + `<span class="dot" style="background:${COLORS[p.color].hex}"></span>${esc(p.name)}<span class="pts">${p.score || 0}</span></li>`).join('');
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
    if (waiting) $('countdown').innerHTML = `${Math.ceil((st.starts - t) / 1000)}<small>Round ${st.round}</small>`;
    if (draw && !waiting && board.querySelector('.target .label').textContent === '?') renderPlay();  // reveal the picture
    const left = draw ? Math.max(0, Math.ceil((st.ends - t) / 1000)) : 0;
    $('timer').textContent = draw ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    $('timer').classList.toggle('low', draw && left <= 10);
    easel.style.opacity = draw && !canDraw() ? 0.6 : 1;
    if (!draw) return;
    if (t >= st.ends && room.flushed !== st.round) { room.flushed = st.round; sendArt(); }
    if (st.host === myId && room.ending !== st.round) {
      const players = playerList(st);
      if (t >= st.ends + GRACE || players.every(p => st.done && st.done[p.id])) endRound();
    }
  }
  setInterval(tick, 200);
})();
