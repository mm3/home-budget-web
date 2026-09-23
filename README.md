# Home Budget 3.0.0 (browser version)

A home budget app that is **one HTML file**. All JavaScript and CSS are inlined, there are no
external requests, no frameworks and no build-time dependencies. Open the file from a USB stick,
a local folder or an offline laptop and it works.

![Dashboard](docs/desktop-home.png)

## What it does

- **Quick add:** type an amount, press **Add**. The entry goes to the default category (**Daily**),
  with today's date and the default currency. Nothing else has to be filled in.
- **Predefined categories** for the spending rhythms - **Daily**, **Monthly**, **Yearly** - plus
  **Budget** for planned shopping, Groceries, Transport, Home and Income. Every category has an emoji,
  a colour and an optional **limit with its own period** (per day, week, month or year); the limits show
  up as progress bars on the home screen and turn red when exceeded.
- **Entries:** full form for date, category, currency and note; filter by period, category,
  currency or text; tap a row (or click *Edit*) to change it.
- **Statistics:** sums and averages per **day, week, month and year**, a bar chart of the last
  periods (days / weeks / months / years) with an **average line**, a donut chart and a ranking per
  category, plus highlights such as the largest single expense.
- **Export:** CSV, Excel (.xlsx) and PDF of exactly the entries the filters show. The PDF starts with a
  drawn bar chart (vector graphics, average line included) and the spreadsheet gets a second sheet with
  the chart data and a **real Excel chart** - so the chart stays editable in Excel, LibreOffice or Numbers.
- **Import:** CSV and .xlsx files. The column layout is **detected automatically** — by header names
  (English, German, Estonian, Spanish, Russian and more) or, when there is no header, by what the
  columns contain. The detected mapping is shown and can be corrected before importing.
- **Languages:** English, Russian and German, picked automatically from the browser or chosen in the
  settings. A built-in editor lets you write **your own translation** of every text; it is stored in the
  browser and can be downloaded and shared as a JSON file.
- **Currencies:** fourteen come with the app (EUR, USD, GBP, CHF, SEK, NOK, DKK, PLN, CZK, UAH, TRY,
  CAD, AUD, JPY) and more can be added. Each has an editable **rate** against the default currency, and a
  switch folds every currency into the default one for the dashboard, the statistics and the budgets.
  Rates are typed in by hand - an offline app cannot fetch them, and the shipped values are only examples.
- **Configurable:** categories (name, type, colour, emoji, limit, limit period) and currencies (code,
  symbol, decimals, rate), the default category and currency, light/dark theme and mobile/desktop layout.
- **Storage:** everything stays in the browser's `localStorage` (about 60 000 entries fit).
  `sessionStorage` and an in-memory store are used as fallbacks when a browser blocks storage,
  so the app still runs in private mode. A JSON backup can be downloaded and restored.

| Mobile | Russian interface |
|---|---|
| ![Mobile](docs/mobile-home.png) | ![Russian](docs/desktop-home-ru.png) |

| Statistics | Settings |
|---|---|
| ![Statistics](docs/desktop-stats.png) | ![Settings](docs/desktop-settings.png) |

![Currencies](docs/desktop-currencies.png)

## Using it

Open `home-budget-3.0.0.html` in any modern browser (Chrome, Edge, Firefox, Safari). Nothing to install.
Amounts are stored as whole cents, so no rounding errors creep in. Data saved by an older version is
upgraded automatically on first start: entries and categories are kept, and anything new (icons, limit
periods, currency rates) appears with sensible defaults. The version is visible in three places: the file
name, the page footer and **Settings → About**; the saved data also records which version last wrote it.

Data belongs to one browser profile on one device: a different browser or a private window starts
empty. Use the JSON backup in **Settings → Data** to move data, and remember that clearing site data
deletes it.

.xlsx files are ZIP archives, so import and export use the browser's built-in compression
(`CompressionStream`, available in Chrome/Edge 80+, Safari 16.4+, Firefox 113+). CSV and PDF work
everywhere.

## Building

```bash
npm run build          # dist/home-budget-<version>.html and .min.html
npm run build:min      # the minified file only
npm test               # unit tests
npm run coverage       # unit tests + coverage thresholds
npm run browser-check  # end-to-end check of both builds in Chromium
npm run check          # coverage + build + browser check
```

The version lives in `src/core/version.js` and nowhere else: `package.json`, the file names, the bundle
banner, the `<title>`, the meta tag, the footer, the About card, the PDF export footer and the saved data
all take it from there, and a unit test fails if `package.json` drifts away from it.

There are **no dependencies** — Node 22 (or newer) runs everything. `tools/bundle.mjs` contains a
small ES module bundler and a conservative minifier: it strips comments and redundant whitespace but
never renames anything, so the minified file stays debuggable and behaves identically. Both builds
are verified by the same browser check.

## Structure

```
src/
  core/          logic with no DOM, fully unit tested
    version.js     the single version source
    format.js      money and date formatting, parsing, period keys
    i18n.js        English, Russian and German texts plus user translations
    model.js       entries, categories, currencies, limits, conversion
    store.js       application state and all operations on it
    storage.js     localStorage / sessionStorage / memory, migration and repair
    stats.js       sums, averages, series, budgets and category breakdowns
    charts.js      SVG bar (with average line) and donut charts
    csv.js         CSV reader and writer with delimiter detection
    zip.js         ZIP reader and writer (for .xlsx)
    xlsx.js        .xlsx reader and writer, including a native Excel chart
    pdf.js         PDF writer (Helvetica, paginated table, vector chart)
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

102 tests covering the core modules, including round trips (CSV → parse → CSV, XLSX write → read,
ZIP write → read), the PDF and chart structure, storage upgrades from older data, budget calculations
per limit period, currency conversion, version consistency, translation completeness (every language has
every key with the same placeholders), and the import detection for files with and without headers. The run **fails below 90%** line, branch and
function coverage of `src/core`; it currently sits at about 99% lines, 95% branches.

`tools/browser-check.mjs` additionally drives the built file in headless Chromium (24 checks): it adds
an entry through the quick form, checks that it is stored and survives a reload, exports CSV/XLSX/PDF
and verifies the produced bytes (including the chart parts), imports a semicolon-separated German CSV,
switches the interface between English, Russian, German and a user translation written in the settings
editor, checks the version stamp, the average line, the budget bars with their periods and the currency
conversion, and takes the screenshots in this README. It fails
if anything logs an error to the console.
