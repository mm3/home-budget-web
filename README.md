# Home Budget (browser version)

A home budget app that is **one HTML file**. All JavaScript and CSS are inlined, there are no
external requests, no frameworks and no build-time dependencies. Open the file from a USB stick,
a local folder or an offline laptop and it works.

![Dashboard](docs/desktop-home.png)

## What it does

- **Quick add:** type an amount, press **Add**. The entry goes to the default category (**Daily**),
  with today's date and the default currency. Nothing else has to be filled in.
- **Entries:** full form for date, category, currency and note; filter by period, category,
  currency or text; tap a row (or click *Edit*) to change it.
- **Statistics:** sums and averages per **day, week, month and year**, a bar chart of the last
  periods (days / weeks / months / years), a donut chart and a ranking per category, plus highlights
  such as the largest single expense.
- **Export:** CSV, Excel (.xlsx) and PDF of exactly the entries the filters show.
- **Import:** CSV and .xlsx files. The column layout is **detected automatically** — by header names
  (English, German, Estonian, Spanish, Russian and more) or, when there is no header, by what the
  columns contain. The detected mapping is shown and can be corrected before importing.
- **Configurable:** categories (name, type, colour) and currencies (code, symbol, decimals), the
  default category and currency, light/dark theme and mobile/desktop layout.
- **Storage:** everything stays in the browser's `localStorage` (about 60 000 entries fit).
  `sessionStorage` and an in-memory store are used as fallbacks when a browser blocks storage,
  so the app still runs in private mode. A JSON backup can be downloaded and restored.

| Mobile | Statistics |
|---|---|
| ![Mobile](docs/mobile-home.png) | ![Statistics](docs/desktop-stats.png) |

## Using it

Open `home-budget.html` in any modern browser (Chrome, Edge, Firefox, Safari). Nothing to install.
Amounts are stored as whole cents, so no rounding errors creep in.

Data belongs to one browser profile on one device: a different browser or a private window starts
empty. Use the JSON backup in **Settings → Data** to move data, and remember that clearing site data
deletes it.

.xlsx files are ZIP archives, so import and export use the browser's built-in compression
(`CompressionStream`, available in Chrome/Edge 80+, Safari 16.4+, Firefox 113+). CSV and PDF work
everywhere.

## Building

```bash
npm run build        # dist/home-budget.html      (readable, ~132 kB)
npm run build:min    # dist/home-budget.min.html  (minified, ~110 kB)
npm test             # unit tests
npm run coverage     # unit tests + coverage thresholds
node tools/browser-check.mjs dist/home-budget.html   # end-to-end check in Chromium
```

There are **no dependencies** — Node 22 (or newer) runs everything. `tools/bundle.mjs` contains a
small ES module bundler and a conservative minifier: it strips comments and redundant whitespace but
never renames anything, so the minified file stays debuggable and behaves identically. Both builds
are verified by the same browser check.

## Structure

```
src/
  core/          logic with no DOM, fully unit tested
    format.js      money and date formatting, parsing, period keys
    model.js       entries, categories, currencies, validation
    store.js       application state and all operations on it
    storage.js     localStorage / sessionStorage / memory, migration and repair
    stats.js       sums, averages, series and category breakdowns
    charts.js      SVG bar and donut charts
    csv.js         CSV reader and writer with delimiter detection
    zip.js         ZIP reader and writer (for .xlsx)
    xlsx.js        .xlsx reader and writer
    pdf.js         PDF writer (Helvetica, paginated table)
    importer.js    column detection and row conversion
    exporter.js    entries -> CSV / XLSX / PDF
  ui/            DOM layer: shell, views, dialogs
  index.html     template, app.css styles, main.js entry point
tools/           bundler, build script, browser check
test/            unit tests (node:test)
```

The UI layer only reads from and calls into `core`; `core` has no reference to the DOM, which is why
it can be tested in Node and why the same logic runs in the export/import code paths.

## Tests

```
npm run coverage
```

72 tests covering the core modules, including round trips (CSV → parse → CSV, XLSX write → read,
ZIP write → read), the PDF structure, storage repair of corrupt data, and the import detection for
files with and without headers. The run **fails below 90%** line, branch and function coverage of
`src/core`; it currently sits at about 99% lines, 95% branches.

`tools/browser-check.mjs` additionally drives the built file in headless Chromium: it adds an entry
through the quick form, checks that it is stored and survives a reload, exports CSV/XLSX/PDF and
verifies the produced bytes, imports a semicolon-separated German CSV, and takes the screenshots in
this README. It fails if anything logs an error to the console.
