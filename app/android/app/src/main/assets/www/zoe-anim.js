/* Zoe · corpo e animações (usado pelo app, pelo peteleco e pela bolinha).
   ZoeAnim.html(tam, humor, opcoes)  -> HTML da Zoe
   ZoeAnim.tocar(el, nome[, dados])  -> toca uma animação (Promise)
   ZoeAnim.principal()               -> a maior Zoe da tela
   ZoeAnim.vida()                    -> gestos ao acaso, toque = gelatina, 5 toques = tonta
   Só usa CSS e Web Animations (WebView do Android 8+). Com "reduzir movimento", nada se mexe. */
(function () {
  'use strict';
  var calmo = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------------- desenho ----------------
  var BROTO = '<div class="broto" aria-hidden="true"><svg viewBox="0 0 40 40"><path class="caule" d="M20 40 C20 32 19 27 21 19"/>' +
    '<path class="folha e" d="M20.5 22 C13 22 7.5 17 6.5 10 C14 10 19.5 14.5 20.5 22Z"/><path class="folha d" d="M21 19.5 C25 12.5 31 10 36.5 11 C35 17.5 28.5 21.5 21 19.5Z"/>' +
    '<circle class="luz" cx="21" cy="18" r="3"/><g class="flor"><circle cx="21" cy="11" r="3.4"/><circle cx="17" cy="14" r="3.4"/><circle cx="25" cy="14" r="3.4"/>' +
    '<circle cx="18.5" cy="18.5" r="3.4"/><circle cx="23.5" cy="18.5" r="3.4"/><circle class="miolo" cx="21" cy="15" r="2.6"/></g></svg></div>';
  var OLHO = '<i class="pill"></i><i class="big"></i><i class="arc"></i><i class="line"></i><i class="focus"></i><i class="angry"></i><i class="sad"></i>' +
    '<svg class="heart" viewBox="0 0 20 20"><path d="M10 17s-7-4.3-7-9a3.8 3.8 0 0 1 7-2 3.8 3.8 0 0 1 7 2c0 4.7-7 9-7 9z"/></svg>' +
    '<svg class="star" viewBox="0 0 20 20"><path d="M10 1.5l2.5 5.4 5.9.6-4.4 4 1.2 5.8L10 14.4l-5.2 2.9 1.2-5.8-4.4-4 5.9-.6z"/></svg>' +
    '<svg class="spiral" viewBox="0 0 20 20"><path d="M10 10c0-1 1.5-1 1.5 0 0 2-3 2-3 0 0-3 4.5-3 4.5 0 0 4-6 4-6 0 0-5 7.5-5 7.5 0"/></svg>' +
    '<svg class="x" viewBox="0 0 20 20"><path d="M5 4l9 6-9 6"/></svg>';
  var OCULOS = '<span class="oculos" aria-hidden="true"><svg viewBox="0 0 60 20"><circle cx="15" cy="10" r="8" fill="rgba(255,255,255,.25)" stroke="#2B2442" stroke-width="2.4"/>' +
    '<circle cx="45" cy="10" r="8" fill="rgba(255,255,255,.25)" stroke="#2B2442" stroke-width="2.4"/><path d="M23 9q7-4 14 0" fill="none" stroke="#2B2442" stroke-width="2.4"/></svg></span>';

  // humor do app -> pose do corpo
  var HUMOR = {
    '': { eyes: 'open' },
    feliz: { eyes: 'happy', leaves: 'open', ch: .85 },
    foco: { eyes: 'focus', leaves: 'up' },
    sono: { eyes: 'closed', leaves: 'droop', dim: '1', ch: .3 },
    brava: { eyes: 'angry', leaves: 'red', ch: .8 },
    triste: { eyes: 'sad', leaves: 'droop', dim: '1', ch: .3 },
    pensa: { eyes: 'focus', bead: 'on', fx: .07, fy: -.06 }
  };
  var CHAVES = ['eyes', 'mouth', 'leaves', 'bead', 'hands', 'dim'];
  var VARS = ['fx', 'fy', 'rot', 'tx', 'ty', 'hlx', 'hly', 'hrx', 'hry', 'ch'];
  function humorDe(txt) {
    var h = '';
    String(txt || '').split(/\s+/).forEach(function (p) { if (HUMOR[p] && p) h = p; });
    return h;
  }
  function attrs(p) {
    var a = '';
    CHAVES.forEach(function (k) { if (p[k]) a += ' data-' + k + '="' + p[k] + '"'; });
    return a;
  }
  function estilo(p) {
    var s = '';
    if (p.ch != null) s += '--ch:' + p.ch + ';';
    if (p.fx) s += '--fx:' + p.fx + ';';
    if (p.fy) s += '--fy:' + p.fy + ';';
    return s;
  }

  /** opcoes: { estilo: 'css extra', classe: 'classes extra', oculos: bool, flor: bool, rotulo: 'texto' } */
  function html(tam, humor, o) {
    o = o || {};
    var h = humorDe(humor), p = HUMOR[h];
    var classes = 'zoe' + (/\brespira\b/.test(humor || '') ? ' respira' : '') + (o.quieta ? ' quieta' : '') + (o.classe ? ' ' + o.classe : '');
    var rot = o.rotulo || ('Zoe' + ({ feliz: ' feliz', sono: ' sonolenta', foco: ' concentrada', brava: ' brava', triste: ' triste', pensa: ' pensativa' }[h] || ''));
    return '<div class="' + classes + '" data-humor="' + h + '"' + attrs(p) + (o.flor ? ' data-flor="1"' : '') +
      ' style="--s:' + tam + 'px;' + estilo(p) + (o.estilo || '') + '" role="img" aria-label="' + rot + '">' +
      '<div class="rig"><div class="tilt"><div class="sq">' + BROTO +
      '<div class="corpo"><div class="liq"></div></div>' +
      '<div class="rosto"><span class="olho e">' + OLHO + '</span><span class="olho d">' + OLHO + '</span>' +
      '<span class="boca"><i class="m-smile"></i><i class="m-o"></i><i class="m-open"></i><i class="m-flat"></i><i class="m-talk"></i>' +
      '<svg class="m-wavy" viewBox="0 0 24 8"><path d="M2 5 Q6 1 10 5 T18 5 T22 4"/></svg></span>' + (o.oculos ? OCULOS : '') + '</div>' +
      '<div class="bochechas"><b></b><b></b></div><span class="mao-z e"></span><span class="mao-z d"></span>' +
      '</div></div></div><div class="sombra"></div><div class="fx"></div></div>';
  }

  // ---------------- poses ----------------
  function pose(z, o) {
    var base = HUMOR[z.dataset.humor || ''] || HUMOR[''];
    o = o || {};
    CHAVES.forEach(function (k) {
      var v = o[k] !== undefined ? o[k] : (o.limpo ? (k === 'eyes' ? 'open' : '') : base[k]);
      if (v) z.dataset[k] = v; else delete z.dataset[k];
    });
  }
  function v(z, o) { Object.keys(o).forEach(function (k) { z.style.setProperty('--' + k, o[k]); }); }
  function limpar(z) {
    z.querySelectorAll('.prop,.fx > *').forEach(function (p) { p.remove(); });
    if (z.getAnimations) z.getAnimations({ subtree: true }).forEach(function (a) {
      if (window.CSSAnimation && a instanceof CSSAnimation) return;
      if (window.CSSTransition && a instanceof CSSTransition) return;
      a.cancel();
    });
    VARS.forEach(function (k) { z.style.removeProperty('--' + k); });
    var base = HUMOR[z.dataset.humor || ''] || HUMOR[''];
    var e = estilo(base);
    if (e) e.split(';').forEach(function (d) { if (d) { var p = d.split(':'); z.style.setProperty(p[0], p[1]); } });
    pose(z);
  }

  // ---------------- ajudantes ----------------
  function q(z, s) { return z.querySelector(s); }
  function S(z) { return z.offsetWidth || 120; }
  function W(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function A(el, kf, o) {
    if (!el || !el.animate) return Promise.resolve();
    if (typeof o === 'number') o = { duration: o };
    o = Object.assign({ duration: 600, easing: 'ease-in-out' }, o);
    try { var a = el.animate(kf, o); return a.finished ? a.finished.catch(function () {}) : W(o.duration * (o.iterations || 1)); } catch (e) { return Promise.resolve(); }
  }
  function pulo(z, h, d) {
    var s = S(z); h = h == null ? .16 : h;
    return A(q(z, '.sq'), [{ transform: 'none' }, { transform: 'scale(1.12,.88)', offset: .2 }, { transform: 'translateY(' + (-h * s) + 'px) scale(.94,1.07)', offset: .5 }, { transform: 'scale(1.05,.95)', offset: .8 }, { transform: 'none' }], { duration: d || 700 });
  }
  function prop(z, conteudo, css, onde) {
    var p = document.createElement('div'); p.className = 'prop'; p.innerHTML = conteudo;
    p.style.cssText = css || '';
    (onde ? q(z, onde) : q(z, '.tilt')).appendChild(p);
    return p;
  }
  function particula(z, conteudo, de, ate, d, extra) {
    var s = S(z), p = document.createElement('div');
    p.innerHTML = conteudo; p.style.cssText = 'position:absolute;left:0;top:0;' + (extra || '');
    q(z, '.fx').appendChild(p);
    var kf = [{ transform: 'translate(' + de[0] * s + 'px,' + de[1] * s + 'px) translate(-50%,-50%) scale(' + (de[2] == null ? .4 : de[2]) + ') rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: .15 },
      { transform: 'translate(' + ate[0] * s + 'px,' + ate[1] * s + 'px) translate(-50%,-50%) scale(' + (ate[2] == null ? 1 : ate[2]) + ') rotate(' + (ate[3] || 0) + 'deg)', opacity: 0 }];
    return A(p, kf, { duration: d || 1000, easing: 'cubic-bezier(.2,.7,.4,1)' }).then(function () { p.remove(); });
  }
  function explode(z, n, conteudo, raio, d, cima) {
    var ps = [];
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + Math.random() * .4, r = raio * (.75 + Math.random() * .4);
      ps.push(particula(z, typeof conteudo === 'function' ? conteudo(i) : conteudo, [0, -.05, .3], [Math.cos(ang) * r, Math.sin(ang) * r - (cima || 0), 1, Math.random() * 180], d || 900));
    }
    return Promise.all(ps);
  }
  function txt(z, t, x, y, d, cor) {
    var s = S(z);
    return particula(z, '<span class="z-txt" style="font-size:' + Math.max(14, s * .2) + 'px;' + (cor ? 'color:' + cor : '') + '">' + t + '</span>', [x, y, .4], [x, y - .18, 1.1], d || 1100);
  }
  function bolha(z, t, d) {
    var s = S(z);
    var b = prop(z, '<div class="z-bolha" style="font-size:' + Math.max(13, s * .16) + 'px">' + t + '</div>', 'left:78%;top:-12%;transform-origin:0 100%');
    return A(b, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: .25 }, { transform: 'scale(1)', offset: .4 }, { transform: 'scale(1)', opacity: 1, offset: .85 }, { transform: 'scale(.8)', opacity: 0 }], { duration: d || 1800 }).then(function () { b.remove(); });
  }
  function piscar(z) { return Promise.all([].map.call(z.querySelectorAll('.pill'), function (e) { return A(e, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.08)' }, { transform: 'scaleY(1)' }], 180); })); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var COR = ['#F6B8C8', '#93BC9C', '#FFD98A', '#B4A4EE', '#E99A86', '#A9CDB0'];
  function PONTO(c, t) { return '<i style="display:block;width:' + t + 'px;height:' + t + 'px;border-radius:50%;background:' + c + '"></i>'; }
  function ESTRELA(c) { return '<svg width="16" height="16" viewBox="0 0 20 20"><path d="M10 1.5l2.5 5.4 5.9.6-4.4 4 1.2 5.8L10 14.4l-5.2 2.9 1.2-5.8-4.4-4 5.9-.6z" fill="' + (c || '#FFC94D') + '"/></svg>'; }
  function CORACAO(c) { return '<svg width="16" height="16" viewBox="0 0 20 20"><path d="M10 17s-7-4.3-7-9a3.8 3.8 0 0 1 7-2 3.8 3.8 0 0 1 7 2c0 4.7-7 9-7 9z" fill="' + (c || '#F27C9A') + '"/></svg>'; }
  var NOTA = '<svg width="18" height="20" viewBox="0 0 18 20"><path d="M6 15V3l10-2v12" fill="none" stroke="#8D78D6" stroke-width="2"/><circle cx="4" cy="15" r="3" fill="#8D78D6"/><circle cx="14" cy="13" r="3" fill="#8D78D6"/></svg>';
  function GOTA(c, w) { return '<svg width="' + (w || 10) + '" height="' + Math.round((w || 10) * 1.4) + '" viewBox="0 0 10 14"><path d="M5 0C7 4 10 7 10 9.5a5 5 0 0 1-10 0C0 7 3 4 5 0z" fill="' + (c || '#9DBDF0') + '"/></svg>'; }
  function PETALA(c) { return '<i style="display:block;width:9px;height:13px;border-radius:50% 50% 50% 0;background:' + c + '"></i>'; }

  // ---------------- as animações ----------------
  var ANIM = {
    brotar: async function (z) {
      var s = S(z); pose(z, { eyes: 'closed' });
      A(q(z, '.broto'), [{ transform: 'scale(0)' }, { transform: 'scale(0)', offset: .55 }, { transform: 'scale(1.25)', offset: .8 }, { transform: 'scale(1)' }], 1400);
      await A(q(z, '.sq'), [{ transform: 'translateY(' + s * .3 + 'px) scale(.12)', opacity: 0 }, { transform: 'translateY(' + s * .3 + 'px) scale(.14)', opacity: 1, offset: .25 }, { transform: 'scale(1.12,.86)', offset: .65 }, { transform: 'scale(.95,1.06)', offset: .82 }, { transform: 'none' }], { duration: 1200, easing: 'ease-out' });
      explode(z, 8, function (i) { return PONTO(COR[i % 6], 6); }, .7, 900);
      await W(200); pose(z, { eyes: 'open' }); await W(200); await piscar(z); await W(100); await piscar(z);
      pose(z, { eyes: 'happy', leaves: 'open' }); v(z, { ch: .8 }); await W(700);
    },
    olhar: async function (z) {
      v(z, { fx: -.09, fy: 0 }); await W(800); v(z, { fx: .09 }); await W(800); v(z, { fx: .03, fy: -.07 }); await W(600); v(z, { fx: 0, fy: 0 }); await piscar(z); await W(300);
    },
    oi: async function (z, d) {
      var s = S(z); pose(z, { eyes: 'happy', hands: 'on' }); v(z, { hry: -.32, hrx: -.02, rot: '-5deg', ch: .75 });
      bolha(z, esc((d && d.texto) || 'oi!'), 2000); await W(250);
      await A(q(z, '.mao-z.d'), [{ transform: 'translate(' + (-.02 * s) + 'px,' + (-.32 * s) + 'px) rotate(-25deg)' }, { transform: 'translate(' + (-.02 * s) + 'px,' + (-.32 * s) + 'px) rotate(25deg)' }], { duration: 260, iterations: 6, direction: 'alternate' });
      v(z, { hry: 0, hrx: 0, rot: '0deg' }); await W(300); pose(z, { eyes: 'open' }); await W(300);
    },
    feliz: async function (z) {
      pose(z, { eyes: 'happy', leaves: 'open' }); v(z, { ch: .85 });
      await pulo(z, .18); explode(z, 6, ESTRELA(), .55, 800, .2); await pulo(z, .12, 600); await W(500);
    },
    regar: async function (z, d) {
      var s = S(z);
      var reg = prop(z, '<svg width="' + s * .46 + '" viewBox="0 0 60 44"><path d="M8 14h28v22H8z" fill="#B9C9E8" stroke="#6F86B8" stroke-width="2.5" stroke-linejoin="round"/><path d="M36 20l18-10" stroke="#6F86B8" stroke-width="5" stroke-linecap="round"/><path d="M8 16c-7 0-7 14 0 14" fill="none" stroke="#6F86B8" stroke-width="2.5"/><circle cx="54" cy="10" r="3.5" fill="#6F86B8"/></svg>', 'left:-38%;top:-52%;transform-origin:70% 60%');
      await A(reg, [{ transform: 'translate(-20px,-10px) rotate(0)', opacity: 0 }, { transform: 'rotate(0)', opacity: 1, offset: .4 }, { transform: 'rotate(28deg)' }], { duration: 800, fill: 'forwards' });
      pose(z, { eyes: 'happy' });
      for (var i = 0; i < 6; i++) { particula(z, GOTA(), [-.02 + Math.random() * .06, -1.02, .9], [-.02 + Math.random() * .08, -.62, .6], 520); await W(140); }
      pose(z, { eyes: 'happy', leaves: 'open' });
      A(q(z, '.broto'), [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1.12)' }], { duration: 700, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      txt(z, esc((d && d.texto) || '+10'), .42, -.45, 1200, '#6F9C7C');
      await A(reg, [{ transform: 'rotate(28deg)', opacity: 1 }, { transform: 'translate(-20px,-10px) rotate(0)', opacity: 0 }], { duration: 600, fill: 'forwards' });
      reg.remove(); await pulo(z, .1, 600); await W(400);
    },
    florescer: async function (z, d) {
      var fl = q(z, '.flor'); pose(z, { eyes: 'big' }); await W(400);
      await A(fl, [{ transform: 'scale(0) rotate(-90deg)' }, { transform: 'scale(1.25) rotate(10deg)', offset: .7 }, { transform: 'scale(1) rotate(0)' }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
      pose(z, { eyes: 'star', leaves: 'open' }); v(z, { ch: .9 });
      explode(z, 12, function (i) { return PETALA(i % 2 ? '#F6B8C8' : '#FFD98A'); }, .85, 1300, .3);
      txt(z, esc((d && d.texto) || '7 dias!'), .5, -.8, 1500, '#C98B6B'); await pulo(z, .14); await W(1000);
    },
    beber: async function (z) {
      var s = S(z); pose(z, { hands: 'on' }); v(z, { hrx: -.18, hry: -.04 });
      var copo = prop(z, '<svg width="' + s * .16 + '" viewBox="0 0 20 26"><path d="M2 2h16l-2 22H4z" fill="rgba(200,220,255,.55)" stroke="#6F86B8" stroke-width="1.6"/><path d="M3.4 10h13.2l-1.3 13H4.7z" fill="#9DBDF0"/></svg>', 'right:2%;top:36%;transform-origin:50% 100%;transition:transform .4s');
      await W(500); v(z, { hrx: -.3, hry: -.2, rot: '-6deg' }); copo.style.transform = 'translate(' + (-.26 * s) + 'px,' + (-.2 * s) + 'px) rotate(-45deg)';
      pose(z, { hands: 'on', eyes: 'closed', mouth: 'o' }); await W(400);
      for (var i = 0; i < 3; i++) { await A(q(z, '.sq'), [{ transform: 'none' }, { transform: 'scale(1.03,.97)' }, { transform: 'none' }], 260); }
      copo.style.transform = ''; v(z, { hrx: -.18, hry: -.04, rot: '0deg' }); pose(z, { hands: 'on', eyes: 'happy', mouth: 'smile' });
      txt(z, '+10', .42, -.4, 1100, '#6F9C7C'); await W(700); copo.remove(); v(z, { hrx: 0, hry: 0 }); pose(z, { eyes: 'happy' }); await W(400);
    },
    exercicio: async function (z) {
      var s = S(z); pose(z, { eyes: 'focus', hands: 'on', mouth: 'flat' });
      for (var i = 0; i < 4; i++) {
        v(z, { hly: -.36, hry: -.36, hlx: .04, hrx: -.04 });
        await A(q(z, '.sq'), [{ transform: 'scale(1.12,.84)' }, { transform: 'translateY(' + (-.12 * s) + 'px) scale(.92,1.1)' }, { transform: 'scale(1.12,.84)' }], { duration: 440 });
        v(z, { hly: 0, hry: 0, hlx: 0, hrx: 0 });
        if (i === 1) particula(z, GOTA('#A8D3F0'), [.36, -.32, .8], [.5, -.05, .8], 800);
      }
      pose(z, { eyes: 'happy' }); v(z, { ch: .8 }); txt(z, '+20', .42, -.4, 1100, '#6F9C7C'); await W(900);
    },
    meditar: async function (z) {
      pose(z, { eyes: 'closed', hands: 'on' }); v(z, { hlx: -.04, hly: .1, hrx: .04, hry: .1, ty: -.12 });
      for (var i = 0; i < 3; i++) {
        var r = prop(z, '<i style="display:block;width:100%;height:100%;border-radius:50%;border:2px solid rgba(147,188,156,.7)"></i>', 'left:0;top:0;width:100%;height:100%');
        A(r, [{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 2000, easing: 'ease-out' }).then(function (rr) { return function () { rr.remove(); }; }(r));
        await A(q(z, '.sq'), [{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 1300 });
      }
      v(z, { ty: 0, hly: 0, hry: 0, hlx: 0, hrx: 0 }); await W(500); pose(z, { eyes: 'happy' }); await W(400);
    },
    pensando: async function (z) {
      pose(z, { eyes: 'focus', bead: 'on' }); v(z, { fx: .07, fy: -.07, rot: '6deg' });
      var t = Math.max(5, S(z) * .05);
      var b = prop(z, '<div style="display:flex;gap:4px">' + PONTO('#8D78D6', t) + PONTO('#8D78D6', t) + PONTO('#8D78D6', t) + '</div>', 'left:88%;top:-6%');
      [].forEach.call(b.querySelectorAll('i'), function (d, i) { A(d, [{ transform: 'translateY(0)', opacity: .4 }, { transform: 'translateY(-6px)', opacity: 1 }, { transform: 'translateY(0)', opacity: .4 }], { duration: 900, delay: i * 150, iterations: 3 }); });
      await W(2900); b.remove(); v(z, { fx: 0, fy: 0, rot: '0deg' });
    },
    eureka: async function (z) {
      pose(z, { eyes: 'focus', bead: 'on' }); v(z, { fx: .05, fy: -.06 }); await W(600);
      v(z, { fx: 0, fy: 0 }); pose(z, { eyes: 'big', bead: 'on', mouth: 'o' });
      var flash = prop(z, '<i style="display:block;width:100%;height:100%;border-radius:50%;background:radial-gradient(closest-side,rgba(255,230,163,.95),rgba(255,230,163,0))"></i>', 'left:30%;top:-55%;width:40%;height:40%');
      A(flash, [{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(2.6)', opacity: 0 }], 700).then(function () { flash.remove(); });
      explode(z, 10, function (i) { return ESTRELA(i % 2 ? '#FFC94D' : '#B4A4EE'); }, .8, 1000, .35);
      await pulo(z, .2, 750); pose(z, { eyes: 'happy', leaves: 'open', mouth: 'smile' }); v(z, { ch: .85 }); txt(z, 'achei!', .5, -.75, 1300); await W(1000);
    },
    lendo: async function (z) {
      var s = S(z);
      var oc = q(z, '.oculos') ? null : prop(z, OCULOS.replace('class="oculos"', 'class="oculos" style="position:static;width:100%"'), 'left:-6%;top:2%;width:112%', '.rosto');
      var livro = prop(z, '<svg width="' + s * .62 + '" viewBox="0 0 70 34"><path d="M35 6C27 1 15 0 3 2v28c12-2 24-1 32 4 8-5 20-6 32-4V2C55 0 43 1 35 6z" fill="#FBFAFD" stroke="#C98B6B" stroke-width="2.2" stroke-linejoin="round"/><path d="M35 6v28" stroke="#C98B6B" stroke-width="2"/><path d="M9 10h18M9 15h18M9 20h14M43 10h18M43 15h18M43 20h12" stroke="#CFC6E0" stroke-width="2" stroke-linecap="round"/></svg>', 'left:19%;top:66%');
      if (oc) A(oc, [{ transform: 'translateY(-30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.3,1.5,.5,1)' });
      A(livro, [{ transform: 'translateY(20px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 400);
      pose(z, { eyes: 'focus' }); v(z, { fy: .04 });
      for (var l = 0; l < 3; l++) { v(z, { fx: -.05 }); await W(420); v(z, { fx: .05 }); await W(520); }
      v(z, { fx: 0, fy: 0 }); pose(z, { eyes: 'big' }); await W(400); pose(z, { eyes: 'happy' }); await W(500);
    },
    peteleco: async function (z, d) {
      var s = S(z), letra = esc(((d && d.app) || '∞').charAt(0).toUpperCase());
      var app = prop(z, '<div style="width:' + s * .3 + 'px;height:' + s * .3 + 'px;border-radius:' + s * .08 + 'px;background:linear-gradient(140deg,#F0A08C,#D9667A);display:grid;place-items:center;box-shadow:0 4px 10px rgba(150,60,60,.25);color:#fff;font:800 ' + s * .16 + 'px/1 var(--f-titulo)">' + letra + '</div>', 'left:112%;top:30%');
      await A(app, [{ transform: 'translate(' + s * .4 + 'px,0) rotate(15deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'forwards' });
      v(z, { fx: .09 }); pose(z, { eyes: 'big' }); await W(450);
      pose(z, { eyes: 'angry', leaves: 'red', hands: 'on' }); v(z, { ch: .8 }); await W(350);
      v(z, { hrx: -.12, hry: .02, rot: '-8deg' }); await W(380);
      v(z, { hrx: .22, hry: -.04, rot: '6deg' }); await W(110);
      txt(z, 'tec!', .75, -.35, 900, '#D9667A');
      await A(app, [{ transform: 'none', opacity: 1 }, { transform: 'translate(' + s * 1.6 + 'px,' + (-s * .9) + 'px) rotate(540deg) scale(.6)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
      app.remove(); v(z, { hrx: 0, hry: 0, rot: '0deg', fx: 0 });
      pose(z, { eyes: 'happy', hands: 'on' }); v(z, { hlx: .06, hrx: -.06 });
      await A(q(z, '.mao-z.e'), [{ transform: 'translate(' + s * .06 + 'px,0)' }, { transform: 'translate(' + s * .1 + 'px,' + (-s * .03) + 'px)' }], { duration: 150, iterations: 4, direction: 'alternate' });
      v(z, { hlx: 0, hrx: 0 }); await W(400);
    },
    guarda: async function (z) {
      var s = S(z);
      var dome = prop(z, '<i style="display:block;width:100%;height:100%;border-radius:50% 50% 10% 10% / 60% 60% 10% 10%;border:2px solid rgba(160,140,220,.55);background:linear-gradient(115deg,rgba(255,255,255,.35),rgba(255,255,255,.05) 45%,rgba(255,255,255,.15))"></i>', 'left:-22%;top:-62%;width:144%;height:168%;z-index:7');
      await A(dome, [{ transform: 'translateY(-' + s * .9 + 'px)', opacity: 0 }, { transform: 'translateY(6px)', opacity: 1, offset: .75 }, { transform: 'none', opacity: 1 }], { duration: 800, easing: 'ease-in', fill: 'forwards' });
      A(q(z, '.sq'), [{ transform: 'none' }, { transform: 'scale(1.06,.94)' }, { transform: 'none' }], 300);
      pose(z, { eyes: 'focus', leaves: 'up' });
      v(z, { fx: -.08 }); await W(900); v(z, { fx: .08 }); await W(900); v(z, { fx: 0 }); await W(400);
      pose(z, { eyes: 'wink', leaves: 'up' }); await W(450); pose(z, { eyes: 'focus', leaves: 'up' }); await W(500);
      await A(dome, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-' + s * .9 + 'px)', opacity: 0 }], { duration: 500, fill: 'forwards' }); dome.remove();
    },
    vigia: async function (z) { // de guarda sem a redoma (a tela de foco já desenha a sua)
      pose(z, { eyes: 'focus', leaves: 'up' });
      v(z, { fx: -.08 }); await W(1000); v(z, { fx: .08 }); await W(1000); v(z, { fx: 0 }); await W(300);
      pose(z, { eyes: 'wink', leaves: 'up' }); await W(450);
    },
    brava: async function (z) {
      var s = S(z); pose(z, { eyes: 'angry', leaves: 'red', mouth: 'flat' }); v(z, { ch: .9 });
      var fum = '<svg width="' + s * .2 + '" viewBox="0 0 24 20"><path d="M6 16a5 5 0 0 1 1-9.8A6 6 0 0 1 18 7a4.5 4.5 0 0 1 0 9z" fill="#DCD6E6"/></svg>';
      particula(z, fum, [-.32, -.55, .4], [-.62, -1, 1.2], 1100); particula(z, fum, [.32, -.55, .4], [.62, -1, 1.2], 1100);
      await A(q(z, '.sq'), [{ transform: 'translateX(-3%)' }, { transform: 'translateX(3%)' }], { duration: 70, iterations: 12, direction: 'alternate' });
      particula(z, fum, [-.32, -.55, .4], [-.6, -1, 1.2], 1100); particula(z, fum, [.32, -.55, .4], [.6, -1, 1.2], 1100);
      await pulo(z, .06, 400); await W(600);
    },
    desconfiada: async function (z) {
      var s = S(z);
      var cel = prop(z, '<div style="width:' + s * .32 + 'px;height:' + s * .5 + 'px;border-radius:' + s * .05 + 'px;background:#2B2540;padding:' + s * .025 + 'px;overflow:hidden"><div class="feed" style="display:flex;flex-direction:column;gap:' + s * .02 + 'px">' + Array(10).join('<i style="display:block;height:' + s * .08 + 'px;border-radius:3px;background:#5A5275"></i>') + '</div></div>', 'left:-44%;top:28%;transform:rotate(-8deg)');
      A(cel.querySelector('.feed'), [{ transform: 'translateY(0)' }, { transform: 'translateY(-50%)' }], { duration: 500, iterations: 6 });
      pose(z, { eyes: 'open' });
      for (var i = 0; i < 4; i++) { v(z, { fx: -.08, fy: -.04 }); await W(180); v(z, { fx: -.08, fy: .06 }); await W(180); }
      v(z, { fx: .02, fy: 0 }); pose(z, { eyes: 'focus', mouth: 'wavy' }); await W(400);
      bolha(z, 'hmm…', 1600); v(z, { rot: '-5deg' }); await W(1500); cel.remove(); v(z, { fx: 0, rot: '0deg' });
    },
    falando: async function (z, d) {
      pose(z, { mouth: 'talk' }); if (d && d.texto) bolha(z, esc(d.texto), 2400);
      await A(q(z, '.sq'), [{ transform: 'none' }, { transform: 'scale(1.02,.98) translateY(-2%)' }], { duration: 260, iterations: 8, direction: 'alternate' });
      pose(z, { eyes: 'wink', mouth: 'smile' }); await W(600);
    },
    corada: async function (z) {
      pose(z, { eyes: 'happy', hands: 'on' }); v(z, { fx: -.06, fy: .04, ch: 1, hlx: .16, hly: .06, hrx: -.16, hry: .06 });
      z.querySelectorAll('.bochechas b').forEach(function (b) { A(b, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }], { duration: 500, fill: 'forwards' }); });
      await A(q(z, '.tilt'), [{ transform: 'rotate(0)' }, { transform: 'rotate(-7deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(0)' }], { duration: 1600 });
      particula(z, CORACAO('#F6A3B8'), [.3, -.5, .5], [.45, -1, 1], 1100); await W(500);
      v(z, { fx: 0, fy: 0, hlx: 0, hly: 0, hrx: 0, hry: 0 }); await W(400);
    },
    coracoes: async function (z) {
      pose(z, { eyes: 'heart', leaves: 'open' }); v(z, { ch: .9 });
      for (var i = 0; i < 6; i++) { particula(z, CORACAO(i % 2 ? '#F27C9A' : '#F6B8C8'), [(Math.random() - .5) * .6, -.2, .5], [(Math.random() - .5) * 1, -1.2, 1.1, (Math.random() - .5) * 40], 1500); await W(200); }
      await pulo(z, .1, 600); await W(500);
    },
    surpresa: async function (z, d) {
      pose(z, { eyes: 'big', mouth: 'o', leaves: 'open' });
      txt(z, '!', .42, -.7, 900, '#E99A86'); await pulo(z, .22, 550); await W(400);
      pose(z, { eyes: 'happy', mouth: 'smile' }); bolha(z, esc((d && d.texto) || 'voltou!'), 1600); await W(1400);
    },
    murcha: async function (z) {
      var s = S(z); pose(z, { eyes: 'sad', leaves: 'droop', dim: '1' }); v(z, { ty: .03 });
      var nuvem = prop(z, '<svg width="' + s * .5 + '" viewBox="0 0 50 26"><path d="M12 24a9 9 0 0 1 1-17.9A12 12 0 0 1 36 8a8 8 0 0 1 2 16z" fill="#C7C2D6"/></svg>', 'left:25%;top:-78%');
      A(nuvem, [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], 500);
      for (var i = 0; i < 7; i++) { particula(z, '<i style="display:block;width:2px;height:8px;border-radius:2px;background:#9DBDF0"></i>', [-.12 + Math.random() * .26, -1.05, 1], [-.12 + Math.random() * .26, -.65, 1], 520); await W(220); }
      particula(z, GOTA('#9DBDF0', 8), [-.2, -.02, .8], [-.22, .22, 1], 900);
      await W(900); nuvem.remove(); v(z, { ty: 0 });
    },
    tonta: async function (z) {
      var s = S(z); pose(z, { eyes: 'spiral', mouth: 'wavy' });
      var orb = prop(z, '<div style="position:relative;width:' + s * .9 + 'px;height:' + s * .26 + 'px">' + [0, 1, 2].map(function () { return '<span style="position:absolute;left:50%;top:50%;margin:-8px">' + ESTRELA() + '</span>'; }).join('') + '</div>', 'left:5%;top:-30%');
      [].forEach.call(orb.querySelectorAll('span'), function (e, i) { A(e, [0, 1, 2, 3, 4].map(function (k) { var a = (k / 4) * Math.PI * 2 + i * 2.1; return { transform: 'translate(' + Math.cos(a) * s * .42 + 'px,' + Math.sin(a) * s * .11 + 'px)' }; }), { duration: 1100, iterations: 3 }); });
      await A(q(z, '.tilt'), [{ transform: 'rotate(-9deg)' }, { transform: 'rotate(9deg)' }], { duration: 400, iterations: 8, direction: 'alternate', easing: 'ease-in-out' });
      orb.remove(); await A(q(z, '.sq'), [{ transform: 'scale(1)' }, { transform: 'scale(1.06,.94)' }, { transform: 'scale(1)' }], 300); pose(z, { eyes: 'x' }); await W(500); pose(z, { eyes: 'open' }); await piscar(z); await W(300);
    },
    gelatina: function (z) {
      var olhos = z.dataset.eyes; z.dataset.eyes = 'happy';
      return A(q(z, '.sq'), [{ transform: 'scale(1)' }, { transform: 'scale(1.18,.82)', offset: .18 }, { transform: 'scale(.88,1.12)', offset: .36 }, { transform: 'scale(1.07,.93)', offset: .54 }, { transform: 'scale(.97,1.03)', offset: .72 }, { transform: 'scale(1)' }], { duration: 800, easing: 'ease-out' })
        .then(function () { if (olhos) z.dataset.eyes = olhos; });
    },
    danca: async function (z) {
      pose(z, { eyes: 'happy', hands: 'on', leaves: 'open' });
      for (var i = 0; i < 6; i++) {
        v(z, { rot: (i % 2 ? '10deg' : '-10deg'), tx: (i % 2 ? .05 : -.05), hly: (i % 2 ? -.25 : .02), hry: (i % 2 ? .02 : -.25) });
        if (i % 2 === 0) particula(z, NOTA, [(i % 4 ? -.4 : .4), -.6, .5], [(i % 4 ? -.6 : .6), -1.15, 1, (i % 4 ? -20 : 20)], 1200);
        await pulo(z, .07, 440);
      }
      v(z, { rot: '0deg', tx: 0, hly: 0, hry: 0 }); await W(400);
    },
    sono: async function (z) {
      pose(z, { eyes: 'closed', leaves: 'droop' }); v(z, { ch: .3 });
      for (var i = 0; i < 3; i++) {
        particula(z, '<span style="font:700 ' + Math.max(14, S(z) * .17) + 'px var(--f-mao);color:var(--lavanda)">z</span>', [.32, -.55, .5], [.6, -1.15, 1.2, -10], 1600);
        await A(q(z, '.sq'), [{ transform: 'scale(1)' }, { transform: 'scale(1.04,.96)' }, { transform: 'scale(1)' }], { duration: 1100 });
      }
    },
    bocejo: async function (z) {
      pose(z, { eyes: 'closed', hands: 'on' }); v(z, { hly: -.42, hry: -.42, hlx: .08, hrx: -.08 });
      var sq = q(z, '.sq');
      await A(sq, [{ transform: 'none' }, { transform: 'scale(.9,1.14)' }], { duration: 700, fill: 'forwards' });
      pose(z, { eyes: 'closed', mouth: 'open', hands: 'on' }); await W(900);
      particula(z, GOTA('#B9D3F2', 7), [.16, -.05, .8], [.2, .16, 1], 800);
      await A(sq, [{ transform: 'scale(.9,1.14)' }, { transform: 'scale(1.06,.94)' }, { transform: 'none' }], { duration: 600 });
      sq.getAnimations().forEach(function (a) { a.cancel(); });
      v(z, { hly: 0, hry: 0, hlx: 0, hrx: 0 }); pose(z, { eyes: 'closed', mouth: 'smile' }); await W(600);
    },
    espirro: async function (z) {
      pose(z, { eyes: 'closed', mouth: 'o' }); v(z, { rot: '-4deg' }); await W(400); v(z, { rot: '-9deg' }); await W(400); v(z, { rot: '-13deg' }); pose(z, { eyes: 'x', mouth: 'o' }); await W(500);
      v(z, { rot: '8deg' }); pose(z, { eyes: 'x', mouth: 'open' });
      A(q(z, '.broto'), [{ transform: 'rotate(0)' }, { transform: 'rotate(25deg)' }, { transform: 'rotate(-15deg)' }, { transform: 'rotate(0)' }], 600);
      explode(z, 14, function (i) { return PONTO(i % 3 ? '#FFE29A' : '#F6D27A', 5); }, .75, 800);
      txt(z, 'atchim!', .5, -.6, 1000, '#C98B6B');
      await A(q(z, '.sq'), [{ transform: 'scale(1.1,.9)' }, { transform: 'none' }], 300);
      v(z, { rot: '0deg' }); pose(z, { eyes: 'happy', mouth: 'smile' }); await W(500);
      await A(q(z, '.tilt'), [{ transform: 'rotate(-5deg)' }, { transform: 'rotate(5deg)' }], { duration: 140, iterations: 4, direction: 'alternate' }); await W(300);
    },
    comemorar: async function (z) {
      var s = S(z); pose(z, { eyes: 'star', hands: 'on', leaves: 'open' }); v(z, { hly: -.4, hry: -.4, ch: .9 });
      for (var i = 0; i < 26; i++) {
        particula(z, '<i style="display:block;width:7px;height:' + (i % 2 ? 7 : 11) + 'px;border-radius:2px;background:' + COR[i % 6] + '"></i>', [0, -.3, .6], [(Math.random() - .5) * 2.2, -.6 - Math.random() * .6, 1, Math.random() * 720], 1400);
      }
      await A(q(z, '.sq'), [{ transform: 'none' }, { transform: 'translateY(' + (-.25 * s) + 'px) rotate(180deg) scale(.95,1.05)', offset: .5 }, { transform: 'rotate(360deg)' }], { duration: 900, easing: 'cubic-bezier(.3,1.2,.5,1)' });
      await pulo(z, .1, 500); v(z, { hly: 0, hry: 0 }); await W(700);
    }
  };

  // ---------------- tocar ----------------
  var fila = new WeakMap();
  function tocar(z, nome, dados) {
    if (!z || !ANIM[nome]) return Promise.resolve();
    var antes = fila.get(z) || Promise.resolve();
    var p = antes.then(function () {
      if (!z.isConnected || calmo) return;
      limpar(z); z.dataset.ocupada = '1';
      return Promise.resolve(ANIM[nome](z, dados)).catch(function () {}).then(function () { if (z.isConnected) { limpar(z); delete z.dataset.ocupada; } });
    });
    fila.set(z, p);
    return p;
  }
  function principal() {
    var maior = null, tam = 0;
    document.querySelectorAll('.zoe').forEach(function (z) { var w = z.offsetWidth; if (w > tam && z.getClientRects().length) { tam = w; maior = z; } });
    return maior;
  }

  // ---------------- vida: toque e gestos ao acaso ----------------
  var vivo = false;
  function vida(opcoes) {
    if (vivo) return; vivo = true;
    opcoes = opcoes || {};
    var toques = [];
    document.addEventListener('click', function (e) {
      var z = e.target.closest && e.target.closest('.zoe');
      if (!z || z.dataset.ocupada || e.target.closest('[data-acao]')) return;
      var agora = Date.now();
      toques = toques.filter(function (t) { return agora - t < 2000; }); toques.push(agora);
      if (toques.length >= 5) { toques = []; tocar(z, 'tonta'); } else ANIM.gelatina(z);
    });
    if (calmo) return;
    (function gesto() {
      setTimeout(function () {
        var z = principal(), escolha = opcoes.gestos ? opcoes.gestos() : null;
        if (z && !z.dataset.ocupada && !document.hidden && escolha !== false) {
          var h = new Date().getHours(), lista = escolha || (h >= 22 || h < 6 ? ['olhar', 'bocejo', 'sono'] : ['olhar', 'olhar', 'olhar', 'espirro', 'bocejo']);
          tocar(z, lista[Math.floor(Math.random() * lista.length)]);
        }
        gesto();
      }, 9000 + Math.random() * 9000);
    })();
  }

  window.ZoeAnim = { html: html, tocar: tocar, principal: principal, vida: vida, nomes: Object.keys(ANIM), calmo: calmo };
})();
