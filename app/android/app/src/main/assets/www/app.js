/* Zoe Foco · telas do app. Conversa com o Android pela ponte window.Zoe (MainActivity.Ponte). */
(function () {
  'use strict';

  var Z = window.Zoe || null; // sem Android: ponte falsa, criada no fim do arquivo
  var S = null;               // estado vindo do Android
  var rota = 'hoje';          // aba ou editor atual
  var rotaAnterior = 'hoje';
  var passo = 0;              // passo das boas-vindas
  var rascunho = {};          // edições ainda não salvas
  var apps = null;            // lista de apps instalados (carrega uma vez)
  var busca = '';
  var duracao = 25;
  var relogio = null;
  var erro = '';

  var PASSOS = ['ola', 'habitos', 'viloes', 'agenda', 'jeito', 'perms'];
  var EDITORES = ['habitos', 'viloes', 'agenda', 'jeito', 'perms'];
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
    fogo: '<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5"/>'
  };

  function orbe(tam, humor, extraStyle) {
    return '<div class="orb flutua ' + (humor || '') + '" style="--s:' + tam + 'px;' + (extraStyle || '') + '" role="img" aria-label="Zoe' + (humor ? ' ' + nomeHumor(humor) : '') + '">' +
      '<span class="bochecha e"></span><span class="bochecha d"></span>' +
      '<div class="face"><i class="eye"></i><i class="eye"></i></div></div>';
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
    } else {
      html = telaAba(rota) + nav();
    }
    $('#app').innerHTML = html;
    document.body.style.background = (S.onboarded && rota === 'foco' && S.foco.ativo) ? '#160A33' : '';
    depoisDeRender();
  }

  function depoisDeRender() {
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
  function telaBoasVindas() {
    var p = PASSOS[passo];
    if (p === 'ola') {
      return '<section class="tela centro">' + orbe(180, 'feliz') +
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
    if (p === 'jeito') { rascunho.tom = S.tom; rascunho.voz = S.voz; }
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
      '<p class="sub">Também dá pra começar um foco avulso quando quiser, na aba Foco.</p>';
  }

  // ---------- jeito ----------
  function conteudoJeito(editor) {
    var cab = editor ? '' : '<h2 class="titulo">Que jeito de Zoe você quer?</h2><p class="sub">Isso muda o tom das broncas. Dá pra trocar quando quiser.</p>';
    return cab + '<div role="radiogroup" aria-label="Tom da Zoe" style="display:flex;flex-direction:column;gap:10px">' + TONS.map(function (t) {
      var on = rascunho.tom === t.id;
      return '<button class="linha escolha" role="radio" aria-checked="' + on + '" aria-pressed="' + on + '" data-acao="tom" data-arg="' + t.id + '" style="align-items:flex-start">' +
        orbe(48, t.humor, 'animation:none') +
        '<span class="meio"><strong>' + t.nome + '</strong><span class="det" style="white-space:normal">“' + esc(t.exemplo) + '”</span></span></button>';
    }).join('') + '</div>' +
      '<button class="linha" role="switch" aria-checked="' + !!rascunho.voz + '" data-acao="voz">' +
      '<span class="perm-ico">' + ico('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>') + '</span>' +
      '<span class="meio"><strong style="white-space:normal">Falar as broncas em voz alta</strong><span class="det" style="white-space:normal">Usa a voz do próprio celular, sem internet.</span></span>' +
      '<span class="interruptor" aria-hidden="true"></span></button>';
  }

  // ---------- permissões ----------
  var PERMS = [
    { grupo: 'Essenciais', itens: [
      { id: 'uso', ico: I.olho, nome: 'Ver qual app está aberto', porque: 'É assim que eu sei que você abriu o Instagram no horário de foco. Eu só olho durante o foco, e isso fica no seu celular.', onde: 'Na lista, toque em Zoe Foco e ative "Permitir acesso ao uso".' },
      { id: 'sobrepor', ico: I.camadas, nome: 'Aparecer por cima de outros apps', porque: 'Pra eu aparecer na frente do app e dar o peteleco.', onde: 'Ative "Permitir sobreposição a outros apps".' }
    ] },
    { grupo: 'Recomendadas', itens: [
      { id: 'notificacoes', ico: I.sino, nome: 'Notificações', porque: 'Pra avisar que o foco começou e mostrar que estou de guarda.' },
      { id: 'alarmes', ico: I.relogio, nome: 'Alarmes no horário certo', porque: 'Pra eu começar a vigiar exatamente na hora do seu foco, e não uns minutos depois.' },
      { id: 'bateria', ico: I.bateria, nome: 'Rodar sem economia de bateria', porque: 'Alguns celulares desligam apps em segundo plano. Isso evita que eu durma no meio do seu foco. Só gasto bateria enquanto vigio.', onde: 'Procure Zoe Foco e escolha "Não otimizar" ou "Sem restrições".' }
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
    var abas = [['hoje', 'Hoje', I.casa], ['estudos', 'Estudos', I.estudo], ['foco', 'Foco', I.alvo], ['zoe', 'Zoe', I.zoe]];
    return '<nav class="nav" aria-label="Principal">' + abas.map(function (a) {
      return '<button data-acao="aba" data-arg="' + a[0] + '"' + (rota === a[0] ? ' aria-current="page"' : '') + '>' + ico(a[2]) + a[1] + '</button>';
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

  function telaHoje() {
    var d = new Date(S.agora);
    var data = DIAS_LONGOS[d.getDay()] + ', ' + d.getDate() + '/' + doisDig(d.getMonth() + 1);
    var feitos = S.habitos.filter(function (h) { return S.feitosHoje.indexOf(h.id) >= 0; }).length;
    var humor = S.foco.ativo ? 'foco' : humorPorEnergia(S.energia);
    var nivel = (80 - S.energia * 0.4) + '%';

    var alerta = !essenciaisOk()
      ? '<div class="aviso">' + ico(I.olho) + '<p><strong>Estou sem enxergar.</strong> Faltam permissões pra eu poder dar o peteleco.</p>' +
        '<button class="btn secundario pequeno" data-acao="editar" data-arg="perms">Ver</button></div>' : '';

    var focoCard;
    if (S.foco.ativo) {
      focoCard = '<button class="card-noite linha" style="background:var(--noite);color:#fff;border:0" data-acao="aba" data-arg="foco">' +
        '<span class="perm-ico" style="background:#2D1A5C;color:#C9A7FF">' + ico(I.escudo) + '</span>' +
        '<span class="meio"><strong>Zoe de guarda até ' + hora(S.foco.fim) + '</strong><span class="det" style="color:#D9CCF5">' + S.vigiados.length + ' apps vigiados</span></span>' + ico(I.seta) + '</button>';
    } else {
      var prox = S.foco.proximo ? 'Próximo foco: ' + DIAS[new Date(S.foco.proximo).getDay()] + ' às ' + hora(S.foco.proximo) : 'Nenhum foco agendado';
      focoCard = '<div class="card-noite" style="display:flex;flex-direction:column;gap:12px">' +
        '<div style="display:flex;gap:12px;align-items:center"><span class="perm-ico" style="background:#2D1A5C;color:#C9A7FF">' + ico(I.alvo) + '</span>' +
        '<span style="display:flex;flex-direction:column;gap:2px"><strong>' + prox + '</strong><span style="font-size:13px;color:#D9CCF5">' + S.vigiados.length + ' apps vigiados</span></span></div>' +
        '<button class="btn claro" style="min-height:48px" data-acao="focar" data-arg="25">Foco agora · 25 min</button></div>';
    }

    var habitos = S.habitos.length ? '<ul class="lista">' + S.habitos.map(function (h) {
      var on = S.feitosHoje.indexOf(h.id) >= 0;
      return '<li><button class="linha" aria-pressed="' + on + '" data-acao="habito" data-arg="' + esc(h.id) + '">' +
        '<span class="check">' + (on ? ico(I.certo, 14).replace('stroke="currentColor"', 'stroke="#FFF" stroke-width="3.5"') : '') + '</span>' +
        '<span class="meio"><strong>' + esc(h.nome) + '</strong></span><span class="pts">+' + h.pontos + '</span></button></li>';
    }).join('') + '</ul>' : '<button class="btn secundario" data-acao="editar" data-arg="habitos">Escolher hábitos</button>';

    return '<section class="tela">' +
      '<div class="topo" style="justify-content:space-between"><div style="display:flex;flex-direction:column;gap:2px"><span class="sub" style="font-size:14px">' + data + '</span><h1 style="font-size:26px">' + saudacao(d) + '</h1></div>' +
      '<span class="selo" aria-label="Sequência de ' + S.sequencia + ' dias">' + ico(I.fogo, 16).replace('currentColor', '#C2410C') + S.sequencia + (S.sequencia === 1 ? ' dia' : ' dias') + '</span></div>' +
      alerta +
      '<div style="display:flex;flex-direction:column;align-items:center;gap:14px">' + orbe(160, humor, '--nivel:' + nivel) +
      '<p class="card" style="margin:0;padding:10px 14px;font-size:15px;text-align:center;max-width:300px" aria-live="polite">' + falaDoDia(feitos, S.habitos.length) + '</p>' +
      '<div class="energia"><span class="sub" style="font-size:13px">Energia</span><div class="barra" role="progressbar" aria-label="Energia da Zoe" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + S.energia + '"><i style="width:' + S.energia + '%"></i></div><strong style="font-size:13px;width:28px;text-align:right">' + S.energia + '</strong></div></div>' +
      focoCard +
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="font-size:19px">Hábitos de hoje</h2><span class="sub" style="font-size:14px">' + feitos + ' de ' + S.habitos.length + '</span></div>' +
      habitos +
      '<p class="sub" style="font-size:13px">Hoje: ' + S.minutosFocoHoje + ' min de foco · ' + S.petelecosHoje + (S.petelecosHoje === 1 ? ' peteleco' : ' petelecos') + '</p>' +
      '</section>';
  }
  function saudacao(d) { var h = d.getHours(); return h < 12 ? 'Bom dia!' : (h < 18 ? 'Boa tarde!' : 'Boa noite!'); }

  function telaFoco() {
    if (S.foco.ativo) {
      return '<section class="tela tela-noite" style="align-items:center;text-align:center">' +
        '<span class="selo" style="background:rgba(255,255,255,.07);border-color:rgba(201,167,255,.25);color:#F4EEFF">' + ico(I.escudo, 16) + 'Zoe de guarda até ' + hora(S.foco.fim) + '</span>' +
        '<div style="padding:24px 0">' + orbe(150, 'foco respira', 'animation:respira 5s ease-in-out infinite') + '</div>' +
        '<div><div class="timer" id="timer" role="timer" aria-label="Tempo restante">--:--</div><p class="sub" style="margin-top:6px">restantes neste foco</p></div>' +
        '<div class="card-noite" style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(201,167,255,.18);text-align:left;display:flex;flex-direction:column;gap:10px">' +
        '<div style="display:flex;justify-content:space-between;font-size:14px;color:#D9CCF5"><span>Vigiando</span><span>Petelecos neste foco: <strong style="color:#fff">' + S.foco.tentativas + '</strong></span></div>' +
        '<div class="vigiados">' + (S.nomesVigiados.length ? S.nomesVigiados.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') : '<span>Nenhum app marcado</span>') + '</div></div>' +
        (!essenciaisOk() ? '<p class="erro" style="color:#FFB4A3">Faltam permissões: estou de guarda, mas sem enxergar.</p>' : '') +
        '<div class="rodape" style="width:100%"><button class="btn fantasma" data-acao="encerrar">Encerrar foco antes da hora</button></div></section>';
    }
    var blocos = S.blocos.length ? S.blocos.map(function (b) {
      return '<li class="linha" style="cursor:default"><span class="perm-ico">' + ico(I.relogio) + '</span><span class="meio"><strong>' + hhmm(b.inicio) + ' – ' + hhmm(b.fim) + '</strong><span class="det">' + diasTexto(b.dias) + '</span></span></li>';
    }).join('') : '<li class="vazio">Nenhum horário agendado.</li>';
    return '<section class="tela">' +
      '<h1 class="titulo">Foco</h1>' +
      '<div class="card" style="display:flex;flex-direction:column;gap:14px">' +
      '<div style="display:flex;gap:14px;align-items:center">' + orbe(64, 'foco') + '<div><strong style="font-size:18px">Começar agora</strong><p class="sub" style="font-size:14px">Eu fico de guarda até o fim.</p></div></div>' +
      '<div class="chips" role="radiogroup" aria-label="Duração">' + [25, 50, 90].map(function (m) {
        return '<button class="chip-btn" role="radio" aria-checked="' + (duracao === m) + '" data-acao="duracao" data-arg="' + m + '" style="flex:1">' + m + ' min</button>';
      }).join('') + '</div>' +
      '<button class="btn principal" data-acao="focar" data-arg="' + duracao + '">Começar foco de ' + duracao + ' min</button>' +
      (!essenciaisOk() ? '<p class="sub" style="font-size:13px">Sem as permissões essenciais eu fico de guarda, mas não consigo ver os apps. <a href="#" data-acao="editar" data-arg="perms">Liberar</a></p>' : '') +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:19px">Agenda</h2><button class="btn fantasma pequeno" data-acao="editar" data-arg="agenda">Editar</button></div>' +
      '<ul class="lista">' + blocos + '</ul>' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:19px">Apps vigiados</h2><button class="btn fantasma pequeno" data-acao="editar" data-arg="viloes">Editar</button></div>' +
      '<div class="vigiados">' + (S.nomesVigiados.length ? S.nomesVigiados.map(function (n) { return '<span style="background:#EFE7FF">' + esc(n) + '</span>'; }).join('') : '<span class="sub">Nenhum ainda.</span>') + '</div>' +
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

  function telaEstudos() {
    return '<section class="tela centro">' + orbe(120, 'pensa') +
      '<h1 class="titulo">Estudos chega logo</h1>' +
      '<p class="texto">Na próxima versão você vai contar o que está estudando ou lendo, e eu trago perguntas e provocações pra você pensar no intervalo do foco.</p>' +
      '<p class="sub">Por enquanto, foco no peteleco.</p></section>';
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
      item('editar', 'jeito', I.zoe, 'Jeito da Zoe', tom.nome + (S.voz ? ' · fala em voz alta' : ' · silenciosa')) +
      item('editar', 'viloes', I.olho, 'Apps vigiados', S.vigiados.length + ' apps') +
      item('editar', 'agenda', I.relogio, 'Horários de foco', S.blocos.length ? S.blocos.length + (S.blocos.length === 1 ? ' horário' : ' horários') : 'Nenhum') +
      item('editar', 'habitos', I.certo, 'Hábitos', S.habitos.length + ' hábitos') +
      item('editar', 'perms', I.escudo, 'Permissões', permsLiberadas() + ' de 5 liberadas') +
      '</ul>' +
      '<p class="sub" style="display:flex;gap:8px;align-items:flex-start">' + ico(I.escudo, 18) + '<span>Privacidade: a Zoe não tem permissão de internet. Seus hábitos e o uso dos apps ficam só neste celular.</span></p>' +
      '<p class="sub" style="font-size:12px">Zoe Foco 0.1.0</p></section>';
  }

  // ---------------- ações ----------------
  var acoes = {
    avancar: function () { erro = ''; passo++; render(); },
    voltar: function () { window.zoeVoltar(); },
    aba: function (a) { rota = a; render(); window.scrollTo(0, 0); },
    editar: function (p) { rotaAnterior = rota; rota = p; erro = ''; delete rascunho[{ habitos: 'habitos', viloes: 'vigiados', agenda: 'blocos', jeito: 'tom' }[p]]; render(); window.scrollTo(0, 0); },
    liberar: function (p) { Z.liberar(p); },
    habito: function (id) { Z.alternarHabito(id); carregar(); render(); },
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
    tom: function (t) { rascunho.tom = t; render(); },
    voz: function () { rascunho.voz = !rascunho.voz; render(); },
    duracao: function (m) { duracao = +m; render(); },
    focar: function (m) { Z.focarAgora(+m); carregar(); rota = 'foco'; render(); },
    encerrar: function () {
      if (!confirm('Encerrar o foco antes da hora? A Zoe perde 10 de energia.')) return;
      Z.encerrarFoco(); carregar(); render();
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
      if (p === 'jeito') { Z.salvarTom(rascunho.tom); Z.salvarVoz(!!rascunho.voz); }
      if (p === 'perms' && !S.onboarded) { Z.concluirBoasVindas(); rota = 'hoje'; }
      carregar();
      if (!S.onboarded) { passo++; }
      else if (EDITORES.indexOf(rota) >= 0) { rota = rotaAnterior; }
      render();
      window.scrollTo(0, 0);
    }
  };

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-acao]');
    if (!t) return;
    e.preventDefault();
    var f = acoes[t.getAttribute('data-acao')];
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
    if (EDITORES.indexOf(rota) >= 0) { rota = rotaAnterior; erro = ''; render(); return true; }
    if (rota !== 'hoje') { rota = 'hoje'; render(); return true; }
    return false;
  };
  window.zoeVoltou = function () {
    var antes = S && S.perms.uso;
    carregar();
    if (S.perms.uso && !antes) apps = null; // agora dá pra mostrar o tempo de uso
    render();
  };

  // ---------------- ponte falsa (só para abrir no navegador do computador) ----------------
  function pontaFalsa() {
    var st = {
      onboarded: location.hash !== '#novo', energia: 72, sequencia: 12, tom: 'firme', voz: true,
      vigiados: ['com.instagram.android', 'com.google.android.youtube'], nomesVigiados: ['Instagram', 'YouTube'],
      blocos: [{ dias: [1, 2, 3, 4, 5], inicio: 540, fim: 720 }, { dias: [1, 2, 3, 4, 5], inicio: 840, fim: 1080 }],
      habitos: HABITOS_SUGERIDOS.slice(0, 4), feitosHoje: ['ler'],
      foco: { ativo: false, fim: 0, tentativas: 0, proximo: Date.now() + 3600e3 },
      petelecosHoje: 1, minutosFocoHoje: 50,
      perms: { uso: true, sobrepor: false, notificacoes: true, alarmes: false, bateria: false, marca: 'Xiaomi', marcaAgressiva: 'xiaomi', android: 35 },
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
      salvarTom: function (t) { st.tom = t; }, salvarVoz: function (v) { st.voz = v; },
      concluirBoasVindas: function () { st.onboarded = true; },
      liberar: function (p) { st.perms[p] = true; setTimeout(window.zoeVoltou, 50); },
      focarAgora: function (m) { st.foco = { ativo: true, fim: Date.now() + m * 60e3, tentativas: 0, proximo: 0 }; },
      encerrarFoco: function () { st.foco.ativo = false; }
    };
  }

  if (!Z) Z = pontaFalsa();
  carregar();
  render();
})();
