# Visual review of 3.16.0

What a sweep of every screen, in every language, theme and layout, over five
shapes of data, turned up. 198 screens were rendered by `npm run sweep`
(`tools/visual-sweep.mjs`); the machine measured what is measurable and kept a
screenshot of everything it complained about, and the list below is what
survived a person looking at those screenshots.

Nothing here is fixed. This is the report, not the repair.

## The findings, worst first

### 1. One category makes the donut chart disappear

**Where:** Home → *By category*, with a single category — which is what every
new installation looks like after the first quick entry.

**What happens:** the ring is not drawn at all. The legend beside it is correct,
so the card reads as a legend with an empty space where the chart should be.

**Why:** `arcPath` in `src/core/charts.js` clamps a full turn to
`2π - 1e-6` and then rounds the coordinates. A slice covering everything
therefore starts and ends at the same point:

```
M 100 1 A 99 99 0 1 1 100 1 L 100 38 A 62 62 0 1 0 100 38 Z
       └── starts at 100,1 ──────┴── ends at 100,1
```

An elliptical arc whose two endpoints are the same point draws nothing at all —
that is what the SVG specification says to do with it. Measured in the page, the
path's bounding box is **0 pixels wide**.

A category holding *almost* everything is the same bug one step less severe: at
99.999% the arc is 0.01 pixels wide, which is the thin vertical line visible on
the extreme-data screenshot.

A slice that covers the whole circle has to be drawn as two arcs, or as a
circle.

### 2. A budget row does not fit its card, and drags the whole app sideways

**Where:** Home → *Budgets this month*, on a phone. In Russian and German at
perfectly ordinary data; in every language once a category name is long.

**What happens:** the figure on the right of a budget row — `45.00 € of 300.00 €
· per week` — cannot wrap, so it runs out of the card and off the screen.

| language / data | row content | room |
|---|---|---|
| English, normal | 332 | 332 — fits by luck |
| Russian, normal | 348 | 332 |
| German, normal | 373 | 332 |
| 36-character category name | 543 | 332 |
| amount near the allowed maximum | 421 | 332 |

**Why:** `.bar-head` is a flex row of two parts, the second one `.num`, which is
`white-space: nowrap` by design so a sum never breaks across lines. Neither part
may shrink, so the row simply grows.

### 3. …which makes every dialog on that page unusable

**Where:** any dialog opened on a phone while finding 2 is in effect.

**What happens:** the page is wider than the screen — 402 CSS pixels in German,
572 with a long category name, against a 390 pixel phone — and `.dialog` is
sized `min(440px, calc(100vw - 32px))`, where `100vw` is that widened layout.
The dialog becomes wider than the screen and is centred in a viewport the person
cannot see all of. Its **Close** button sits at x=423 and its **Add** button at
x=336..448, on a screen that ends at 390.

The screenshot `docs/sweep/phone_ru_dark_long_dialog-entry-new.png` shows it:
the labels are cut off on the left, the primary button on the right.

This is the reason finding 2 matters more than a clipped figure would suggest.
One card that does not fit takes the dialogs down with it.

### 4. The dialog's own buttons overflow it in Russian and German

**Where:** the entry dialog, on a phone, independently of 2 and 3.

**What happens:** `.dialog-actions` holds *Delete · Cancel · Save* in a flex row
that does not wrap: 325 pixels of buttons in a 324 pixel dialog in Russian, 341
in German. A pixel or two today, and no room at all the moment a word grows.

### 5. Two localisation bugs in one `toLowerCase()`

**Where:** Home → budget rows, and Settings → the category table.

`src/ui/views/home.js` builds the period as
`t('home.budgetPeriod', { period: t('period.week').toLowerCase() })`.

| language | shown | should be |
|---|---|---|
| English | per week | correct |
| Russian | **за неделя** | за неделю — the template takes the accusative |
| German | **pro woche** | pro Woche — German capitalises its nouns |

Lower-casing a word is an English habit. Russian needs a different case after
this preposition, and in German it is simply a spelling error — all four periods
are wrong there (`woche`, `monat`, `jahr`, `tag`), and in Russian one of the four
is (`неделя`), because the other three happen to be identical in both cases.

The same call in `settings.js` produces `300.00 € / woche` in the category
table.

### 6. A figure near the allowed maximum overflows its card

**Where:** Home → the four figures at the top, desktop and phone.

`1 000 000 000.04 €` needs 226 pixels in a 219 pixel card. The app accepts
amounts up to that maximum on purpose — it is the point beyond which the totals
stop being exact — so the card should be able to show one.

The same data puts `10000000000%` in a budget badge, which is arithmetically
true and not worth printing.

### 7. Two targets too small for a finger

**Where:** on a phone.

- The chart toggles — *show income*, *show average* — are **14×14** pixels.
  `.toggle input` sets that size explicitly. They appear on Home and on Stats,
  so this is 28 of the 198 screens.
- The **Share** control in *Settings → About* is **23 pixels tall**. It became a
  plain piece of text in 3.9.0 to stop it jumping around, and lost its height
  along with its box.

Both are below the 24 pixel floor this project's own checks use elsewhere, and
well below the 44 pixels Apple and Google both recommend.

### 8. The small grey badge is one step too pale

**Where:** everywhere a badge appears — `default`, `15%` — in the light theme
only.

Contrast measures **4.36:1** against the card. Text of 11 pixels needs 4.5:1 to
meet WCAG AA. It is a small miss on a small label, and it is the only contrast
failure in 198 screens, in either theme — the dark palette passes everywhere.

### 9. Two sentences saying nearly the same thing

**Where:** *Settings → About*, in a file opened from disk.

The install row says installation needs the published page; the update row says
there is no server to ask. Both are true, both are about the same limitation,
and they sit one under the other.

## What was checked and found sound

- **No overlapping controls** anywhere, in any combination, once the two
  artefacts below were accounted for.
- **The chart legend and the donut legend fit** on a phone in all three
  languages — what looks clipped in a screenshot is the page being dragged
  sideways by finding 2, not the legend itself.
- **Rows of form fields stay aligned** in every language and both layouts; the
  subgrid work in 3.13.0 holds.
- **The dark theme** produced no contrast failures and no layout differences.
- **The empty state** renders correctly on every screen.
- **No console errors** in any of the 198 renders.

## Two things the tool got wrong before it could be trusted

Worth writing down, because both would have made the report confidently wrong:

- Chrome hands out real rectangles for the contents of a **closed `<details>`**
  and for rows **scrolled out of a box that clips them**. Measured naively, the
  collapsed translation editor appeared to lie on top of the card below it — 88
  overlaps that do not exist.
- On a phone the **visual viewport widens** to fit content that does not fit, so
  `document.scrollWidth > window.innerWidth` is never true no matter how far the
  page overflows. Compared against the device width instead, eight real
  overflows appeared that the first two runs had missed — including finding 3.
