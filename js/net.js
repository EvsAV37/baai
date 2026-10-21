/* «Баай» — игра с разных телефонов по Wi-Fi точке доступа. Интернет не нужен.
   Хост (телефон с приложением) держит партию и считает правила.
   Игроки открывают игру в браузере по QR и только отправляют действия.
   Сервер в приложении лишь пересылает сообщения (см. tools/relay.js — тот же протокол).

   Протокол (всё — JSON):
   игрок → хост:  hello {key,name,figure} · me {name,figure} · claim {seat} · act {a} · ping
   хост → игрок:  lobby {seats,you,minutes} · state {G,me,opts,left,now,online} · full {seats}
                  err {error} · bye · rehello (шлёт сервер, когда хост переподключился)
   хост ↔ сервер: хост шлёт {to:[id…]|"all", m:"строка"}; сервер шлёт хосту
                  {t:"open",id} · {t:"close",id} · {t:"from",id,m:"строка"}
   © 2026 Евсеев А.В. */
(function () {
  'use strict';

  const T = BAAI.theme;
  const E = BAAI.engine;
  const HTTP_PORT = 8080, WS_PORT = 8081;
  const AUCTION_SEC = 15, OFFER_SEC = 45;
  const NET_SAVE = 'baai.net.v1', ME_KEY = 'baai.me.v1';

  const $ = id => document.getElementById(id);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранения */ } },
  };
  const FIG_IDS = T.FIGURES.map(f => f.id);

  const Android = window.BaaiAndroid || null;
  const params = new URLSearchParams(location.search);
  const mode = params.has('join') ? 'client' : (Android || params.has('host')) ? 'host' : 'local';

  const net = {
    mode,                   // 'local' — только на одном телефоне, 'host' — может создать игру, 'client' — игрок
    canHost: mode === 'host',
    inGame: false,          // идёт сетевая партия
    me: null,               // номер моего игрока в партии
    online: null,           // кто на связи (по номерам игроков)
    deadline: 0,            // когда кончится время на ставку/ответ (часы этого телефона)
    skew: 0,                // разница часов хоста и этого телефона
    ui: null,               // ui.js регистрирует себя здесь
  };

  // ---------- соединение с автоматическим переподключением ----------
  function Conn(url, onMsg, onState) {
    let ws = null, closed = false, wait = 800, pingT = 0;
    const open = () => {
      if (closed) return;
      try { ws = new WebSocket(url); } catch (e) { return retry(); }
      ws.onopen = () => {
        wait = 800; onState(true);
        clearInterval(pingT);
        pingT = setInterval(() => this.send({ t: 'ping' }), 15000);
      };
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
      ws.onclose = () => { clearInterval(pingT); onState(false); retry(); };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* уже закрыт */ } };
    };
    const retry = () => { if (!closed) { setTimeout(open, wait); wait = Math.min(wait * 1.5, 3000); } };
    this.send = obj => { if (ws && ws.readyState === 1) { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); return true; } return false; };
    this.close = () => { closed = true; clearInterval(pingT); if (ws) ws.close(); };
    this.ok = () => ws && ws.readyState === 1;
    open();
  }

  function freeFigure(seats, want, except) {
    const taken = seats.filter((_, i) => i !== except).map(s => s.figure);
    if (want && FIG_IDS.includes(want) && !taken.includes(want)) return want;
    return FIG_IDS.find(f => !taken.includes(f)) || FIG_IDS[0];
  }
  const cleanName = (n, fallback) => String(n || '').trim().slice(0, 14) || fallback;

  // ====================================================================
  //  ХОСТ
  // ====================================================================
  const H = {
    conn: null, seats: [], ids: {}, minutes: 0, rules: null, ip: '', ips: [], timer: 0, timerKey: '', autoT: 0,
    linked: false,
  };

  function hostIps() {
    let list = [];
    if (Android && Android.ips) { try { list = JSON.parse(Android.ips()) || []; } catch (e) { list = []; } }
    else if (location.hostname && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') list = [location.hostname];
    else if (params.get('host')) list = [params.get('host')];
    return list;
  }
  const joinUrl = ip => `http://${ip}:${HTTP_PORT}/?join`;
  const hostWs = () => `ws://${Android ? '127.0.0.1' : (location.hostname || '127.0.0.1')}:${WS_PORT}/?role=host`;

  function hostSend(ids, obj) {
    if (!H.conn || !ids.length) return;
    H.conn.send({ to: ids, m: typeof obj === 'string' ? obj : JSON.stringify(obj) });
  }
  const seatConn = i => { for (const id in H.ids) if (H.ids[id] === H.seats[i].key) return Number(id); return null; };
  const seatOf = id => H.seats.findIndex(s => s.key === H.ids[id]);
  // бот всегда «на связи»: его ходы делает телефон хоста
  const onlineList = () => H.seats.map((s, i) => s.key === 'host' || !!s.bot || seatConn(i) !== null);

  function hostLink() {
    if (H.conn) return;
    H.conn = new Conn(hostWs(), hostMsg, ok => {
      H.linked = ok;
      if (!net.inGame) renderLobby();
      else if (net.ui) net.ui.refresh();
    });
  }

  function hostMsg(env) {
    if (env.t === 'open') return;
    if (env.t === 'close') {
      delete H.ids[env.id];
      return seatsChanged();
    }
    if (env.t !== 'from') return;
    let m; try { m = JSON.parse(env.m); } catch (e) { return; }
    const id = env.id;
    if (m.t === 'ping') return;
    if (m.t === 'hello') {
      const key = String(m.key || '').slice(0, 40);
      if (!key || key === 'host') return;
      for (const k in H.ids) if (H.ids[k] === key) delete H.ids[k];   // тот же телефон зашёл заново
      let i = H.seats.findIndex(s => s.key === key);
      if (i < 0) {
        if (net.inGame || H.seats.length >= 6) {
          H.ids[id] = key + '?';
          return hostSend([id], { t: 'full', started: net.inGame, seats: offlineSeats() });
        }
        H.seats.push({ key, name: cleanName(m.name, `Игрок ${H.seats.length + 1}`), figure: freeFigure(H.seats, m.figure, -1) });
        i = H.seats.length - 1;
      }
      H.ids[id] = key;
      return seatsChanged();
    }
    if (m.t === 'claim') {
      const want = Number(m.seat), key = String(H.ids[id] || '').replace(/\?$/, '');
      if (!key || !H.seats[want] || H.seats[want].key === 'host' || H.seats[want].bot || seatConn(want) !== null) {
        return hostSend([id], { t: 'full', started: net.inGame, seats: offlineSeats() });
      }
      H.seats[want].key = key;
      H.ids[id] = key;
      return seatsChanged();
    }
    const i = seatOf(id);
    if (i < 0) return;
    if (m.t === 'me' && !net.inGame) {
      H.seats[i].name = cleanName(m.name, H.seats[i].name);
      H.seats[i].figure = freeFigure(H.seats, m.figure, i);
      return seatsChanged();
    }
    if (m.t === 'act' && net.inGame && m.a && typeof m.a.type === 'string') {
      const a = Object.assign({}, m.a, { player: i });
      const r = net.ui.applyAction(a, { remote: true });
      if (!r.ok) hostSend([id], { t: 'err', error: r.error });
    }
  }

  function offlineSeats() {
    return H.seats.map((s, i) => ({ i, name: s.name, figure: s.figure, color: T.PLAYER[i] }))
      .filter(s => H.seats[s.i].key !== 'host' && !H.seats[s.i].bot && seatConn(s.i) === null);
  }

  function seatsChanged() {
    net.online = onlineList();
    if (net.inGame) { publish({}); if (net.ui) net.ui.refresh(); saveNet(); }
    else { lobbyBroadcast(); renderLobby(); }
  }

  function lobbyBroadcast() {
    const seats = H.seats.map((s, i) => ({ name: s.name, figure: s.figure, color: T.PLAYER[i], bot: !!s.bot, online: s.key === 'host' || !!s.bot || seatConn(i) !== null }));
    H.seats.forEach((s, i) => {
      const id = seatConn(i);
      if (id !== null) hostSend([id], { t: 'lobby', seats, you: i, minutes: H.minutes, rules: H.rules });
    });
  }

  // Разослать всем состояние партии
  function publish(opts) {
    const G = net.ui.getState();
    if (!G) return;
    armTimers(G);
    const left = net.deadline ? Math.max(0, net.deadline - Date.now()) : 0;
    // тайный аукцион: гостям уходит только «ставка сделана», без сумм
    const A = G.auction;
    const base = A && A.sealed ? Object.assign({}, G, { auction: Object.assign({}, A, { bids: Object.fromEntries(Object.keys(A.bids).map(k => [k, A.bids[k] > 0 ? 1 : 0])) }) }) : G;
    const on = JSON.stringify(onlineList()), o = JSON.stringify(opts || {});
    // тайные роли: каждому — только своя роль и уже раскрытые
    const roles = G.rules && G.rules.roles !== 'off' && G.phase !== 'over';
    const forSeat = i => !roles ? base : Object.assign({}, base, { players: base.players.map((p, k) =>
      k === i || p.roleShown ? p : Object.assign({}, p, { role: p.role ? 'hidden' : null, roleUsed: false, trap: false })) });
    const shared = roles ? null : JSON.stringify(base);
    H.seats.forEach((s, i) => {
      const id = seatConn(i);
      if (id === null || s.key === 'host') return;
      hostSend([id], `{"t":"state","me":${i},"left":${left},"now":${Date.now()},"online":${on},"opts":${o},"G":${shared || JSON.stringify(forSeat(i))}}`);
    });
  }

  // Время на ставку и на ответ; выбывший игрок завершает ход сам
  function armTimers(G) {
    const who = E.actor(G);
    const key = G.phase === 'auction' ? `a:${G.auction.cell}:${who}:${G.auction.price}`
      : G.phase === 'offer' ? `o:${G.offer.from}:${who}:${G.seq}` : '';
    if (key !== H.timerKey) {
      clearTimeout(H.timer);
      H.timerKey = key;
      net.deadline = 0;
      if (key) {
        const sec = G.phase === 'auction' ? AUCTION_SEC : OFFER_SEC;
        net.deadline = Date.now() + sec * 1000;
        H.timer = setTimeout(() => {
          const S = net.ui.getState();
          if (!S || H.timerKey !== key) return;
          H.timerKey = '';
          net.deadline = 0;
          net.ui.applyAction({ type: S.phase === 'auction' ? 'pass' : 'reject', player: E.actor(S) }, { remote: true, timeout: true });
        }, sec * 1000);
      }
    }
    clearTimeout(H.autoT);
    if (G.phase === 'end' && G.players[G.turn].bankrupt) {
      H.autoT = setTimeout(() => {
        const S = net.ui.getState();
        if (S && S.phase === 'end' && S.players[S.turn].bankrupt) net.ui.applyAction({ type: 'endTurn', player: S.turn }, { remote: true });
      }, 1500);
    }
  }

  function saveNet() {
    const G = net.ui && net.ui.getState();
    store.set(NET_SAVE, G ? { G, seats: H.seats.map(s => ({ key: s.key, name: s.name, figure: s.figure, bot: !!s.bot })), minutes: H.minutes, rules: H.rules } : null);
  }

  function openLobby() {
    const mine = store.get(ME_KEY) || {};
    if (!H.seats.length) H.seats = [{ key: 'host', name: cleanName(mine.name, 'Игрок 1'), figure: freeFigure([], mine.figure, -1) }];
    net.inGame = false; net.me = 0;
    hostLink();
    H.ips = hostIps();
    if (!H.ips.includes(H.ip)) H.ip = H.ips[0] || '';
    if (Android && Android.keepAwake) Android.keepAwake(true);
    showLobby();
    lobbyBroadcast();
  }

  function startNet() {
    if (H.seats.length < 2) return;
    const h = H.seats[0];
    store.set(ME_KEY, { name: h.name, figure: h.figure });
    const players = H.seats.map((s, i) => ({ name: s.name, color: T.PLAYER[i], figure: s.figure, bot: !!s.bot }));
    net.inGame = true; net.me = 0; net.online = onlineList();
    net.ui.startNetGame(players, H.minutes, H.rules);
    saveNet();
  }

  function resumeNet() {
    const s = store.get(NET_SAVE);
    if (!s || !s.G) return false;
    H.seats = s.seats; H.minutes = s.minutes || 0; H.rules = s.rules || null;
    hostLink();
    H.ips = hostIps(); H.ip = H.ips[0] || '';
    if (Android && Android.keepAwake) Android.keepAwake(true);
    net.inGame = true; net.me = 0; net.online = onlineList();
    net.ui.resumeNetGame(E.migrate(s.G));
    return true;
  }

  // Хост закончил партию — все обратно в комнату
  function backToLobby() {
    net.inGame = false;
    store.set(NET_SAVE, null);
    clearTimeout(H.timer); H.timerKey = ''; net.deadline = 0;
    openLobby();
  }

  function leaveHost() {
    H.seats.forEach((s, i) => { const id = seatConn(i); if (id !== null) hostSend([id], { t: 'bye' }); });
    H.seats = []; H.ids = {};
    net.inGame = false;
    store.set(NET_SAVE, null);
    if (Android && Android.keepAwake) Android.keepAwake(false);
  }

  function qrSVG(text) {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  }

  // ====================================================================
  //  ИГРОК
  // ====================================================================
  const C = { conn: null, linked: false, key: '', lobby: null, full: null, firstState: true, bye: false };

  function clientBoot() {
    C.key = store.get('baai.key');
    if (!C.key) { C.key = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('baai.key', C.key); }
    showLobby();
    C.conn = new Conn(`ws://${location.hostname}:${WS_PORT}/`, clientMsg, ok => {
      C.linked = ok;
      if (ok) hello();
      bar();
      if (!net.inGame) renderLobby();
    });
  }

  function hello() {
    const me = store.get(ME_KEY) || {};
    C.conn.send({ t: 'hello', key: C.key, name: me.name || '', figure: me.figure || '' });
  }

  function clientMsg(m) {
    if (m.t === 'rehello') return hello();
    if (m.t === 'lobby') {
      C.lobby = m; C.full = null; C.bye = false;
      net.me = m.you;
      if (net.inGame) { net.inGame = false; net.ui.leaveGame(); showLobby(); }
      return renderLobby();
    }
    if (m.t === 'full') { C.full = m; C.lobby = null; if (net.inGame) { net.inGame = false; net.ui.leaveGame(); showLobby(); } return renderLobby(); }
    if (m.t === 'bye') {
      C.bye = true; C.lobby = null;
      if (net.inGame) { net.inGame = false; net.ui.leaveGame(); showLobby(); }
      return renderLobby();
    }
    if (m.t === 'err') return net.ui && (net.ui.netErr ? net.ui.netErr(m.error) : net.ui.toast(m.error));
    if (m.t === 'state') {
      net.skew = (m.now || Date.now()) - Date.now();
      net.deadline = m.left ? Date.now() + m.left : 0;
      net.me = m.me; net.online = m.online;
      const first = !net.inGame;
      net.inGame = true;
      C.bye = false;
      $('lobby').hidden = true;
      net.ui.setState(m.G, m.opts || {}, first);
    }
  }

  function clientSendMe(name, figure) {
    store.set(ME_KEY, { name, figure });
    C.conn.send({ t: 'me', name, figure });
  }

  // ====================================================================
  //  КОМНАТА (лобби)
  // ====================================================================
  function showLobby() {
    $('setup').hidden = true;
    $('game').hidden = true;
    $('lobby').hidden = false;
    renderLobby();
  }

  const tok = (fig, color, size) => T.tokenSVG(fig, color, size).replace('<svg ', '<svg aria-hidden="true" ');

  function seatRows(seats, you, removable) {
    return seats.map((s, i) => `<div class="seat${i === you ? ' you' : ''}">${tok(s.figure, s.color, 38)}
      <span class="nm">${esc(s.name)}${i === you ? ' <em>вы</em>' : ''}${i === 0 ? ' <em>хост</em>' : ''}${s.bot ? ' <em class="bot">бот</em>' : ''}</span>
      <span class="dot${s.online ? ' on' : ''}" title="${s.online ? 'на связи' : 'нет связи'}"></span>
      ${removable && i > 0 ? `<button type="button" class="btn sm ghost" data-net="kick" data-i="${i}" aria-label="Убрать ${esc(s.name)}">✕</button>` : ''}</div>`).join('');
  }

  function figurePicker(current, taken, color) {
    return `<div class="figs" role="radiogroup" aria-label="Фигурка">${T.FIGURES.map(f => {
      const busy = taken.includes(f.id) && f.id !== current;
      return `<button type="button" role="radio" aria-checked="${f.id === current}" aria-label="${esc(f.name)}" data-net="fig" data-f="${f.id}" ${busy ? 'disabled' : ''}>${tok(f.id, color, 40)}</button>`;
    }).join('')}</div>`;
  }

  function renderLobby() {
    const el = $('lobby');
    if (!el || el.hidden) return;
    let h = `<header class="setup-head"><h1 class="logo">Баай</h1><p class="tagline">Игра по Wi-Fi</p></header>`;
    if (mode === 'host') {
      const seats = H.seats.map((s, i) => ({ name: s.name, figure: s.figure, color: T.PLAYER[i], bot: !!s.bot, online: s.key === 'host' || !!s.bot || seatConn(i) !== null }));
      const me = H.seats[0];
      h += '<div class="panel qr-panel">';
      if (!H.linked) h += '<p class="notice bad">Сервер игры не отвечает. Перезапустите приложение.</p>';
      if (H.ip) {
        h += `<p class="hint">1. Включите точку доступа на этом телефоне.<br>2. Друзья подключаются к ней и наводят камеру на код.</p>
          <div class="qr">${qrSVG(joinUrl(H.ip))}</div>
          <p class="addr">${esc(joinUrl(H.ip))}</p>`;
        if (H.ips.length > 1) h += `<div class="seg ips">${H.ips.map(ip => `<button type="button" role="radio" aria-checked="${ip === H.ip}" data-net="ip" data-ip="${esc(ip)}">${esc(ip)}</button>`).join('')}</div>`;
        h += `<p class="hint">Если телефон пишет «Нет подключения к интернету», выберите «Оставаться на связи» или «Не отключаться» — интернет для игры не нужен.</p>`;
      } else {
        h += `<p class="notice bad">Точка доступа не найдена. Включите её в настройках телефона и нажмите «Обновить».</p>`;
      }
      h += `<button type="button" class="btn" data-net="refresh">Обновить</button></div>`;
      h += `<div class="panel"><h2 class="h2">Вы</h2>
        <input id="net-name" type="text" maxlength="14" value="${esc(me.name)}" aria-label="Ваше имя">
        ${figurePicker(me.figure, H.seats.slice(1).map(s => s.figure), T.PLAYER[0])}</div>`;
      h += `<div class="panel"><h2 class="h2">Игроки · ${seats.length} из 6</h2>${seatRows(seats, 0, true)}
        ${seats.length < 2 ? '<p class="hint">Ждём, когда подключится хотя бы один игрок, или добавьте бота.</p>' : ''}
        ${seats.length < 6 ? '<button type="button" class="btn" data-net="addBot">Добавить бота</button>' : ''}
        ${seats.some(s => s.bot) ? '<p class="hint">Боты ходят сами, их ходы делает этот телефон. Если подключится ещё человек, а мест нет, уберите бота.</p>' : ''}</div>`;
      h += `<div class="panel"><h2 class="h2">Ограничение по времени</h2><div class="seg">${[[0, 'Нет'], [30, '30 мин'], [60, '60 мин'], [90, '90 мин']].map(([m, t]) =>
        `<button type="button" role="radio" aria-checked="${m === H.minutes}" data-net="min" data-m="${m}">${t}</button>`).join('')}</div></div>`;
      h += `<div class="panel"><h2 class="h2">Правила партии</h2><div class="rules">${net.ui.rulesHTML(H.rules, 'data-nrule')}</div></div>`;
      h += `<button type="button" class="btn primary big" data-net="start" ${seats.length < 2 ? 'disabled' : ''}>Начать игру</button>
        <button type="button" class="btn ghost" data-net="back">Назад</button>`;
    } else {
      if (C.bye) h += '<div class="panel"><p class="notice">Хост закрыл комнату. Когда он создаст новую, игра откроется здесь сама.</p></div>';
      else if (!C.linked) h += '<div class="panel"><p class="notice">Подключаемся к хосту…</p><p class="hint">Телефон должен быть подключён к точке доступа хоста. Если пишет «Нет подключения к интернету», выберите «Оставаться на связи».</p></div>';
      else if (C.full) {
        h += '<div class="panel">';
        if (!C.full.started) h += '<p class="notice">В комнате уже 6 игроков.</p>';
        else if (C.full.seats.length) {
          h += `<p>Партия уже идёт. За кого продолжить?</p><div class="claims">${C.full.seats.map(s =>
            `<button type="button" class="btn" data-net="claim" data-i="${s.i}">${tok(s.figure, s.color, 30)}${esc(s.name)}</button>`).join('')}</div>`;
        } else h += '<p class="notice">Партия уже идёт, все места заняты.</p>';
        h += '</div>';
      } else if (C.lobby) {
        const L = C.lobby, me = L.seats[L.you];
        h += `<div class="panel"><h2 class="h2">Вы</h2>
          <input id="net-name" type="text" maxlength="14" value="${esc(me.name)}" aria-label="Ваше имя">
          ${figurePicker(me.figure, L.seats.filter((_, i) => i !== L.you).map(s => s.figure), me.color)}</div>
          <div class="panel"><h2 class="h2">Игроки · ${L.seats.length} из 6</h2>${seatRows(L.seats, L.you, false)}</div>
          <div class="panel"><h2 class="h2">Правила партии · выбирает хост</h2><div class="rules">${net.ui.rulesHTML(L.rules, '', true)}</div></div>
          <p class="notice center">Ждём, когда хост начнёт игру${L.minutes ? ` (партия на ${L.minutes} мин)` : ''}.</p>`;
      } else h += '<div class="panel"><p class="notice">Подключаемся…</p></div>';
    }
    h += '<p class="copy">© 2026 Евсеев А.В.</p>';
    // не перерисовываем поле ввода, пока в нём печатают
    const typing = document.activeElement && document.activeElement.id === 'net-name' ? document.activeElement.value : null;
    el.innerHTML = h;
    if (typing !== null && $('net-name')) { const i = $('net-name'); i.value = typing; i.focus(); }
  }

  function lobbyClick(e) {
    const r = e.target.closest('[data-nrule]');
    if (r && mode === 'host') { H.rules = Object.assign(E.normRules(H.rules), { [r.dataset.nrule]: r.dataset.v }); return seatsChanged(); }
    const t = e.target.closest('[data-net]');
    if (!t) return;
    const what = t.dataset.net;
    if (mode === 'host') {
      if (what === 'fig') { H.seats[0].figure = freeFigure(H.seats, t.dataset.f, 0); return seatsChanged(); }
      if (what === 'kick') { const i = Number(t.dataset.i); const id = seatConn(i); if (id !== null) { hostSend([id], { t: 'bye' }); delete H.ids[id]; } H.seats.splice(i, 1); return seatsChanged(); }
      if (what === 'min') { H.minutes = Number(t.dataset.m); return seatsChanged(); }
      if (what === 'ip') { H.ip = t.dataset.ip; return renderLobby(); }
      if (what === 'refresh') { H.ips = hostIps(); if (!H.ips.includes(H.ip)) H.ip = H.ips[0] || ''; return renderLobby(); }
      if (what === 'addBot' && H.seats.length < 6) {
        const used = H.seats.map(x => x.name.toLowerCase());
        const name = BAAI.bot.NAMES.find(n => !used.includes(n.toLowerCase())) || `Бот ${H.seats.length + 1}`;
        H.seats.push({ key: 'bot:' + Math.random().toString(36).slice(2, 8), name, figure: freeFigure(H.seats, '', -1), bot: true });
        return seatsChanged();
      }
      if (what === 'start') return startNet();
      if (what === 'back') { leaveHost(); $('lobby').hidden = true; net.ui.showSetup(); return; }
    } else {
      if (what === 'fig' && C.lobby) { const me = C.lobby.seats[C.lobby.you]; me.figure = t.dataset.f; clientSendMe(me.name, t.dataset.f); return renderLobby(); }
      if (what === 'claim') { C.conn.send({ t: 'claim', seat: Number(t.dataset.i) }); return; }
    }
  }

  function lobbyInput(e) {
    if (e.target.id !== 'net-name') return;
    const v = cleanName(e.target.value, '');
    if (!v) return;
    if (mode === 'host') { H.seats[0].name = v; store.set(ME_KEY, { name: v, figure: H.seats[0].figure }); lobbyBroadcast(); }
    else if (C.lobby) { const me = C.lobby.seats[C.lobby.you]; me.name = v; clientSendMe(v, me.figure); }
  }

  // Полоса «нет связи» у игрока
  function bar() {
    const el = $('net-bar');
    if (!el) return;
    el.hidden = mode !== 'client' || !net.inGame || C.linked;
    el.textContent = 'Нет связи с хостом. Переподключаемся…';
  }

  // ====================================================================
  net.boot = function () {
    $('lobby').addEventListener('click', lobbyClick);
    $('lobby').addEventListener('input', lobbyInput);
    if (mode === 'client') clientBoot();
  };
  net.isClient = () => mode === 'client';
  net.isHost = () => mode === 'host' && net.inGame;
  net.hasSave = () => mode === 'host' && !!(store.get(NET_SAVE) || {}).G;
  net.openLobby = openLobby;
  net.resume = resumeNet;
  net.backToLobby = backToLobby;
  net.leave = leaveHost;
  net.publish = opts => { publish(opts); saveNet(); };
  net.send = a => { if (!C.conn || !C.conn.send({ t: 'act', a })) { if (net.ui) net.ui.toast('Нет связи с хостом'); return false; } return true; };
  net.linked = () => mode === 'client' ? C.linked : H.linked;
  net.bar = bar;
  net.joinUrl = () => H.ip ? joinUrl(H.ip) : '';
  net.qr = () => H.ip ? qrSVG(joinUrl(H.ip)) : '';
  net.refreshIps = () => { H.ips = hostIps(); if (!H.ips.includes(H.ip)) H.ip = H.ips[0] || ''; };

  BAAI.net = net;
})();
