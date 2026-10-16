<<<<<<< HEAD
# CogLog
Documenting and logging down your progress on any activity however its principal to cognitive training
=======
# Cognitive Evolution Tracker — journal + working-memory assessment lab

Two apps in one private, local-first web site:

1. **Cognitive Evolution Tracker** (tabs *Journal / Progress / Profile*) — a personal
   **cognitive-training research journal** for logging daily training sessions, lifestyle
   variables, and cognitive assessments, then exploring them through interactive graphs and
   descriptive statistics.
2. **Procedurally Generated Working-Memory Assessment Platform** (tab *WM Assessment*) — a
   browser-administered assessment battery with four task families, procedurally generated
   stimuli (reproducible from a stored seed), a fixed difficulty blueprint, per-family scoring
   with confidence intervals, interruption-safe sessions, and full data export.

Both are deliberately careful about the difference between *improving at a trained task* and
*a change in cognitive ability* — and neither converts task gains into IQ points.

---

## Running it

The app is plain HTML/CSS/JS — **no build step, no npm install, no CDN/network calls.**

**Recommended** (full IndexedDB storage):

```bash
cd cognitive-evolution-tracker
python serve.py          # serves http://127.0.0.1:8747
# or: python serve.py 8000
```

Then open <http://127.0.0.1:8747>.

**Also works:** double-click `index.html` to open it directly. If the browser blocks IndexedDB on
`file://`, the app automatically falls back to `localStorage` (smaller quota — prefer the JSON
export for large journals). The storage mode is always shown in the footer and in *Data & Backup*.

> The bundled `serve.py` exists only as a convenience local server with no-cache headers. Nothing
> is sent anywhere; it binds to `127.0.0.1` only.

---

## Storage architecture (chosen before the data layer was built)

**Local-first, browser-side storage. No accounts, no server, no telemetry.**

| | |
|---|---|
| Primary store | **IndexedDB** (`cognitive-evolution-tracker` database), holds records **and** image/data attachments |
| Fallback store | **localStorage** if IndexedDB is unavailable (verified by an automated test cycle) |
| What leaves the device | Nothing, unless *you* click an export button |
| What backs it up | Nothing automatically — see *Backups* below |

### ⚠️ Important honesty about local storage

Browser-local data is **not protected against device failure, browser-profile reset, or "clear
browsing data."** This is stated in the app footer and in *Data & Backup*, not buried.
**Export a JSON backup after any meaningful stretch of logging.**

### Backups & recovery

*Data & Backup* (top-right) provides:

- **Full JSON backup** — everything: profile, modes, metric definitions (with version history),
  tickets, sessions, observations, assessments, attachments (images as data URLs).
- **JSON (data only)** — same, excluding image attachments (smaller).
- **CSV exports** — `observations`, `daily tickets`, `assessments`, `metric definitions`
  (for spreadsheets / external analysis).
- **Shared report (Markdown)** — a human-readable summary. **Sensitive profile fields are excluded
  unless you explicitly tick "Include sensitive profile information."**
- **Import** — restores a JSON backup. Two modes:
  - **Merge (safer):** keeps existing records; records are matched by `id`. If an incoming record
    conflicts with a different local version, it is **skipped and counted**, never silently overwritten.
  - **Replace:** wipes the journal and restores from the file.

**Recovery procedure:** erase or lose data → *Data & Backup* → *Import JSON backup* → choose
Replace (if restoring onto a fresh install) or Merge.

### Data format

The JSON export envelope is stable and documented:

```jsonc
{
  "app": "cognitive-evolution-tracker",
  "schemaVersion": 1,
  "exportedAt": "2026-10-15T15:31:30.334Z",
  "includeAttachments": true,
  "includeSensitive": false,
  "data": {
    "profile":  { ... },            // includes .snapshots[], .plans{}, .sensitive{}
    "modes":    [ { id, name, color, archived, ... } ],
    "metrics":  [ { id, name, unit, dataType, direction, min, max, target,
                    modeIds[], description, currentVersion, versions[] } ],
    "tickets":  [ { id, date, sleep{}, pa{}, notes, createdAt, updatedAt } ],
    "sessions": [ { id, ticketId, date, startTime, endTime, durationMin,
                    modeId, notes, createdAt, updatedAt } ],
    "observations": [ { id, sessionId, ticketId, metricId, metricVersion,
                        value, notes, createdAt, updatedAt } ],
    "assessments":  [ { id, kind:"baseline"|"followup", testName, date, scoreType,
                        scaleMin, scaleMax, normSD, overallScore, subtests[],
                        reliability, gLoading, notes, preparation, conclusions,
                        createdAt, updatedAt } ],
    "attachments":  [ { id, ownerType, ownerId, name, mime, size, dataUrl, createdAt } ]
  }
}
```

