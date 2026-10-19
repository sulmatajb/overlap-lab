import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFixture, analyzeFixture, serializeFixture, timestamp, LIMITS } from '../dist/assets/core.mjs';
import { examples } from '../dist/assets/examples.mjs';
const sample = key => structuredClone(examples.find(e => e.key === key).fixture);
const numbers = report => [report.summary.event_count, report.summary.busy_minutes, report.summary.conflict_minutes, report.summary.free_minutes];
const root = fileURLToPath(new URL('../', import.meta.url));
const minute = n => new Date(Date.UTC(2026,9,15,9) + n * 60000).toISOString();
const event = (id, a, b) => ({ id, start: minute(a), end: minute(b) });
const fixture = (events, a=0, b=180) => ({ version: 1, name: 'Synthetic test', window: { start: minute(a), end: minute(b) }, events });

test('partial-hour event occupies both hours', () => {
  const r = analyzeFixture(sample('partial'));
  assert.deepEqual(numbers(r), [1,60,0,120]);
  assert.deepEqual(r.hours.map(h=>[h.event_count,h.busy_minutes]), [[1,30],[1,30],[0,0]]);
});
test('triple overlap counts each conflict minute once', () => {
  const r=analyzeFixture(sample('overlap'));
  assert.deepEqual(numbers(r),[3,90,45,90]);
  assert.deepEqual(r.hours.map(h=>[h.event_count,h.busy_minutes,h.conflict_minutes]),[[2,30,15],[3,60,30],[0,0,0]]);
  assert.equal(r.segments.find(s=>s.concurrency===3).duration_ms,15*60000);
});
test('touching intervals and window endpoints are half-open',()=>{
  const r=analyzeFixture(fixture([event('a',0,60),event('b',60,120),event('ends-before',-60,0),event('starts-after',180,200)]));
  assert.deepEqual(numbers(r),[2,120,0,60]);assert.deepEqual(r.hours.map(h=>h.event_count),[1,1,0]);
  assert.deepEqual(r.excluded_event_ids,['ends-before','starts-after']);
});
test('clipping and partial first/last hour preserve elapsed totals',()=>{
  const r=analyzeFixture(fixture([event('left',-30,30),event('right',60,180)],15,90));
  assert.deepEqual(numbers(r),[2,45,0,30]);assert.deepEqual(r.hours.map(h=>[h.duration_ms/60000,h.busy_minutes]),[[45,15],[30,30]]);
  assert.equal(r.clipped_events[0].clipped_start,minute(15));assert.equal(r.clipped_events[1].clipped_end,minute(90));
});
test('midnight date boundary retains overlap',()=>{
  const r=analyzeFixture(sample('midnight'));assert.deepEqual(numbers(r),[2,75,15,75]);
  assert.deepEqual(r.hours.map(h=>h.busy_minutes),[15,60,0]);assert.equal(r.hours[1].start,'2026-10-16T00:00:00.000Z');
});
test('repeated wall hour with different offsets is two distinct UTC hours',()=>{
  const r=analyzeFixture(sample('repeated'));assert.deepEqual(numbers(r),[2,60,0,150]);
  assert.deepEqual(r.hours.map(h=>h.busy_minutes),[0,30,30,0]);
  assert.equal(r.fixture.events[0].start,'2026-11-01T05:15:00.000Z');assert.equal(r.fixture.events[1].start,'2026-11-01T06:15:00.000Z');
});
test('spring offset change uses elapsed time, without timezone inference',()=>{
  const f={version:1,name:'Explicit spring offsets',window:{start:'2026-03-08T01:00-05:00',end:'2026-03-08T04:00-04:00'},events:[{id:'a',start:'2026-03-08T01:30-05:00',end:'2026-03-08T03:30-04:00'}]};
  const r=analyzeFixture(f);assert.deepEqual(numbers(r),[1,60,0,60]);assert.equal(r.hours.length,2);
});
test('empty events gives one free partition per UTC hour',()=>{
  const r=analyzeFixture(fixture([]));assert.deepEqual(numbers(r),[0,0,0,180]);assert.equal(r.segments.length,1);assert.equal(r.hours.length,3);
});
test('milliseconds remain exact and fractional minutes are not rounded in core',()=>{
  const f=fixture([{id:'a',start:minute(0).replace('.000','.001'),end:minute(0).replace('.000','.999')}]);
  const r=analyzeFixture(f);assert.equal(r.summary.busy_ms,998);assert.equal(r.summary.busy_minutes,998/60000);
});
for(const invalid of ['2026-02-29T10:00Z','1900-02-29T10:00Z','2026-04-31T10:00Z','2026-13-01T10:00Z','2026-01-00T10:00Z','2026-01-01T24:00Z','2026-01-01T10:60Z','2026-01-01T10:00:60Z','2026-01-01T10:00','2026-01-01T10:00-00:00','2026-01-01T10:00+24:00','2026-01-01T10:00+01:60','0000-01-01T10:00Z','2026-01-01T10:00:00.1234Z','2026-1-01T10:00Z','0001-01-01T00:00+01:00']) {
  test(`rejects invalid timestamp ${invalid}`,()=>assert.throws(()=>timestamp(invalid)));
}
test('valid Gregorian leap day, early years and fractions normalize exactly',()=>{
  assert.equal(new Date(timestamp('2000-02-29T10:00:00.1+02:30')).toISOString(),'2000-02-29T07:30:00.100Z');
  assert.equal(new Date(timestamp('0099-01-01T10:00Z')).toISOString(),'0099-01-01T10:00:00.000Z');
});
test('schema, identity and duration constraints reject ambiguous inputs',()=>{
  const bad=[null,[],{...fixture([]),extra:1},{...fixture([]),version:2},{...fixture([]),name:' '},fixture([event('x',1,1)]),fixture([event('x',2,1)]),fixture([event('x',0,1),event('x',2,3)]),fixture([{...event('a',0,1),label:null}]),fixture([{...event('a',0,1),id:'\n'}]),fixture([],0,2881),fixture([],10,10),fixture(Array.from({length:101},(_,i)=>event(String(i),0,1)))];
  for(const f of bad)assert.throws(()=>analyzeFixture(f));
  assert.equal(analyzeFixture(fixture([],0,2880)).summary.duration_ms,48*3600000);
});
test('byte cap applies to both input and normalized export, including UTF-8',()=>{
  assert.throws(()=>parseFixture(' '.repeat(LIMITS.bytes+1)),/64 KiB/);
  const f=fixture(Array.from({length:100},(_,i)=>({...event(String(i)+'界'.repeat(28),30,90),label:'界'.repeat(150)})));
  f.name='Synthetic UTF-8 limit case'; const compact=JSON.stringify(f);
  assert.ok(Buffer.byteLength(compact)<LIMITS.bytes);assert.throws(()=>parseFixture(compact),/Normalized fixture exceeds/);
});
test('normalization is stable, sorted and permutation-independent',()=>{
  const f=sample('overlap'), reversed={...f,events:[...f.events].reverse()};
  assert.deepEqual(analyzeFixture(f),analyzeFixture(reversed));
  const text=serializeFixture(f);assert.equal(serializeFixture(parseFixture(text)),text);
  assert.equal(serializeFixture({...f,events:f.events.map(e=>({...e,start:e.start.replace('Z','+00:00')}))}),text);
});
test('independent minute oracle checks 60 deterministic clipped scenarios',()=>{
  let seed=718;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let iteration=0;iteration<60;iteration++){
    const events=Array.from({length:random(16)},(_,i)=>{const a=random(180)-30;return event(String(i),a,a+1+random(60));});
    const r=analyzeFixture(fixture(events,10,130));let busy=0,conflict=0;
    for(let m=10;m<130;m++){const count=events.filter(e=>timestamp(e.start)<=timestamp(minute(m))&&timestamp(e.end)>timestamp(minute(m))).length;if(count)busy++;if(count>=2)conflict++;}
    assert.equal(r.summary.busy_minutes,busy);assert.equal(r.summary.conflict_minutes,conflict);
    assert.equal(r.hours.reduce((sum,h)=>sum+h.busy_ms,0),r.summary.busy_ms);
    assert.equal(r.hours.reduce((sum,h)=>sum+h.conflict_ms,0),r.summary.conflict_ms);
    assert.equal(r.summary.busy_ms+r.summary.free_ms,r.summary.duration_ms);
  }
});
function temporary(run){const dir=mkdtempSync(join(tmpdir(),'overlap-test-'));try{return run(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function cli(args,extra={}){return spawnSync(process.execPath,[resolve(root,'cli.mjs'),...args],{encoding:'utf8',timeout:4000,...extra});}
test('actual CLI normalize/analyze roundtrip is deterministic across host timezones',()=>temporary(dir=>{
  const source=join(dir,'source.json'),normalized=join(dir,'normalized.json');writeFileSync(source,JSON.stringify(sample('repeated')));
  const n=cli(['normalize',source]);assert.equal(n.status,0,n.stderr);writeFileSync(normalized,n.stdout);
  const a=cli(['analyze',source],{env:{...process.env,TZ:'Pacific/Honolulu'}}),b=cli(['analyze',normalized],{env:{...process.env,TZ:'Europe/Paris'}});
  assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);assert.equal(a.stdout,b.stdout);assert.deepEqual(JSON.parse(a.stdout),analyzeFixture(sample('repeated')));
}));
test('CLI reports invalid, oversize, non-UTF-8 and missing inputs with exit 2',()=>temporary(dir=>{
  for(const [name,content]of[['bad.json','{}'],['big.json',' '.repeat(65537)],['utf8.json',Buffer.from([0xff])]]){const p=join(dir,name);writeFileSync(p,content);const r=cli(['analyze',p]);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.match(r.stderr,/Overlap Lab:/);}
  assert.equal(cli(['analyze',join(dir,'absent')]).status,2);assert.equal(cli([]).status,2);
}));
test('CLI consumes bounded short reads through EOF rather than ignoring trailing bytes',()=>temporary(dir=>{
  const preload=join(dir,'short-read.mjs'),source=join(dir,'source.json');
  writeFileSync(preload,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.readSync;fs.readSync=(fd,b,o,l,p)=>original(fd,b,o,Math.min(l,7),p);syncBuiltinESMExports();");
  writeFileSync(source,JSON.stringify(sample('partial')));
  const run=()=>spawnSync(process.execPath,['--import',preload,resolve(root,'cli.mjs'),'analyze',source],{encoding:'utf8',timeout:4000});
  assert.equal(run().status,0);writeFileSync(source,JSON.stringify(sample('partial'))+' trailing');const result=run();assert.equal(result.status,2);assert.equal(result.stdout,'');
}));
