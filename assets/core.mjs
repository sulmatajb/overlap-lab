// Pure shared browser/CLI calculations. No host-timezone parsing or I/O.
export const LIMITS = Object.freeze({ bytes: 65536, events: 100, windowHours: 48 });
const HOUR = 3600000;
export class FixtureError extends Error {}
const fail = message => { throw new FixtureError(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function shape(value, required, optional, name) {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    fail(`${name}: expected ${required.join(', ')}${optional.length ? `; optional ${optional.join(', ')}` : ''}.`);
  }
}
function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    fail(`${name}: use nonblank text up to ${max} characters, without control characters.`);
  }
  return value;
}
export function timestamp(value, name = 'timestamp') {
  if (typeof value !== 'string') fail(`${name}: expected an ISO timestamp string with Z or an explicit offset.`);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) fail(`${name}: use YYYY-MM-DDTHH:mm[:ss[.sss]]Z or an explicit ±HH:MM offset.`);
  const [, ys, mos, ds, hs, mis, ss = '0', fraction = '', zone] = match;
  const [year, month, day, hour, minute, second] = [ys, mos, ds, hs, mis, ss].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) {
    fail(`${name}: invalid calendar date or clock time (no 24:00 or leap seconds).`);
  }
  let offset = 0;
  if (zone !== 'Z') {
    const oh = Number(zone.slice(1, 3)), om = Number(zone.slice(4, 6));
    if (oh > 23 || om > 59 || zone === '-00:00') fail(`${name}: invalid or unknown offset; use Z for UTC.`);
    offset = (oh * 60 + om) * (zone[0] === '+' ? 1 : -1);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.padEnd(3, '0')));
  const instant = date.getTime() - offset * 60000;
  const utcYear = new Date(instant).getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999) fail(`${name}: UTC instant must remain within years 0001–9999.`);
  return instant;
}
const iso = value => new Date(value).toISOString();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function normalizeFixture(input) {
  shape(input, ['version', 'name', 'window', 'events'], [], 'fixture');
  if (input.version !== 1) fail('version: only 1 is supported.');
  const name = text(input.name, 'name', 160);
  shape(input.window, ['start', 'end'], [], 'window');
  const start = timestamp(input.window.start, 'window.start'), end = timestamp(input.window.end, 'window.end');
  if (end <= start || end - start > LIMITS.windowHours * HOUR) fail('window: end must follow start by at most 48 elapsed hours.');
  if (!Array.isArray(input.events) || input.events.length > LIMITS.events) fail('events: expected an array with at most 100 events.');
  const seen = new Set();
  const events = input.events.map((event, index) => {
    const prefix = `events[${index}]`;
    shape(event, ['id', 'start', 'end'], ['label'], prefix);
    const id = text(event.id, `${prefix}.id`, 80);
    if (seen.has(id)) fail(`${prefix}.id: duplicate event ID.`);
    seen.add(id);
    const label = text(Object.hasOwn(event, 'label') ? event.label : id, `${prefix}.label`, 160);
    const a = timestamp(event.start, `${prefix}.start`), b = timestamp(event.end, `${prefix}.end`);
    if (b <= a) fail(`${prefix}: end must be later than start; zero-length/reversed events are invalid.`);
    return { id, label, start: iso(a), end: iso(b) };
  }).sort((a, b) => compare(a.start, b.start) || compare(a.end, b.end) || compare(a.id, b.id));
  const fixture = { version: 1, name, window: { start: iso(start), end: iso(end) }, events };
  if (new TextEncoder().encode(JSON.stringify(fixture, null, 2) + '\n').length > LIMITS.bytes) fail('Normalized fixture exceeds 64 KiB; shorten labels or remove events.');
  return fixture;
}
export function parseFixture(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > LIMITS.bytes) fail('Input exceeds the 64 KiB UTF-8 limit.');
  let value;
  try { value = JSON.parse(source); } catch { fail('Input must be valid JSON.'); }
  return normalizeFixture(value);
}
export const serializeFixture = fixture => JSON.stringify(normalizeFixture(fixture), null, 2) + '\n';

export function analyzeFixture(input) {
  const fixture = normalizeFixture(input);
  const start = timestamp(fixture.window.start), end = timestamp(fixture.window.end);
  const clipped = fixture.events.map(event => ({ ...event,
    a: Math.max(start, timestamp(event.start)), b: Math.min(end, timestamp(event.end)),
  })).filter(event => event.b > event.a);
  // All changes at the same instant are applied together. Touching endpoints do
  // not overlap: each resulting interval is [start, end).
  const changes = new Map([[start, []], [end, []]]);
  for (const event of clipped) {
    if (!changes.has(event.a)) changes.set(event.a, []);
    if (!changes.has(event.b)) changes.set(event.b, []);
    changes.get(event.a).push([event.id, true]);
    changes.get(event.b).push([event.id, false]);
  }
  const points = [...changes.keys()].sort((a, b) => a - b), active = new Set(), segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const at = points[i];
    for (const [id, entering] of changes.get(at)) entering ? active.add(id) : active.delete(id);
    const ids = [...active].sort(compare);
    segments.push({ start: iso(at), end: iso(points[i + 1]), duration_ms: points[i + 1] - at,
      concurrency: ids.length, event_ids: ids });
  }
  const stats = (a, b) => {
    let busy = 0, conflict = 0;
    for (const segment of segments) {
      const duration = Math.max(0, Math.min(b, timestamp(segment.end)) - Math.max(a, timestamp(segment.start)));
      if (segment.concurrency >= 1) busy += duration;
      if (segment.concurrency >= 2) conflict += duration;
    }
    const ids = clipped.filter(event => event.a < b && event.b > a).map(event => event.id).sort(compare);
    return { duration_ms: b - a, event_count: ids.length, event_ids: ids, busy_ms: busy, conflict_ms: conflict,
      free_ms: b - a - busy, busy_minutes: busy / 60000, conflict_minutes: conflict / 60000, free_minutes: (b - a - busy) / 60000 };
  };
  const hours = [];
  for (let a = start; a < end;) {
    const b = Math.min(end, (Math.floor(a / HOUR) + 1) * HOUR);
    hours.push({ start: iso(a), end: iso(b), ...stats(a, b) });
    a = b;
  }
  return { version: 1, display_timezone: 'UTC', interval_convention: '[start, end)', fixture,
    summary: { input_event_count: fixture.events.length, ...stats(start, end) },
    clipped_events: clipped.map(({ a, b, ...event }) => ({ ...event, clipped_start: iso(a), clipped_end: iso(b) })),
    excluded_event_ids: fixture.events.filter(event => !clipped.some(e => e.id === event.id)).map(event => event.id),
    segments, hours };
}
