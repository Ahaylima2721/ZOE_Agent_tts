/* Janela principal da Zoe: Início (painel), Assistente, Tarefas, Foco, Relatórios, Memória, Computador, Configurações.
 * Tudo vem do Zoe Core (REST via window.zoe.api + WebSocket). Nenhum número é inventado. */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const api = window.zoe.api;
  const CAT = { estudo: 'Estudo', trabalho: 'Trabalho', geral: 'Geral', lazer: 'Lazer' };
  const CAT_ORDER = ['estudo', 'trabalho', 'geral', 'lazer'];   // ordem em anel validada (cores vizinhas distinguíveis)
  let state = null, dash = null, page = 'inicio', ws = null, retry = 500, refSeq = 0;
  const pending = new Map(), streaming = new Map();

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------------- navegação ----------------
  function go(name) {
    page = name;
    document.querySelectorAll('.nav button').forEach((b) => {
      if (b.dataset.page === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.page').forEach((p) => { p.hidden = p.dataset.page !== name; });
    if (name === 'computador') window.ZoeRecursos.show(); else window.ZoeRecursos.hide();
    if (name === 'inicio' || name === 'relatorios' || name === 'foco') loadDashboard();
    if (name === 'tarefas') loadTasks();
    if (name === 'memoria') { window.ZoeMemoria.show(); window.ZoeAprendizado.show(); }
    if (name === 'configuracoes') { loadSettings(); window.ZoeIA.show(); window.ZoeBusca.show(); }
    if (name === 'assistente') { if (!historyLoaded) loadHistory(); setTimeout(() => $('input').focus(), 30); }
  }
  document.querySelectorAll('.nav button').forEach((b) => { b.onclick = () => go(b.dataset.page); });
  document.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => go(b.dataset.goto); });
  window.zoe.on('open-page', (p) => go(p));

  // ---------------- conexão ----------------
  function setOnline(on, why) {
    $('onlineDot').classList.toggle('on', on);
    $('onlineTxt').textContent = on ? 'Zoe Online' : 'Zoe offline';
    $('onlineSub').textContent = on ? 'Sempre por perto!' : (why || 'Reconectando…');
    $('heroOrb').classList.toggle('offline', !on);
  }
  async function connect() {
    const info = await window.zoe.coreInfo();
    if (!info.ok) { setOnline(false, info.error); return later(); }
    ws = new WebSocket(info.wsUrl);
    ws.onopen = () => { retry = 500; setOnline(true); loadDashboard(); };
    ws.onclose = () => { setOnline(false); later(); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'hello' || m.type === 'state') applyState(m.state);
      if (m.type === 'hello') window.ZoeRecursos.resubscribe();
      else if (m.type === 'expression') setExpression(m.name, m.ttl_ms);
      else if (m.type === 'pc') window.ZoeRecursos.update(m);
      else if (m.type === 'changed') { if (m.what === 'tasks') { loadDashboard(); if (page === 'tarefas') loadTasks(); } }
      else if (m.type === 'chat.delta' && streaming.has(m.ref)) streaming.get(m.ref)(m.text);
      else if (m.type === 'chat.reply' && pending.has(m.ref)) { pending.get(m.ref)(m); pending.delete(m.ref); }
      else if (m.type === 'ai.pull') { window.ZoeIA.onPull(m.pull); window.ZoeBusca.onPull(m.pull); }
      else if (m.type === 'notification' && m.notification.category === 'foco') loadDashboard();
    };
  }
  function later() { setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); }
  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  function applyState(st) {
    const hadFocus = !!(state && state.focus);
    state = st;
    setExpression(st.expression, 0);
    window.ZoeRecursos.setLimits(st.settings.pc_limites);
    if (st.pc && !st.pc.available) window.ZoeRecursos.unavailable(st.pc.error || 'Monitor do computador indisponível.');
    renderFocus();
    $('toggleMonitor').textContent = st.monitoring ? 'Pausar monitoramento' : 'Retomar monitoramento';
    $('monitorHint').textContent = st.monitoring ? 'Monitoramento ativo. Tudo é processado só neste computador.' : 'Monitoramento e intervenções pausados.';
    if (hadFocus !== !!st.focus) loadDashboard();
  }

  // ---------------- orbe grande ----------------
  const EXPR = ['pensando', 'curiosa', 'feliz', 'preocupada', 'foco', 'descanso', 'alerta'];
  let baseExpr = 'normal', exprTimer = null;
  function setExpression(name, ttl) {
    const orb = $('heroOrb');
    const apply = (n) => { orb.classList.remove(...EXPR); if (EXPR.includes(n)) orb.classList.add(n); };
    clearTimeout(exprTimer);
    if (ttl) { apply(name); exprTimer = setTimeout(() => apply(baseExpr), ttl); } else { baseExpr = name || 'normal'; apply(baseExpr); }
  }
  addEventListener('pointermove', (e) => {        // olhos seguem o mouse dentro da janela
    if (page !== 'inicio' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const b = $('heroOrb').getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
    const d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / 400) * b.width * 0.07;
    $('heroFace').style.transform = `translate(calc(-50% + ${(dx / d * m).toFixed(1)}px), calc(-50% + ${(dy / d * m).toFixed(1)}px))`;
  }, { passive: true });

  // ---------------- painel ----------------
  async function loadDashboard() {
    const r = await api('GET', '/api/dashboard');
    if (!r.ok) return;
    dash = r.data;
    $('hello').textContent = dash.saudacao;
    $('summary').textContent = ' ' + dash.resumo;
    $('statusTxt').textContent = dash.status.label;
    $('statusPill').dataset.kind = dash.status.kind;
    renderToday(dash.hoje);
    bars($('prodBars'), dash.produtividade.dias, 'foco_min', (d) => `${d.dia} · ${d.foco_min} min de foco · ${d.tarefas} ${d.tarefas === 1 ? 'tarefa' : 'tarefas'}`,
      'Faça uma sessão de foco para ver sua semana aqui.');
    delta($('prodDelta'), dash.produtividade.variacao_pct);
    donut($('catsBody'), dash.categorias);
    // relatórios
    bars($('repFocus'), dash.produtividade.dias, 'foco_min', (d) => `${d.dia} · ${d.foco_min} min`, 'Sem sessões de foco nos últimos 7 dias.');
    bars($('repTasks'), dash.produtividade.dias, 'tarefas', (d) => `${d.dia} · ${d.tarefas} ${d.tarefas === 1 ? 'tarefa' : 'tarefas'}`, 'Nenhuma tarefa concluída nos últimos 7 dias.');
    delta($('repDelta'), dash.produtividade.variacao_pct);
    donut($('repCats'), dash.categorias);
    $('repNoAi').textContent = dash.numeros.sem_ia_pct == null ? '—' : `${dash.numeros.sem_ia_pct}%`;
    $('focusToday').textContent = `Hoje: ${dash.numeros.foco_min_hoje} min de foco · ${dash.numeros.tarefas_hoje} ${dash.numeros.tarefas_hoje === 1 ? 'tarefa concluída' : 'tarefas concluídas'}`;
    const lr = await api('GET', '/api/learning');
    if (lr.ok && lr.data.stats.total) {
      const L = { regras: 'comandos', memoria: 'memória', aprendizado: 'correções', base: 'base aprendida', ia: 'IA', sem_resposta: 'sem resposta' };
      $('repLayers').textContent = 'Quem respondeu (30 dias): ' + Object.entries(lr.data.stats.by_layer).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${L[k] || k} ${n}`).join(' · ');
    }
  }

  function delta(node, pct) {
    node.hidden = pct == null;
    if (pct == null) return;
    node.textContent = `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}%`;
    node.classList.toggle('down', pct < 0);
    node.title = 'em relação aos 7 dias anteriores';
  }

  const BAR_AREA = 120;   // px: altura útil das barras (o .bars tem 150 px, o resto é o rótulo do dia)
  function bars(root, days, key, label, emptyText) {
    root.replaceChildren();
    const max = Math.max(...days.map((d) => d[key]));
    if (!max) root.append(el('p', 'chart-empty', emptyText));
    days.forEach((d) => {
      const b = el('div', 'bar' + (d.hoje ? ' today' : ''));
      b.tabIndex = 0;
      b.setAttribute('aria-label', label(d));
      const col = el('div', 'col'); col.style.height = `${Math.round(BAR_AREA * (max ? Math.max(0.03, d[key] / max) : 0.03))}px`;
      if (!max) col.style.opacity = '.25';                // semana vazia: só o "chão" das barras
      b.append(col, el('span', 'd', d.dia), el('span', 'tip', label(d)));
      root.append(b);
    });
  }

  function donut(root, cats) {
    root.replaceChildren();
    if (!cats.length) { root.append(el('p', 'chart-empty', 'As categorias aparecem quando você faz sessões de foco (Estudo, Trabalho, Lazer).')); return; }
    const ordered = CAT_ORDER.map((id) => cats.find((c) => c.id === id)).filter(Boolean);
    const ns = 'http://www.w3.org/2000/svg', R = 42, C = 2 * Math.PI * R, gap = ordered.length > 1 ? 2.5 : 0;
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'donut');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', ordered.map((c) => `${c.nome} ${c.pct}%`).join(', '));
    let offset = 0;
    const total = ordered.reduce((n, c) => n + c.minutos, 0) || 1;
    ordered.forEach((c) => {
      const len = (C * c.minutos) / total;
      const s = document.createElementNS(ns, 'circle');
      s.setAttribute('cx', 50); s.setAttribute('cy', 50); s.setAttribute('r', R);
      s.setAttribute('stroke', `var(--c-${c.id})`);
      s.setAttribute('stroke-dasharray', `${Math.max(0.5, len - gap)} ${C}`);
      s.setAttribute('stroke-dashoffset', String(-offset));
      const t = document.createElementNS(ns, 'title'); t.textContent = `${c.nome}: ${c.minutos} min (${c.pct}%)`; s.append(t);
      svg.append(s);
      offset += len;
    });
    const legend = el('ul', 'legend');
    ordered.forEach((c) => {
      const li = el('li'); const sw = el('span', 'sw'); sw.style.background = `var(--c-${c.id})`;
      li.append(sw, el('span', null, `${c.nome} · ${c.minutos} min`), el('b', null, `${c.pct}%`));
      legend.append(li);
    });
    root.append(svg, legend);
  }

  // ---------------- tarefas ----------------
  function taskRow(t, opts = {}) {
    const li = el('li', t.concluida ? 'done' : '');
    const tick = el('button', 'tick'); tick.type = 'button'; tick.setAttribute('role', 'checkbox');
    tick.setAttribute('aria-checked', String(t.concluida)); tick.setAttribute('aria-label', `Concluir ${t.titulo}`);
    tick.onclick = async () => { await api('PATCH', `/api/tasks/${t.id}`, { concluida: !t.concluida }); };
    const txt = el('span', 't', t.titulo);
    li.append(tick, txt);
    if (opts.meta) {
      const meta = el('small'); const dot = el('span', 'cat-dot'); dot.style.background = `var(--c-${t.categoria})`;
      const when = t.para ? new Date(t.para + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'sem data';
      meta.append(dot, `${CAT[t.categoria] || t.categoria} · ${when}`);
      li.append(meta);
      const del = el('button', 'del', '✕'); del.type = 'button'; del.setAttribute('aria-label', `Apagar ${t.titulo}`);
      del.onclick = async () => { if (confirm(`Apagar a tarefa “${t.titulo}”?`)) await api('DELETE', `/api/tasks/${t.id}`); };
      li.append(del);
    }
    return li;
  }
  function renderToday(list) {
    const ul = $('todayList'); ul.replaceChildren();
    if (!list.length) ul.append(el('li', 'empty', 'Nada para hoje ainda. Anote abaixo ou diga “nova tarefa …”.'));
    list.forEach((t) => ul.append(taskRow(t)));
  }
  $('quickAdd').onsubmit = async (e) => {
    e.preventDefault();
    const v = $('quickAddInput').value.trim(); if (!v) return;
    const r = await api('POST', '/api/tasks', { titulo: v });
    if (r.ok) $('quickAddInput').value = '';
  };
  let taskScope = 'hoje';
  async function loadTasks() {
    const r = await api('GET', `/api/tasks?escopo=${taskScope}`);
    const ul = $('taskList'); ul.replaceChildren();
    if (!r.ok) return;
    if (!r.data.length) ul.append(el('li', 'empty', taskScope === 'hoje' ? 'Nenhuma tarefa para hoje.' : 'Nenhuma tarefa ainda.'));
    r.data.forEach((t) => ul.append(taskRow(t, { meta: true })));
  }
  document.querySelectorAll('#taskFilter button').forEach((b) => {
    b.onclick = () => {
      taskScope = b.dataset.scope;
      document.querySelectorAll('#taskFilter button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      loadTasks();
    };
  });
  const form = $('taskForm');
  form.elements.para.value = new Date().toLocaleDateString('sv-SE');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = { titulo: form.elements.titulo.value, categoria: form.elements.categoria.value, para: form.elements.para.value || null };
    const r = await api('POST', '/api/tasks', data);
    $('taskErr').textContent = r.ok ? '' : r.error;
    if (r.ok) { form.elements.titulo.value = ''; form.elements.titulo.focus(); }
  };

  // ---------------- foco ----------------
  let tick = null, chosenMin = 25, chosenCat = 'estudo';
  function chipGroup(id, attr, onPick) {
    document.querySelectorAll(`#${id} button`).forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(`#${id} button`).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        onPick(b.dataset[attr]);
        renderFocus();
      };
    });
  }
  chipGroup('focusMins', 'min', (v) => { chosenMin = Number(v); });
  chipGroup('focusCat', 'cat', (v) => { chosenCat = v; });

  function btn(text, cls, fn) { const b = el('button', 'btn ' + cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function actions(root, f, withSelect) {
    root.replaceChildren();
    if (!f) {
      if (withSelect) {
        const sel = el('select'); sel.setAttribute('aria-label', 'Categoria');
        CAT_ORDER.forEach((c) => { const o = el('option', null, CAT[c]); o.value = c; sel.append(o); });
        sel.value = chosenCat; sel.onchange = () => { chosenCat = sel.value; };
        root.append(sel);
      }
      root.append(btn(`▶ Iniciar ${withSelect ? (state ? state.settings.foco_minutos_padrao : 25) : chosenMin} min`, 'primary', () =>
        api('POST', '/api/focus/start', { minutes: withSelect ? undefined : chosenMin, categoria: chosenCat })));
      return;
    }
    root.append(f.paused ? btn('▶ Continuar', 'primary', () => api('POST', '/api/focus/resume', {}))
      : btn('❚❚ Pausar', 'outline', () => api('POST', '/api/focus/pause', {})));
    root.append(btn('■ Parar', '', () => api('POST', '/api/focus/stop', {})));
  }
  function renderFocus() {
    clearInterval(tick);
    const f = state && state.focus;
    actions($('focusActions'), f, true);
    actions($('focusActionsBig'), f, false);
    $('focusSetup').hidden = !!f;
    const C = 263.9;
    const draw = () => {
      let remaining, total;
      if (f) {
        const elapsedLocal = f.paused ? 0 : (Date.now() - drawStart) / 1000;
        remaining = Math.max(0, f.remaining_s - elapsedLocal);
        total = f.minutes * 60;
      } else {
        total = (page === 'foco' ? chosenMin : (state ? state.settings.foco_minutos_padrao : 25)) * 60;
        remaining = total;
      }
      const label = f ? (f.paused ? 'Pausado' : `Sessão atual · ${CAT[f.category] || ''}`) : 'Pronta para começar';
      $('focusTime').textContent = mmss(f ? remaining : (state ? state.settings.foco_minutos_padrao : 25) * 60);
      $('focusTimeBig').textContent = mmss(f ? remaining : chosenMin * 60);
      $('focusLabel').textContent = label; $('focusLabelBig').textContent = f ? label : `${CAT[chosenCat]} · ${chosenMin} min`;
      const frac = f ? 1 - remaining / total : 0;
      $('focusRing').style.strokeDashoffset = String(C * (1 - frac));
      $('focusRingBig').style.strokeDashoffset = String(C * (1 - frac));
    };
    const drawStart = Date.now();
    draw();
    if (f && !f.paused) tick = setInterval(draw, 1000);
  }

  // ---------------- assistente ----------------
  let historyLoaded = false;
  const log = $('log'), quick = $('quick'), input = $('input');
  function addMsg(who, text) {
    const empty = log.querySelector('.empty'); if (empty) empty.remove();
    const m = el('div', 'msg ' + who, text); log.append(m); log.scrollTop = log.scrollHeight; return m;
  }
  function setQuick(list) {
    quick.replaceChildren();
    (list && list.length ? list : ['ajuda', 'minhas tarefas', 'como está o pc']).forEach((label) => {
      const b = el('button', 'chip', label); b.type = 'button'; b.onclick = () => sendChat(label); quick.append(b);
    });
  }
  async function loadHistory() {
    const r = await api('GET', '/api/interactions?limit=50');
    if (!r.ok) return;
    historyLoaded = true; log.replaceChildren();
    r.data.forEach((it) => { if (it.context) addMsg('eu', it.context); if (it.response) addMsg('zoe', it.response); });
    if (!r.data.length) log.append(el('p', 'empty', 'Oi! Eu sou a Zoe. Escreva "ajuda" para ver o que já sei fazer.'));
    setQuick();
  }
  function sendChat(text) {
    text = text.trim(); if (!text) return;
    addMsg('eu', text); input.value = '';
    if (!ws || ws.readyState !== 1) { addMsg('zoe', 'Estou sem conexão com o meu serviço local agora.'); return; }
    const typing = addMsg('zoe typing', ''); typing.innerHTML = '<i></i><i></i><i></i>';
    setExpression('pensando', 60000);
    const ref = ++refSeq;
    streaming.set(ref, (piece) => {
      if (typing.classList.contains('typing')) { typing.classList.replace('typing', 'streaming'); typing.textContent = ''; }
      typing.textContent += piece; log.scrollTop = log.scrollHeight;
    });
    pending.set(ref, (m) => {
      streaming.delete(ref);
      const bubble = addMsg('zoe', m.text); typing.replaceWith(bubble);
      window.ZoeAprendizado.decorate(bubble, m);
      setExpression(m.expression || 'normal', 2400); setQuick(m.quick_replies);
      log.scrollTop = log.scrollHeight;
    });
    send({ type: 'chat', text, ref });
  }
  $('composer').onsubmit = (e) => { e.preventDefault(); sendChat(input.value); };

  // ---------------- configurações ----------------
  const sform = $('settingsForm');
  async function loadSettings() {
    const r = await api('GET', '/api/settings');
    if (!r.ok) return;
    for (const e of sform.elements) {
      if (!e.name || e === document.activeElement) continue;
      const [k, sub] = e.name.split('.');
      const v = sub ? (r.data[k] || {})[sub] : r.data[k];
      if (v === undefined) continue;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = Array.isArray(v) ? v.join(', ') : v;
    }
  }
  let savedTimer = null;
  sform.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.name) return;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.type === 'number') { v = parseInt(v, 10); if (!Number.isFinite(v)) return; }
    if (t.hasAttribute('data-list')) v = v.split(',').map((x) => x.trim()).filter(Boolean);
    const [k, sub] = t.name.split('.');
    const r = await api('PATCH', '/api/settings', sub ? { [k]: { [sub]: v } } : { [k]: v });
    const out = $('saved'); clearTimeout(savedTimer);
    out.style.color = r.ok ? '' : 'var(--danger)';
    out.textContent = r.ok ? 'Salvo.' : `Não salvei: ${r.error}`;
    savedTimer = setTimeout(() => { out.textContent = ''; }, 2500);
  });
  sform.addEventListener('submit', (e) => e.preventDefault());
  $('toggleMonitor').onclick = () => api('POST', '/api/monitoring', { active: !(state && state.monitoring) });
  $('emergency').onclick = () => api('POST', '/api/emergency-stop', {});
  $('wipe').onclick = async () => {
    if (!confirm('Apagar conversas, avisos, tarefas, memória e o que a Zoe aprendeu? Isso não pode ser desfeito.')) return;
    const r = await api('POST', '/api/personal-data/delete', { confirm: 'APAGAR' });
    if (r.ok) { historyLoaded = false; log.replaceChildren(); loadSettings(); loadDashboard(); $('saved').textContent = 'Dados apagados.'; }
  };

  // ---------------- início ----------------
  window.ZoeRecursos.init({ api, send });
  window.ZoeMemoria.init({ api });
  window.ZoeIA.init({ api });
  window.ZoeAprendizado.init({ api });
  window.ZoeBusca.init({ api });
  setOnline(false);
  renderFocus();
  connect();
  setInterval(() => { if (page === 'inicio' && ws && ws.readyState === 1) loadDashboard(); }, 60000);   // vira o dia, muda a saudação
})();
