const {chromium}=require('playwright');
const S=process.argv[2];
const commits=['7eb4763','f092da7','946c6e9','adf911f','c697611','f8e1f2d','5daab0c','c3666c8'];
(async()=>{const b=await chromium.launch();
for(const c of commits){
  const p=await b.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1.5,colorScheme:'light'});
  await p.goto(`file://${S}/v/${c}/index.html`);await p.waitForTimeout(1200);
  await p.addStyleTag({content:'.reveal{opacity:1!important;transform:none!important}'});
  await p.waitForTimeout(300);
  await p.screenshot({path:`${S}/shots/${c}-top.png`});
  await p.screenshot({path:`${S}/shots/${c}-full.png`,fullPage:true,clip:{x:0,y:0,width:1280,height:2600}});
  // página da Zoe, quando existir
  if(await p.$('#zoe')){await p.goto(`file://${S}/v/${c}/index.html#zoe`);await p.waitForTimeout(1200);await p.screenshot({path:`${S}/shots/${c}-zoe.png`});}
  await p.close();}
await b.close();})();
