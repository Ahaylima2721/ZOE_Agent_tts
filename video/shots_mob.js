const {chromium}=require('playwright');const S=process.argv[2];
const commits=['7eb4763','946c6e9','adf911f','c697611','f8e1f2d','5daab0c','c3666c8'];
(async()=>{const b=await chromium.launch({args:['--allow-file-access-from-files']});
for(const c of commits){
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,colorScheme:'light'});
  await p.goto(`file://${S}/v/${c}/index.html`);await p.waitForTimeout(1300);
  await p.addStyleTag({content:'.reveal{opacity:1!important;transform:none!important}'});await p.waitForTimeout(300);
  await p.screenshot({path:`${S}/mob/${c}-top.png`});
  await p.screenshot({path:`${S}/mob/${c}-full.png`,fullPage:true,clip:{x:0,y:0,width:390,height:2400}});
  if(await p.$('#zoe')){await p.goto(`file://${S}/v/${c}/index.html#zoe`);await p.waitForTimeout(1300);
    await p.addStyleTag({content:'.reveal{opacity:1!important;transform:none!important}'});await p.waitForTimeout(300);
    await p.screenshot({path:`${S}/mob/${c}-zoe.png`,fullPage:true,clip:{x:0,y:0,width:390,height:2400}});}
  await p.close();}
await b.close();})();
