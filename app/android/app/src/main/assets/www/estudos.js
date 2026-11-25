/* Zoe Foco · Estudos: trilhas, pacotes de perguntas (Gemini), pílula com revisão espaçada e conversa socrática.
   Tudo fica no celular (ponte Zoe.ler/guardar). Só o tema da trilha e as mensagens da conversa vão para a internet. */
window.ZoeEstudos = function (ctx) {
  'use strict';
  var Z = ctx.Z, esc = ctx.esc, ico = ctx.ico, I = ctx.I, orbe = ctx.orbe;

  var INTERVALOS = [1, 3, 7, 15, 30];       // dias até rever, por caixa
  var OCULOS = 50;                           // perguntas respondidas para a Zoe ganhar óculos
  var TIPOS = {
    conceito: 'Conceito', codigo: 'Desafio de código', erro: 'Erro comum',
    contraponto: 'O que dizem sobre o livro', conexao: 'Conexão', frase: 'Em uma frase'
  };

  // ---------------- dados ----------------
  function ler(k, padrao) { try { var v = Z.ler(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } }
  function guardar(k, v) { Z.guardar(k, JSON.stringify(v)); }
  var trilhas = ler('est_trilhas', []);
  var perguntas = ler('est_perguntas', []);
  var respostas = ler('est_respostas', []);
  var conversas = ler('est_conversas', {});
  function salvarTudo() {
    guardar('est_trilhas', trilhas); guardar('est_perguntas', perguntas);
    guardar('est_respostas', respostas.slice(-300)); guardar('est_conversas', conversas);
  }

  function hoje(offset) {
    var d = new Date(); d.setDate(d.getDate() + (offset || 0));
    return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
  }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function trilha(id) { return trilhas.filter(function (t) { return t.id === id; })[0]; }
  function daTrilha(id) { return perguntas.filter(function (q) { return q.trilha === id; }); }
  function devidas(idTrilha) {
    var h = hoje();
    return perguntas.filter(function (q) { return (!idTrilha || q.trilha === idTrilha) && q.proxima <= h; })
      .sort(function (a, b) { return a.proxima < b.proxima ? -1 : a.proxima > b.proxima ? 1 : a.caixa - b.caixa; });
  }
  function respondidas(idTrilha) {
    return perguntas.filter(function (q) { return (!idTrilha || q.trilha === idTrilha); })
      .reduce(function (s, q) { return s + (q.vezes || 0); }, 0);
  }
  function nomeTrilha(t) { return t.tipo === 'leitura' ? (t.titulo || 'Livro') : (t.tema || 'Estudo'); }
  function detalheTrilha(t) {
    return t.tipo === 'leitura'
      ? 'Leitura · capítulo ' + esc(t.capitulo || '1') + (t.autor ? ' · ' + esc(t.autor) : '')
      : 'Estudo' + (t.topico ? ' · agora: ' + esc(t.topico) : '') + (t.nivel ? ' · ' + esc(t.nivel) : '');
  }
  function sigla(t) { return t.tipo === 'leitura' ? ico(I.livro) : esc((t.tema || '?').slice(0, 2).toLowerCase()); }

  // texto da IA: escapa e aceita só `código` e **negrito**
  function formatar(t) {
    return esc(t).replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '<pre class="cod-bloco"><code>$1</code></pre>')
      .replace(/`([^`\n]+)`/g, '<code class="cod">$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  // ---------------- pedidos à IA ----------------
  var pendentes = {};
  window.zoeResposta = function (id, ok, dados) {
    var cb = pendentes[id]; delete pendentes[id];
    if (cb) cb(ok, dados);
  };
  function pedir(tipo, dados, cb) {
    var id = uid('r');
    pendentes[id] = cb;
    Z.ia(id, tipo, JSON.stringify(dados || {}));
  }

  var gerando = {};   // trilhaId -> true
  var erros = {};     // trilhaId -> mensagem
  function gerarPacote(t) {
    if (gerando[t.id]) return;
    gerando[t.id] = true; delete erros[t.id];
    var existentes = daTrilha(t.id).map(function (q) { return q.pergunta; });
    pedir('pacote', { trilha: t, existentes: existentes }, function (ok, dados) {
      delete gerando[t.id];
      if (!ok) { erros[t.id] = dados; ctx.render(); return; }
      var r = JSON.parse(dados);
      var h = hoje();
      r.perguntas.forEach(function (q) {
        q.id = uid('q'); q.trilha = t.id; q.caixa = 0; q.proxima = h; q.vezes = 0; q.acertos = 0;
        perguntas.push(q);
      });
      t.modo = r.modo; t.atualizada = h; t.ultimoPacote = r.perguntas.length;
      salvarTudo();
      ctx.render();
    });
    ctx.render();
  }

  // ---------------- estado das telas ----------------
  var atual = null;            // trilha aberta
  var form = null;             // nova trilha
  var pil = null;              // pílula em andamento
  var conv = { enviando: false, erro: '' };
  var iaTela = { testando: false, msg: '', ok: null };

  function novoForm() {
    return { tipo: 'estudo', tema: '', nivel: 'Intermediário', topico: '', objetivo: '', titulo: '', autor: '', capitulo: '1', erro: '' };
  }

  function iniciarPilula(idTrilha, troca) {
    var fila = devidas(idTrilha).slice(0, 3).map(function (q) { return q.id; });
    var extra = false;
    if (!fila.length) {
      var todas = perguntas.filter(function (q) { return !idTrilha || q.trilha === idTrilha; });
      if (todas.length) { fila = [todas[Math.floor(Math.random() * todas.length)].id]; extra = true; }
    }
    pil = { fila: fila, i: 0, etapa: 'pensar', dica: false, acerto: null, troca: !!troca, extra: extra, recompensa: '', feitas: 0, texto: '' };
  }

  // ---------------- telas ----------------
  function cabecalho(titulo, sub) {
    return '<div class="topo"><button class="voltar" data-acao="voltar" aria-label="Voltar">' + ico(I.voltar) + '</button>' +
      '<div style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:0"><h1 style="font-size:20px">' + titulo + '</h1>' +
      (sub ? '<span class="sub" style="font-size:13px">' + sub + '</span>' : '') + '</div></div>';
  }

  function cardChave() {
    return '<div class="card" style="display:flex;gap:12px;align-items:flex-start">' + orbe(48, 'pensa', 'animation:none') +
      '<div style="flex:1;display:flex;flex-direction:column;gap:8px"><strong>Pra eu buscar perguntas, preciso de uma chave</strong>' +
      '<span class="sub" style="font-size:14px">É grátis, do Google (Gemini). Leva 2 minutos.</span>' +
      '<button class="btn secundario pequeno" style="align-self:flex-start" data-acao="sub" data-arg="ia">Configurar</button></div></div>';
  }

  function telaEstudos(S) {
    var n = devidas().length;
    var html = '<section class="tela">' +
      '<div class="topo" style="justify-content:space-between"><h1 class="titulo">Estudos</h1>' +
      '<button class="btn secundario pequeno" data-acao="novaTrilha">' + ico(I.mais, 16) + 'Nova trilha</button></div>';
    if (!S.ia.temChave) html += cardChave();
    if (perguntas.length) {
      html += '<div class="card-noite" style="display:flex;flex-direction:column;gap:14px">' +
        '<div style="display:flex;gap:14px;align-items:center">' + orbe(56, n ? '' : 'feliz', 'animation:none') +
        '<div style="display:flex;flex-direction:column;gap:2px"><strong style="font-size:19px">' +
        (n ? n + (n === 1 ? ' pergunta para revisar' : ' para revisar hoje') : 'Tudo revisado hoje!') + '</strong>' +
        '<span style="font-size:14px;color:#D9CCF5">' + (n ? 'Uns ' + Math.max(1, Math.round(n * 0.5)) + ' min' : 'Quer uma pergunta extra?') + '</span></div></div>' +
        '<button class="btn claro" style="min-height:48px" data-acao="pilula">' + (n ? 'Revisar agora' : 'Uma pergunta extra') + '</button></div>';
    }
    if (!trilhas.length) {
      html += '<div class="vazio" style="display:flex;flex-direction:column;align-items:center;gap:14px">' + orbe(110, 'pensa') +
        '<p class="texto" style="color:var(--tinta)">Me conta o que você está estudando ou lendo.</p>' +
        '<p class="sub">Eu busco perguntas e provocações pra você pensar no intervalo do foco.</p>' +
        '<button class="btn principal" data-acao="novaTrilha">Criar minha primeira trilha</button></div>';
    } else {
      html += '<h2 style="font-size:19px">Suas trilhas</h2><ul class="lista">' + trilhas.map(function (t) {
        var resp = respondidas(t.id), tot = daTrilha(t.id).length;
        var info = gerando[t.id] ? 'Buscando perguntas…' : (erros[t.id] ? 'Deu erro: toque para ver' : tot + ' perguntas · ' + devidas(t.id).length + ' para hoje');
        return '<li><button class="linha" style="flex-direction:column;align-items:stretch;gap:12px" data-acao="abrirTrilha" data-arg="' + t.id + '">' +
          '<span style="display:flex;align-items:center;gap:12px"><span class="letra" style="font-size:15px;' + (t.tipo === 'leitura' ? 'background:#FFF1EC;color:var(--peteleco-escuro)' : '') + '" aria-hidden="true">' + sigla(t) + '</span>' +
          '<span class="meio"><strong>' + esc(nomeTrilha(t)) + '</strong><span class="det">' + detalheTrilha(t) + '</span></span></span>' +
          '<span style="display:flex;align-items:center;gap:10px"><span class="barra" style="flex:1"><i style="width:' + Math.min(100, resp / OCULOS * 100) + '%"></i></span>' +
          '<span class="det" style="font-size:12px">' + info + '</span></span></button></li>';
      }).join('') + '</ul>';
    }
    return html + '</section>';
  }

  function telaTrilha(S) {
    var t = trilha(atual);
    if (!t) return telaEstudos(S);
    var qs = daTrilha(t.id), dominadas = qs.filter(function (q) { return q.caixa >= 3; }).length;
    var resp = respondidas(t.id);
    var fonteTxt = { busca: 'Perguntas montadas com busca do Google.', aberta: 'A busca do Google não está liberada na sua chave grátis, então usei Wikipedia e Open Library como fontes.', sem_fonte: 'Não achei fontes abertas sobre isso: estas perguntas vieram só do modelo, confira com cuidado.' }[t.modo] || '';
    var html = '<section class="tela">' + cabecalho(esc(nomeTrilha(t)), detalheTrilha(t)) +
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' +
      stat(qs.length, 'perguntas') + stat(dominadas, 'dominadas') + stat(devidas(t.id).length, 'para hoje') + '</div>' +
      '<div class="card" style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;font-size:14px"><strong>Óculos da Zoe</strong><span class="sub" style="font-size:13px">' + Math.min(resp, OCULOS) + ' de ' + OCULOS + '</span></div>' +
      '<div class="barra"><i style="width:' + Math.min(100, resp / OCULOS * 100) + '%"></i></div>' +
      '<span class="sub" style="font-size:13px">' + (resp >= OCULOS ? 'Conquistado! A Zoe agora usa óculos.' : 'Com ' + OCULOS + ' respostas nesta trilha, a Zoe ganha óculos.') + '</span></div>';
    if (gerando[t.id]) {
      html += '<div class="card" style="display:flex;gap:14px;align-items:center">' + orbe(56, 'pensa') +
        '<div><strong>Buscando referências…</strong><p class="sub" style="font-size:14px">Pode levar até um minuto. Pode sair desta tela.</p></div></div>';
    }
    if (erros[t.id]) html += '<div class="aviso"><p>' + esc(erros[t.id]) + '</p></div>';
    if (!S.ia.temChave) html += cardChave();
    html += '<div style="display:flex;flex-direction:column;gap:10px">' +
      (qs.length ? '<button class="btn principal" data-acao="pilula" data-arg="' + t.id + '">Revisar esta trilha</button>' : '') +
      (S.ia.temChave ? '<button class="btn secundario" data-acao="gerar" data-arg="' + t.id + '"' + (gerando[t.id] ? ' disabled' : '') + '>' + ico(I.mais, 18) + (qs.length ? 'Buscar mais perguntas' : 'Montar meu pacote') + '</button>' +
        '<button class="btn secundario" data-acao="conversa" data-arg="' + t.id + '">' + ico(I.balao, 18) + 'Conversar com a Zoe</button>' : '') +
      '</div>';
    if (t.tipo === 'leitura') {
      html += '<div class="campo"><label for="cap">Em que capítulo você está?</label><div class="linha-campo">' +
        '<input id="cap" class="entrada" type="number" inputmode="numeric" min="1" value="' + esc(t.capitulo) + '">' +
        '<button class="btn secundario pequeno" data-acao="capitulo" data-arg="' + t.id + '">Salvar</button></div>' +
        '<span class="sub" style="font-size:13px">Ao avançar, busque mais perguntas: as novas vão até o novo capítulo.</span></div>';
    } else {
      html += '<div class="campo"><label for="top">O que você está vendo agora?</label><div class="linha-campo">' +
        '<input id="top" class="entrada" type="text" maxlength="80" value="' + esc(t.topico || '') + '">' +
        '<button class="btn secundario pequeno" data-acao="topico" data-arg="' + t.id + '">Salvar</button></div></div>';
    }
    if (fonteTxt) html += '<p class="sub" style="font-size:13px">' + fonteTxt + '</p>';
    html += '<button class="btn fantasma" style="color:var(--peteleco-escuro)" data-acao="apagarTrilha" data-arg="' + t.id + '">Apagar trilha</button>';
    return html + '</section>';
  }
  function stat(n, rot) {
    return '<div class="card" style="padding:12px;display:flex;flex-direction:column;gap:2px"><strong style="font-size:22px">' + n + '</strong><span class="sub" style="font-size:12px">' + rot + '</span></div>';
  }

  function telaNovaTrilha(S) {
    var f = form || (form = novoForm());
    var est = f.tipo === 'estudo';
    var campo = function (id, rot, val, ph, extra) {
      return '<div class="campo"><label for="nt-' + id + '">' + rot + '</label><input id="nt-' + id + '" class="entrada" type="text" maxlength="80" data-form="' + id + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '"' + (extra || '') + '></div>';
    };
    var html = '<section class="tela">' + cabecalho('Nova trilha') +
      '<div role="radiogroup" aria-label="Tipo de trilha" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;background:#EAE2FA;border-radius:14px;padding:4px">' +
      ['estudo', 'leitura'].map(function (tp) {
        var on = f.tipo === tp;
        return '<button role="radio" aria-checked="' + on + '" data-acao="tipoTrilha" data-arg="' + tp + '" style="min-height:44px;border:0;border-radius:11px;font-weight:600;cursor:pointer;background:' + (on ? '#fff' : 'transparent') + '">' + (tp === 'estudo' ? 'Estou estudando' : 'Estou lendo') + '</button>';
      }).join('') + '</div>';
    if (est) {
      html += campo('tema', 'O que você está estudando?', f.tema, 'Ex.: Python') +
        '<div class="campo"><span class="lbl" id="nt-nivel">Seu nível</span><div class="chips" role="radiogroup" aria-labelledby="nt-nivel">' +
        ['Começando', 'Intermediário', 'Avançado'].map(function (n) {
          return '<button class="chip-btn" style="flex:1" role="radio" aria-checked="' + (f.nivel === n) + '" data-acao="nivel" data-arg="' + n + '">' + n + '</button>';
        }).join('') + '</div></div>' +
        campo('topico', 'O que você está vendo agora?', f.topico, 'Ex.: listas e dicionários') +
        campo('objetivo', 'Para quê? (opcional)', f.objetivo, 'Ex.: automatizar planilhas no trabalho');
    } else {
      html += campo('titulo', 'Qual livro?', f.titulo, 'Título do livro') +
        campo('autor', 'Autor', f.autor, 'Nome do autor') +
        '<div class="campo"><label for="nt-capitulo">Em que capítulo você está?</label><input id="nt-capitulo" class="entrada" type="number" min="1" inputmode="numeric" data-form="capitulo" value="' + esc(f.capitulo) + '"></div>' +
        '<p class="sub" style="font-size:13px">Eu nunca trago nada depois do seu capítulo. Sem spoiler.</p>';
    }
    html += '<div class="balao" style="align-items:flex-start">' + orbe(40, '', 'animation:none') +
      '<p style="margin:0;font-size:14px">' + (S.ia.temChave ? 'Vou buscar perguntas e referências na internet. Só o tema sai do seu celular, nada sobre seus apps ou hábitos.' : 'Sem a chave do Gemini eu guardo a trilha, mas só monto as perguntas depois que você configurar.') + '</p></div>' +
      (f.erro ? '<p class="erro" role="alert">' + esc(f.erro) + '</p>' : '') +
      '<div class="rodape"><button class="btn principal" data-acao="criarTrilha">' + (S.ia.temChave ? 'Montar meu pacote' : 'Salvar trilha') + '</button></div>';
    return html + '</section>';
  }

  function telaPilula(S) {
    if (!pil) iniciarPilula(null, false);
    if (!pil.fila.length) {
      return '<section class="tela centro">' + orbe(120, 'pensa') + '<h1 class="titulo">Ainda não tenho perguntas</h1>' +
        '<p class="texto">Crie uma trilha em Estudos e eu monto um pacote pra você.</p>' +
        '<div class="rodape" style="width:100%"><button class="btn principal" data-acao="irEstudos">Ir para Estudos</button>' +
        '<button class="btn fantasma" data-acao="voltar">Voltar</button></div></section>';
    }
    if (pil.i >= pil.fila.length) {
      return '<section class="tela centro">' + orbe(140, 'feliz') + '<h1 class="titulo">' + (pil.troca ? 'Troca feita!' : 'Pronto!') + '</h1>' +
        '<p class="texto">' + (pil.troca ? 'Você trocou a rede social por ' + pil.feitas + (pil.feitas === 1 ? ' pergunta' : ' perguntas') + '. Orgulho!' : pil.feitas + (pil.feitas === 1 ? ' pergunta respondida.' : ' perguntas respondidas.')) + '</p>' +
        '<div class="rodape" style="width:100%"><button class="btn principal" data-acao="voltar">' + (pil.troca ? 'Voltar ao foco' : 'Fechar') + '</button>' +
        '<button class="btn fantasma" data-acao="maisUma">Mais uma</button></div></section>';
    }
    var q = perguntas.filter(function (x) { return x.id === pil.fila[pil.i]; })[0];
    if (!q) { pil.i++; return telaPilula(S); }
    var t = trilha(q.trilha) || {};
    var leitura = t.tipo === 'leitura';
    var falas = {
      pensar: pil.troca ? 'No lugar da rede social, uma rapidinha. Tenta responder de cabeça!' : (leitura ? 'Pensa um pouco antes de escrever. Não tem resposta errada.' : 'Tenta responder de cabeça antes de ver a resposta.'),
      avaliar: 'E aí, bateu com o que você pensou?',
      fim: leitura ? 'Boa reflexão! Guardei sua resposta.' : (pil.acerto ? 'Mandou bem! Essa volta daqui a uns dias pra fixar.' : 'Tudo bem errar, é assim que fixa. Essa volta amanhã.')
    };
    var humor = pil.etapa === 'pensar' ? 'pensa' : (pil.etapa === 'fim' && (pil.acerto || leitura) ? 'feliz' : '');
    var fonte = q.fonte && q.fonte.url ? '<a href="' + esc(q.fonte.url) + '" style="display:inline-flex;gap:6px;align-items:center;font-size:13px">' + ico(I.externo, 14) + 'Fonte: ' + esc(q.fonte.titulo || q.fonte.url) + '</a>' : '';
    var html = '<section class="tela">' +
      '<div class="topo" style="justify-content:space-between"><button class="voltar" data-acao="voltar" aria-label="Fechar">' + ico(I.fechar) + '</button>' +
      '<span class="selo">' + esc(nomeTrilha(t)) + ' · ' + (pil.i + 1) + ' de ' + pil.fila.length + (pil.extra ? ' (extra)' : '') + '</span></div>' +
      '<div style="display:flex;gap:14px;align-items:center">' + orbe(72, humor) + '<p class="texto" style="flex:1;font-size:15px" aria-live="polite">' + falas[pil.etapa] + '</p></div>' +
      '<div class="card" style="display:flex;flex-direction:column;gap:14px">' +
      '<span class="rotulo">' + esc(TIPOS[q.tipo] || 'Pergunta') + '</span>' +
      (q.citacao ? '<blockquote class="citacao">“' + esc(q.citacao) + '”</blockquote>' : '') +
      '<h1 style="font-size:20px;line-height:1.3">' + formatar(q.pergunta) + '</h1>' +
      (q.codigo ? '<pre class="cod-bloco"><code>' + esc(q.codigo) + '</code></pre>' : '') +
      (pil.dica && pil.etapa === 'pensar' && q.dica ? '<p class="dica">Dica: ' + formatar(q.dica) + '</p>' : '');
    if (leitura && pil.etapa === 'pensar') {
      html += '<div class="campo"><label for="pil-txt">Sua resposta (fica só no seu celular)</label>' +
        '<textarea id="pil-txt" class="entrada" style="height:96px;padding:12px" data-pil="texto" placeholder="Escreve o que vier, nem que seja uma linha.">' + esc(pil.texto) + '</textarea></div>';
    }
    if (pil.etapa !== 'pensar') {
      html += '<div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid #EFE9FB;padding-top:14px">' +
        (leitura ? '<span class="rotulo">Um jeito de pensar</span>' : '') +
        '<strong style="font-size:17px;color:' + (leitura ? 'var(--tinta)' : 'var(--ok)') + '">' + formatar(q.resposta) + '</strong>' +
        (q.explicacao ? '<p class="texto" style="font-size:14px">' + formatar(q.explicacao) + '</p>' : '') + fonte + '</div>';
    }
    html += '</div>';
    if (pil.recompensa) html += '<div style="display:flex;justify-content:center"><span class="selo" style="background:#EFE7FF;color:var(--roxo)">' + esc(pil.recompensa) + '</span></div>';
    html += '<div class="rodape">';
    if (pil.etapa === 'pensar') {
      html += leitura
        ? '<button class="btn principal" data-acao="pilGuardar">Guardar e ver um jeito de pensar</button>'
        : '<button class="btn principal" data-acao="pilRevelar">Pensei, mostrar resposta</button>';
      if (q.dica && !pil.dica) html += '<button class="btn fantasma" data-acao="pilDica">Me dá uma dica</button>';
    } else if (pil.etapa === 'avaliar') {
      html += '<span class="sub" style="text-align:center;font-size:14px">Você acertou?</span><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' +
        '<button class="btn secundario" data-acao="pilErrei">Errei</button><button class="btn principal" data-acao="pilAcertei">Acertei</button></div>';
    } else {
      html += '<button class="btn principal" data-acao="pilProxima">' + (pil.i + 1 < pil.fila.length ? 'Próxima pergunta' : 'Terminar') + '</button>';
    }
    if (pil.etapa !== 'pensar') html += '<button class="btn fantasma" style="font-size:13px;min-height:40px" data-acao="pilRuim">Essa pergunta está errada</button>';
    return html + '</div></section>';
  }

  function telaConversa(S) {
    var t = trilha(atual);
    if (!t) return telaEstudos(S);
    var hist = conversas[t.id] || [];
    var html = '<section class="tela" style="gap:12px">' +
      cabecalho('Zoe · ' + esc(nomeTrilha(t)), 'Modo socrático · ' + S.ia.conversasRestantes + ' mensagens hoje') +
      '<div role="log" aria-label="Conversa" style="display:flex;flex-direction:column;gap:10px;flex:1">' +
      '<p class="msg zoe">Sobre o que você quer pensar em <strong>' + esc(nomeTrilha(t)) + '</strong>? Pode mandar sua dúvida. Eu respondo com perguntas, pra você chegar lá sozinho.</p>' +
      hist.map(function (m) { return '<p class="msg ' + (m.eu ? 'eu' : 'zoe') + '">' + (m.eu ? esc(m.texto) : formatar(m.texto)) + '</p>'; }).join('') +
      (conv.enviando ? '<p class="msg zoe" aria-label="Zoe está pensando">…</p>' : '') +
      (conv.erro ? '<p class="erro" role="alert">' + esc(conv.erro) + '</p>' : '') + '</div>' +
      '<div class="chips">' + ['Me explica direto', 'Me dá um exemplo', 'Me faz uma pergunta'].map(function (c) {
        return '<button class="chip-btn" data-acao="enviar" data-arg="' + c + '"' + (conv.enviando ? ' disabled' : '') + '>' + c + '</button>';
      }).join('') + '</div>' +
      '<div class="linha-campo" style="position:sticky;bottom:0;background:var(--fundo);padding:8px 0">' +
      '<label class="sr" for="msg">Mensagem para a Zoe</label><input id="msg" class="entrada" type="text" maxlength="500" placeholder="Sua resposta ou dúvida" enterkeyhint="send">' +
      '<button class="btn principal pequeno" style="width:52px" data-acao="enviar" aria-label="Enviar"' + (conv.enviando ? ' disabled' : '') + '>' + ico(I.seta, 20) + '</button></div>' +
      (hist.length ? '<button class="btn fantasma" style="font-size:13px" data-acao="limparConversa">Começar conversa nova</button>' : '');
    return html + '</section>';
  }

  function telaIa(S) {
    var html = '<section class="tela">' + cabecalho('Inteligência') +
      '<div class="balao" style="align-items:flex-start">' + orbe(56, 'pensa', 'animation:none') +
      '<p style="margin:0">Pra montar perguntas e conversar eu uso o Gemini, do Google, no plano gratuito. Você só precisa criar uma chave.</p></div>';
    if (S.ia.temChave) {
      html += '<div class="card perm"><div class="perm-cab"><span class="perm-ico">' + ico(I.chave) + '</span><strong>Chave salva</strong>' +
        '<span class="estado ' + (iaTela.ok === false ? 'falta' : 'ok') + '">' + (iaTela.ok === false ? 'Com erro' : 'Ok') + '</span></div>' +
        (S.ia.modelo ? '<p>Modelo em uso: ' + esc(S.ia.modelo) + '</p>' : '') +
        (iaTela.msg ? '<p' + (iaTela.ok === false ? ' class="erro"' : '') + '>' + esc(iaTela.msg) + '</p>' : '') +
        '<div class="linha-campo"><button class="btn secundario pequeno" data-acao="testarIa"' + (iaTela.testando ? ' disabled' : '') + '>' + (iaTela.testando ? 'Testando…' : 'Testar') + '</button>' +
        '<button class="btn secundario pequeno" style="color:var(--peteleco-escuro)" data-acao="apagarChave">Apagar chave</button></div></div>';
    } else {
      html += '<h2 style="font-size:17px">Como conseguir a chave grátis</h2><ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;line-height:1.5">' +
        '<li>Abra <a href="https://aistudio.google.com/apikey">aistudio.google.com/apikey</a> e entre com sua conta Google.</li>' +
        '<li>Toque em <strong>Create API key</strong> (Criar chave de API).</li>' +
        '<li>Copie a chave e cole aqui embaixo.</li></ol>' +
        '<div class="campo"><label for="chave">Chave do Gemini</label><input id="chave" class="entrada" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Cole aqui"></div>' +
        (iaTela.msg ? '<p class="erro" role="alert">' + esc(iaTela.msg) + '</p>' : '') +
        '<button class="btn principal" data-acao="salvarChave"' + (iaTela.testando ? ' disabled' : '') + '>' + (iaTela.testando ? 'Testando…' : 'Salvar e testar') + '</button>';
    }
    html += '<h2 style="font-size:17px">O que sai do seu celular</h2>' +
      '<p class="sub">Só o tema da trilha (assunto, nível, tópico, livro e capítulo) e as mensagens que você escreve na conversa. Nunca seus hábitos, horários ou o uso dos apps.</p>' +
      '<p class="sub">No plano gratuito, o Google pode usar o que você envia para melhorar os produtos dele. Não escreva nada pessoal nas trilhas nem na conversa.</p>' +
      '<p class="sub">A chave fica só neste celular e não entra no backup.</p>';
    return html + '</section>';
  }

  // ---------------- ações ----------------
  var acoes = {
    novaTrilha: function () { form = novoForm(); ctx.abrir('novaTrilha'); },
    tipoTrilha: function (tp) { form.tipo = tp; form.erro = ''; ctx.render(); },
    nivel: function (n) { form.nivel = n; ctx.render(); },
    criarTrilha: function () {
      var f = form, S = ctx.S();
      if (f.tipo === 'estudo' && !f.tema.trim()) { f.erro = 'Me conta o que você está estudando.'; ctx.render(); return; }
      if (f.tipo === 'leitura' && !f.titulo.trim()) { f.erro = 'Qual é o livro?'; ctx.render(); return; }
      var t = f.tipo === 'estudo'
        ? { id: uid('t'), tipo: 'estudo', tema: f.tema.trim(), nivel: f.nivel, topico: f.topico.trim(), objetivo: f.objetivo.trim() }
        : { id: uid('t'), tipo: 'leitura', titulo: f.titulo.trim(), autor: f.autor.trim(), capitulo: String(Math.max(1, parseInt(f.capitulo, 10) || 1)) };
      t.criada = hoje();
      trilhas.push(t); salvarTudo();
      form = null; atual = t.id;
      ctx.trocar('trilha');
      if (S.ia.temChave) gerarPacote(t);
    },
    abrirTrilha: function (id) { atual = id; ctx.abrir('trilha'); },
    gerar: function (id) { var t = trilha(id); if (t) gerarPacote(t); },
    capitulo: function (id) {
      var t = trilha(id), v = parseInt((document.getElementById('cap') || {}).value, 10);
      if (t && v > 0) { t.capitulo = String(v); salvarTudo(); ctx.render(); }
    },
    topico: function (id) {
      var t = trilha(id), v = ((document.getElementById('top') || {}).value || '').trim();
      if (t) { t.topico = v; salvarTudo(); ctx.render(); }
    },
    apagarTrilha: function (id) {
      if (!confirm('Apagar esta trilha e todas as perguntas dela?')) return;
      trilhas = trilhas.filter(function (t) { return t.id !== id; });
      perguntas = perguntas.filter(function (q) { return q.trilha !== id; });
      delete conversas[id]; salvarTudo();
      ctx.voltar();
    },
    pilula: function (id) { iniciarPilula(id || null, false); ctx.abrir('pilula'); },
    irEstudos: function () { pil = null; ctx.irAba('estudos'); },
    maisUma: function () { var troca = pil && pil.troca; iniciarPilula(null, false); pil.troca = troca; ctx.render(); },
    pilDica: function () { pil.dica = true; ctx.render(); },
    pilRevelar: function () { pil.etapa = 'avaliar'; ctx.render(); },
    pilAcertei: function () { responder(true); },
    pilErrei: function () { responder(false); },
    pilGuardar: function () {
      var q = atualPergunta();
      if (q && pil.texto.trim()) respostas.push({ pergunta: q.id, texto: pil.texto.trim(), dia: hoje() });
      responder(true, true);
    },
    pilProxima: function () { pil.i++; pil.etapa = 'pensar'; pil.dica = false; pil.acerto = null; pil.recompensa = ''; pil.texto = ''; ctx.render(); window.scrollTo(0, 0); },
    pilRuim: function () {
      var q = atualPergunta();
      if (!q || !confirm('Tirar essa pergunta do seu pacote?')) return;
      perguntas = perguntas.filter(function (x) { return x.id !== q.id; }); salvarTudo();
      acoes.pilProxima();
    },
    conversa: function (id) { atual = id; conv = { enviando: false, erro: '' }; ctx.abrir('conversa'); },
    enviar: function (pronto) {
      var el = document.getElementById('msg');
      var texto = (pronto || (el && el.value) || '').trim();
      if (!texto || conv.enviando) return;
      var t = trilha(atual), hist = conversas[t.id] || (conversas[t.id] = []);
      hist.push({ eu: true, texto: texto });
      conv.enviando = true; conv.erro = '';
      ctx.render(); window.scrollTo(0, document.body.scrollHeight);
      pedir('conversa', { trilha: t, historico: hist }, function (ok, dados) {
        conv.enviando = false;
        if (ok) {
          var r = JSON.parse(dados);
          hist.push({ eu: false, texto: r.texto });
          if (hist.length > 60) hist.splice(0, hist.length - 60);
        } else {
          hist.pop();
          conv.erro = dados;
        }
        salvarTudo(); ctx.recarregar();
        window.scrollTo(0, document.body.scrollHeight);
        if (!ok) { var e2 = document.getElementById('msg'); if (e2) e2.value = texto; }
      });
    },
    limparConversa: function () { delete conversas[atual]; salvarTudo(); ctx.render(); },
    salvarChave: function () {
      var v = ((document.getElementById('chave') || {}).value || '').trim();
      if (v.length < 20) { iaTela.msg = 'Essa chave parece curta. Copie ela inteira.'; ctx.render(); return; }
      Z.salvarChave(v); testar(true);
    },
    testarIa: function () { testar(false); },
    apagarChave: function () {
      if (!confirm('Apagar a chave deste celular?')) return;
      Z.apagarChave(); iaTela = { testando: false, msg: '', ok: null }; ctx.recarregar();
    }
  };

  function testar(nova) {
    iaTela.testando = true; iaTela.msg = ''; ctx.recarregar();
    pedir('testar', {}, function (ok, dados) {
      iaTela.testando = false; iaTela.ok = ok;
      if (ok) iaTela.msg = 'Tudo certo! Já posso montar suas perguntas.';
      else {
        iaTela.msg = dados;
        if (nova && /chave/i.test(dados)) Z.apagarChave();
      }
      ctx.recarregar();
    });
  }

  function atualPergunta() { return pil && perguntas.filter(function (x) { return x.id === pil.fila[pil.i]; })[0]; }

  function responder(acertou, leitura) {
    var q = atualPergunta();
    if (!q) return;
    q.vezes = (q.vezes || 0) + 1;
    q.ultima = hoje();
    if (acertou) { q.acertos = (q.acertos || 0) + 1; q.caixa = Math.min((q.caixa || 0) + 1, INTERVALOS.length - 1); }
    else q.caixa = 0;
    q.proxima = hoje(acertou ? INTERVALOS[q.caixa] : 1);
    var pts = acertou ? 5 : 2;
    pil.recompensa = Z.recompensa(pts) ? '+' + pts + ' de energia para a Zoe' : 'Energia de estudo do dia já está no máximo';
    pil.acerto = acertou; pil.etapa = 'fim'; pil.feitas++;
    salvarTudo(); ctx.recarregar();
  }

  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute('data-form');
    if (k && form) form[k] = e.target.value;
    if (e.target.getAttribute('data-pil') === 'texto' && pil) pil.texto = e.target.value;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'msg') { e.preventDefault(); acoes.enviar(); }
  });

  return {
    acoes: acoes,
    telas: { estudos: telaEstudos, trilha: telaTrilha, novaTrilha: telaNovaTrilha, pilula: telaPilula, conversa: telaConversa, ia: telaIa },
    devidas: function () { return devidas().length; },
    temPerguntas: function () { return perguntas.length > 0; },
    oculos: function () { return trilhas.some(function (t) { return respondidas(t.id) >= OCULOS; }); },
    respondidasHoje: function () { var h = hoje(); return perguntas.filter(function (q) { return q.ultima === h; }).length; },
    abrirPilula: function (troca) { iniciarPilula(null, troca); },
    aoSair: function (rota) { if (rota === 'pilula') pil = null; if (rota === 'ia') iaTela = { testando: false, msg: '', ok: null }; }
  };
};
