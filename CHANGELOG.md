# Changelog

Newest first. The pull-request script reads this file: a pull request describes
only the versions above the one the target repository is on, so the description
is always the difference from the release being replaced.

## 4.0.1

**The arrow on a drop-down was still the system's.** 3.20.0 took the open list
away from the operating system and left the closed control alone, and the
control is what a person looks at all day: a solid platform disclosure triangle,
heavier than any other mark on the page, sitting inside a field that was
otherwise the app's. The list had stopped looking borrowed; the button had not.

There is now one arrow in the app - a thin rounded chevron, defined once as
`--chevron` and painted as a mask, so it takes its colour from whatever it sits
in and follows the theme like text. It is used in both places a browser
otherwise draws its own: the drop-down, where it turns over while the list is
open, and a section that folds (**Filters and search**, the translation editor),
where it points the way the section will open.

The closed control also says its own layout now - the chosen row at one end, the
arrow at the other, both on the middle line - instead of leaving it to the
browser's base stylesheet, which centred nothing and let an emoji in front of
the text push it off the line.

## 4.0.0

**The major version is now the document version.** Saved data has been at
version 4 since an entry gained its list of categories; the app was still called
3.20.0. From here the two are the same number by rule - `4.x.y` writes documents
of version 4 - and a unit test fails if either moves without the other.

That is the whole of this release: no feature changes, nothing to migrate,
nothing to relearn. A 3.19.0 or 3.20.0 installation updates to 4.0.0 and finds
its entries, categories, currencies, rates and settings exactly where it left
them, because the format they are stored in has not moved either.

What it buys is a question a backup file could not answer before. A JSON backup
carries a document version; a release carries a release number; and until now
nothing connected them, so "will this file open in that version" meant opening
both and looking. Now the major version answers it: anything 4.x reads a
version 4 document, and a release that has to break the format has to say so in
the only number people actually read.

The 3.x line ends here. What it built, in short: an entry may be in several
**categories** at once; the currency **follows the language** until the first
entry or the first choice; the cards pace the **period now running**; limits
have their own periods; the app **updates itself** past every cache; the lists
are drawn by the page; and the visual **sweep** renders 198 screens before every
release.

## 3.20.0

**The drop-down lists are the app's own now.** A `<select>` used to hand its
list to the operating system: a grey system menu, the system's font, the
system's highlight colour, dropped on top of a page it shares nothing with. It
is now drawn by the page - the same surface, the same rounded corners, the same
shadow as a dialog - and the three things a list of choices needs:

- **Groups with names.** Currencies come as *In use* first, then *Other
  currencies*; categories as *Expenses* and *Income*. The entry form no longer
  writes "(Expense)" after every single row to say the same thing one row at a
  time.
- **Columns that line up.** A currency row is flag, code, symbol in three
  aligned columns, so the codes start together instead of each one beginning
  wherever the flag before it ended. A category row is icon, then name.
- **A tick on the chosen row**, in the app's green, at the end of the row where
  a list of choices is read.

This uses `appearance: base-select`, which today only Chromium-based browsers
have. Nothing depends on it: where it is missing the browser draws its own list
exactly as before, and the option text there reads "🇪🇺 EUR €" and "🛒
Groceries", because the spaces between the parts are real text. `<optgroup>`
gives the group names in every browser either way.

## 3.19.0

**An entry can be in several categories.** One of them is the main one - it
decides whether the entry is money in or money out - and any number of others
are labels the whole amount also counts under. That is what makes "how much did
I spend on anything to do with the car" a question the app can answer.

Counting it that way means the per-category totals deliberately add up to more
than was spent: a hundred euro filed under both Groceries and Presents is a
hundred euro of groceries *and* a hundred euro of presents, and the two are not
meant to be summed. The shares say so by coming to more than 100%.

A pie chart cannot do that without lying, so the donut groups by the whole
**combination** instead: one block for "Daily + Groceries", another for
"Groceries" alone. Each block holds money that belongs to no other block, and
they come to exactly what was spent. The overall totals never double count.

Everything that asks about a category now asks about all of them: the filter,
the search, the entry count beside a category in the settings, and a category
limit, which covers anything filed under it. Moving entries out of a deleted
category replaces it wherever it appears. The export writes the names separated
by a bar and the importer reads them back, creating any it does not know.

