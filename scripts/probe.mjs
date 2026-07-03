// probe.mjs — 특정 셀렉터/버튼을 눌러 나오는 상태의 DOM을 덤프
// node scripts/probe.mjs <URL>
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto(URL,{waitUntil:'networkidle',timeout:45000});
await p.waitForTimeout(1000);
const dump = await p.evaluate(()=>{
  const el = document.body;
  const simplify = (n,d=0)=>{
    if(d>4||!n||n.nodeType!==1)return '';
    const tag=n.tagName.toLowerCase();
    const id=n.id?('#'+n.id):'';
    const cls=n.className&&typeof n.className==='string'?('.'+n.className.trim().split(/\s+/).slice(0,3).join('.')):'';
    const txt=(n.childNodes.length&&[...n.childNodes].every(c=>c.nodeType===3))?(' "'+n.innerText.trim().slice(0,24)+'"'):'';
    let out='  '.repeat(d)+tag+id+cls+txt+'\n';
    if(!txt)for(const c of n.children)out+=simplify(c,d+1);
    return out;
  };
  return simplify(el).slice(0,4000);
});
console.log(dump);
await b.close();