`createdAt`/`updatedAt` are ISO timestamps (when it was *entered*). `date` is the **event date**
(when it *happened*). Graphs always use `date`, never `createdAt`.

Assessments carry two dedicated free-text fields: `preparation` (baseline — how the user prepared
for the training before testing) and `conclusions` (follow-up — what the training sessions
concluded, e.g. premises per RRT component or the overall Executive N-back level achieved).
Both are optional, stored as `null` when empty, included in the JSON backup and the
assessments CSV (`preparation`, `conclusions` columns), and surfaced on the profile cards,
the side-by-side comparison, and the shared report. Older records simply lack the fields —
readers must treat them as optional.

---

## Data model

Nine entities, with referential integrity enforced on write and cascade on delete:

```
profile ─┬─ snapshots[]        lifestyle plans{}      sensitive{}
ticket   │  1─n session        daily sleep{} / pa{}   notes
session  │  1─n observation    own date + start/end time + mode
observation n─1 metric         value + metricVersion (definition at time of record)
metric   └─ version history[]  name/unit/type/direction/range/target
assessment 1─n subtest         baseline | follow-up, psychometrics, attachments
attachment  n─1 (ticket|session|assessment)
```

A ticket is a **container** for a day: it can hold many sessions, each session many observations,
of many different metrics — including repeated sessions of the same mode on one day.

---

## Design principles encoded in the code

| Principle | How it shows up |
|---|---|
| **Tickets ≠ sessions** | One ticket holds N sessions, each with its own time, mode, notes, metrics, attachments |
| **Event date ≠ entry date** | `date` drives all graphs; `createdAt`/`updatedAt` recorded separately and displayed |
| **Editing a date reorders** | Changing a session/ticket date re-sorts the feed and redraws every graph/statistic |
| **Metrics have identity** | Each metric has unit, data type, scoring direction, valid range, target, description |
| **Metric definitions version** | Editing a definitional field bumps `currentVersion` and appends to `versions[]`; **past observations keep their old version number**, and the graph never pools incompatible versions — it shows a version selector |
| **Missing ≠ zero** | Optional fields are `null`, never `0`. A deliberately-recorded `0` is preserved as a real number |
| **No invented psychometrics** | Reliability / g-loading / norm-SD are blank unless you enter them |
| **Sleep crosses midnight** | `computeSleepMinutes()` handles `23:30 → 07:00`; missing times return `null` |
| **Workouts stay specific** | Each ticket records minutes for one selected workout type; the Progress page draws **one graph per workout type** over time — nothing is aggregated into rolling windows |
| **No over-claiming** | Stats need ≥2 points; trends need ≥3; the RCI panel explains its assumptions; overlays are labelled *descriptive only, not causal* |
| **Task ≠ ability** | Training metrics and standardized assessments keep separate timelines; the UI never converts task gains into IQ points |
| **Sensitive by default** | Diagnostic/private notes excluded from shared reports and exports unless explicitly opted in |

---

## Features

- **Journal** — chronological ticket feed, search, date-range/mode filters, summary stats
  (days logged, sessions, current streak, latest session), create/edit/duplicate/delete tickets
  with explicit consequences on delete.
- **Ticket editor** — collapsible sections; auto-populated but editable date; sleep (auto-computed
  from bed/wake, manual override); physical activity per specific workout (minutes, selectable
  workout type with suggestions, intensity); N training
  sessions; multiple metrics per session; image/PDF attachments (images auto-downscaled).