Stored data gains `categoryIds` (`DATA_VERSION` 4). An entry written by an older
version has one category and becomes a list of one; nothing is lost, and a
document that was already broken is repaired exactly as it was before.

**The default currency is first** in every list of currencies - the table in the
settings, the pickers in the forms and the filters. The stored order is left
alone; this is only how the list is read.

**Today, this week, this month and this year** are one press each in the entry
filters, instead of only "this month".

**Export and import → Export data**, with what it exports said underneath
rather than in the heading.

## 3.18.0

**All nine findings of the visual sweep, fixed.** `docs/visual-review.md` has
the report and now what was done about each one. The two that mattered:

**A single category made the donut chart draw nothing.** An arc whose two ends
are the same point draws nothing at all - that is what the format says to do
with it - and a slice covering the whole circle is exactly that arc. The state
of every installation after its first entry, so the most ordinary screen there
is showed a legend beside an empty space. A full turn is now two arcs out and
two back, and a unit test fails if it ever collapses again.

**One row that would not fit took every dialog on the phone down with it.** The
figure in a budget row could not wrap, so in Russian and German it ran out of
its card; the layout viewport grew to hold it; and `.dialog`, sized from
`100vw`, then measured itself against that wider viewport and put its Close and
Add buttons off the screen. Three separate things were widening the page and all
three had one cause: a `1fr` grid track is never narrower than its item's
min-content width unless the item is told it may shrink. `min-width: 0` on grid
items is the line that was missing. A new check renders every tab in all three
languages at 390 pixels, with a long category name and an amount at the ceiling,
and fails if anything makes the page wider than the phone.

The rest: buttons in a dialog wrap instead of overflowing it; a figure at the
allowed maximum gets smaller type instead of leaving its card, and a budget
blown past a thousand percent says `999+%`; the chart toggles and the Share
control are targets a finger can find; the small grey badge measures 5.06
against the card rather than 4.36; and one sentence replaces the two that both
said a file cannot install or update itself.

Two localisation bugs went with them, both from one `toLowerCase()` - an English
habit applied to every language. "за неделя" needed the accusative and German
does not lower-case its nouns. The phrase is now one key per period, written out
in each language.

The sweep itself learned two more things: a control inside a `<label>` is hit by
the whole label, and text longer than a text field is how a text field works.

## 3.17.0

**A visual sweep, and a report of what it found.** `npm run sweep` renders every
screen and every dialog in every language, theme and layout over five shapes of
data - empty, ordinary, long names, amounts at the allowed maximum, many
currencies at once - and measures the things nobody can check 198 times by eye:
a control past the edge of the screen, two controls on top of each other, words
outside the box holding them, a target too small for a finger, text too pale to
read against what is behind it. Every screen it flags is kept as a screenshot.

`docs/visual-review.md` is the read-through of those flags. Nine findings
survived it, none of them fixed in this release - the worst is that a single
category makes the donut chart draw nothing at all, and the one with the longest
reach is a budget row that does not fit its card, drags the whole page wider
than the phone, and takes every dialog on that page off the screen with it.

Two things the tool itself had to learn before its output could be trusted:
Chrome reports real rectangles for a collapsed `<details>` and for rows scrolled
out of a clipping box, and on a phone the visual viewport widens to fit content
that does not fit, so the obvious test for a page overflowing never fires.

## 3.16.0

**The workflows moved to Node 24, runtime and scripts both.** GitHub removed
Node 20 from its runners on 23 September 2026; actions still pinned to it warned
first and then stop working. These are two separate settings and both had to
move: the runtime the actions themselves run on, and the Node this project's own
scripts are given.

| action | was | now |
|---|---|---|
| `actions/checkout` | v4 | v7 |
| `actions/setup-node` | v4 | v7 |
| `actions/upload-pages-artifact` | v3 | v5 |
| `actions/deploy-pages` | v4 | v5 |
| `softprops/action-gh-release` | v2 | v3 |

`node-version` is now `24`. `package.json` declares `engines: { node: ">=22" }`,
because 22 is what the project is developed against and nothing here needs
anything newer - the workflows simply run the version the runners are on.

## 3.15.0

