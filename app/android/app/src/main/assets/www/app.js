/* Zoe · telas do app. Conversa com o Android pela ponte window.Zoe (MainActivity.Ponte). */
(function () {
  'use strict';

  var Z = window.Zoe || null; // sem Android: ponte falsa, criada no fim do arquivo
  var S = null;               // estado vindo do Android
  var rota = 'hoje';          // aba, editor ou tela interna atual
  var pilha = [];             // de onde viemos (para o botão voltar)
  var E = null;               // módulo de Estudos (estudos.js)
  var lemb = null;            // rascunho dos lembretes
  var rec = null;             // rascunho dos ajustes da bolinha
  var passo = 0;              // passo das boas-vindas
  var rascunho = {};          // edições ainda não salvas
  var apps = null;            // lista de apps instalados (carrega uma vez)
  var busca = '';
  var duracao = 25;
  var relogio = null;
  var erro = '';

  var PASSOS = ['ola', 'habitos', 'viloes', 'agenda', 'jeito', 'perms'];
  var EDITORES = ['habitos', 'viloes', 'agenda', 'jeito', 'perms'];
  var INTERNAS = ['trilha', 'novaTrilha', 'pilula', 'conversa', 'ia', 'lembretes', 'resumo', 'bolinha'];
  var ABAS = ['hoje', 'estudos', 'foco', 'zoe'];
  var DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  var DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var UTEIS = [1, 2, 3, 4, 5];
  var HABITOS_SUGERIDOS = [
    { id: 'agua', nome: 'Beber água', pontos: 10 },
    { id: 'ler', nome: 'Ler 10 páginas', pontos: 15 },
    { id: 'exercicio', nome: 'Exercício', pontos: 20 },
    { id: 'estudar', nome: 'Estudar', pontos: 20 },
    { id: 'dormir', nome: 'Dormir antes das 23h', pontos: 15 },
    { id: 'meditar', nome: 'Meditar 5 minutos', pontos: 10 }
  ];
  var TONS = [
    { id: 'gentil', nome: 'Gentil', humor: 'feliz', exemplo: 'Opa, acho que você abriu sem querer. Bora voltar?' },
    { id: 'firme', nome: 'Firme', humor: 'foco', exemplo: 'Ei! A gente combinou foco até as 12h. Volta pra tarefa!' },
    { id: 'brava', nome: 'Brava', humor: 'brava', exemplo: 'Não. Fecha isso agora.' }
  ];

  // ---------------- utilidades ----------------
  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function carregar() { S = JSON.parse(Z.estado()); }
  function doisDig(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(min) { return doisDig(Math.floor(min / 60)) + ':' + doisDig(min % 60); }
  function paraMin(v) { var p = String(v).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10); }
  function hora(ms) { var d = new Date(ms); return doisDig(d.getHours()) + ':' + doisDig(d.getMinutes()); }
  function tempo(min) { if (min < 60) return min + ' min'; return Math.floor(min / 60) + 'h' + (min % 60 ? ' ' + doisDig(min % 60) + 'min' : ''); }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }
  function ico(path, tam) {
    return '<svg width="' + (tam || 22) + '" height="' + (tam || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  var I = {
    voltar: '<path d="M15 18l-6-6 6-6"/>',
    casa: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    estudo: '<path d="M2 7l10-4 10 4-10 4z"/><path d="M6 9v5c0 2 3 3 6 3s6-1 6-3V9"/>',
    alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
    zoe: '<circle cx="12" cy="12" r="8"/><path d="M9.5 10v1M14.5 10v1"/>',
    olho: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    camadas: '<rect x="3" y="3" width="13" height="13" rx="2"/><rect x="8" y="8" width="13" height="13" rx="2"/>',
    sino: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    relogio: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3L2 6M19 3l3 3"/>',
    bateria: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2M6 11v2"/>',
    mao: '<path d="M8 13V5a2 2 0 0 1 4 0v6M12 11V4a2 2 0 0 1 4 0v7M16 11V6a2 2 0 0 1 4 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-3-5a2 2 0 0 1 3-2l2 2"/>',
    escudo: '<path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    certo: '<path d="M5 12l5 5 9-10"/>',
    seta: '<path d="M9 6l6 6-6 6"/>',
    fogo: '<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5"/>',
    livro: '<path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M19 19v2H6"/>',
    balao: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    externo: '<path d="M10 14L21 3M15 3h6v6M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
    chave: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"/>',
    grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    canteiro: '<path d="M2.5 20c6-2 13-2 19 0"/><path d="M12 19c0-4 0-6.5.6-9.5"/><path d="M12.3 12.5c-3.3 0-5.6-2.2-6-5.2 3.3 0 5.6 2 6 5.2z"/><path d="M12.6 10.5c1.9-2.8 4.5-3.9 6.9-3.5-.6 2.8-3.4 4.3-6.9 3.5z"/>',
    livroAberto: '<path d="M12 6.5c-2.3-1.5-5.1-1.9-8.3-1.5v12c3.2-.4 6 0 8.3 1.5 2.3-1.5 5.1-1.9 8.3-1.5V5c-3.2-.4-6 0-8.3 1.5z"/><path d="M12 6.5v12"/>',
    redoma: '<path d="M4.5 20v-7.5a7.5 7.5 0 0 1 15 0V20"/><path d="M2.5 20h19"/><path d="M8.5 9.5c.8-1.4 1.9-2.2 3.3-2.5"/>',
    zoeRosto: '<path d="M12 21c-4.7 0-8-3.1-8-7s3.4-7 8-7 8 3.1 8 7-3.3 7-8 7z"/><path d="M12 7c0-1.5.4-2.8 1.3-3.7"/><path d="M9.5 13v1.5M14.5 13v1.5"/>'
  };

  function orbe(tam, humor, extraStyle) {
    var quieta = /animation:\s*none/.test(extraStyle || '');
    var estilo = (extraStyle || '').replace(/animation:[^;]*;?/g, '');
    return ZoeAnim.html(tam, humor, {
      estilo: estilo, quieta: quieta, oculos: !!(E && E.oculos()), flor: !!(S && S.sequencia >= 7),
      rotulo: 'Zoe' + (humor ? ' ' + nomeHumor(humorPrincipal(humor)) : '')
    });
  }
  function humorPrincipal(h) { return (String(h || '').split(/\s+/).filter(function (x) { return x && x !== 'respira' && x !== 'flutua'; })[0]) || ''; }

  // ---------------- animações da Zoe (zoe-anim.js) ----------------
  var animPendente = null;
  /** Toca uma animação na Zoe principal da tela, depois do próximo desenho. */
  function animar(nome, dados, atraso) { animPendente = { nome: nome, dados: dados, atraso: atraso || 80 }; }
  function tocarPendente() {
    if (!animPendente) return;
    var a = animPendente; animPendente = null;
    setTimeout(function () { ZoeAnim.tocar(a.alvo ? document.querySelector(a.alvo) : ZoeAnim.principal(), a.nome, a.dados); }, a.atraso);
  }
  function nomeHumor(h) {
    return { feliz: 'feliz', sono: 'sonolenta', foco: 'concentrada', brava: 'brava', triste: 'triste', pensa: 'pensativa' }[h] || '';
  }
  function humorPorEnergia(e) { return e >= 70 ? 'feliz' : (e < 35 ? 'sono' : ''); }

  function permsLiberadas() {
    var p = S.perms;
    return ['uso', 'sobrepor', 'notificacoes', 'alarmes', 'bateria'].filter(function (k) { return p[k]; }).length;
  }
  function essenciaisOk() { return S.perms.uso && S.perms.sobrepor; }

  // ---------------- render ----------------
  function render() {
    clearInterval(relogio);
    var html;
    if (!S.onboarded) {
      html = telaBoasVindas();
    } else if (EDITORES.indexOf(rota) >= 0) {
      html = telaEditor(rota);
    } else if (INTERNAS.indexOf(rota) >= 0) {
      html = telaInterna(rota);
    } else {
      html = telaAba(rota) + nav();
    }
    $('#app').innerHTML = html;
    document.body.style.background = (S.onboarded && rota === 'foco' && S.foco.ativo) ? 'var(--noite-fundo)' : '';
    depoisDeRender();
  }

  function depoisDeRender() {
    tocarPendente();
    if (S.onboarded && rota === 'foco' && S.foco.ativo) {
      relogio = setInterval(atualizarTimer, 1000);
      atualizarTimer();
    }
    if ((rota === 'viloes' || (!S.onboarded && PASSOS[passo] === 'viloes')) && apps === null) {
      setTimeout(function () {
        try { apps = JSON.parse(Z.apps()); } catch (e) { apps = []; }
        if (!rascunho.vigiados || (!rascunho.vigiados.length && !S.vigiados.length)) iniciarRascunho('viloes');
        render();
      }, 30);
    }
  }

  // ---------------- boas-vindas ----------------
  var jaAcenou = false;
  function telaBoasVindas() {
    var p = PASSOS[passo];
    if (p === 'ola') {
      if (!jaAcenou) { jaAcenou = true; animar('oi', { texto: 'oi!' }, 2400); }
      return '<section class="tela centro">' + orbe(170, 'feliz') +
        '<h1 class="grande">Oi! Eu sou a Zoe.</h1>' +
        '<p class="texto">Eu cuido do seu foco e você cuida de mim. Se abrir o Instagram na hora do foco, leva um peteleco.</p>' +
        '<p class="sub">Leva uns 2 minutos pra me configurar.</p>' +
        '<div class="rodape" style="width:100%"><button class="btn principal" data-acao="avancar">Bora!</button></div></section>';
    }
    var barra = '<div class="progresso" role="img" aria-label="Passo ' + passo + ' de 5">' +
      [1, 2, 3, 4, 5].map(function (i) { return '<i class="' + (i <= passo ? 'on' : '') + '"></i>'; }).join('') + '</div>';
    var topo = '<div class="topo"><button class="voltar" data-acao="voltar" aria-label="Voltar">' + ico(I.voltar) + '</button>' + barra + '</div>';
    return '<section class="tela">' + topo + conteudo(p) + rodape(p, true) + '</section>';
  }

  function telaEditor(p) {
    var titulos = { habitos: 'Hábitos', viloes: 'Apps vigiados', agenda: 'Horários de foco', jeito: 'Jeito da Zoe', perms: 'Permissões' };
    var topo = '<div class="topo"><button class="voltar" data-acao="voltar" aria-label="Voltar">' + ico(I.voltar) + '</button><h1>' + titulos[p] + '</h1></div>';
    return '<section class="tela">' + topo + conteudo(p, true) + rodape(p, false) + '</section>';
  }

  function iniciarRascunho(p) {
    if (p === 'habitos') rascunho.habitos = S.habitos.length ? copia(S.habitos) : [];
    if (p === 'viloes') {
      var v = S.vigiados.slice();
      if (!v.length && apps) v = apps.filter(function (a) { return a.sugerido; }).map(function (a) { return a.pacote; });
      rascunho.vigiados = v;
    }
    if (p === 'agenda') rascunho.blocos = S.blocos.length ? copia(S.blocos) : (S.onboarded ? [] : [{ dias: UTEIS.slice(), inicio: 540, fim: 720 }]);
    if (p === 'jeito') { rascunho.tom = S.tom; }
  }

  function conteudo(p, editor) {
    if (!rascunho[{ habitos: 'habitos', viloes: 'vigiados', agenda: 'blocos', jeito: 'tom', perms: 'x' }[p]] && p !== 'perms') iniciarRascunho(p);
    if (p === 'habitos') return conteudoHabitos(editor);
    if (p === 'viloes') return conteudoViloes(editor);
    if (p === 'agenda') return conteudoAgenda(editor);
    if (p === 'jeito') return conteudoJeito(editor);
    if (p === 'perms') return conteudoPerms(editor);
    return '';
  }

  function rodape(p, boasVindas) {
    var txt = 'Salvar';
    if (boasVindas) txt = 'Continuar';
    if (p === 'viloes') txt = 'Vigiar ' + (rascunho.vigiados || []).length + ' apps';
    if (p === 'perms') {
      if (!boasVindas) return '';
      txt = essenciaisOk() ? 'Tudo pronto, começar!' : 'Continuar mesmo assim';
    }
    var nota = (p === 'perms' && boasVindas && !essenciaisOk())
      ? '<p class="sub" style="text-align:center">Sem as duas essenciais eu não consigo dar o peteleco. Dá pra liberar depois em Zoe › Permissões.</p>' : '';
    var e = erro ? '<p class="erro" role="alert">' + esc(erro) + '</p>' : '';
    return '<div class="rodape">' + e + nota + '<button class="btn principal" data-acao="salvar" data-arg="' + p + '">' + esc(txt) + '</button></div>';
  }

  // ---------- hábitos ----------
  function conteudoHabitos(editor) {
    var escolhidos = rascunho.habitos;
    var ids = escolhidos.map(function (h) { return h.id; });
    var todos = HABITOS_SUGERIDOS.concat(escolhidos.filter(function (h) {
      return !HABITOS_SUGERIDOS.some(function (s) { return s.id === h.id; });
    }));
    var cab = editor ? '' :
      '<div class="balao">' + orbe(64, 'feliz') + '<p>Quais hábitos você quer cuidar? Cada um que você cumprir me dá energia.</p></div>' +
      '<h2 class="titulo">Seus hábitos</h2>';
    return cab + '<ul class="lista">' + todos.map(function (h) {
      var on = ids.indexOf(h.id) >= 0;
      return '<li><button class="linha escolha" aria-pressed="' + on + '" data-acao="escolherHabito" data-arg="' + esc(h.id) + '">' +
        '<span class="check">' + (on ? ico(I.certo, 14).replace('stroke="currentColor"', 'stroke="#FFF" stroke-width="3.5"') : '') + '</span>' +
        '<span class="meio"><strong>' + esc(h.nome) + '</strong></span><span class="pts">+' + h.pontos + '</span></button></li>';
    }).join('') + '</ul>' +
      '<div class="campo"><label for="novo-habito">Criar o meu</label><div class="linha-campo">' +
      '<input id="novo-habito" class="entrada" type="text" maxlength="40" placeholder="Ex.: Tomar sol 10 min">' +
      '<button class="btn secundario pequeno" data-acao="criarHabito">' + ico(I.mais, 18) + 'Criar</button></div></div>';
  }

  // ---------- vilões ----------
  function conteudoViloes(editor) {
    var cab = editor ? '' :
      '<div class="balao">' + orbe(64, '') + '<p>Me diz quais apps te roubam tempo. No horário de foco, eu fico de olho neles.</p></div>' +
      '<h2 class="titulo">Quem são os seus vilões?</h2>';
    var semUso = !S.perms.uso
      ? '<div class="aviso">' + ico(I.olho) + '<p>Libere "ver qual app está aberto" pra eu mostrar quanto tempo você passa em cada um.</p>' +
        '<button class="btn secundario pequeno" data-acao="liberar" data-arg="uso">Liberar</button></div>' : '';
    if (apps === null) return cab + semUso + '<p class="vazio">Procurando seus apps…</p>';
    var v = rascunho.vigiados;
    var termo = busca.trim().toLowerCase();
    var lista = apps.filter(function (a) { return !termo || a.nome.toLowerCase().indexOf(termo) >= 0; });
    return cab + semUso +
      '<div class="campo"><label class="sr" for="busca">Buscar app</label>' +
      '<input id="busca" class="entrada" type="search" placeholder="Buscar app" value="' + esc(busca) + '" data-campo="busca"></div>' +
      '<ul class="lista" id="lista-apps">' + linhasApps(lista, v) + '</ul>';
  }
  function linhasApps(lista, v) {
    if (!lista.length) return '<li class="vazio">Nenhum app encontrado.</li>';
    return lista.map(function (a) {
      var on = v.indexOf(a.pacote) >= 0;
      var img = a.icone ? '<img class="icone-app" alt="" src="' + a.icone + '">' : '<span class="letra" aria-hidden="true">' + esc(a.nome.charAt(0)) + '</span>';
      var det = a.minutos > 0 ? tempo(a.minutos) + ' por dia' : (a.sugerido ? 'Costuma roubar tempo' : '');
      return '<li><button class="linha" role="switch" aria-checked="' + on + '" data-acao="vigiar" data-arg="' + esc(a.pacote) + '">' + img +
        '<span class="meio"><strong>' + esc(a.nome) + '</strong>' + (det ? '<span class="det">' + det + '</span>' : '') + '</span>' +
        '<span class="interruptor" aria-hidden="true"></span><span class="sr">Vigiar ' + esc(a.nome) + '</span></button></li>';
    }).join('');
  }

  // ---------- agenda ----------
  function conteudoAgenda(editor) {
    var cab = editor ? '' :
      '<div class="balao">' + orbe(64, 'foco') + '<p>Quando você quer que eu fique de guarda? Fora desses horários eu não vigio nada.</p></div>' +
      '<h2 class="titulo">Horários de foco</h2>';
    var presets = '<div class="chips">' +
      '<button class="chip-btn" data-acao="preset" data-arg="540-720">Manhã 9h–12h</button>' +
      '<button class="chip-btn" data-acao="preset" data-arg="840-1080">Tarde 14h–18h</button>' +
      '<button class="chip-btn" data-acao="preset" data-arg="1140-1320">Noite 19h–22h</button></div>';
    var blocos = rascunho.blocos.map(function (b, i) {
      return '<div class="card" style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="chips" role="group" aria-label="Dias do horário ' + (i + 1) + '">' + DIAS.map(function (d, di) {
          return '<button class="chip-btn" aria-pressed="' + (b.dias.indexOf(di) >= 0) + '" data-acao="dia" data-arg="' + i + ':' + di + '">' + d + '</button>';
        }).join('') + '</div>' +
        '<div class="linha-campo" style="align-items:flex-end">' +
        '<div class="campo" style="flex:1"><label for="ini-' + i + '">Começa</label><input id="ini-' + i + '" class="entrada" type="time" value="' + hhmm(b.inicio) + '" data-campo="inicio" data-i="' + i + '"></div>' +
        '<div class="campo" style="flex:1"><label for="fim-' + i + '">Termina</label><input id="fim-' + i + '" class="entrada" type="time" value="' + hhmm(b.fim) + '" data-campo="fim" data-i="' + i + '"></div>' +
        '<button class="voltar" style="background:#FFF1EC;color:var(--peteleco-escuro)" data-acao="removerBloco" data-arg="' + i + '" aria-label="Remover horário ' + (i + 1) + '">' + ico(I.lixo, 20) + '</button>' +
        '</div></div>';
    }).join('');
    return cab + presets + (blocos || '<p class="vazio">Nenhum horário ainda. Escolha um acima ou crie o seu.</p>') +
      '<button class="btn secundario" data-acao="novoBloco">' + ico(I.mais, 18) + 'Adicionar horário</button>' +
      '<p class="sub">Também dá pra fechar a estufa quando quiser, na aba Estufa.</p>';
  }

  // ---------- jeito ----------
  function conteudoJeito(editor) {
    var cab = editor ? '' : '<h2 class="titulo">Que jeito de Zoe você quer?</h2><p class="sub">Isso muda o tom das broncas. Dá pra trocar quando quiser.</p>';
    return cab + '<div role="radiogroup" aria-label="Tom da Zoe" style="display:flex;flex-direction:column;gap:10px">' + TONS.map(function (t) {
      var on = rascunho.tom === t.id;
      return '<button class="linha escolha" role="radio" aria-checked="' + on + '" aria-pressed="' + on + '" data-acao="tom" data-arg="' + t.id + '" style="align-items:flex-start">' +
        orbe(48, t.humor, 'animation:none') +
        '<span class="meio"><strong>' + t.nome + '</strong><span class="det" style="white-space:normal">“' + esc(t.exemplo) + '”</span></span></button>';
    }).join('') + '</div>' ;
  }

  // ---------- permissões ----------
  var PERMS = [
    { grupo: 'Essenciais', itens: [
      { id: 'uso', ico: I.olho, nome: 'Ver qual app está aberto', porque: 'É assim que eu sei que você abriu o Instagram no horário de foco. Fora do foco, só uso isso para avisar se você rolar demais (dá pra desligar em Zoe › Bolinha). Tudo fica no seu celular.', onde: 'Na lista, toque em Zoe e ative "Permitir acesso ao uso".' },
      { id: 'sobrepor', ico: I.camadas, nome: 'Aparecer por cima de outros apps', porque: 'Pra eu aparecer na frente do app e dar o peteleco.', onde: 'Ative "Permitir sobreposição a outros apps".' }
    ] },
    { grupo: 'Recomendadas', itens: [
      { id: 'notificacoes', ico: I.sino, nome: 'Notificações', porque: 'Pra avisar que o foco começou e mostrar que estou de guarda.' },
      { id: 'alarmes', ico: I.relogio, nome: 'Alarmes no horário certo', porque: 'Pra eu começar a vigiar exatamente na hora do seu foco, e não uns minutos depois.' },
      { id: 'bateria', ico: I.bateria, nome: 'Rodar sem economia de bateria', porque: 'Alguns celulares desligam apps em segundo plano. Isso evita que eu durma no meio do seu foco. Só gasto bateria enquanto vigio.', onde: 'Procure Zoe e escolha "Não otimizar" ou "Sem restrições".' }
    ] }
  ];

  function conteudoPerms(editor) {
    var n = permsLiberadas();
    var cab = editor ? '' :
      '<div class="balao">' + orbe(64, '') + '<p>Agora umas permissões. Te explico cada uma, e você pode mudar de ideia quando quiser.</p></div>' +
      '<h2 class="titulo">O que eu preciso</h2>';
    var html = cab + '<span class="selo" style="align-self:flex-start">' + n + ' de 5 liberadas</span>';
    PERMS.forEach(function (g) {
      html += '<h3 class="secao">' + g.grupo + '</h3>';
      g.itens.forEach(function (p) {
        var ok = !!S.perms[p.id];
        html += '<div class="card perm">' +
          '<div class="perm-cab"><span class="perm-ico">' + ico(p.ico) + '</span><strong>' + p.nome + '</strong>' +
          '<span class="estado ' + (ok ? 'ok' : 'falta') + '">' + (ok ? 'Liberada' : 'Falta') + '</span></div>' +
          '<p>' + p.porque + '</p>' +
          (!ok && p.onde ? '<p><strong style="color:var(--tinta)">Como:</strong> ' + p.onde + '</p>' : '') +
          (!ok ? '<button class="btn secundario pequeno" style="align-self:flex-start" data-acao="liberar" data-arg="' + p.id + '">Liberar</button>' : '') +
          '</div>';
      });
    });
    if (S.perms.marcaAgressiva) {
      html += '<div class="card perm"><div class="perm-cab"><span class="perm-ico">' + ico(I.mao) + '</span><strong>Passo extra no seu ' + esc(S.perms.marca) + '</strong>' +
        '<span class="estado depois">Confira</span></div>' +
        '<p>Celulares dessa marca costumam fechar apps sozinhos. Nas configurações do app, ative "Início automático" (ou "Executar em segundo plano") e deixe a bateria em "Sem restrições".</p>' +
        '<button class="btn secundario pequeno" style="align-self:flex-start" data-acao="liberar" data-arg="inicioAuto">Abrir configurações do app</button></div>';
    }
    html += '<h3 class="secao">Pra depois</h3>' +
      '<div class="card perm desligada"><div class="perm-cab"><span class="perm-ico">' + ico(I.mao) + '</span><strong>Acessibilidade</strong>' +
      '<span class="estado depois">Não peço agora</span></div>' +
      '<p>Serviria para bloquear só os Reels e os Shorts e deixar o resto do app livre. A Play Store não aceita esse uso, então fica para uma versão futura instalada direto.</p></div>' +
      '<p class="sub" style="display:flex;gap:8px;align-items:flex-start">' + ico(I.escudo, 18) + '<span>A Zoe não tem permissão de internet. Nada disso sai do seu celular.</span></p>';
    return html;
  }

  // ---------------- abas ----------------
  function nav() {
    var abas = [['hoje', 'Canteiro', I.canteiro], ['estudos', 'Estudos', I.livroAberto], ['foco', 'Estufa', I.redoma], ['zoe', 'Zoe', I.zoeRosto]];
    return '<nav class="nav" aria-label="Principal">' + abas.map(function (a) {
      return '<button data-acao="aba" data-arg="' + a[0] + '"' + (rota === a[0] ? ' aria-current="page"' : '') + '>' + ico(a[2], 26).replace('stroke-width="2"', 'stroke-width="1.8"') + a[1] + '</button>';
    }).join('') + '</nav>';
  }

  function telaAba(r) {
    if (r === 'foco') return telaFoco();
    if (r === 'estudos') return telaEstudos();
    if (r === 'zoe') return telaZoe();
    return telaHoje();
  }

  function falaDoDia(feitos, total) {
    if (S.foco.ativo) return 'Tô de guarda. Foca que eu cuido do resto.';
    if (!total) return 'Escolhe uns hábitos pra gente cuidar juntos?';
    if (feitos === 0) return 'Bora começar o dia? Um hábito já me acorda.';
    if (feitos >= total) return 'Dia perfeito. Orgulho!';
    if (feitos * 2 >= total) return 'Tô feliz demais! Continua assim.';
    return 'Boa! Mais um e eu fico radiante.';
  }

  // desenhos do canteiro
  function folhasSeq(n) {
    var k = Math.min(n, 14), h = '';
    for (var i = 0; i < k; i++) { var x = 4 + i * 6.2; h += '<path d="M' + x + ' 14C' + (x - 3.4) + ' 10 ' + (x - 2) + ' 4.5 ' + (x + 1.6) + ' 1 ' + (x + 4) + ' 5 ' + (x + 3.4) + ' 10.5 ' + x + ' 14Z" fill="' + (i === k - 1 && n >= 7 ? '#F6B8C8' : (i % 2 ? '#A9CDB0' : '#93BC9C')) + '"/>'; }
    var w = Math.max(12, k * 6.2 + 6);
    return '<svg viewBox="0 0 ' + w + ' 15" style="width:' + w + 'px" aria-hidden="true">' + h + '</svg>';
  }
  function gota(e) {
    var y = 46 - Math.max(0, Math.min(100, e)) / 100 * 44;
    var d = 'M18 2C25 12 32 19 32 28a14 14 0 0 1-28 0C4 19 11 12 18 2z';
    return '<svg viewBox="0 0 36 46" aria-hidden="true"><defs><clipPath id="cg"><path d="' + d + '"/></clipPath></defs><path d="' + d + '" fill="#E6E0F7"/>' +
      '<rect x="0" y="' + y + '" width="36" height="46" fill="#A996E3" clip-path="url(#cg)"/><path d="' + d + '" fill="none" stroke="#8D78D6" stroke-width="2"/></svg>';
  }
  function plantaSvg(feito) {
    var alt = feito ? 30 : 12, top = 40 - alt;
    return '<g class="planta"><path d="M27 40 C27 ' + (40 - alt * .6) + ' 26 ' + (top + 6) + ' 27.5 ' + top + '" fill="none" stroke="#6F9C7C" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M27 ' + (top + alt * .45) + 'c-5 0-8-3-8.5-7 5 0 8 3 8.5 7z" fill="#A9CDB0"/><path d="M27.4 ' + (top + alt * .3) + 'c2.6-4 6-5 9-4.5-.8 3.8-4.4 5.6-9 4.5z" fill="#93BC9C"/>' +
      (feito ? '<g transform="translate(27.5 ' + top + ')"><circle r="3.4" cy="-3.6" fill="#F6B8C8"/><circle r="3.4" cx="-3.4" cy="-.6" fill="#F6B8C8"/><circle r="3.4" cx="3.4" cy="-.6" fill="#F6B8C8"/><circle r="3.4" cx="-2" cy="3" fill="#F6B8C8"/><circle r="3.4" cx="2" cy="3" fill="#F6B8C8"/><circle r="2.6" fill="#FFD98A"/></g>' : '') + '</g>';
  }
  function vasoSvg(feito) {
    return '<svg viewBox="0 0 54 62" aria-hidden="true">' + plantaSvg(feito) + '<path d="M13 40h28l-3.5 20h-21z" fill="#D9A387"/><rect x="11" y="37" width="32" height="5" rx="2" fill="#C98B6B"/></svg>';
  }
  var TERRA = '<svg class="terra" viewBox="0 0 360 50" preserveAspectRatio="none" aria-hidden="true"><path d="M0 16 C45 4 90 20 135 11 S225 2 270 13 S335 18 360 9 V50 H0Z" fill="#DCD2C8"/>' +
    '<path d="M0 16 C45 4 90 20 135 11 S225 2 270 13 S335 18 360 9" fill="none" stroke="#C9B9AA" stroke-width="2" stroke-dasharray="3 5"/></svg>';
  var SETA = '<svg viewBox="0 0 46 30" fill="none" stroke="#8D78D6" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 4c10 2 22 8 30 20"/><path d="M26 22l7 2 1-7"/></svg>';
  var REDOMA = '<svg class="redoma" viewBox="0 0 40 40" fill="none" stroke="#F3F0FA" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 33V20a12 12 0 0 1 24 0v13" fill="rgba(255,255,255,.12)"/><path d="M5 33h30"/><path d="M14 15c1.4-2.3 3.2-3.7 5.5-4.2"/></svg>';

  function telaHoje() {
    var d = new Date(S.agora);
    var data = DIAS_LONGOS[d.getDay()] + ' · ' + d.getDate() + '/' + doisDig(d.getMonth() + 1);
    var feitos = S.habitos.filter(function (h) { return S.feitosHoje.indexOf(h.id) >= 0; }).length;
    var humor = S.foco.ativo ? 'foco' : humorPorEnergia(S.energia);
    var nivel = (80 - S.energia * 0.4) + '%';

    var alerta = !essenciaisOk()
      ? '<div class="aviso">' + ico(I.olho) + '<p><strong>Estou sem enxergar.</strong> Faltam permissões pra eu poder dar o peteleco.</p>' +
        '<button class="btn secundario pequeno" data-acao="editar" data-arg="perms">Ver</button></div>' : '';

    var estufa;
    if (S.foco.ativo) {
      estufa = '<button class="estufa-card" data-acao="aba" data-arg="foco">' + REDOMA +
        '<span class="meio"><b>Estufa fechada até ' + hora(S.foco.fim) + '</b><span>' + S.vigiados.length + ' vilões lá fora</span></span>' + ico(I.seta) + '</button>';
    } else {
      var prox = S.foco.proximo ? 'Estufa ' + (new Date(S.foco.proximo).getDay() === d.getDay() ? 'às ' : DIAS[new Date(S.foco.proximo).getDay()] + ' às ') + hora(S.foco.proximo) : 'Nenhuma estufa agendada';
      estufa = '<button class="estufa-card" data-acao="focar" data-arg="25">' + REDOMA +
        '<span class="meio"><b>' + prox + '</b><span>' + (S.vigiados.length ? S.vigiados.length + (S.vigiados.length === 1 ? ' vilão fica' : ' vilões ficam') + ' lá fora' : 'Escolha os vilões na aba Zoe') + '</span></span>' +
        '<span class="acao">Fechar · 25 min</span></button>';
    }

    var vasos = S.habitos.length ? '<div class="vasos">' + S.habitos.map(function (h) {
      var on = S.feitosHoje.indexOf(h.id) >= 0;
      return '<button class="vaso" aria-pressed="' + on + '" data-acao="habito" data-arg="' + esc(h.id) + '" aria-label="' + esc(h.nome) + (on ? ': regado hoje' : ': toque para regar') + '">' +
        vasoSvg(on) + '<b>' + esc(h.nome) + '</b><span>' + (on ? 'regado' : '+' + h.pontos) + '</span></button>';
    }).join('') + '<button class="vaso novo" data-acao="editar" data-arg="habitos" aria-label="Escolher hábitos"><svg viewBox="0 0 54 62" aria-hidden="true"><path d="M27 22v14M20 29h14" stroke="#6B6480" stroke-width="2" stroke-linecap="round"/><path d="M13 40h28l-3.5 20h-21z" fill="none" stroke="#C98B6B" stroke-width="1.6" stroke-dasharray="3 3"/></svg><b>Nova muda</b></button></div>'
      : '<button class="btn secundario" data-acao="editar" data-arg="habitos">Plantar os primeiros hábitos</button>';

    return '<section class="tela canteiro">' +
      '<div class="c-topo"><div><span class="olho-cima">' + data + '</span><h1>' + saudacao(d) + '</h1></div>' +
      '<div class="c-seq" aria-label="Sequência de ' + S.sequencia + ' dias"><b>' + S.sequencia + '</b><span>' + (S.sequencia === 1 ? 'dia seguido' : 'dias seguidos') + '</span>' + folhasSeq(S.sequencia) + '</div></div>' +
      (alerta ? '<div style="padding:12px 20px 0">' + alerta + '</div>' : '') +
      '<div class="c-chao">' +
      '<div class="c-recado"><p class="recado" aria-live="polite">' + esc(falaDoDia(feitos, S.habitos.length)) + '</p>' + SETA + '</div>' +
      '<div class="c-agua" role="img" aria-label="Energia da Zoe: ' + S.energia + ' de 100">' + gota(S.energia) + '<b>' + S.energia + '%</b><span>água</span></div>' +
      TERRA + orbe(112, humor, '--nivel:' + nivel) + '</div>' +
      '<div class="c-faixa">' +
      '<div class="c-cab"><h2>Suas mudas</h2><span>' + feitos + ' de ' + S.habitos.length + ' regadas</span></div>' +
      vasos + estufa +
      '<div class="c-extra">' + revisao() +
      '<button class="linha" data-acao="sub" data-arg="resumo"><span class="perm-ico">' + ico(I.livro) + '</span><span class="meio"><strong>Diário de hoje</strong><span class="det">' +
      tempo(S.minutosFocoHoje) + ' de estufa · ' + S.petelecosHoje + (S.petelecosHoje === 1 ? ' peteleco' : ' petelecos') + '</span></span>' + ico(I.seta) + '</button></div>' +
      '</div></section>';
  }
  function revisao() {
    var n = E.devidas();
    if (!n) return '';
    return '<button class="linha" data-acao="pilula"><span class="perm-ico">' + ico(I.estudo) + '</span><span class="meio"><strong>' + n + (n === 1 ? ' pergunta para revisar' : ' perguntas para revisar') + '</strong><span class="det">Uma pílula rápida de estudo</span></span>' + ico(I.seta) + '</button>';
  }
  function saudacao(d) { var h = d.getHours(); return h < 12 ? 'Bom dia!' : (h < 18 ? 'Boa tarde!' : 'Boa noite!'); }

  var redomaDesceu = false;
  function telaFoco() {
    if (S.foco.ativo) {
      var desce = !redomaDesceu; redomaDesceu = true;
      return '<section class="tela tela-noite" style="align-items:center;text-align:center">' +
        '<div class="e-topo"><span class="olho-cima">estufa fechada até ' + hora(S.foco.fim) + '</span><p class="recado">aqui dentro só cresce foco</p></div>' +
        '<div class="e-redoma"><div class="vidro' + (desce ? ' e-desce' : '') + '"></div><div class="base"></div>' + orbe(112, 'foco respira') + '</div>' +
        '<div><div class="timer" id="timer" role="timer" aria-label="Tempo restante">--:--</div><p class="sub" style="margin-top:8px">para abrir a estufa</p></div>' +
        '<div class="e-fora"><span class="olho-cima" style="color:var(--noite-suave)">lá fora</span>' +
        '<div class="vigiados">' + (S.nomesVigiados.length ? S.nomesVigiados.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') : '<span>Nenhum vilão marcado</span>') + '</div>' +
        '<div class="linha-fora"><span>Petelecos nesta estufa</span><strong>' + S.foco.tentativas + '</strong></div></div>' +
        (!essenciaisOk() ? '<p class="erro" style="color:#F4C3B5">Faltam permissões: estou de guarda, mas sem enxergar.</p>' : '') +
        '<div class="rodape" style="width:100%"><button class="btn fantasma" data-acao="encerrar">abrir a estufa antes da hora</button></div></section>';
    }
    redomaDesceu = false;
    var blocos = S.blocos.length ? S.blocos.map(function (b) {
      return '<li class="linha" style="cursor:default"><span class="perm-ico">' + ico(I.relogio) + '</span><span class="meio"><strong>' + hhmm(b.inicio) + ' – ' + hhmm(b.fim) + '</strong><span class="det">' + diasTexto(b.dias) + '</span></span></li>';
    }).join('') : '<li class="vazio">Nenhum horário agendado.</li>';
    return '<section class="tela">' +
      '<div><span class="olho-cima">aba estufa</span><h1 class="titulo">Fechar a estufa</h1></div>' +
      '<div class="card" style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="mini-estufa"><div class="redoma-mini">' + orbe(56, 'foco') + '</div><div><strong>Eu fico aqui dentro de guarda</strong><p class="sub" style="font-size:14px;margin-top:2px">Os vilões ficam lá fora até o fim.</p></div></div>' +
      '<div class="chips" role="radiogroup" aria-label="Duração">' + [25, 50, 90].map(function (m) {
        return '<button class="chip-btn" role="radio" aria-checked="' + (duracao === m) + '" data-acao="duracao" data-arg="' + m + '" style="flex:1">' + m + ' min</button>';
      }).join('') + '</div>' +
      '<button class="btn principal" data-acao="focar" data-arg="' + duracao + '">Fechar a estufa · ' + duracao + ' min</button>' +
      (!essenciaisOk() ? '<p class="sub" style="font-size:13px">Sem as permissões essenciais eu fico de guarda, mas não consigo ver os apps. <a href="#" data-acao="editar" data-arg="perms">Liberar</a></p>' : '') +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:19px">Horários da estufa</h2><button class="btn fantasma pequeno" data-acao="editar" data-arg="agenda">Editar</button></div>' +
      '<ul class="lista">' + blocos + '</ul>' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:19px">Ficam lá fora</h2><button class="btn fantasma pequeno" data-acao="editar" data-arg="viloes">Editar</button></div>' +
      '<div class="vigiados">' + (S.nomesVigiados.length ? S.nomesVigiados.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') : '<span class="sub" style="background:none;padding:0">Nenhum ainda.</span>') + '</div>' +
      '</section>';
  }
  function diasTexto(dias) {
    var s = dias.slice().sort().join(',');
    if (s === '1,2,3,4,5') return 'Segunda a sexta';
    if (s === '0,1,2,3,4,5,6') return 'Todos os dias';
    if (s === '0,6') return 'Fim de semana';
    return dias.slice().sort().map(function (d) { return DIAS[d]; }).join(', ');
  }
  function atualizarTimer() {
    var el = $('#timer');
    var resta = Math.max(0, Math.round((S.foco.fim - Date.now()) / 1000));
    if (el) el.textContent = doisDig(Math.floor(resta / 60)) + ':' + doisDig(resta % 60);
    if (resta <= 0) { clearInterval(relogio); setTimeout(function () { carregar(); render(); }, 1500); }
  }

  function telaEstudos() { return E.telas.estudos(S); }

  function telaInterna(r) {
    if (r === 'resumo') return telaResumo();
    if (r === 'lembretes') return telaLembretes();
    if (r === 'bolinha') return telaBolinha();
    return E.telas[r](S);
  }

  // ---------------- resumo do dia ----------------
  function barraMao(min, max, cor) {
    var w = Math.max(6, Math.round(min / max * 150));
    return '<svg viewBox="0 0 150 14" preserveAspectRatio="none" aria-hidden="true"><path d="M1 3 Q' + w / 2 + ' 1 ' + w + ' 3 L' + (w - 1) + ' 12 Q' + w / 2 + ' 13.5 2 11.5 Z" fill="' + cor + '" opacity=".78"/>' +
      '<path d="M1 3 Q' + w / 2 + ' 1 ' + w + ' 3" fill="none" stroke="#2B2540" stroke-width="1" opacity=".3"/></svg>';
  }
  function crescimento(seq, prox) {
    var fase = !prox ? 3 : Math.min(3, Math.floor(seq / prox * 4));
    var nomes = ['semente', 'broto', 'botão', 'flor'], xs = [30, 92, 154, 214], c = '';
    var cinza = '#CFC6E0', verde = '#6F9C7C';
    c += '<path d="M8 68 C70 62 160 72 236 66" fill="none" stroke="#C9B9AA" stroke-width="2" stroke-dasharray="3 5"/>';
    c += '<ellipse cx="30" cy="64" rx="7" ry="5" fill="' + (fase >= 0 ? '#C98B6B' : cinza) + '"/>';
    var c1 = fase >= 1 ? verde : cinza;
    c += '<path d="M92 66c0-8 0-12 1-17" stroke="' + c1 + '" stroke-width="2" fill="none"/><path d="M92.5 56c-5 0-8-3-8.5-7 5 0 8 3 8.5 7z" fill="' + (fase >= 1 ? '#A9CDB0' : 'none') + '" stroke="' + (fase >= 1 ? 'none' : cinza) + '"/><path d="M93 52c2.6-4 6-5 9-4.5-.8 3.8-4.4 5.6-9 4.5z" fill="' + (fase >= 1 ? '#93BC9C' : 'none') + '" stroke="' + (fase >= 1 ? 'none' : cinza) + '"/>';
    var c2 = fase >= 2 ? verde : cinza;
    c += '<path d="M154 66c0-12 0-18 1-26" stroke="' + c2 + '" stroke-width="2" fill="none"/><ellipse cx="155" cy="35" rx="5" ry="7" fill="' + (fase >= 2 ? '#F6B8C8' : 'none') + '" stroke="' + (fase >= 2 ? 'none' : cinza) + '" stroke-width="2"/>';
    var c3 = fase >= 3 ? verde : cinza;
    c += '<path d="M214 66c0-14 0-20 1-30" stroke="' + c3 + '" stroke-width="2" fill="none"/>' + (fase >= 3
      ? '<g transform="translate(215 28)"><circle r="5" cy="-5" fill="#F6B8C8"/><circle r="5" cx="-5" cy="-1" fill="#F6B8C8"/><circle r="5" cx="5" cy="-1" fill="#F6B8C8"/><circle r="5" cx="-3" cy="5" fill="#F6B8C8"/><circle r="5" cx="3" cy="5" fill="#F6B8C8"/><circle r="3.6" fill="#FFD98A"/></g>'
      : '<circle cx="215" cy="28" r="9" fill="none" stroke="' + cinza + '" stroke-width="2" stroke-dasharray="3 3"/>');
    nomes.forEach(function (n, i) { c += '<text x="' + xs[i] + '" y="84" text-anchor="middle" font-size="10.5" font-family="Figtree,sans-serif" font-weight="600" fill="' + (i <= fase ? '#2B2540' : '#A49DB8') + '">' + n + '</text>'; });
    return '<svg viewBox="0 0 244 88" role="img" aria-label="Fase atual: ' + nomes[fase] + '">' + c + '</svg>';
  }
  function telaResumo() {
    var R = {};
    try { R = JSON.parse(Z.resumo()); } catch (e) { R = { viloes: [], minutosViloes: 0, mediaViloes: 0, temUso: false }; }
    var feitos = S.habitos.filter(function (h) { return S.feitosHoje.indexOf(h.id) >= 0; }).length, total = S.habitos.length;
    var estudadas = E.respondidasHoje();
    var bom = total ? feitos * 2 >= total : true;
    var d = new Date(S.agora);
    var fala = 'Você ficou <u>' + tempo(S.minutosFocoHoje) + '</u> na estufa, regou <u>' + feitos + ' de ' + total + '</u> mudas e levou ' +
      (S.petelecosHoje === 0 ? '<u>nenhum peteleco</u>.' : '<u>' + S.petelecosHoje + (S.petelecosHoje === 1 ? ' peteleco' : ' petelecos') + '</u>.') + ' ' +
      (bom ? 'Orgulho!' : 'Amanhã a gente rega mais.') + (d.getHours() >= 21 ? ' Agora bora dormir?' : '');
    var max = Math.max.apply(null, [60, S.minutosFocoHoje].concat(R.viloes.map(function (v) { return v.minutos; })));
    var viloes = !R.temUso ? '<p class="sub" style="font-size:14px">Libere "ver qual app está aberto" pra eu mostrar o tempo nos vilões.</p>'
      : '<div class="d-barras">' + R.viloes.slice(0, 4).map(function (v) {
        return '<div><span>' + esc(v.nome) + '</span>' + barraMao(v.minutos, max, '#E99A86') + '<b>' + tempo(v.minutos) + '</b></div>';
      }).join('') + '<div><span><strong>Estufa</strong></span>' + barraMao(S.minutosFocoHoje, max, '#93BC9C') + '<b>' + tempo(S.minutosFocoHoje) + '</b></div></div>' +
        (R.viloes.length ? '' : '<p class="sub" style="font-size:14px">Nem encostou nos vilões hoje. Uau!</p>');
    var dif = R.mediaViloes - R.minutosViloes;
    var comp = R.temUso && R.mediaViloes > 0 ? '<p class="recado" style="font-size:20px;color:' + (dif >= 0 ? 'var(--salvia)' : 'var(--peteleco-escuro)') + '">' +
      (dif >= 0 ? tempo(dif) + ' a menos que a sua média nos vilões' : tempo(-dif) + ' a mais que a sua média nos vilões') + '</p>' : '';
    var marcos = [7, 30, 100], prox = marcos.filter(function (m) { return S.sequencia < m; })[0];
    var evol = '<div class="d-cresce"><span class="olho-cima">' + (prox ? 'próxima flor · ' + S.sequencia + ' de ' + prox + ' dias' : S.sequencia + ' dias: a Zoe está em flor') + '</span>' + crescimento(S.sequencia, prox) +
      (prox ? '<p class="sub" style="font-size:13.5px">Com ' + prox + ' dias seguidos regando metade das mudas, o broto da Zoe floresce.</p>' : '') + '</div>';
    return '<section class="tela diario">' +
      '<div class="topo"><button class="voltar" data-acao="voltar" aria-label="Voltar">' + ico(I.voltar) + '</button><div style="flex:1"><span class="olho-cima" style="color:var(--peteleco-escuro)">diário · ' + DIAS_LONGOS[d.getDay()] + '</span><h1 style="font-size:28px;font-weight:700">Como foi hoje</h1></div></div>' +
      '<div class="d-nota"><p class="recado">' + fala + '</p>' + orbe(64, bom ? 'feliz' : 'triste', 'animation:none') + '</div>' +
      '<div class="d-numeros"><div><strong>' + feitos + '/' + total + '</strong><span>mudas regadas</span></div><div><strong>' + tempo(S.minutosFocoHoje) + '</strong><span>na estufa</span></div>' +
      '<div class="' + (S.petelecosHoje > 0 ? 'alerta' : '') + '"><strong>' + S.petelecosHoje + '</strong><span>' + (S.petelecosHoje === 1 ? 'peteleco' : 'petelecos') + '</span></div></div>' +
      (estudadas ? '<p class="sub" style="font-size:14px">' + estudadas + (estudadas === 1 ? ' pergunta revisada hoje.' : ' perguntas revisadas hoje.') + '</p>' : '') +
      '<div style="display:flex;flex-direction:column;gap:10px"><h2 class="d-titulo">Onde foi o seu tempo</h2>' + viloes + comp + '</div>' +
      evol + '</section>';
  }

  // ---------------- bolinha: recados e aviso de rolagem ----------------
  function telaBolinha() {
    if (!rec) rec = JSON.parse(JSON.stringify(S.recados));
    var sw = function (acao, on, titulo, det) {
      return '<button class="linha" role="switch" aria-checked="' + on + '" data-acao="' + acao + '"><span class="meio"><strong style="white-space:normal">' + titulo + '</strong><span class="det" style="white-space:normal">' + det + '</span></span><span class="interruptor" aria-hidden="true"></span></button>';
    };
    var chips = function (rot, campo, ops) {
      return '<div class="campo"><span class="lbl">' + rot + '</span><div class="chips" role="radiogroup" aria-label="' + rot + '">' + ops.map(function (o) {
        return '<button class="chip-btn" style="flex:1" role="radio" aria-checked="' + (rec[campo] === o[0]) + '" data-acao="recChip" data-arg="' + campo + ':' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div></div>';
    };
    return '<section class="tela">' +
      '<div class="topo"><button class="voltar" data-acao="voltar" aria-label="Voltar">' + ico(I.voltar) + '</button><h1>Bolinha da Zoe</h1></div>' +
      '<div class="balao" style="align-items:flex-start">' + orbe(56, '', 'animation:none') + '<p style="margin:0">Fora do foco eu apareço de vez em quando, por cima de qualquer app, com um recado. Me arrasta até o X pra dispensar.</p></div>' +
      (!S.perms.sobrepor ? '<div class="aviso">' + ico(I.camadas) + '<p>Preciso da permissão de aparecer por cima de outros apps.</p><button class="btn secundario pequeno" data-acao="liberar" data-arg="sobrepor">Liberar</button></div>' : '') +
      sw('recAtivos', rec.ativos, 'Recados', 'Livro parado, perguntas pra revisar, hábito pendente, sequência') +
      (rec.ativos ? chips('Quantos recados por dia', 'porDia', [[1, 'Até 1'], [3, 'Até 3'], [5, 'Até 5']]) : '') +
      '<h2 style="font-size:17px;margin-top:6px">Aviso de rolagem</h2>' +
      '<p class="sub" style="font-size:13px;margin-top:-10px">Fora do foco eu não fecho nada: só aviso, e você decide.</p>' +
      sw('recRolagem', rec.rolagem, 'Avisar quando eu rolar demais', 'Nos apps vigiados: ' + (S.nomesVigiados.length ? S.nomesVigiados.map(esc).join(', ') : 'nenhum ainda')) +
      (rec.rolagem ? chips('Avisar depois de (seguidos)', 'seguidos', [[15, '15 min'], [20, '20 min'], [30, '30 min']]) +
        chips('Limite do dia (somando todos)', 'limite', [[30, '30 min'], [60, '1h'], [90, '1h30'], [120, '2h']]) : '') +
      (rec.rolagem && !S.perms.uso ? '<div class="aviso">' + ico(I.olho) + '<p>Pra saber quanto você rolou, preciso ver qual app está aberto.</p><button class="btn secundario pequeno" data-acao="liberar" data-arg="uso">Liberar</button></div>' : '') +
      '<div class="linha" style="cursor:default"><span class="meio"><strong>Silêncio</strong><span class="det">Eu não apareço nesse horário</span></span><strong>22:00 – 08:00</strong></div>' +
      '<p class="sub" style="font-size:13px">Nunca apareço durante o foco (ali só existe o peteleco) nem em ligações. Se você me dispensar 3 vezes seguidas, mando no máximo 1 recado por dia durante uma semana.</p>' +
      (S.perms.sobrepor ? '<div class="linha-campo"><button class="btn secundario pequeno" style="flex:1" data-acao="testarBolha" data-arg="recado">Ver um recado</button><button class="btn secundario pequeno" style="flex:1" data-acao="testarBolha" data-arg="rolagem">Ver um aviso</button></div>' : '') +
      '<div class="rodape"><button class="btn principal" data-acao="salvarRecados">Salvar</button></div></section>';
  }

  // ---------------- lembretes ----------------
  function telaLembretes() {
    if (!lemb) lemb = { ativo: S.lembrete.ativo, minuto: S.lembrete.minuto, resumo: S.lembrete.resumo };
    var sw = function (acao, on, titulo, det) {
      return '<button class="linha" role="switch" aria-checked="' + on + '" data-acao="' + acao + '"><span class="meio"><strong style="white-space:normal">' + titulo + '</strong><span class="det" style="white-space:normal">' + det + '</span></span><span class="interruptor" aria-hidden="true"></span></button>';
    };
    return '<section class="tela">' +
      '<div class="topo"><button class="voltar" data-acao="voltar" aria-label="Voltar">' + ico(I.voltar) + '</button><h1>Lembretes</h1></div>' +
      sw('lembAtivo', lemb.ativo, 'Lembrete dos hábitos', 'Só aparece se ainda faltar algum hábito no dia.') +
      (lemb.ativo ? '<div class="campo"><label for="lemb-hora">Horário do lembrete</label><input id="lemb-hora" class="entrada" type="time" value="' + hhmm(lemb.minuto) + '" data-campo="lembHora"></div>' : '') +
      sw('lembResumo', lemb.resumo, 'Resumo do dia às 22h', 'Hábitos, foco, petelecos e tempo nos vilões.') +
      (!S.perms.notificacoes ? '<div class="aviso">' + ico(I.sino) + '<p>As notificações estão desligadas: os lembretes não vão aparecer.</p><button class="btn secundario pequeno" data-acao="liberar" data-arg="notificacoes">Liberar</button></div>' : '') +
      '<div class="rodape"><button class="btn principal" data-acao="salvarLembretes">Salvar</button></div></section>';
  }

  function telaZoe() {
    var tom = TONS.filter(function (t) { return t.id === S.tom; })[0] || TONS[1];
    var item = function (acao, arg, icone, titulo, det) {
      return '<li><button class="linha" data-acao="' + acao + '" data-arg="' + arg + '"><span class="perm-ico">' + ico(icone) + '</span>' +
        '<span class="meio"><strong>' + titulo + '</strong><span class="det">' + det + '</span></span>' + ico(I.seta) + '</button></li>';
    };
    return '<section class="tela">' +
      '<div style="display:flex;align-items:center;gap:16px">' + orbe(80, humorPorEnergia(S.energia)) +
      '<div><h1 class="titulo">Zoe</h1><p class="sub">Energia ' + S.energia + ' · ' + S.sequencia + ' dias seguidos</p></div></div>' +
      '<ul class="lista">' +
      item('editar', 'jeito', I.zoe, 'Jeito da Zoe', tom.nome) +
      item('editar', 'viloes', I.olho, 'Apps vigiados', S.vigiados.length + ' apps') +
      item('editar', 'agenda', I.relogio, 'Horários da estufa', S.blocos.length ? S.blocos.length + (S.blocos.length === 1 ? ' horário' : ' horários') : 'Nenhum') +
      item('editar', 'habitos', I.certo, 'Hábitos', S.habitos.length + ' hábitos') +
      item('editar', 'perms', I.escudo, 'Permissões', permsLiberadas() + ' de 5 liberadas') +
      item('sub', 'ia', I.chave, 'Inteligência', S.ia.temChave ? 'Gemini conectado' : 'Configurar chave grátis') +
      item('sub', 'bolinha', I.zoe, 'Bolinha', S.recados.ativos || S.recados.rolagem ? (S.recados.ativos ? 'Recados' : '') + (S.recados.ativos && S.recados.rolagem ? ' e ' : '') + (S.recados.rolagem ? 'aviso de rolagem' : '') : 'Desligada') +
      item('sub', 'lembretes', I.sino, 'Lembretes', S.lembrete.ativo ? 'Hábitos às ' + hhmm(S.lembrete.minuto) : 'Desligados') +
      item('sub', 'resumo', I.grafico, 'Resumo do dia', 'Como foi hoje') +
      '</ul>' +
      '<p class="sub" style="display:flex;gap:8px;align-items:flex-start">' + ico(I.escudo, 18) + '<span>Privacidade: hábitos, horários e o uso dos apps ficam só neste celular. A internet é usada só em Estudos, e só com o tema da trilha.</span></p>' +
      '<p class="sub" style="font-size:12px">Zoe 0.4.0</p></section>';
  }

  // ---------------- ações ----------------
  var acoes = {
    avancar: function () { erro = ''; passo++; animar('feliz'); render(); },
    voltar: function () { window.zoeVoltar(); },
    aba: function (a) { irAba(a); },
    editar: function (p) { erro = ''; delete rascunho[{ habitos: 'habitos', viloes: 'vigiados', agenda: 'blocos', jeito: 'tom' }[p]]; abrir(p); },
    sub: function (p) { if (p === 'lembretes') lemb = null; if (p === 'bolinha') rec = null; if (p === 'resumo') { abrirResumo(); return; } abrir(p); },
    recAtivos: function () { rec.ativos = !rec.ativos; render(); },
    recRolagem: function () { rec.rolagem = !rec.rolagem; render(); },
    recChip: function (arg) { var p = arg.split(':'); rec[p[0]] = +p[1]; render(); },
    salvarRecados: function () { Z.salvarRecados(!!rec.ativos, rec.porDia, !!rec.rolagem, rec.seguidos, rec.limite); carregar(); fechar(); },
    testarBolha: function (t) { Z.testarBolha(t); },
    lembAtivo: function () { lemb.ativo = !lemb.ativo; render(); },
    lembResumo: function () { lemb.resumo = !lemb.resumo; render(); },
    salvarLembretes: function () { Z.salvarLembretes(!!lemb.ativo, lemb.minuto, !!lemb.resumo); carregar(); fechar(); },
    liberar: function (p) { Z.liberar(p); },
    habito: function (id) {
      var antes = S.feitosHoje.indexOf(id) >= 0;
      Z.alternarHabito(id); carregar();
      if (!antes) {
        var h = S.habitos.filter(function (x) { return x.id === id; })[0] || {};
        var especial = { agua: 'beber', exercicio: 'exercicio', meditar: 'meditar' }[id];
        var todos = S.habitos.length && S.habitos.every(function (x) { return S.feitosHoje.indexOf(x.id) >= 0; });
        animar(todos ? 'corada' : (especial || 'regar'), { texto: '+' + (h.pontos || 10) });
        setTimeout(function () {
          var v = document.querySelector('.vaso[data-arg="' + CSS.escape(id) + '"] .planta');
          if (v && v.animate && !ZoeAnim.calmo) v.animate([{ transform: 'scale(.4)' }, { transform: 'scale(1.15)', offset: .7 }, { transform: 'scale(1)' }], { duration: 650, easing: 'cubic-bezier(.3,1.5,.5,1)' });
        }, 60);
      }
      render();
    },
    escolherHabito: function (id) {
      var i = rascunho.habitos.map(function (h) { return h.id; }).indexOf(id);
      if (i >= 0) rascunho.habitos.splice(i, 1);
      else {
        var h = HABITOS_SUGERIDOS.filter(function (s) { return s.id === id; })[0];
        if (h) rascunho.habitos.push(copia(h));
      }
      render();
    },
    criarHabito: function () {
      var el = $('#novo-habito');
      var nome = (el && el.value || '').trim();
      if (!nome) return;
      rascunho.habitos.push({ id: 'h' + Date.now(), nome: nome, pontos: 10 });
      render();
    },
    vigiar: function (pkg) {
      var v = rascunho.vigiados, i = v.indexOf(pkg);
      if (i >= 0) v.splice(i, 1); else v.push(pkg);
      var btn = document.querySelector('[data-acao="vigiar"][data-arg="' + CSS.escape(pkg) + '"]');
      if (btn) btn.setAttribute('aria-checked', i < 0);
      var salvar = document.querySelector('[data-acao="salvar"]');
      if (salvar) salvar.textContent = 'Vigiar ' + v.length + ' apps';
    },
    preset: function (arg) {
      var p = arg.split('-');
      rascunho.blocos.push({ dias: UTEIS.slice(), inicio: +p[0], fim: +p[1] });
      render();
    },
    novoBloco: function () { rascunho.blocos.push({ dias: UTEIS.slice(), inicio: 540, fim: 600 }); render(); },
    removerBloco: function (i) { rascunho.blocos.splice(+i, 1); render(); },
    dia: function (arg) {
      var p = arg.split(':'), b = rascunho.blocos[+p[0]], d = +p[1], i = b.dias.indexOf(d);
      if (i >= 0) b.dias.splice(i, 1); else b.dias.push(d);
      render();
    },
    tom: function (t) {
      rascunho.tom = t; render();
      var el = document.querySelector('[data-acao="tom"][data-arg="' + t + '"] .zoe');
      ZoeAnim.tocar(el, { gentil: 'coracoes', firme: 'vigia', brava: 'brava' }[t]);
    },
    duracao: function (m) { duracao = +m; render(); },
    focar: function (m) { Z.focarAgora(+m); carregar(); rota = 'foco'; redomaDesceu = false; animar('vigia', null, 900); render(); window.scrollTo(0, 0); },
    encerrar: function () {
      if (!confirm('Encerrar o foco antes da hora? A Zoe perde 10 de energia.')) return;
      Z.encerrarFoco(); carregar(); animar('murcha'); render();
    },
    salvar: function (p) {
      erro = '';
      if (p === 'habitos') Z.salvarHabitos(JSON.stringify(rascunho.habitos));
      if (p === 'viloes') Z.salvarVigiados(JSON.stringify(rascunho.vigiados));
      if (p === 'agenda') {
        var ruim = rascunho.blocos.filter(function (b) { return b.fim <= b.inicio || !b.dias.length; });
        if (ruim.length) { erro = 'Cada horário precisa de pelo menos um dia e terminar depois de começar.'; render(); return; }
        if (!Z.salvarBlocos(JSON.stringify(rascunho.blocos))) { erro = 'Não consegui salvar esses horários.'; render(); return; }
      }
      if (p === 'jeito') { Z.salvarTom(rascunho.tom); }
      if (p === 'perms' && !S.onboarded) { Z.concluirBoasVindas(); rota = 'hoje'; animar('comemorar', null, 300); }
      carregar();
      if (!S.onboarded) { passo++; }
      else if (EDITORES.indexOf(rota) >= 0) { fechar(); return; }
      render();
      window.scrollTo(0, 0);
    }
  };

  // ---------------- navegação ----------------
  function abrirResumo() {
    var total = S.habitos.length, feitos = S.habitos.filter(function (h) { return S.feitosHoje.indexOf(h.id) >= 0; }).length;
    animar(!total || feitos * 2 >= total ? 'feliz' : 'murcha', null, 300);
    abrir('resumo');
  }
  function abrir(r) { pilha.push(rota); rota = r; render(); window.scrollTo(0, 0); }
  function trocar(r) { if (E) E.aoSair(rota); rota = r; render(); window.scrollTo(0, 0); }
  function fechar() {
    if (E) E.aoSair(rota);
    rota = pilha.pop() || 'hoje';
    erro = '';
    carregar(); render(); window.scrollTo(0, 0);
  }
  function irAba(a) { if (E) E.aoSair(rota); pilha = []; rota = a; carregar(); render(); window.scrollTo(0, 0); }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-acao]');
    if (!t) return;
    e.preventDefault();
    var nome = t.getAttribute('data-acao');
    var f = acoes[nome] || (E && E.acoes[nome]);
    if (t.disabled) return;
    if (f) f(t.getAttribute('data-arg'), t);
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.getAttribute('data-campo') === 'busca') {
      busca = t.value;
      var ul = $('#lista-apps');
      var termo = busca.trim().toLowerCase();
      if (ul && apps) ul.innerHTML = linhasApps(apps.filter(function (a) { return !termo || a.nome.toLowerCase().indexOf(termo) >= 0; }), rascunho.vigiados);
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, campo = t.getAttribute('data-campo');
    if (campo === 'lembHora' && t.value && lemb) lemb.minuto = paraMin(t.value);
    if ((campo === 'inicio' || campo === 'fim') && t.value) {
      rascunho.blocos[+t.getAttribute('data-i')][campo] = paraMin(t.value);
    }
  });

  // ---------------- chamadas do Android ----------------
  window.zoeVoltar = function () {
    if (!S.onboarded) {
      if (passo > 0) { passo--; erro = ''; render(); return true; }
      return false;
    }
    if (pilha.length || EDITORES.indexOf(rota) >= 0 || INTERNAS.indexOf(rota) >= 0) { fechar(); return true; }
    if (rota !== 'hoje') { irAba('hoje'); return true; }
    return false;
  };
  /** O Android pede para abrir uma tela (notificação ou "pergunta no lugar" do peteleco). */
  window.zoeAbrir = function (r, troca) {
    if (!S.onboarded) return;
    if (r === 'pilula') { E.abrirPilula(!!troca); pilha = []; rota = 'hoje'; abrir('pilula'); return; }
    if (r === 'resumo') { pilha = []; rota = 'hoje'; abrirResumo(); return; }
    if (ABAS.indexOf(r) >= 0) irAba(r);
  };
  /** Recarrega o estado e redesenha, mantendo o que a pessoa está digitando. */
  function recarregar() {
    var foco = document.activeElement, id = foco && foco.id, val = foco && foco.value;
    carregar(); render();
    if (id) { var el = document.getElementById(id); if (el) { if (val != null && 'value' in el && !el.value) el.value = val; el.focus(); } }
  }
  var saiuEm = 0;
  document.addEventListener('visibilitychange', function () { if (document.hidden) saiuEm = Date.now(); });
  window.zoeVoltou = function () {
    var antes = S && S.perms.uso;
    carregar();
    if (S.onboarded && saiuEm && Date.now() - saiuEm > 3 * 3600e3 && !S.foco.ativo) animar('surpresa', null, 300);
    saiuEm = 0;
    if (S.perms.uso && !antes) apps = null; // agora dá pra mostrar o tempo de uso
    render();
  };

  // ---------------- ponte falsa (só para abrir no navegador do computador) ----------------
  function pontaFalsa() {
    var st = {
      onboarded: location.hash !== '#novo', energia: 72, sequencia: 12, tom: 'firme',
      vigiados: ['com.instagram.android', 'com.google.android.youtube'], nomesVigiados: ['Instagram', 'YouTube'],
      blocos: [{ dias: [1, 2, 3, 4, 5], inicio: 540, fim: 720 }, { dias: [1, 2, 3, 4, 5], inicio: 840, fim: 1080 }],
      habitos: HABITOS_SUGERIDOS.slice(0, 4), feitosHoje: ['ler'],
      foco: { ativo: false, fim: 0, tentativas: 0, proximo: Date.now() + 3600e3 },
      petelecosHoje: 1, minutosFocoHoje: 50,
      // '#demo' (vídeos): tudo liberado, sem avisos de permissão
      perms: location.hash === '#demo'
        ? { uso: true, sobrepor: true, notificacoes: true, alarmes: true, bateria: true, marca: 'Google', marcaAgressiva: '', android: 35 }
        : { uso: true, sobrepor: false, notificacoes: true, alarmes: false, bateria: false, marca: 'Xiaomi', marcaAgressiva: 'xiaomi', android: 35 },
      emergenciasRestantes: 2, lembrete: { ativo: true, minuto: 1200, resumo: true },
      recados: { ativos: true, porDia: 3, rolagem: true, seguidos: 20, limite: 60 },
      ia: { temChave: location.hash === '#chave', modelo: 'gemini-2.5-flash', conversasRestantes: 20 },
      agora: Date.now()
    };
    return {
      estado: function () { st.agora = Date.now(); return JSON.stringify(st); },
      apps: function () {
        return JSON.stringify([['Instagram', 134, 1], ['YouTube', 108, 1], ['TikTok', 65, 1], ['WhatsApp', 90, 0], ['Chrome', 40, 0], ['Spotify', 30, 0]].map(function (a, i) {
          return { pacote: 'app' + i, nome: a[0], minutos: a[1], sugerido: !!a[2], vigiado: false, icone: '' };
        }));
      },
      salvarVigiados: function (j) { st.vigiados = JSON.parse(j); },
      salvarHabitos: function (j) { st.habitos = JSON.parse(j); },
      alternarHabito: function (id) { var i = st.feitosHoje.indexOf(id); if (i >= 0) st.feitosHoje.splice(i, 1); else st.feitosHoje.push(id); },
      salvarBlocos: function (j) { st.blocos = JSON.parse(j); return true; },
      salvarTom: function (t) { st.tom = t; },
      concluirBoasVindas: function () { st.onboarded = true; },
      liberar: function (p) { st.perms[p] = true; setTimeout(window.zoeVoltou, 50); },
      focarAgora: function (m) { st.foco = { ativo: true, fim: Date.now() + m * 60e3, tentativas: 0, proximo: 0 }; },
      encerrarFoco: function () { st.foco.ativo = false; },
      salvarRecados: function (a, p, r, s, l) { st.recados = { ativos: a, porDia: p, rolagem: r, seguidos: s, limite: l }; },
      testarBolha: function () { window.open('bolha.html', '_blank'); },
      introPronta: function () { },
      salvarLembretes: function (a, m, r) { st.lembrete = { ativo: a, minuto: m, resumo: r }; },
      ler: function (k) { try { return localStorage.getItem('mock_' + k) || ''; } catch (e) { return ''; } },
      guardar: function (k, v) { try { localStorage.setItem('mock_' + k, v); } catch (e) { } },
      recompensa: function (p) { st.energia = Math.min(100, st.energia + p); return true; },
      salvarChave: function () { st.ia.temChave = true; },
      apagarChave: function () { st.ia.temChave = false; },
      resumo: function () { return JSON.stringify({ viloes: [{ nome: 'Instagram', minutos: 51 }, { nome: 'YouTube', minutos: 32 }, { nome: 'TikTok', minutos: 12 }], minutosViloes: 95, mediaViloes: 188, temUso: true }); },
      ia: function (id, tipo, dados) {
        setTimeout(function () {
          var r;
          if (tipo === 'testar') r = { modelo: 'gemini-2.5-flash' };
          if (tipo === 'conversa') r = { texto: 'Boa pergunta! Antes de eu responder: o que acontece se você tentar mudar um item de uma `tupla`?', restantes: 19 };
          if (tipo === 'pacote') {
            var t = JSON.parse(dados).trilha;
            r = { modo: 'busca', modelo: 'gemini-2.5-flash', perguntas: t.tipo === 'leitura' ? [
              { tipo: 'contraponto', citacao: 'O autor simplifica demais a história para caber na tese dele.', pergunta: 'Você concorda com essa crítica, pelo que leu até agora?', dica: 'Pense num exemplo do livro que sustente ou derrube a crítica.', resposta: 'Dá para defender que a simplificação é escolha didática, mas vale checar onde ela esconde nuances.', explicacao: '', dificuldade: 2, fonte: { titulo: 'Resenha de exemplo', url: 'https://example.com' } }
            ] : [
              { tipo: 'codigo', pergunta: 'O que este código imprime?', codigo: 'print([x * 2 for x in range(3)])', dica: 'range(3) gera 0, 1 e 2.', resposta: '[0, 2, 4]', explicacao: 'A compreensão de lista aplica `x * 2` a cada número e junta tudo numa lista nova.', dificuldade: 1, fonte: { titulo: 'docs.python.org', url: 'https://docs.python.org/3/tutorial/datastructures.html' } },
              { tipo: 'erro', pergunta: 'Por que `def f(lista=[])` é uma armadilha?', codigo: '', dica: 'Quando o valor padrão é criado?', resposta: 'A lista padrão é criada uma vez só e compartilhada entre as chamadas.', explicacao: 'Use `None` como padrão e crie a lista dentro da função.', dificuldade: 2, fonte: null }
            ] };
          }
          window.zoeResposta(id, true, JSON.stringify(r));
        }, 400);
      }
    };
  }

  if (!Z) Z = pontaFalsa();

  // Animação de entrada: ~2 s (curta com "reduzir movimento"). Toque pula.
  (function intro() {
    var el = document.getElementById('intro');
    if (!el) return;
    var calmo = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var feito = false;
    function sair() {
      if (feito) return; feito = true;
      el.classList.add('sai');
      try { Z.introPronta && Z.introPronta(); } catch (e) { }
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
    }
    el.addEventListener('click', sair);
    var z = el.querySelector('.zoe');
    if (z) ZoeAnim.tocar(z, 'brotar');
    setTimeout(sair, calmo ? 500 : 2600);
  })();

  carregar();
  E = window.ZoeEstudos({
    Z: Z, esc: esc, ico: ico, I: I, orbe: orbe,
    S: function () { return S; },
    render: render, recarregar: recarregar,
    abrir: abrir, trocar: trocar, voltar: fechar, irAba: irAba
  });
  render();
  ZoeAnim.vida({
    gestos: function () {
      if (!S.onboarded || EDITORES.indexOf(rota) >= 0 || rota === 'conversa' || rota === 'pilula') return false;
      if (S.foco.ativo) return ['vigia', 'olhar'];
      return null;
    }
  });
  // sequência de 7, 30 ou 100 dias: a Zoe floresce (uma vez por marco)
  (function () {
    var m = [7, 30, 100].indexOf(S.sequencia) >= 0 ? S.sequencia : 0;
    if (!m || !S.onboarded) return;
    var chave = 'florescer_' + m;
    try { if (Z.ler(chave)) return; Z.guardar(chave, '1'); } catch (e) { return; }
    setTimeout(function () { ZoeAnim.tocar(ZoeAnim.principal(), 'florescer', { texto: m + ' dias!' }); }, 3200);
  })();
})();
