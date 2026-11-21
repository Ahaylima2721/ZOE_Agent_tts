/* Ajustes → Inteligência artificial: liga/desliga, escolhe o modelo, mostra o status do Ollama
 * e baixa o modelo (só quando o usuário clica), com barra de progresso. */
'use strict';
window.ZoeIA = (function () {
  const $ = (id) => document.getElementById(id);
  let api = null, st = null;

  const MB = (n) => (n / 2 ** 20).toFixed(0) + ' MB';

  function render() {
    if (!st) return;
    $('iaAtiva').checked = st.enabled;
    const sel = $('iaModelo');
    if (!sel.options.length) {
      st.models.forEach((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.append(o); });
    }
    if (![...sel.options].some((o) => o.value === st.model)) {
      const o = document.createElement('option'); o.value = st.model; o.textContent = st.model; sel.append(o);
    }
    sel.value = st.model;
    const status = $('iaStatus'), hint = $('iaHint'), btn = $('iaPull');
    const pulling = st.pull && !st.pull.done;
    if (!st.enabled) status.textContent = 'Desligada: a Zoe usa só as respostas locais.';
    else if (!st.ollama) status.textContent = 'Ollama não encontrado neste computador.';
    else if (st.model_installed) status.textContent = `Pronta: ${st.model} (Ollama ${st.version}). Tudo roda neste computador.`;
    else status.textContent = `Ollama ${st.version} encontrado. Falta baixar o modelo.`;
    status.dataset.ok = String(st.enabled && st.ollama && st.model_installed);
    hint.hidden = !(st.enabled && !st.ollama);
    btn.hidden = !(st.enabled && st.ollama && !st.model_installed) || pulling;
    btn.textContent = `Baixar ${st.model}`;
    pullView(st.pull);
  }

  function pullView(p) {
    const box = $('iaPullBox');
    box.hidden = !p || (p.done && !p.error);
    if (!p) return;
    const pct = p.total ? Math.round((100 * p.completed) / p.total) : 0;
    $('iaPullFill').style.width = pct + '%';
    $('iaPullMeter').setAttribute('aria-valuenow', String(pct));
    $('iaPullText').textContent = p.error ? `Não consegui baixar: ${p.error}`
      : p.total ? `${p.status} · ${MB(p.completed)} de ${MB(p.total)} (${pct}%)` : p.status;
  }

  async function refresh() {
    const r = await api('GET', '/api/ai');
    if (r.ok) { st = r.data; render(); }
  }

  async function patch(data) {
    const r = await api('PATCH', '/api/settings', data);
    const out = $('saved');
    out.style.color = r.ok ? '' : 'var(--danger)';
    out.textContent = r.ok ? 'Salvo.' : `Não salvei: ${r.error}`;
    await refresh();
  }

  $('iaAtiva').onchange = (e) => patch({ ia_ativa: e.target.checked });
  $('iaModelo').onchange = (e) => patch({ ia_modelo: e.target.value });
  $('iaPull').onclick = async () => {
    $('iaPull').hidden = true;
    const r = await api('POST', '/api/ai/pull', {});
    if (!r.ok) { $('iaPullBox').hidden = false; $('iaPullText').textContent = r.error; return; }
    pullView(r.data.pull);
  };

  return {
    init(opts) { api = opts.api; },
    show: refresh,
    onPull(p) {
      if (st && p.model && p.model !== st.model) return;     // download de outro modelo (ex.: embeddings)
      if (st) st.pull = p;
      pullView(p);
      if (p.done) refresh();
    },
  };
})();