**A message no longer moves the page under the hand that caused it.** The
confirmation line sat between the top bar and the content, so pressing Add on
the home screen pushed the quick form 53 pixels down - out from under the finger
that had just pressed it, and with the cursor still in the amount field - and
pulled it back up four seconds later when the message expired.

The message is now written after the page rather than before it, and taken out
of the flow: it sits at the foot of the window, below whatever produced it, so
nothing moves when it arrives or when it goes. It also carries `role="status"`,
which is what makes a screen reader read it out.

A new check measures the quick form and the figures beneath it before a message,
while it is shown and after it expires, and fails if any of the three differ.
Putting the message back where it was makes it fail with the 53 pixels in the
detail line.

## 3.14.0

**Settings → About → Update the app.** The page asks to be cached for a year and
the service worker answers from its own copy first, which is right every day and
wrong the one moment somebody wants to know whether a new version is published.
The button asks the server, past both of them.

- The fetch uses `cache: 'reload'`, which goes around the browser's HTTP cache.
- The service worker now lets a `reload` request through untouched instead of
  answering it from its cache - serving it would be exactly what the request
  said not to do.
- The version is read from the meta tag the build stamps into the page, not from
  the bytes differing, so a rebuilt but unchanged release does not announce
  itself as an update. If it matches, the app says so and nothing happens.
- If it does not match, every cache is emptied and the worker re-checked before
  the reload, so what comes back cannot be the old app from either cache.

**The service worker no longer caches stale bytes on install.** `cache.addAll()`
goes through the browser's HTTP cache, so a brand new release could fill its
brand new cache with last year's page and be none the wiser. Each asset is
fetched with `cache: 'reload'` instead.

A file opened from disk has no server to ask, so there the row says so rather
than offering a button that could only fail.

The site check drives all of it: it counts the requests the server really
receives - a button answering from a cache looks identical from inside the page -
then publishes a different version for a moment and asserts that it is found,
that the caches are emptied, and that the reload is reached. It then puts the
worker back and still proves the app opens with the network switched off.

## 3.13.0

**The interface was measured in one language and broke in the other two.** Every
fault below was there in Russian and German while the checks, which ran in
English only, said the layout was fine.

- **Controls lay on top of each other.** A `<select>` is as wide as its widest
  option and refuses to shrink below it, so "Все категории ☕ Ежедневные" reached
  45 pixels across the search box in the cell beside it. `min-width: 0` is what
  lets a grid item shrink to its cell; controls in a row of fields now also fill
  that cell, so the row looks deliberate rather than ragged.
- **Words fell out of their buttons.** Buttons standing beside form controls had
  an exact height, which looked right in English: "В этом месяце" wrapped to two
  lines inside a 40 pixel box and printed the second one over the card, and
  "Сбросить" was pushed off the screen entirely. A button is now never *shorter*
  than the controls beside it and never taller than its own words, and two
  buttons sharing a cell take a line each when they do not fit side by side.
- **The name and the tabs no longer share the top bar unevenly.** "Домашний
  бюджет" wrapped, doubling the height of a sticky bar on every screen, and
  "Haushaltsbudget" ran seven pixels past the right edge. The tab icons give
  back the padding they do not need, and all three languages fit one line.
- **The import button spoke the browser's language, not the app's.** A bare
  `<input type="file">` draws the browser's own control, so "Choose File / No
  file chosen" sat in English in the middle of a Russian page. All three file
  choosers in the app now share one helper, carry the app's own word, and clear
  themselves afterwards - which also fixes picking the same file twice in a row,
  where `change` never fired because the value had not changed.

The alignment check now runs **in all three languages** at both widths, and looks
for two things it never did: a control overlapping its neighbour, and text
spilling outside the box that holds it. Reverting each fix makes it fail, and it
named faults in English too that nobody had noticed - "Add currency" had been
spilling all along.

## 3.12.0

**A deploy no longer installs a browser or touches the kernel.** Both workflows
used to download Chrome when the runner had none and then turn off Ubuntu's
restriction on unprivileged user namespaces with `sudo sysctl`. Neither step is
needed: GitHub's hosted images already ship Chrome, and the sandbox flags the
checks pass (`--no-sandbox`, `--disable-setuid-sandbox`) are what made the
namespace setting irrelevant in the first place - it was belt and braces that
reached for root on a machine the project does not own. The checks themselves
stay; `tools/cdp.mjs` finds the browser, and says plainly when there is none, so
a self-hosted runner without one fails with a sentence rather than a mystery. A
runner that needs Chrome should have it in its own image.

