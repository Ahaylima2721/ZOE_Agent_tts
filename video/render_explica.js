// Renderiza as 4 imagens de explica_template.html. Uso: node render_explica.js <pasta com explicar.json e mapa.json> <caminho do template> [escala]
const {chromium}=require('playwright');const fs=require('fs');const [,,S,TPL,DS]=process.argv;
(async()=>{let h=fs.readFileSync(TPL,'utf8');
h=h.replace('/*DADOS*/','const EXP='+fs.readFileSync(S+'/explicar.json','utf8')+';const MAPA='+fs.readFileSync(S+'/mapa.json','utf8')+';');
fs.writeFileSync(S+'/explica.html',h);
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1400},deviceScaleFactor:+DS||1});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+S+'/explica.html');await p.waitForTimeout(500);
const over=await p.evaluate(()=>[...document.querySelectorAll('.slide')].map(s=>{const r=s.getBoundingClientRect();return Math.max(...[...s.children].map(c=>c.getBoundingClientRect().bottom))-r.top}));
console.log('bottom of content per slide',over.map(Math.round),errs);
for(let i=1;i<=4;i++) await (await p.$('#s'+i)).screenshot({path:`${S}/zoe-${i}.png`});
await b.close();})();