- **Progress** — performance graph (one metric per Y-axis, coloured by mode, connect/trend
  toggles, click a point to open its source ticket), metric-version selector, descriptive
  statistics, five lifestyle charts (sleep, sleep/wake times, training duration,
  training frequency, time of training) plus one graph per workout type (recorded minutes
  over time, one per workout), association explorer with caveat, assessment timeline.
  Time ranges: 7 / 30 / 90 days, 6 months, 1 year, all, custom.
- **Profile & Assessments** — general info + dated snapshots, lifestyle *plans* (kept distinct from
  actual behaviour), private sensitive section, baseline and post-training assessment panels
  with dedicated text fields (baseline: *training preparation*; follow-up: *session
  conclusions* — e.g. premises per RRT component or the achieved Executive N-back level),
  side-by-side comparison with absolute/percentage difference (percentage only on true-zero
  scales), elapsed time, intervening session count, subtest deltas, the selected baseline's
  preparation / follow-up's conclusions as context, and an optional **Reliable Change Index**
  analysis with its assumptions spelled out.
- **Ticket notes summary** — every note inside every daily ticket (day notes, sleep notes,
  physical-activity notes, per-session notes, per-observation notes) compiled into one
  date-stamped text document on the Profile page, with *copy to clipboard* and
  *download as .txt*. The same compilation feeds the "Ticket notes" section of the shared
  report, so panel and export always agree.
- **Settings** — manage training modes (colour-consistent across all graphs) and metric definitions.
- **Appearance** — seven curated themes (four light: Lumen, Sepia, Forest, Blush; three dark:
  Midnight, Graphite, Aurora) with signature accents, plus nine accent-colour overrides.
  Chosen via the 🎨 Appearance button in the top bar; applies instantly, is persisted
  (IndexedDB meta record + localStorage mirror applied by a pre-paint script, so no flash
  of the default look), and is cosmetic only — it never rides along in data backups and is
  untouched by data erasure.

---

## Working-Memory Assessment Platform (tab: *WM Assessment*)

A second, self-contained app sharing the same storage and privacy model. Eight sections,
addressable as `#wm/<section>`: **Dashboard · Assessment Session · Task Configuration ·
Performance Analytics · Session History · Data Management · Assessment Settings ·
Methodology & Limitations**.

### The four task families

| Family | Variants | What varies with difficulty |
|---|---|---|
| **A · Visuospatial** | reproduce, reverse, identify | grid size, sequence length, retention interval, distractor load |
| **B · Verbal/auditory** | forward, backward, positions, recognition | item count, distractor similarity, modality, delay |
| **C · Updating** | n-back, recent-set | load (n / set size), interference (lures, masks), lure similarity |
| **D · Complex span** | storage-only, storage+processing | list length, processing load, scoring split (storage vs processing are always reported separately) |

### Procedural generation, honestly reproducible

- Every session derives a master seed; the PRNG is a small xoshiro-style generator
  (`wm-rng.js`, versioned as `wm-gen-1.0.0`). All stimuli come from
  `rng.derive('block/variant/level/…')` sub-seeds — nothing in a session is untracked randomness.
- The seed, generator version, and per-trial parameters are stored on the session and trials and
  are inspectable in **Session History** (and in the dev view of the stage when dev mode is on) —
  **never shown during scored trials**.
- Constraint guards run inside the generators (uniqueness, no straight runs, no alphabetical/digit
  runs, no ABAB, minimum lags, controlled target rates with no exploitable answer-status runs,
  duplicate-sequence rejection across a session). When a constraint must be relaxed to satisfy the
  rule (e.g. a target whose match item is also the just-shown item), the relaxation is **recorded
  on the trial**, not silently absorbed.
- Generated ≠ equivalent difficulty: a fresh form with the same difficulty label is a *new sample
  from a difficulty specification*, not a same-difficulty copy.

### Fixed difficulty blueprint

The blueprint (default 25 / 33 / 25 / 17 across low / moderate / high / very-high) is allocated
per session with deterministic largest-remainder rounding, scheduled per **unit** (A/B: per trial,
C: per stream step, D: per list), and pinned to the session. Intended vs delivered counts are
shown on the dashboard and stored in the session record; the same label is explicitly *not*
claimed to be equivalent across families (each family's difficulty parameters are listed in the
Task Configuration section).

### Session procedure

