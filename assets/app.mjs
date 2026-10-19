import { parseFixture, analyzeFixture, serializeFixture } from './core.mjs';
import { examples } from './examples.mjs';
const $ = id => document.getElementById(id);
let exported = null;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const clock = iso => iso.slice(11, 23).replace(/:00\.000$/, '').replace(/\.000$/, '');
const stamp = iso => `${iso.slice(0, 10)} ${clock(iso)} UTC`;
const minutes = value => Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
function invalidate(message = 'Input changed. Analyze again to enable export.') {
  exported = null;
  $('export').disabled = true;
  $('results').replaceChildren();
  $('results').hidden = true;
  $('empty').hidden = false;
  $('error').hidden = true;
  $('fixture').removeAttribute('aria-invalid');
  $('status').textContent = message;
}
function render(report) {
  const target = $('results'), summary = report.summary;
  target.append(element('p', report.fixture.name, 'fixture-title'));
  target.append(element('p', `${stamp(report.fixture.window.start)} → ${stamp(report.fixture.window.end)}`, 'window'));
  const metrics = element('div', undefined, 'metrics');
  for (const [value, label, conflict] of [[summary.event_count, 'events in window'], [summary.busy_minutes, 'busy minutes'], [summary.conflict_minutes, 'conflict minutes', true], [summary.free_minutes, 'free minutes']]) {
    const metric = element('div', undefined, `metric${conflict ? ' conflict' : ''}`);
    metric.append(element('strong', minutes(value)), element('span', label)); metrics.append(metric);
  }
  target.append(metrics, element('p', 'Event count = distinct events touching the interval. Busy = time with ≥1 event. Conflict = time with ≥2 events, counted once. Minutes shown to 3 decimals; CLI keeps exact milliseconds.', 'explain'));
  target.append(element('h3', 'Time occupied across the window'));
  const legend = element('div', undefined, 'legend');
  for (const [className,label] of [['free','Free'],['busy','One event'],['conflict-fill','2+ events']]) {
    const item = element('span'); item.append(element('i', undefined, `swatch ${className}`), document.createTextNode(label));legend.append(item);
  }
  const overview = element('div', undefined, 'overview');
  overview.setAttribute('role','img');overview.setAttribute('aria-label',`${minutes(summary.busy_minutes)} busy minutes, including ${minutes(summary.conflict_minutes)} conflict minutes. Detailed values follow.`);
  for (const segment of report.segments) {
    const bar = element('span', undefined, segment.concurrency >= 2 ? 'conflict-fill' : segment.concurrency ? 'busy' : 'free');
    bar.style.width = `${segment.duration_ms / summary.duration_ms * 100}%`;
    bar.title = `${stamp(segment.start)} → ${stamp(segment.end)}: ${segment.concurrency} events`;
    overview.append(bar);
  }
  const edges = element('div',undefined,'timeline-edges'); edges.append(element('span',stamp(report.fixture.window.start)),element('span',stamp(report.fixture.window.end)));
  target.append(legend, overview, edges);
  const list = element('ul',undefined,'event-list');
  const start = Date.parse(report.fixture.window.start);
  for (const event of report.clipped_events) {
    const row = element('li',undefined,'event-row'), label = element('span',event.label,'event-label');
    label.append(element('span',`${stamp(event.clipped_start)} → ${stamp(event.clipped_end)}`,'event-time'));
    const track = element('div',undefined,'track'), bar = element('span',undefined,'event-bar');
    bar.style.left = `${(Date.parse(event.clipped_start) - start) / summary.duration_ms * 100}%`;
    bar.style.width = `${(Date.parse(event.clipped_end) - Date.parse(event.clipped_start)) / summary.duration_ms * 100}%`;
    track.setAttribute('aria-hidden','true');track.append(bar);row.append(label,track);list.append(row);
  }
  target.append(list);
  if (report.excluded_event_ids.length) target.append(element('p',`${report.excluded_event_ids.length} event(s) lie outside the window: ${report.excluded_event_ids.join(', ')}`,'explain'));
  const table = element('table');table.append(element('caption','UTC hour buckets'));
  const head = element('thead'), heading = element('tr');
  for (const label of ['UTC interval', 'Events', 'Busy min', 'Conflict min', 'Free min']) { const th=element('th',label);th.scope='col';heading.append(th); }
  head.append(heading);table.append(head);const body=element('tbody');
  for (const hour of report.hours) {
    const row=element('tr'), time=element('td');time.append(element('span',hour.start.slice(0,10),'date'), document.createTextNode(`${clock(hour.start)} → ${hour.end.slice(0,10)!==hour.start.slice(0,10)?hour.end.slice(0,10)+' ':''}${clock(hour.end)}`));row.append(time);
    for (const [label,value] of [['Events',hour.event_count],['Busy',hour.busy_minutes],['Conflict',hour.conflict_minutes],['Free',hour.free_minutes]]) {
      const cell=element('td',undefined,label==='Conflict'&&value>0?'conflict-number':'');cell.append(element('span',label+':','mobile-label'),document.createTextNode(minutes(value)));row.append(cell);
    }
    body.append(row);
  }
  table.append(body);target.append(table);target.hidden=false;$('empty').hidden=true;
}
function analyze() {
  invalidate('');
  try {
    const fixture=parseFixture($('fixture').value), report=analyzeFixture(fixture);
    render(report);exported=serializeFixture(fixture);$('export').disabled=false;
    $('status').textContent=`Analyzed ${report.summary.input_event_count} events. Export is ready.`;
  } catch(error) {
    $('error').textContent=error.message;$('error').hidden=false;$('fixture').setAttribute('aria-invalid','true');
    $('status').textContent='No current results. Fix the fixture and analyze again.';
  }
}
for (const sample of examples) {
  const button=element('button',sample.label);button.type='button';button.dataset.example=sample.key;button.setAttribute('aria-pressed','false');
  button.addEventListener('click',()=>{
    for(const option of $('examples').children) option.setAttribute('aria-pressed',String(option===button));
    $('fixture').value=JSON.stringify(sample.fixture,null,2);$('example-note').textContent=sample.note;analyze();
  });$('examples').append(button);
}
$('fixture').addEventListener('input',()=>{for(const button of $('examples').children)button.setAttribute('aria-pressed','false');$('example-note').textContent='Custom fixture. Only explicit offsets determine event instants.';invalidate();});
$('fixture-form').addEventListener('submit',event=>{event.preventDefault();analyze();});
$('export').addEventListener('click',()=>{
  if(exported===null)return;
  const url=URL.createObjectURL(new Blob([exported],{type:'application/json'}));const link=element('a');link.href=url;link.download='overlap-fixture.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('examples').children[1].click();
