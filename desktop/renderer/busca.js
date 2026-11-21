/* Configurações → Busca por significado (R1): modelo de embeddings, download, calibração e resultado. */
'use strict';
window.ZoeBusca = (function () {
  const $ = (id) => document.getElementById(id);
  let api = null, st = null;
  const pct = (x) => String(x).replace('.', ',');

  function render() {
    if (!st || !$('semBox')) return;
    const sel = $('semModelo');
    if (!sel.options.length) st.models.forEach((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.append(o); });
    if (![...sel.options].some((o) => o.value === st.model)) { const o = document.createElement('option'); o.value = st.model; o.textContent = st.model; sel.append(o); }
    sel.value = st.model;
    const c = st.calibration;
    let text;
    if (!st.enabled) text = 'Desligada: a Zoe compara só palavras.';
    else if (!st.ollama) text = 'Precisa do Ollama rodando (veja acima).';
    else if (!st.model_installed) text = `Falta baixar o modelo ${st.model}.`;
    else if (!c) text = 'Modelo pronto. Ele é calibrado sozinho na primeira pergunta, ou agora pelo botão.';
    else text = `Ativa: reconhece ${c.acertos} de ${c.pares} perguntas reformuladas do teste em português, sem confundir nenhuma diferente `
      + `(limiar ${pct(c.direto)}; contexto a partir de ${pct(c.contexto)}). ${st.indexed} ${st.indexed === 1 ? 'item indexado' : 'itens indexados'}.`;
    $('semStatus').textContent = text;
    $('semStatus').dataset.ok = String(!!(st.enabled && c && st.model_installed));
    $('semPull').hidden = !(st.enabled && st.ollama && !st.model_installed);
    $('semPull').textContent = `Baixar ${st.model}`;
    $('semCal').hidden = !(st.enabled && st.model_installed);
    $('semCal').textContent = c ? 'Calibrar de novo' : 'Calibrar agora';
  }

  async function refresh() {
    const r = await api('GET', '/api/semantic');
    if (r.ok) { st = r.data; render(); }
  }

  function bind() {
    if (!$('semBox')) return;
    $('semModelo').addEventListener('change', () => setTimeout(refresh, 300));     // o PATCH sai pelo formulário
    $('semBox').querySelector('[name="emb_ativo"]').addEventListener('change', () => setTimeout(refresh, 300));
    $('semPull').onclick = async () => {
      $('semPull').hidden = true;
      const r = await api('POST', '/api/ai/pull', { model: st.model });
      $('semPullBox').hidden = false;
      $('semPullText').textContent = r.ok ? 'Baixando…' : r.error;
    };
    $('semCal').onclick = async () => {
      $('semCal').disabled = true; $('semStatus').textContent = 'Calibrando com os pares em português…';
      const r = await api('POST', '/api/semantic/calibrate', {});
      $('semCal').disabled = false;
      if (!r.ok) { $('semStatus').textContent = `Não consegui calibrar: ${r.error}`; return; }
      refresh();
    };
  }

  return {
    init(opts) { api = opts.api; bind(); },
    show: refresh,
    onPull(p) {
      if (!st || !$('semBox') || p.model !== st.model) return;
      const box = $('semPullBox'); box.hidden = !!(p.done && !p.error);
      const v = p.total ? Math.round((100 * p.completed) / p.total) : 0;
      $('semPullFill').style.width = v + '%';
      $('semPullText').textContent = p.error ? `Não consegui baixar: ${p.error}` : `${p.status} ${p.total ? `(${v}%)` : ''}`;
      if (p.done) refresh();
    },
  };
})();