Overview (with configuration-change warnings vs the previous session) → instructions →
familiarization (practice with feedback, excluded from scores and default exports) → ready →
scored trials → summary. **No correctness feedback is shown during scored trials.** Stimulus-side
timing is scheduled and measured; deviations beyond 80 ms, tab-hidden events, auditory-fallback
presentations, and self-paced responses that overrun the planned window are all recorded per
trial and counted on the session. Esc pauses; interrupted sessions survive reloads and are
resumable from their stored cursor.

### Scoring & statistics (no fabrication)

- **Per-family scores only** — there is deliberately no single "working-memory score".
- Accuracy with Wilson 95% confidence intervals; recognition/yes-no families get
  loglinear-corrected signal detection (hits, false alarms, d′, β).
- A **provisional composite exists but is off by default** and always labelled exploratory.
- **Reliable Change Index requires a reliability value you supply** — without one the app reports
  "unavailable" rather than inventing psychometrics.
- Analytics distinguish **observed change** (any difference), **reliable change** (beyond
  measurement error), and **generalization** (to untrained measures), warn when configurations
  changed between compared sessions, and never auto-label a change as a capacity change.

### Automated tests

The Methodology section (or the console: `WMTests.run()`) runs **32 tests** entirely in the tab:
PRNG determinism and bounds, blueprint allocation/normalization/schedule, all four generators'
constraint compliance and answer keys, template-vs-generated provenance, scoring math (partial
credit, error classes, signal detection, Wilson CIs, RCI availability), duplicate detection,
session lifecycle states, config diffing, interruption/resume, config-version pinning with
rollback, export/import roundtrip, and analytics honesty. Persistence tests create throwaway
records and delete them; nothing mixes into your data.

### WM data management

- **Exports**: JSON bundle (sessions + blocks + trials + config versions + settings) and
  trial-level / session-level CSVs; import merges by id with duplicate skipping.
- **Scoped erase**: *Erase WM assessment data only* removes WM sessions, blocks, trials, config
  history, and WM settings — journal data is untouched. The site-wide erase covers both apps.
- The full journal backup embeds the WM data, so one JSON backup restores everything.

---

## Testing performed

**Journal app**

- All 12 journal JS modules pass `node --check` (23 files including the WM platform).
- Runtime smoke test: all 3 views + all 5 modals render with **zero console errors** and no
  `[object …]`/`undefined` leaks.
- Data-integrity test: every session→ticket, observation→session, observation→metric link valid.
- Date-reorder test: moving a ticket to `2030-01-01` moves it to the top of the timeline and its
  session date follows; reverting restores order.
- Metric-version test: definitional edit bumps v1→v2 (history grows), existing observations keep
  their original version, description-only edit does **not** bump.
- Export→erase→import roundtrip returns **identical counts** with referential integrity intact,
  no duplicated modes/metrics.
- Missing-vs-zero: empty sleep → `null`; recorded `0` stays `0`.
- localStorage fallback: full read/write/upsert/delete/meta/putMany/clear cycle passes.
- Ticket notes summary: compiled document verified against live data — day, sleep,
  physical-activity, session, and observation notes all included with date + entry stamps,
  chronological order, note-less days excluded; copy-to-clipboard and `.txt` download capture
  the exact 553-char document; the shared report's *Ticket notes* section matches the panel.
- Assessment fields: baseline *training preparation* and follow-up *session conclusions* render
  conditionally on kind (flipping the kind select swaps the field and preserves uncommitted
  typed text), persist as `null` when empty, and appear on the cards, the side-by-side
  comparison, the JSON backup, the assessments CSV, and the shared report.
- Appearance: all 7 themes verified token-by-token (backgrounds, ink, lines, accents,
  `--on-accent`, topbar tint); accent overrides flip correctly between light and dark modes;
  the choice survives a full reload via the pre-paint localStorage mirror and the IndexedDB
  record; reset returns to Lumen/auto; the WM stage inherits themes automatically.
- Chart robustness fix: a degenerate dual-axis domain (association explorer with a
  single-valued lifestyle overlay) no longer emits `Infinity`/`NaN` SVG attributes —
  `charts.js` normalises the dual domain and filters non-finite points; a full sweep of
  all 12 views afterwards is clean.
