/* Aba "Recursos" (PC Companion): medidores leves, minilinhas de CPU/RAM, processos e diagnóstico.
 * Uma cor só (o roxo da Zoe) para magnitude. Acima do limite configurado, o medidor ganha a cor
 * de status, sempre com ícone + texto ("⚠ alto"), nunca só a cor. */
'use strict';
window.ZoeRecursos = (function () {
  const $ = (id) => document.getElementById(id);
  let api = null, send = null, visible = false, sort = 'by_memory', last = null;
  let limits = { ram_pct: 90, cpu_pct: 90, disco_livre_pct: 10, temp_c: 90, bateria_pct: 15 };
  const rows = new Map();

  // ---------------- formatação ----------------
  function fmtB(n) {
    if (n == null) return '—';
    const u = [['TB', 2 ** 40], ['GB', 2 ** 30], ['MB', 2 ** 20], ['KB', 2 ** 10]];
    for (const [s, v] of u) if (n >= v) { const x = n / v; return (x < 100 ? x.toFixed(1) : x.toFixed(0)).replace('.', ',') + ' ' + s; }
    return Math.round(n) + ' B';
  }
  const fmtRate = (n) => (n == null ? '—' : fmtB(n) + '/s');
  const pct = (v) => (v == null ? '—' : Math.round(v) + '%');
  const hhmm = (t) => new Date(t * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // ---------------- peças ----------------
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function row(key, label, opts = {}) {
    if (rows.has(key)) return rows.get(key);
    const r = { root: el('div', 'metric') };
    r.root.dataset.key = key;
    const top = el('div', 'm-top');
    r.label = el('span', 'm-label', label);
    r.status = el('span', 'm-status'); r.status.hidden = true;
    r.val = el('span', 'm-val');
    top.append(r.label, r.status, r.val);
    r.root.append(top);
    if (opts.meter !== false) {
      r.meter = el('div', 'meter'); r.meter.setAttribute('role', 'meter');
      r.meter.setAttribute('aria-valuemin', '0'); r.meter.setAttribute('aria-valuemax', '100');
      r.meter.setAttribute('aria-label', label);
      r.fill = el('i'); r.meter.append(r.fill); r.root.append(r.meter);
    }
    if (opts.spark) r.spark = sparkline(label);
    if (r.spark) r.root.append(r.spark.wrap);
    r.sub = el('div', 'm-sub'); r.root.append(r.sub);
    $('recBody').append(r.root);
    rows.set(key, r);
    return r;
  }

  function setRow(r, { value, meter, level, sub, word }) {
    r.val.textContent = value;
    if (r.meter) {
      r.meter.hidden = meter == null;   // ex.: sensor que só aparece depois
      const v = Math.max(0, Math.min(100, meter || 0));
      r.fill.style.width = v + '%';
      r.meter.setAttribute('aria-valuenow', String(Math.round(v)));
      r.meter.dataset.level = level || '';
    }
    r.status.hidden = !level;
    r.status.dataset.level = level || '';
    r.status.textContent = level === 'critical' ? '⛔ crítico' : level ? `⚠ ${word || 'alto'}` : '';
    r.sub.textContent = sub || '';
    r.sub.hidden = !sub;
  }

  // minilinha 2px, valor e horário ao passar o mouse (crosshair + ponto + dica)
  function sparkline(label) {
    const W = 300, H = 36, ns = 'http://www.w3.org/2000/svg';
    const wrap = el('div', 'spark');
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${label}: último minuto`);
    const base = document.createElementNS(ns, 'line');
    base.setAttribute('x1', 0); base.setAttribute('x2', W); base.setAttribute('y1', H - 1); base.setAttribute('y2', H - 1);
    base.setAttribute('class', 'sp-base');
    const line = document.createElementNS(ns, 'polyline'); line.setAttribute('class', 'sp-line');
    const cross = document.createElementNS(ns, 'line'); cross.setAttribute('class', 'sp-cross');
    cross.setAttribute('y1', 0); cross.setAttribute('y2', H); cross.style.display = 'none';
    svg.append(base, line, cross);
    const dot = el('span', 'sp-dot'); dot.hidden = true;
    const tip = el('span', 'sp-tip'); tip.hidden = true;
    wrap.append(svg, dot, tip);
    let vals = [], times = [];
    const xy = (i) => [vals.length < 2 ? W : (i / (vals.length - 1)) * W, H - 2 - (Math.min(100, vals[i]) / 100) * (H - 4)];
    function draw(v, t) {
      vals = v; times = t;
      line.setAttribute('points', v.map((_, i) => xy(i).map((n) => n.toFixed(1)).join(',')).join(' '));
    }
    wrap.addEventListener('pointermove', (e) => {
      if (!vals.length) return;
      const b = wrap.getBoundingClientRect();
      const i = Math.max(0, Math.min(vals.length - 1, Math.round(((e.clientX - b.left) / b.width) * (vals.length - 1))));
      const [x, y] = xy(i);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.style.display = '';
      dot.hidden = false; dot.style.left = (x / W) * 100 + '%'; dot.style.top = (y / H) * b.height + 'px';
      tip.hidden = false; tip.textContent = `${pct(vals[i])} · ${hhmm(times[i])}`;
      tip.style.left = Math.min(Math.max((x / W) * b.width, 40), b.width - 40) + 'px';
    });
    wrap.addEventListener('pointerleave', () => { cross.style.display = 'none'; dot.hidden = true; tip.hidden = true; });
    return { wrap, draw };
  }

  const levelFor = (v, lim, critAt) => (v == null ? null : v >= critAt ? 'critical' : v >= lim ? 'warning' : null);

  // ---------------- atualização ----------------
  function update(payload) {
    const s = payload && payload.snapshot;
    if (!s) return;
    last = payload;
    const h = payload.history || { t: [], cpu: [], ram: [] };

    const cpu = row('cpu', 'Processador', { spark: true });
    const c = s.cpu;
    setRow(cpu, { value: pct(c.percent), meter: c.percent, level: levelFor(c.percent, limits.cpu_pct, 101),
      sub: `${c.cores} núcleos${c.freq_mhz ? ` · ${(c.freq_mhz / 1000).toFixed(1).replace('.', ',')} GHz` : ''} · carga ${c.load[0].toFixed(2).replace('.', ',')}` });
    cpu.spark.draw(h.cpu, h.t);

    const ram = row('ram', 'Memória', { spark: true });
    const m = s.memory;
    setRow(ram, { value: `${fmtB(m.used)} de ${fmtB(m.total)}`, meter: m.percent, level: levelFor(m.percent, limits.ram_pct, 95),
      sub: `${pct(m.percent)} em uso` + (m.swap_total ? ` · swap ${pct(m.swap_percent)}` : '') });
    ram.spark.draw(h.ram, h.t);

    const t = s.temperatures || {};
    const temp = row('temp', 'Temperatura da CPU');
    if (t.cpu != null) {
      setRow(temp, { value: `${Math.round(t.cpu)} °C`, meter: t.cpu, level: levelFor(t.cpu, limits.temp_c, Math.max(limits.temp_c + 5, 95)) });
    } else {
      setRow(temp, { value: '—', sub: 'O sistema não informa a temperatura. Instalar o pacote lm-sensors costuma resolver.' });
    }

    const g = s.gpu;
    const gpu = row('gpu', 'GPU');
    if (g) {
      setRow(gpu, { value: pct(g.percent), meter: g.percent,
        sub: [g.name, g.temp != null ? `${Math.round(g.temp)} °C` : null, g.mem_total ? `${fmtB(g.mem_used)} de ${fmtB(g.mem_total)}` : null].filter(Boolean).join(' · ') });
    } else {
      setRow(gpu, { value: '—', sub: 'Uso da GPU indisponível aqui (GPUs Intel não informam sem permissão de administrador).' });
    }

    (s.disks || []).forEach((d) => {
      const r = row('disk:' + d.mount, d.mount === '/' ? 'Disco do sistema' : `Disco ${d.mount}`);
      const free = 100 - d.percent;
      setRow(r, { value: `${fmtB(d.free)} livres`, meter: d.percent,
        level: free < 3 ? 'critical' : free < limits.disco_livre_pct ? 'warning' : null, word: 'pouco espaço', sub: `${pct(d.percent)} de ${fmtB(d.total)} usados` });
    });

    const io = row('io', 'Leitura e gravação', { meter: false });
    setRow(io, { value: `↓ ${fmtRate(s.io.read_bps)}  ↑ ${fmtRate(s.io.write_bps)}` });

    const n = s.network;
    const net = row('net', 'Rede', { meter: false });
    setRow(net, { value: `↓ ${fmtRate(n.down_bps)}  ↑ ${fmtRate(n.up_bps)}`, sub: n.link_mbps ? `conexão de ${n.link_mbps} Mb/s` : '' });

    const b = s.battery;
    if (b) {
      const bat = row('bat', 'Bateria');
      const left = b.secs_left ? ` · ${Math.floor(b.secs_left / 3600)}h${String(Math.floor((b.secs_left % 3600) / 60)).padStart(2, '0')} restantes` : '';
      setRow(bat, { value: pct(b.percent), meter: b.percent,
        level: !b.plugged && b.percent <= 5 ? 'critical' : !b.plugged && b.percent <= limits.bateria_pct ? 'warning' : null, word: 'baixa',
        sub: b.plugged ? 'carregando' : 'na bateria' + left });
    }

    renderProcs();
    $('recSum').textContent = `Atualizado às ${hhmm(s.timestamp)}`;
  }

  function renderProcs() {
    const list = $('procList');
    const groups = ((last && last.snapshot.processes) || {})[sort] || [];
    const top = groups.slice(0, 6);
    const max = Math.max(1, ...top.map((g) => (sort === 'by_memory' ? g.mem_bytes : g.cpu_pct)));
    list.replaceChildren(...top.map((g) => {
      const li = el('li');
      const name = el('span', 'p-name', g.app);
      if (g.processes > 1) name.append(el('small', null, ` · ${g.processes} proc.`));
      const v = sort === 'by_memory' ? g.mem_bytes : g.cpu_pct;
      const val = el('span', 'p-val', sort === 'by_memory' ? fmtB(g.mem_bytes) : `${g.cpu_pct.toFixed(1).replace('.', ',')}%`);
      const bar = el('span', 'p-bar'); const fill = el('i'); fill.style.width = (100 * v) / max + '%'; bar.append(fill);
      li.append(name, val, bar);
      return li;
    }));
  }

  async function diagnose() {
    const btn = $('recDiag'), box = $('recFindings');
    btn.disabled = true; btn.textContent = 'Diagnosticando…';
    const r = await api('GET', '/api/pc/diagnose');
    btn.disabled = false; btn.textContent = 'Diagnosticar';
    box.hidden = false; box.replaceChildren();
    if (!r.ok) { box.append(el('p', 'f-err', `Não consegui: ${r.error}`)); return; }
    if (!r.data.findings.length) {
      const ok = el('div', 'finding ok');
      ok.append(el('b', null, '✓ Nada fora do normal'), el('p', null, r.data.summary));
      box.append(ok);
      return;
    }
    r.data.findings.forEach((f) => {
      const card = el('div', 'finding'); card.dataset.level = f.severity === 'warning' ? 'warning' : 'critical';
      card.append(el('b', null, `${f.severity === 'warning' ? '⚠' : '⛔'} ${f.title}`), el('p', null, f.message), el('p', 'f-sug', f.suggestion));
      box.append(card);
    });
  }

  document.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => {
      sort = b.dataset.sort;
      document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      renderProcs();
    };
  });
  $('recDiag').onclick = diagnose;

  return {
    init(opts) { api = opts.api; send = opts.send; },
    setLimits(l) { if (l) limits = { ...limits, ...l }; },
    unavailable(msg) {
      $('recSum').textContent = msg; $('recDiag').hidden = true;
      $('recBody').hidden = true; document.querySelector('.procs').hidden = true;
    },
    async show() {
      visible = true;
      const r = await api('GET', '/api/pc');
      if (r.ok) update(r.data); else if (r.error) this.unavailable(r.error);
      send({ type: 'pc.subscribe', on: true });
    },
    hide() { if (visible) { visible = false; send({ type: 'pc.subscribe', on: false }); } },
    resubscribe() { if (visible) send({ type: 'pc.subscribe', on: true }); },
    get visible() { return visible; },
    update,
  };
})();
