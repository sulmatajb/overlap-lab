// Synthetic inputs only. No calendar or personal data.
export const examples = [
  { key: 'partial', label: 'Partial hour', note: '09:30–10:30 occupies 30 minutes in each UTC hour.', fixture: {
    version: 1, name: 'Partial-hour meeting', window: { start: '2026-10-15T09:00:00Z', end: '2026-10-15T12:00:00Z' },
    events: [{ id: 'demo', label: 'Synthetic demo', start: '2026-10-15T09:30:00Z', end: '2026-10-15T10:30:00Z' }],
  } },
  { key: 'overlap', label: 'Overlap', note: 'Three simultaneous events still count each conflict minute once.', fixture: {
    version: 1, name: 'Overlap is elapsed time', window: { start: '2026-10-15T09:00:00Z', end: '2026-10-15T12:00:00Z' },
    events: [
      { id: 'review', label: 'Synthetic review', start: '2026-10-15T09:30:00Z', end: '2026-10-15T10:30:00Z' },
      { id: 'standup', label: 'Synthetic standup', start: '2026-10-15T09:45:00Z', end: '2026-10-15T10:15:00Z' },
      { id: 'pairing', label: 'Synthetic pairing', start: '2026-10-15T10:00:00Z', end: '2026-10-15T11:00:00Z' },
    ],
  } },
  { key: 'midnight', label: 'Midnight', note: 'The date boundary changes the label, not the overlap rule.', fixture: {
    version: 1, name: 'Across midnight', window: { start: '2026-10-15T23:30:00Z', end: '2026-10-16T02:00:00Z' },
    events: [
      { id: 'handoff', label: 'Synthetic handoff', start: '2026-10-15T23:45:00Z', end: '2026-10-16T00:30:00Z' },
      { id: 'followup', label: 'Synthetic follow-up', start: '2026-10-16T00:15:00Z', end: '2026-10-16T01:00:00Z' },
    ],
  } },
  { key: 'repeated', label: 'Repeated hour', note: '01:15 at −04:00 and 01:15 at −05:00 are distinct instants. Display: UTC.', fixture: {
    version: 1, name: 'Two explicit-offset occurrences', window: { start: '2026-11-01T00:30:00-04:00', end: '2026-11-01T03:00:00-05:00' },
    events: [
      { id: 'first', label: 'First 01:15 (−04:00)', start: '2026-11-01T01:15:00-04:00', end: '2026-11-01T01:45:00-04:00' },
      { id: 'second', label: 'Second 01:15 (−05:00)', start: '2026-11-01T01:15:00-05:00', end: '2026-11-01T01:45:00-05:00' },
    ],
  } },
];
