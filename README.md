# Overlap Lab

A small local workbench for developers investigating timed-event overlaps. Paste an explicit-offset JSON fixture, inspect event counts and occupied minutes, and export the same fixture for a CLI regression case. Four bundled examples cover partial hours, overlap, midnight and a repeated wall-clock hour. All data is synthetic.

[Open Overlap Lab](https://sulmatajb.github.io/overlap-lab/) · [Source code](https://github.com/sulmatajb/overlap-lab)

Choose an example, edit its events and analyze the result. Export JSON to reuse the same case in the CLI. No account or installation is needed for the browser version.

## Run locally

```sh
git clone https://github.com/sulmatajb/overlap-lab.git
cd overlap-lab
```

Use Node 22 for the CLI and tests; this milestone was verified on Node v22.14.0. No dependencies, build step, API keys or network services are required for calculations.

```sh
node cli.mjs analyze examples/partial.json
node cli.mjs normalize examples/repeated.json > normalized.json
node cli.mjs analyze normalized.json
node --test tests/core.test.mjs
```

The CLI prints deterministic JSON to stdout. `analyze` produces the calculated report; `normalize` exports a reusable fixture. Exit 0 means success; exit 2 means an input/read/usage error. Redirect to a new path: shell redirection can overwrite files.

Serve the browser files over loopback using any static server, for example Python's standard library:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Visit `http://127.0.0.1:8765`. Stop the server with Ctrl-C. Opening `dist/index.html` through `file://` is not supported because browsers restrict module loading. The page has no external assets, API requests, analytics or storage. Editing clears the previous results and disables export until the current input passes validation.

## Input and interpretation

```json
{
  "version": 1,
  "name": "Synthetic example",
  "window": { "start": "2026-10-15T09:00Z", "end": "2026-10-15T12:00Z" },
  "events": [
    { "id": "meeting", "label": "Synthetic meeting", "start": "2026-10-15T09:30Z", "end": "2026-10-15T10:30Z" }
  ]
}
```

- At most 100 events, a positive window of at most 48 elapsed hours, and 65,536 UTF-8 bytes. The normalized, pretty-printed fixture must also fit this limit, so every accepted export can be imported again. IDs must be unique. Labels are optional and default to the ID. Unknown fields are rejected.
- Timestamps use `YYYY-MM-DDTHH:mm[:ss[.sss]]` followed by uppercase `Z` or `±HH:MM`. Dates must be Gregorian-calendar valid, years 0001–9999. Millisecond precision is the maximum; no leap seconds, `24:00`, or unknown `-00:00` offset. Both the written date and resulting UTC date must be in range. The supplied offset determines the instant; this does not validate a real location's timezone rules.
- Every event must have positive duration. Events are clipped to the window; fully outside events are listed as excluded. Intervals are half-open `[start, end)`: an event ending at 10:00 does not occupy the following hour. Touching endpoints are not conflicts.
- **Events** counts distinct events intersecting that interval. **Busy** counts elapsed time with at least one event. **Conflict** counts elapsed time with at least two events, once even when three or more overlap. **Free** is window duration minus busy time. Per-hour counts cannot be added to get the distinct total because an event can cross hours.
- All output uses **UTC clock-hour buckets**, with first/last buckets clipped to the window. A repeated 01:15 with `−04:00` and `−05:00` offsets becomes 05:15 and 06:15 UTC. Midnight rows explicitly show the next date. This is an instant-based workbench, not a local-zone calendar display.
- Core/CLI reports preserve exact integer milliseconds and unrounded fractional minutes; browser minutes show up to three decimals. Export sorts events by start, end and ID and normalizes timestamps to UTC. Offset spelling is not preserved. Source JSON duplicate keys follow standard `JSON.parse` last-value semantics; use unique keys.

The pure module `dist/assets/core.mjs` is shared by the browser and CLI. There are no imports from calendars, ICS, recurrence rules or all-day event handling. No personal data is bundled. Input remains local to the page/CLI, but exports contain the labels you enter.

## Verification and scope

`tests/core.test.mjs` covers clipping, partial buckets, midnight, explicit offset transitions, half-open boundaries, triple overlap, strict input/byte caps, deterministic serialization, an independent minute oracle, host-timezone independence, real CLI behavior and simulated short filesystem reads.

The optional `tests/browser-check.mjs` uses an already available Playwright installation, selected with `OVERLAP_PLAYWRIGHT` (absolute path to its `index.mjs`). It starts and stops its own loopback static server, checks desktop/mobile behavior and exports, and saves synthetic evidence under an explicit new `OVERLAP_EVIDENCE` directory. It is not required to run the workbench.

This small developer tool covers explicit-offset timed events. Integration with real calendar implementations remains untested. It does not validate external calendars, timezone databases or scientific claims.

## License

[MIT](LICENSE). Built by Besnik Sulmataj.
