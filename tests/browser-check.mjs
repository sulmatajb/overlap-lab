// Optional local verification. Uses an explicitly supplied existing Playwright runtime.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { analyzeFixture, serializeFixture } from '../dist/assets/core.mjs';
import { examples } from '../dist/assets/examples.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=process.env.OVERLAP_EVIDENCE, runtime=process.env.OVERLAP_PLAYWRIGHT;
if(!output||!runtime)throw new Error('Set OVERLAP_EVIDENCE to a new directory and OVERLAP_PLAYWRIGHT to an existing Playwright index.mjs.');
await mkdir(output); // refuses to overwrite an evidence directory
const {chromium}=await import(pathToFileURL(runtime));
const files=new Map([['/','index.html'],['/index.html','index.html'],...['app.mjs','core.mjs','examples.mjs','style.css'].map(f=>['/assets/'+f,'assets/'+f])]);
const server=createServer(async(req,res)=>{
  try{const file=files.get(new URL(req.url,'http://localhost').pathname);if(!file){res.writeHead(404);return res.end();}const content=await readFile(join(root,'dist',file));res.writeHead(200,{'Content-Type':file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(content);}catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const began=new Date().toISOString(),errors=[],external=[],requests=[],checks=[];
const origin=`http://127.0.0.1:${server.address().port}`;
const check=(name,details)=>checks.push({name,outcome:'pass',details});
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/*',route=>{const url=route.request().url();requests.push(url.replace(origin,'<loopback>'));if(!url.startsWith(origin+'/')){external.push(url);return route.abort();}return route.continue();});
  await page.goto(origin,{waitUntil:'networkidle',timeout:10000});
  for(const item of examples){
    await page.getByRole('button',{name:item.label,exact:true}).click();
    const r=analyzeFixture(item.fixture),expected=[r.summary.event_count,r.summary.busy_minutes,r.summary.conflict_minutes,r.summary.free_minutes].map(String);
    assert.deepEqual(await page.locator('.metric strong').allTextContents(),expected);
    assert.equal(await page.locator('tbody tr').count(),r.hours.length);
    const actual=await page.locator('tbody tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('td')].slice(1).map(cell=>[...cell.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(''))));
    assert.deepEqual(actual,r.hours.map(h=>[h.event_count,h.busy_minutes,h.conflict_minutes,h.free_minutes].map(String)));
    const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export fixture JSON'}).click();const download=await downloadEvent;
    const path=join(output,item.key+'-export.json');await download.saveAs(path);
    assert.equal(await readFile(path,'utf8'),serializeFixture(item.fixture));
    const cli=JSON.parse(execFileSync(process.execPath,[join(root,'cli.mjs'),'analyze',path],{encoding:'utf8',timeout:4000}));assert.deepEqual(cli,r);
    check(item.key+' fixture / table / browser export / CLI roundtrip',{summary:expected,hour_rows:r.hours.length});
  }
  await page.getByRole('button',{name:'Midnight',exact:true}).click();
  assert.match(await page.locator('.event-time').first().textContent(),/2026-10-15.*2026-10-16/);
  assert.match(await page.locator('tbody tr').first().textContent(),/2026-10-16 00:00/);
  check('midnight dates visible','Per-event interval and crossing hourly endpoint include dates.');
  await page.getByLabel('Fixture JSON',{exact:true}).fill('{');
  assert.equal(await page.locator('#export').isDisabled(),true);assert.equal(await page.locator('#results').isHidden(),true);assert.equal(await page.locator('#results').textContent(),'');
  await page.getByRole('button',{name:'Analyze fixture',exact:true}).click();assert.equal(await page.locator('#error').isVisible(),true);assert.equal(await page.locator('#fixture').getAttribute('aria-invalid'),'true');
  check('stale results/export invalidation','Editing immediately clears results and disables export; invalid JSON shows a labeled error.');
  const bad=structuredClone(examples[0].fixture);bad.events[0].start='2026-02-30T09:30Z';await page.locator('#fixture').fill(JSON.stringify(bad));await page.getByRole('button',{name:'Analyze fixture',exact:true}).click();assert.match(await page.locator('#error').textContent(),/invalid calendar/);assert.equal(await page.locator('#export').isDisabled(),true);
  check('invalid calendar rejected','No stale results or downloadable fixture.');
  const xss=structuredClone(examples[0].fixture);xss.name='<script>window.injected=true</script>';xss.events[0].label='<img src=x onerror="window.injected=true">';await page.locator('#fixture').fill(JSON.stringify(xss));await page.getByRole('button',{name:'Analyze fixture',exact:true}).click();
  assert.equal(await page.locator('#results img,#results script').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);assert.ok((await page.locator('.event-label').textContent()).includes('<img'));
  check('text injection is inert','Markup-like fixture name/label displayed as text, with no inserted image/script or external request.');
  await page.getByRole('button',{name:'Partial hour',exact:true}).focus();await page.keyboard.press('Enter');assert.deepEqual(await page.locator('.metric strong').allTextContents(),['1','60','0','120']);
  check('keyboard sample activation','Focused example button responds to Enter. Fixture and action controls have accessible names.');
  await page.getByRole('button',{name:'Overlap',exact:true}).click();
  for(const [name,width,height]of[['desktop',1280,1000],['mobile',393,851]]){
    await page.setViewportSize({width,height});
    const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,height:document.documentElement.scrollHeight}));
    assert.ok(dimensions.document<=width&&dimensions.body<=width,JSON.stringify(dimensions));
    await page.screenshot({path:join(output,name+'.png'),fullPage:true});
    check(name+' viewport',{...dimensions,hour_rows:await page.locator('tbody tr').count()});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  check('browser runtime/network','No page/console errors or attempted external requests; only static loopback files.');
  await writeFile(join(output,'results.json'),JSON.stringify({started_at:began,finished_at:new Date().toISOString(),browser_version:browser.version(),mode:'local synthetic browser fixtures; no calendar APIs',checks,errors,external_requests:external,requests,limitations:['Chromium only; no screen-reader or real calendar integration tested.','UI checks cover the four bundled fixtures and selected invalid/text-injection cases; they do not prove all browser/input combinations.']},null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,outcome:'pass',output}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
