/* "O que aprendi" (topo da aba Memória) + 👍/👎 e fonte nos balões do chat. */
'use strict';
window.ZoeAprendizado = (function () {
  const $ = (id) => document.getElementById(id);
  let api = null;

  const STATUS = { validada: 'confirmada', fonte: 'com fonte', candidata: 'aguardando 👍' };
  const LAYER = { regras: 'comandos', memoria: 'memória', aprendizado: 'correções', base: 'base aprendida', ia: 'IA', sem_resposta: 'sem resposta' };

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ---------------- balões do chat ----------------
  function decorate(bubble, reply) {
    if (reply.source && reply.source.label) {
      const src = el('div', 'msg-src');
      if (reply.source.url) {
        const a = el('button', 'link', reply.source.label); a.type = 'button';
        a.onclick = () => window.zoe.openExternal(reply.source.url);
        src.append(a);
      } else src.textContent = reply.source.label;
      bubble.append(src);
    }
    if (!reply.feedback || !reply.id) return;
    const row = el('div', 'msg-fb');
    const vote = async (v) => {
      row.replaceChildren(el('span', null, '…'));
      const r = await api('POST', '/api/learning/feedback', { interaction_id: reply.id, vote: v });
      row.replaceChildren(el('span', null, r.ok ? r.data.message : `Não consegui: ${r.error}`));
    };
    const up = el('button', 'fb', '👍'); up.type = 'button'; up.setAttribute('aria-label', 'Resposta certa: pode guardar');
    const down = el('button', 'fb', '👎'); down.type = 'button'; down.setAttribute('aria-label', 'Resposta errada: não repetir');
    up.onclick = () => vote('up'); down.onclick = () => vote('down');
    row.append(up, down);
    bubble.append(row);
  }

  // ---------------- seção "O que aprendi" ----------------
  async function show() {
    const box = $('learnBox');
    const [r, s] = await Promise.all([api('GET', '/api/learning'), api('GET', '/api/settings')]);
    box.replaceChildren();
    if (!r.ok) return;
    const st = r.data.stats;
    const head = el('div', 'learn-head');
    const big = el('b', 'learn-pct', st.sem_ia_pct == null ? '—' : `${st.sem_ia_pct}%`);
    const txt = el('div', 'learn-txt');
    txt.append(el('span', null, 'respondido sem IA'),
      el('small', null, st.total ? `${st.local} de ${st.total} mensagens nos últimos ${st.days} dias` : 'ainda sem conversas registradas'));
    head.append(big, txt);
    if (s.ok && s.data.pesquisa_web) {
      const go = el('button', 'btn ghost', 'Pesquisar agora'); go.type = 'button';
      go.onclick = async () => {
        go.disabled = true; go.textContent = 'Pesquisando…';
        const x = await api('POST', '/api/learning/research', {});
        go.textContent = x.ok ? `Aprendi ${x.data.learned}` : 'Não deu';
        setTimeout(show, 1200);
      };
      head.append(go);
    }
    box.append(head);
    if (st.total) {
      const parts = Object.entries(st.by_layer).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${LAYER[k] || k} ${n}`);
      box.append(el('p', 'learn-layers', parts.join(' · ')));
    }
    const items = r.data.items;
    const det = el('details', 'mem-kind');
    det.open = items.some((i) => i.status === 'candidata');
    const sum = el('summary');
    sum.append(el('span', 'mem-title', 'O que aprendi'), el('span', 'mem-count', String(items.length)));
    det.append(sum);
    const ul = el('ul', 'mem-items');
    if (!items.length) ul.append(el('li', 'mem-empty', 'Quando a IA responder algo certo, toque em 👍 no balão. Para corrigir, escreva “na verdade, …”.'));
    items.slice(0, 40).forEach((k) => {
      const li = el('li', 'mem-item');
      const t = el('div', 'mem-text');
      t.append(el('b', null, k.question));
      t.append(el('small', null, `${STATUS[k.status] || k.status} · ${k.source === 'web' ? `Wikipédia · ${k.title}` : k.source === 'correcao' ? 'você ensinou' : 'resposta da IA'}${k.uses ? ` · usada ${k.uses}x` : ''}`));
      t.append(el('p', 'mem-notes', k.answer.length > 220 ? k.answer.slice(0, 220) + '…' : k.answer));
      li.append(t);
      if (k.status === 'candidata') {
        const ok = el('button', 'icon', '✓'); ok.type = 'button'; ok.setAttribute('aria-label', 'Confirmar esta resposta');
        ok.onclick = async () => { await api('PATCH', `/api/learning/${k.id}`, { status: 'validada' }); show(); };
        li.append(ok);
      } else li.append(el('span'));
      const del = el('button', 'icon', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Esquecer esta resposta');
      del.onclick = async () => { await api('DELETE', `/api/learning/${k.id}`); show(); };
      li.append(del);
      ul.append(li);
    });
    det.append(ul);
    box.append(det);
  }

  return { init(opts) { api = opts.api; }, decorate, show };
})();