**A pull request now describes only the difference from the release it
replaces.** This file is that description: `create-pr.sh` reads
`src/core/version.js` in the clone it is pointed at and takes the sections above
that version, so a repository on 3.9.0 gets 3.10 through 3.12 and a repository on
3.0.0 gets everything - without anyone editing the script. A clone that is
already current gets no pull request at all.

## 3.11.0

**The default currency follows the interface language.** A fresh app opened in
Russian started in euro, and the only way out was the settings. The locale now
picks the starting currency, with the *region* deciding where it disagrees with
the language:

| locale | currency |
|---|---|
| `ru-RU`, `ru` | RUB |
| `de-DE`, `de` | EUR |
| `de-CH` | CHF |
| `en-GB` | GBP |
| `en-IN` | INR |
| `en-US`, `en` | USD |

It follows a language chosen by hand as well, and says so in the message line
when it does.

Where it stops is the part that matters: the currency is left alone from the
moment the person picks one themselves, **or** records their first entry,
whichever comes first - a figure already written down must never change meaning
underneath it. A `currencyChosen` flag carries that, and a stored state without
it counts as chosen, so nothing moves under an existing installation. A currency
the app does not have is never returned, so someone who deleted the franc gets
the euro rather than a broken setting.

The browser checks now pin the currency at the top of the run. They had been
quietly depending on the app starting in euro - fine on a laptop, a failure on a
runner in another locale, which is the worst kind.

## 3.10.0

**The cards on the home screen pace their period from the inside.** *This month*
used to read `avg 1 901.82 € / month` - the average month over the whole history,
on a card that is about *this* month; with less than a year of data the year card
just repeated its own total.

| card | before | now |
|---|---|---|
| Today | `avg 66.57 € / day` | unchanged - a day has nothing finer to divide by |
| This week | `avg 459.06 € / week` | `avg 110.20 € / day this week` |
| This month | `avg 1 901.82 € / month` | `avg 414.71 € / week this month` |
| This year | `avg 13 312.73 € / year` | `avg 1 973.37 € / month this year` |

The divisor is **elapsed** sub-periods, not the ones that happen to have entries:
a day on which nothing was spent is still a day that passed, and dividing by the
days with entries would turn a quiet week into a high daily rate. A month counts
the calendar weeks its elapsed days fall in, so the week that crosses the first
of the month counts once, for the month being looked at.

The statistics table keeps the other average - per whole period, over the periods
that have entries - because that is the one that answers what a typical week
costs. Its hint now says which is which.

## 3.9.0

**The settings were unusable on a phone.** The narrow layout hid `.row-actions`
outright, which left no way at all to edit or delete a category, a currency or an
entry from a phone, and the tables ran past the right edge on top of it. The
columns that carry the least are dropped instead, the actions stay as a sign with
a 34 pixel target and the word as its accessible name, and in the entry list -
where tapping the row already opens the editor - only the delete sign remains.

**A row of fields is a grid now.** "Category for quick entries" wraps to two
lines on a phone and almost every German label wraps somewhere; a wrapping label
used to grow only its own field and push its control below the control beside it.
Every field is three rows - label, control, hint - and a row of fields shares
those rows through `subgrid`, so the tallest label sets the height for all of
them. Where `subgrid` is missing the label reserves two lines and keeps the same
promise. The alignment check runs at a desktop width **and at 390 pixels**.

**The Share button no longer moves.** It was a bordered box among plain text
links, and the install row above it changed height the moment the browser offered
an installation, shoving everything below it down the page.

**Two renames:** *Delete all entries* → **Delete all data**, *Reset everything* →
**Reset to default**, in all three languages, with the confirmations and the hint
reworded so they still say exactly what each one removes.

**Add with details** on the home screen opens the same dialog the Entries tab
uses, for an entry whose category, date, currency or note is not the usual one.

A new test scans the error map in `app.js` against the messages the core throws:
they are matched by exact English text, so rewording one would silently drop it
back to English in every language.

## 3.8.0

