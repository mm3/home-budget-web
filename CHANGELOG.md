# Changelog

Newest first. The pull-request script reads this file: a pull request describes
only the versions above the one the target repository is on, so the description
is always the difference from the release being replaced.

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