- Per-workout physical activity: the 7-day total-minutes field, its referenced-period and
  overlap-warning UI, the "7-day PA" lifestyle chart, and the association overlay for it are
  gone; the editor keeps minutes + a workout selector (datalist of previously recorded types
  and common presets) + intensity + notes; the Progress page draws **one graph per workout
  type** from the recorded data. Verified live: editing a workout and saving regenerates the
  cells (a new workout type appears as its own graph, minutes round-trip), journal chips show
  `min · workout`, the daily CSV exports `pa_workout_minutes,pa_type,pa_intensity`, all
  workout-chart SVG attributes stay finite, and `WMTests.run()` remains **32/32 green**.

**WM assessment platform**

- All `js/wm/*` modules pass `node --check`.
- `WMTests.run()`: **32/32 green** (see *Automated tests* above).
- End-to-end driven session in a real browser: overview → instructions → familiarization →
  ready → scored trials → summary, with the full stage overlay, keyboard/click input, and a
  completed session record (blueprint realized, seeds, config version pinned).
- Interruption/resume verified across an actual page reload: the open session, its cursor,
  completed trials, and familiarization status all survived; resume recorded the interruption
  and finished the session.
- Config-versioning verified through the UI form (edit → new version; no-op save → no version;
  temporary test version rolled back).
- Export JSON/CSV + import roundtrip verified with real session data (duplicates skipped, counts
  stable); scoped erase verified to clear WM data while leaving journal records intact.
- All eight `#wm/…` sections render with zero console errors, with and without session data.

## Project layout

```
cognitive-evolution-tracker/
├── index.html            shell + script order (journal views, then WM platform, then main.js)
├── serve.py              optional no-cache local server (127.0.0.1)
├── css/styles.css        design system, responsive breakpoints, WM assessment stage
└── js/
│   ├── util.js           dates, stats, CSV, validation, image compression
│   ├── db.js             storage layer: IndexedDB + localStorage fallback (stores incl. wm*)
│   ├── store.js          data model, CRUD, cascades, metric versioning, queries
│   ├── charts.js         dependency-free SVG chart + timeline engine
│   ├── export.js         JSON/CSV export, import/merge, shared report
│   ├── ui.js             toasts, modals, confirmations, image viewer
│   ├── theme.js          appearance: curated themes, accent overrides, picker modal
│   ├── editor.js         daily ticket editor (sessions, metrics, sleep, PA, attachments)
│   ├── view-journal.js   dashboard feed, search, filters, summary
│   ├── view-progress.js  graphs, statistics, lifestyle charts, assessment timeline
│   ├── view-profile.js   profile, plans, ticket-notes summary, assessments, comparison + RCI
│   └── wm/               ── WM Assessment Platform ──
│       ├── wm-rng.js         seeded PRNG (versioned generator), sub-seed derivation
│       ├── wm-blueprint.js   difficulty blueprint: allocation, schedule, realized-vs-intended
│       ├── wm-tasks.js       the four families: generators, instructions, scoring keys
│       ├── wm-scoring.js     per-family scoring, Wilson CIs, signal detection, RCI
│       ├── wm-store.js       WM sessions/blocks/trials/config-version persistence
│       ├── wm-runner.js      full-screen assessment stage, timing, pause/resume, dev view
│       ├── wm-analytics.js   trajectories, observed/reliable change, per-family breakdowns
│       ├── wm-export.js      WM JSON bundle + trial/session CSVs, import merge
│       ├── wm-tests.js       32 automated tests (Methodology page / console)
│       ├── wm-view.js        shell + Dashboard, Session, Configuration, Settings sections
│       └── wm-view2.js       Analytics, History, Data management, Methodology sections
    └── main.js           bootstrap, routing, Data & Backup, definitions manager
```

## Privacy

- No accounts, no analytics, no network requests after page load, no third-party resources.
- Records live in this browser's storage on this device only.
- Sensitive profile information is opt-in for every export and never appears in shared reports
  by default.
- The app never uses diagnostic information to draw conclusions about intelligence or expected
  progress.
- WM assessment data follows the same rules: sessions, seeds, and answer keys never leave the
  device; answer keys are inspectable in Session History after a session, never during scored
  trials; dev mode only reveals seeds/parameters, and only post-session.
>>>>>>> b4689cf (log)
