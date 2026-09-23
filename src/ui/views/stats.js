/** Statistics screen: sums and averages per day, week, month and year. */

import { formatDate, formatMoney, PERIODS } from '../../core/format.js';
import { byCategory, highlights, overview, series } from '../../core/stats.js';
import { el, field, options } from '../dom.js';
import { chartLegend, chartMarkup } from './home.js';

const LENGTHS = { day: 30, week: 16, month: 12, year: 6 };

export function statsView(app) {
  const store = app.store;
  const t = app.t;
  const code = app.viewCurrency();
  const currency = store.currency(code);
  const entries = store.entriesIn(code);
  const today = store.today();
  const summaries = overview(entries, store.categories, today, app.periodTexts());
  const period = app.ui.statsPeriod;
  const points = series(entries, store.categories, period, LENGTHS[period], today, app.periodTexts());
  const facts = highlights(entries, store.categories);
  const breakdown = byCategory(entries, store.categories);
  const used = store.usedCurrencies();

  return [
    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: t('stats.sums') }),
        used.length > 1 && !store.settings.convertToDefault ? field(t('common.currency'), el('select', {
          on: { change: (event) => app.setUi({ currency: event.target.value }) },
        }, options(used.map((item) => ({ value: item, label: item })), code))) : null,
      ]),
      el('div.table-wrap', {}, el('table.stats-table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: t('stats.periodColumn') }),
          el('th.num', { text: t('stats.current') }),
          el('th.num', { text: t('stats.averageColumn') }),
          el('th.num', { text: t('stats.total') }),
          el('th.num', { text: t('stats.periods') }),
        ])),
        el('tbody', {}, summaries.map((summary) => el('tr', {}, [
          el('td', {}, [
            el('strong', { text: t(`period.${summary.period}`) }),
            el('span.muted.block', { text: summary.label }),
          ]),
          el('td.num', { text: formatMoney(summary.current.expense, currency) }),
          el('td.num', { text: formatMoney(summary.averageExpense, currency) }),
          el('td.num', { text: formatMoney(summary.totalExpense, currency) }),
          el('td.num', { text: String(summary.periodsWithData) }),
        ]))),
      ])),
      el('p.muted', { text: t('stats.averagesHint') }),
    ]),
    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: t('stats.history') }),
        el('div.segmented', {}, PERIODS.map((item) => el('button', {
          type: 'button',
          class: item === period ? 'active' : '',
          text: t(`period.${item}s`),
          on: { click: () => app.setUi({ statsPeriod: item }) },
        }))),
      ]),
      el('div.chart-box.tall', { html: chartMarkup(app, points, currency) }),
      chartLegend(app, points),
    ]),
    el('section.grid', {}, [
      el('article.card', {}, [
        el('header.card-head', {}, [el('h2', { text: t('stats.categories') })]),
        breakdown.length ? el('ul.bar-list', {}, breakdown.map((item) => el('li', {}, [
          el('div.bar-head', {}, [
            el('span', {}, [
              el('span.category-icon', { text: store.category(item.id).icon }),
              app.categoryName(store.category(item.id)),
            ]),
            el('span.num', { text: `${formatMoney(item.amount, currency)} · ${item.share}%` }),
          ]),
          el('div.track', {}, el('div.fill', { style: `width:${item.share}%;background:${item.color}` })),
        ]))) : el('p.muted', { text: t('home.noExpenses') }),
      ]),
      el('article.card', {}, [
        el('header.card-head', {}, [el('h2', { text: t('stats.highlights') })]),
        el('ul.facts', {}, [
          el('li', { text: t('stats.daysWithSpending', { count: facts.daysWithSpending }) }),
          facts.largest ? el('li', {
            text: t('stats.largest', {
              amount: formatMoney(facts.largest.amount, currency),
              date: formatDate(facts.largest.date),
            }),
          }) : null,
          facts.busiestDay ? el('li', {
            text: t('stats.busiest', {
              amount: formatMoney(facts.busiestDay.amount, currency),
              date: formatDate(facts.busiestDay.date),
            }),
          }) : null,
          el('li', { text: t('stats.entryCount', { count: entries.length }) }),
        ]),
      ]),
    ]),
  ];
}
