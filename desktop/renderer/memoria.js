/* Aba "Memória" (Personal Companion): ver, adicionar, editar e apagar o que a Zoe sabe sobre você.
 * Os formulários são montados a partir da descrição dos campos que a API envia. */
'use strict';
window.ZoeMemoria = (function () {
  const $ = (id) => document.getElementById(id);
  let api = null, kinds = [], items = {}, openKinds = new Set();

  const LABELS = {
    titulo: 'Título', autor: 'Autor', capitulo: 'Capítulo', progresso: 'Progresso', status: 'Situação', notas: 'Notas',
    nome: 'Nome', descricao: 'Descrição', frequencia: 'Frequência', categoria: 'Tipo', prazo: 'Prazo', prioridade: 'Prioridade (0 a 3)',
  };
  const CHOICE = {
    quero_ler: 'quero ler', lendo: 'lendo', pausado: 'pausado', lido: 'lido', ativo: 'ativo', concluido: 'concluído',
    alcancado: 'alcançado', pessoal: 'pessoal', profissional: 'profissional',
  };
  const EXAMPLE = {
    livro: 'estou lendo Duna, de Frank Herbert', projeto: 'novo projeto Fluxo, que é um app de finanças',
    objetivo: 'meu objetivo profissional é…', aprender: 'quero aprender Python', hobby: 'meu hobby é tocar violão',
    interesse: 'me interesso por inteligência artificial', filme_serie: 'quero assistir a série Dark',
    musica: 'minha banda favorita é…', adiada: 'vivo adiando a academia',
  };
  const LONG = new Set(['notas', 'descricao']);

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function ago(ts) {
    if (!ts) return '';
    const d = Math.floor((Date.now() / 1000 - ts) / 86400);
    return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`;
  }

  function meta(kind, it) {
    const parts = [];
    if (kind.key === 'livro') {
      if (it.autor) parts.push(it.autor);
      if (it.capitulo) parts.push(`cap. ${it.capitulo}`);
      if (it.progresso) parts.push(it.progresso);
    }
    if (it.categoria && kind.key === 'objetivo') parts.push(CHOICE[it.categoria]);
    if (it.prazo) parts.push(`até ${it.prazo}`);
    if (it.frequencia) parts.push(it.frequencia);
    if (it.status) parts.push(CHOICE[it.status] || it.status);
    const when = ago(it.atualizado_em);
    if (when) parts.push(`falamos ${when}`);
    return parts.join(' · ');
  }

  // ---------------- formulário ----------------
  function form(kind, it, onDone) {
    const f = el('form', 'mem-form');
    f.noValidate = true;
    for (const [name, spec] of Object.entries(kind.fields)) {
      const lab = el('label', LONG.has(name) ? 'wide' : null, LABELS[name] || name);
      let input;
      if (spec.kind === 'choice') {
        input = el('select');
        spec.choices.forEach((c) => { const o = el('option', null, CHOICE[c] || c); o.value = c; input.append(o); });
      } else if (spec.kind === 'int') {
        input = el('input'); input.type = 'number'; input.min = spec.min; input.max = spec.max;
      } else if (LONG.has(name)) {
        input = el('textarea'); input.rows = 3; input.maxLength = spec.max_len;
      } else {
        input = el('input'); input.maxLength = spec.max_len;
      }
      input.name = name;
      if (it && it[name] != null) input.value = it[name];
      if (spec.required) input.required = true;
      lab.append(input);
      f.append(lab);
    }
    const err = el('p', 'mem-err'); err.setAttribute('aria-live', 'polite');
    const row = el('div', 'mem-actions');
    const save = el('button', 'btn primary', it ? 'Salvar' : 'Adicionar'); save.type = 'submit';
    const cancel = el('button', 'btn ghost', 'Cancelar'); cancel.type = 'button';
    cancel.onclick = () => onDone(false);
    row.append(save, cancel);
    f.append(err, row);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = {};
      for (const [name, spec] of Object.entries(kind.fields)) {
        const v = f.elements[name].value;
        if (spec.kind === 'int') { if (v !== '') data[name] = parseInt(v, 10); } else if (it || v.trim()) data[name] = v;
      }
      const r = it
        ? await api('PATCH', `/api/memory/${kind.key}/${it.id}`, data)
        : await api('POST', `/api/memory/${kind.key}`, data);
      if (!r.ok) { err.textContent = r.error; return; }
      onDone(true);
    };
    setTimeout(() => { const first = f.querySelector('input,select,textarea'); if (first) first.focus(); }, 0);
    return f;
  }

  // ---------------- lista ----------------
  function render() {
    const root = $('memList');
    root.replaceChildren();
    const total = Object.values(items).reduce((n, l) => n + l.length, 0);
    $('memSum').textContent = total
      ? `${total} ${total === 1 ? 'coisa guardada' : 'coisas guardadas'}. Só o que você me contou.`
      : 'Ainda não sei nada sobre você. Me conte pelo chat ou adicione aqui.';
    for (const kind of kinds) {
      const list = items[kind.key] || [];
      const sec = el('details', 'mem-kind');
      sec.dataset.kind = kind.key;
      sec.open = openKinds.has(kind.key) || (list.length > 0 && openKinds.size === 0);
      sec.ontoggle = () => { if (sec.open) openKinds.add(kind.key); else openKinds.delete(kind.key); };
      const sum = el('summary');
      sum.append(el('span', 'mem-title', kind.plural), el('span', 'mem-count', String(list.length)));
      sec.append(sum);
      const ul = el('ul', 'mem-items');
      list.forEach((it) => ul.append(itemRow(kind, it)));
      if (!list.length) ul.append(el('li', 'mem-empty', `Diga no chat, por exemplo: “${EXAMPLE[kind.key]}”.`));
      sec.append(ul);
      const add = el('button', 'btn ghost mem-add', `+ Adicionar ${kind.label}`); add.type = 'button';
      add.onclick = () => {
        add.hidden = true;
        const f = form(kind, null, async (changed) => { if (changed) { openKinds.add(kind.key); await load(); } else { f.remove(); add.hidden = false; } });
        sec.append(f);
      };
      sec.append(add);
      root.append(sec);
    }
  }

  function itemRow(kind, it) {
    const li = el('li', 'mem-item');
    li.dataset.id = it.id;
    const text = el('div', 'mem-text');
    text.append(el('b', null, it[kind.name_field]));
    const m = meta(kind, it);
    if (m) text.append(el('small', null, m));
    const notes = it.notas || (kind.key === 'projeto' || kind.key === 'objetivo' ? it.descricao : '');
    if (notes) text.append(el('p', 'mem-notes', notes));
    const edit = el('button', 'icon', '✎'); edit.type = 'button'; edit.setAttribute('aria-label', `Editar ${it[kind.name_field]}`);
    const del = el('button', 'icon', '✕'); del.type = 'button'; del.setAttribute('aria-label', `Apagar ${it[kind.name_field]}`);
    edit.onclick = () => {
      const f = form(kind, it, async (changed) => { if (changed) await load(); else f.replaceWith(li); });
      li.replaceWith(f);
    };
    del.onclick = async () => {
      if (!confirm(`Apagar “${it[kind.name_field]}” da memória da Zoe?`)) return;
      const r = await api('DELETE', `/api/memory/${kind.key}/${it.id}`);
      if (r.ok) await load();
    };
    li.append(text, edit, del);
    return li;
  }

  async function load() {
    const r = await api('GET', '/api/memory');
    if (!r.ok) { $('memSum').textContent = `Não consegui abrir a memória: ${r.error}`; return; }
    kinds = r.data.kinds; items = r.data.items;
    render();
  }

  return {
    init(opts) { api = opts.api; },
    show: load,
  };
})();