**The interface matches its icon.** The accent, the income colour, the focus
ring, `theme-color`, the manifest's `theme_color` and the browser's own
checkboxes all derive from a single `--green`. The coin in the header carries the
symbol of the currency the figures are shown in - it used to be a euro sign
whatever you were counting in. The `apple-touch-icon` is a real 180x180 PNG,
because an inline SVG is the one thing iOS will not read for a home screen icon.
Category colours are left varied: they are data, and need to stay far apart on a
chart.

## 3.7.0

The README opens with a GIF of the app being used, recorded by
`tools/make-demo.mjs` and written by `tools/gif.mjs` - popularity based colour
quantisation and the format's own LZW, no dependency. **Settings → About →
Share** draws the app's address as a QR code, offline; the encoder moved into
`src/core/qr.js` so the app and the build share it. The link to the repository
reads *Source on GitHub*.

## 3.6.0, 3.6.1

**Settings → About** has an *Install as an app* button. The browser's own banner
is cancelled, so the dialog opens on the press and only then, and the offer is
used once. The button appears only where it can work; iOS shows the manual route
instead, and a file opened from disk says installation needs the published page.

A new icon: a gold coin on green instead of the indigo house, with the euro sign
drawn as geometry so it does not depend on a font, and legible at 16 pixels.

## 3.5.0

The app links to itself. **Settings → About** offers *Open the web app* and
*Source code*; both addresses live in `src/core/version.js` next to the version,
feed the build banner - which used to carry a bare `https://github.com/` - and
become the site's `canonical` and `og:url`. The README opens with the same links,
a Pages badge and a QR code generated by `tools/make-qr.mjs`: byte mode,
Reed-Solomon over GF(256), the mask chosen by the penalty rules of the
specification, no dependency. Every version and correction level it can produce
was verified by decoding the result with an independent reader, which is how two
real bugs in the format information layout were found - one of them writing over
the timing pattern.

**The browser checks could not run in CI.** `tools/cdp.mjs` had Chromium's path
hard coded to what it happens to be in one container, so every run failed with
`spawn ... ENOENT`, and the failed spawn had no error handler, so it ended in a
stack trace rather than a sentence. It now looks for `CHROME_PATH`, then
`google-chrome` / `chromium` / `chromium-browser` in the usual places, then a
Chromium downloaded by Playwright with its version globbed rather than pinned. A
browser that is found but will not start carries its own output with the error,
both headless spellings are tried, and the wait is 30 seconds
(`CHROME_TIMEOUT_MS` to change it).

## 3.4.0

**The date field is the app's own.** `<input type="date">` displays the format of
the browser's language setting alone - not the page, not `lang`, not the chosen
interface language - so a browser set to American English showed `09/23/2026` in
an otherwise Russian app. Dates are now typed and shown as `23.09.2026`
everywhere, and the button still opens the browser's native calendar, which is
what makes it usable on a phone. An unreadable date is refused instead of
quietly becoming today.

## 3.3.0

Amounts have limits, and the limits are honest. There was no upper bound, so
`1e300` was accepted and destroyed every total; `1e15` silently became `115.00`
because the cleanup ate its exponent; and `0.001` was refused with "Amount cannot
be zero", which is not what happened. All three are fixed, with messages that say
which. The entry list draws one page at a time - 1507 ms to 12 ms at 30 000
entries - while the summary, the exports and the statistics still cover every
matching entry.

## 3.2.0, 3.2.1

Form controls stop jumping: every control in a row is one height, every label
one height, and a hint under one field no longer moves the field beside it. The
regression check groups fields into visual lines and was proven to fail on the
layout it replaced. The three Nordic crowns get symbols of their own - `Skr`,
`Nkr`, `Dkr` - so an amount always says which currency it is in. The category
column reads *Limit* rather than *Monthly limit*, since a limit has its own
period. *Delete all entries* and *Reset everything* are separated, and the
settings spell out the difference.

## 3.1.0

**The PDF writes any language.** It used to fall back to a built-in font with no
Cyrillic, so a Russian export came out as `?????`. It now embeds a subset of
DejaVu Sans - CIDFontType2, Identity-H, `/ToUnicode` for copy and search - built
by `tools/make-font.mjs`, a TrueType subsetter written for this project. The
ruble joins the currencies, every currency has its flag, the page asks to be
cached forever and carries the metadata that makes it installable, and the build
also writes `home-budget.html` under a name that never changes, so a link can
always point at the latest build.
