/* Interface da Zoe Desktop: orbe, expressões, balões, conversa e ajustes.
 * Fala com o Zoe Core por WebSocket (tempo real) e por window.zoe.api (REST via processo principal). */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const orb = $('zoe'), face = $('face'), stage = $('stage'), panel = $('panel');
  const bubbles = $('bubbles'), log = $('log'), quick = $('quick'), input = $('input');
  const EXPR = ['pensando', 'curiosa', 'feliz', 'preocupada', 'foco', 'descanso', 'alerta'];
  const SUGESTOES = ['ajuda', 'foco 25', 'status'];

  let calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { if (localStorage.getItem('zoe.calmo') === '1') calmo = true; } catch { /* sem storage */ }
  document.documentElement.toggleAttribute('data-calmo', calmo);

  // ---------------- expressões ----------------
  let base = 'normal', temp = null, tempTimer = null;
  function render() {
    const name = temp || base;
    orb.classList.remove(...EXPR);
    if (name !== 'normal') orb.classList.add(name);
    $('zzz').classList.toggle('on', name === 'descanso' && !calmo);
    orb.dataset.expression = name;
    if (name !== 'normal' && name !== 'curiosa') face.style.transform = '';
  }
  function setBase(name) { base = EXPR.includes(name) ? name : 'normal'; render(); }
  function flash(name, ms) {
    if (!name || name === 'normal') return;
    temp = name; clearTimeout(tempTimer); render();
    tempTimer = setTimeout(() => { temp = null; render(); }, ms || 2200);
  }
  function gesto(cls, ms) { orb.classList.add(cls); setTimeout(() => orb.classList.remove(cls), ms); }

  // olhos seguem o cursor (posição vem do processo principal, relativa à janela)
  window.zoe.on('cursor', (p) => {
    if (calmo || dragging || !['normal', 'curiosa'].includes(temp || base)) return;
    const b = orb.getBoundingClientRect();
    const dx = p.x - (b.left + b.width / 2), dy = p.y - (b.top + b.height / 2);
    const d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / 300) * b.width * 0.08;
    face.style.transform = `translate(calc(-50% + ${(dx / d * m).toFixed(1)}px), calc(-50% + ${(dy / d * m).toFixed(1)}px))`;
  });

  // gestos ao acaso (como no portfólio), só quando ela está tranquila
  (function acaso() {
    setTimeout(() => {
      if (!calmo && !document.hidden && !dragging && !temp && base === 'normal' && !orb.dataset.zfx) {
        const r = Math.random();
        if (r < 0.35) gesto('pisca', 380);
        else if (r < 0.6) gesto('feliz', 1600);
        else if (r < 0.8) gesto('pulo', 800);
      }
      acaso();
    }, 6000 + Math.random() * 8000);
  })();

  // ---------------- modo da janela ----------------
  let panelOpen = false;
  function syncMode() {
    const m = panelOpen ? 'panel' : (bubbles.children.length ? 'bubble' : 'orb');
    stage.dataset.mode = m;
    window.zoe.setMode(m);
  }
  window.zoe.on('layout', (l) => {
    stage.dataset.corner = l.corner;
    document.body.classList.toggle('native-wayland', !!l.nativeWayland);
  });
  window.zoe.on('open-panel', (tab) => openPanel(tab));

  function openPanel(tab) {
    panelOpen = true; syncMode(); panel.hidden = false;
    orb.classList.add('chat');
    selectTab(tab || 'conversa');
    if (!historyLoaded) loadHistory();
    setTimeout(() => input.focus(), 50);
  }
  function closePanel() {
    panelOpen = false; panel.hidden = true; orb.classList.remove('chat'); syncMode();
    window.ZoeRecursos.hide();
  }
  $('closePanel').onclick = closePanel;
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) closePanel(); });

  // ---------------- arrastar x clicar ----------------
  let dragging = false, down = null, justDragged = false;
  orb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY };
    orb.setPointerCapture(e.pointerId);
  });
  orb.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      dragging = true; orb.classList.add('arrastando'); window.zoe.dragStart(down);
    }
    if (dragging) window.zoe.dragMove({ x: e.screenX, y: e.screenY });
  });
  orb.addEventListener('pointerup', () => {
    if (dragging) {
      const b = $('orbBox').getBoundingClientRect();
      window.zoe.dragEnd({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
      justDragged = true; setTimeout(() => { justDragged = false; }, 0);
    }
    dragging = false; down = null; orb.classList.remove('arrastando');
  });
  orb.addEventListener('click', () => { if (justDragged) return; panelOpen ? closePanel() : openPanel(); });
  orb.addEventListener('contextmenu', (e) => { e.preventDefault(); window.zoe.contextMenu(); });

  // ---------------- conexão com o Core ----------------
  let ws = null, state = null, retry = 500, refSeq = 0, offlineReason = '';
  const pending = new Map();
  function setOnline(on) {
    orb.classList.toggle('offline', !on);
    $('connDot').classList.toggle('on', on);
    $('connDot').title = on ? 'conectada ao Zoe Core' : (offlineReason || 'sem conexão com o Zoe Core');
    if (on) offlineReason = '';
  }
  async function connect() {
    const info = await window.zoe.coreInfo();
    if (!info.ok) { offlineReason = info.error || ''; setOnline(false); return scheduleReconnect(); }
    ws = new WebSocket(info.wsUrl);
    ws.onopen = () => { retry = 500; setOnline(true); };
    ws.onclose = () => { setOnline(false); scheduleReconnect(); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'hello' || m.type === 'state') applyState(m.state);
      if (m.type === 'hello') window.ZoeRecursos.resubscribe();
      else if (m.type === 'pc') window.ZoeRecursos.update(m);
      else if (m.type === 'expression') m.ttl_ms ? flash(m.name, m.ttl_ms) : setBase(m.name);
      else if (m.type === 'notification') notify(m.notification);
      else if (m.type === 'chat.reply' && pending.has(m.ref)) { pending.get(m.ref)(m); pending.delete(m.ref); }
    };
  }
  function scheduleReconnect() { setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); }

  function applyState(st) {
    state = st;
    setBase(st.expression);
    window.ZoeRecursos.setLimits(st.settings.pc_limites);
    if (st.pc && !st.pc.available) window.ZoeRecursos.unavailable(st.pc.error || 'Monitor do computador indisponível.');
    window.zoe.reportState({ monitoring: st.monitoring });
    renderFocus();
    $('toggleMonitor').textContent = st.monitoring ? 'Pausar monitoramento' : 'Retomar monitoramento';
    $('monitorHint').textContent = st.monitoring
      ? 'Monitoramento ativo. Tudo é processado só neste computador.'
      : 'Monitoramento e intervenções pausados.';
    if (!$('tab-ajustes').hidden) fillSettings(st.settings);
  }

  // ---------------- foco ----------------
  let focusTick = null;
  function renderFocus() {
    clearInterval(focusTick);
    const chip = $('focusChip'), f = state && state.focus;
    if (!f) { chip.hidden = true; return; }
    const ends = Date.now() + f.remaining_s * 1000;
    const upd = () => {
      const s = Math.max(0, Math.round((ends - Date.now()) / 1000));
      chip.textContent = `Foco ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} ✕`;
    };
    chip.hidden = false; upd(); focusTick = setInterval(upd, 1000);
  }
  $('focusChip').onclick = () => window.zoe.api('POST', '/api/focus/stop', {});

  // ---------------- balões ----------------
  let unread = 0;
  function badge() { const b = $('badge'); b.hidden = !unread; b.textContent = unread > 9 ? '9+' : unread; }
  function ack(id, action) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'notification.ack', id, action })); }

  const OPEN_RECURSOS = new Set(['ver_processos', 'ver_recursos']);
  function notify(n) {
    flash(n.expression, 2600);
    if (!calmo) gesto('pulo', 800);
    if (panelOpen) { addMsg('zoe', n.message); setQuick((n.actions || []).map((a) => a.label), n); return; }
    while (bubbles.children.length >= 3) bubbles.lastElementChild.remove();
    const el = document.createElement('div');
    el.className = 'bubble'; el.setAttribute('role', 'status');
    const txt = document.createElement('div'); txt.textContent = n.message; el.append(txt);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Dispensar');
    let done = false;
    const close = (action) => {
      if (done) return; done = true; clearTimeout(timer);
      if (action) ack(n.id, action); else { unread++; badge(); }
      if (OPEN_RECURSOS.has(action)) openPanel('recursos');
      el.classList.add('sai'); setTimeout(() => { el.remove(); syncMode(); }, 200);
    };
    x.onclick = (e) => { e.stopPropagation(); close('dismiss'); };
    el.append(x);
    if (n.actions && n.actions.length) {
      const acts = document.createElement('div'); acts.className = 'acts';
      n.actions.forEach((a) => {
        const b = document.createElement('button'); b.className = 'chip'; b.textContent = a.label;
        b.onclick = (e) => { e.stopPropagation(); close(a.id); };
        acts.append(b);
      });
      el.append(acts);
    }
    el.onclick = () => { close('dismiss'); openPanel('conversa'); };
    const timer = setTimeout(() => close(null), n.actions && n.actions.length ? 30000 : 12000);
    bubbles.prepend(el);
    syncMode();
  }

  // ---------------- conversa ----------------
  let historyLoaded = false;
  function addMsg(who, text) {
    const empty = log.querySelector('.empty'); if (empty) empty.remove();
    const m = document.createElement('div'); m.className = 'msg ' + who; m.textContent = text;
    log.append(m); log.scrollTop = log.scrollHeight; return m;
  }
  function setQuick(list, note) {
    quick.replaceChildren();
    (list && list.length ? list : SUGESTOES).forEach((label, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label;
      b.onclick = () => {
        if (note) {
          const id = note.actions[i].id;
          ack(note.id, id); setQuick();
          if (OPEN_RECURSOS.has(id)) selectTab('recursos');
        } else send(label);
      };
      quick.append(b);
    });
  }
  async function loadHistory() {
    const r = await window.zoe.api('GET', '/api/interactions?limit=50');
    if (!r.ok) return;
    historyLoaded = true; log.replaceChildren();
    r.data.forEach((it) => { if (it.context) addMsg('eu', it.context); if (it.response) addMsg('zoe', it.response); });
    if (!r.data.length) {
      const e = document.createElement('p'); e.className = 'empty';
      e.textContent = 'Oi! Eu sou a Zoe. Escreva "ajuda" para ver o que já sei fazer.';
      log.append(e);
    }
    setQuick();
  }
  function send(text) {
    text = text.trim();
    if (!text) return;
    addMsg('eu', text); input.value = '';
    if (!ws || ws.readyState !== 1) {
      addMsg('zoe', offlineReason
        ? `Não consigo responder ainda. ${offlineReason}`
        : 'Estou sem conexão com o meu serviço local agora. Tento de novo em instantes.');
      flash('preocupada', 2500); return;
    }
    const typing = addMsg('zoe typing', ''); typing.innerHTML = '<i></i><i></i><i></i>';
    temp = 'pensando'; render();
    const ref = ++refSeq;
    pending.set(ref, (m) => {
      typing.remove(); temp = null; render();
      addMsg('zoe', m.text); flash(m.expression, 2400); setQuick(m.quick_replies);
    });
    ws.send(JSON.stringify({ type: 'chat', text, ref }));
  }
  $('composer').onsubmit = (e) => { e.preventDefault(); send(input.value); };

  // ---------------- abas ----------------
  function selectTab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['conversa', 'recursos', 'avisos', 'ajustes'].forEach((t) => { $('tab-' + t).hidden = t !== name; });
    if (name === 'recursos') window.ZoeRecursos.show(); else window.ZoeRecursos.hide();
    if (name === 'avisos') loadNotes();
    if (name === 'ajustes') loadSettings();
  }
  document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => selectTab(b.dataset.tab); });

  const STATUS = { entregue: 'entregue', lida: 'lida', respondida: 'respondida', bloqueada: 'segurada', pendente: 'não entregue' };
  async function loadNotes() {
    unread = 0; badge();
    const r = await window.zoe.api('GET', '/api/notifications?limit=50');
    const ul = $('noteList'); ul.replaceChildren();
    if (!r.ok || !r.data.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nenhum aviso ainda.'; ul.append(li); return; }
    r.data.forEach((n) => {
      const li = document.createElement('li'); li.textContent = n.message;
      const s = document.createElement('small');
      s.textContent = `${new Date(n.scheduled_at * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${n.category} · ${STATUS[n.status] || n.status}`;
      li.append(s); ul.append(li);
    });
  }

  // ---------------- ajustes ----------------
  const form = $('tab-ajustes');
  async function loadSettings() {
    const r = await window.zoe.api('GET', '/api/settings');
    if (r.ok) fillSettings(r.data);
    $('calmo').checked = calmo;
  }
  function fillSettings(s) {
    for (const el of form.elements) {
      if (!el.name || el === document.activeElement) continue;
      const [k, sub] = el.name.split('.');
      const v = sub ? (s[k] || {})[sub] : s[k];
      if (v === undefined) continue;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    }
  }
  let savedTimer = null;
  form.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'calmo') {
      calmo = el.checked; document.documentElement.toggleAttribute('data-calmo', calmo);
      try { localStorage.setItem('zoe.calmo', calmo ? '1' : '0'); } catch { /* ok */ }
      render(); return;
    }
    if (!el.name) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') { v = parseInt(v, 10); if (!Number.isFinite(v)) return; }
    const [k, sub] = el.name.split('.');
    const r = await window.zoe.api('PATCH', '/api/settings', sub ? { [k]: { [sub]: v } } : { [k]: v });
    const out = $('saved'); clearTimeout(savedTimer);
    out.style.color = r.ok ? '' : 'var(--danger)';
    out.textContent = r.ok ? 'Salvo.' : `Não salvei: ${r.error}`;
    savedTimer = setTimeout(() => { out.textContent = ''; }, 2500);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('toggleMonitor').onclick = () => window.zoe.api('POST', '/api/monitoring', { active: !(state && state.monitoring) });
  $('emergency').onclick = () => window.zoe.api('POST', '/api/emergency-stop', {});
  $('wipe').onclick = async () => {
    if (!confirm('Apagar conversas, avisos, eventos e dados pessoais guardados pela Zoe? Isso não pode ser desfeito.')) return;
    const r = await window.zoe.api('POST', '/api/personal-data/delete', { confirm: 'APAGAR' });
    if (r.ok) { historyLoaded = false; log.replaceChildren(); loadSettings(); $('saved').textContent = 'Dados apagados.'; }
  };

  window.ZoeRecursos.init({
    api: window.zoe.api,
    send: (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
  });
  setOnline(false);
  render();
  connect();
})();
