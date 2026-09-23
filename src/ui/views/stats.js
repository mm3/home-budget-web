/** Statistics screen: sums and averages per day, week, month and year. */

import { barChart } from '../../core/charts.js';
import { formatDate, formatMoney, PERIODS } from '../../core/format.js';
import { highlights, ofCurrency, overview, series } from '../../core/stats.js';
import { byCategory } from '../../core/stats.js';
import { el, options, field } from '../dom.js';

const LENGTHS = { day: 30, week: 16, month: 12, year: 6 };
const TITLES = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' };

export function statsView(app) {
  const store = app.store;
  const code = app.viewCurrency();
  const currency = store.currency(code);
  const entries = ofCurrency(store.entries, code);
  const today = store.today();
  const summaries = overview(entries, store.categories, today);
  const period = app.ui.statsPeriod;
  const points = series(entries, store.categories, period, LENGTHS[period], today);
  const facts = highlights(entries, store.categories);
  const breakdown = byCategory(entries, store.categories);
  const used = store.usedCurrencies();

  return [
    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: 'Sums and averages' }),
        used.length > 1 ? field('Currency', el('select', {
          on: { change: (event) => app.setUi({ currency: event.target.value }) },
        }, options(used.map((item) => ({ value: item, label: item })), code))) : null,
      ]),
      el('div.table-wrap', {}, el('table.stats-table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Period' }), el('th', { text: 'Current' }), el('th', { text: 'Average' }),
          el('th', { text: 'Total' }), el('th', { text: 'Periods' }),
        ])),
        el('tbody', {}, summaries.map((summary) => el('tr', {}, [
          el('td', {}, [el('strong', { text: TITLES[summary.period] }), el('span.muted.block', { text: summary.label })]),
          el('td.num', { text: formatMoney(summary.current.expense, currency) }),
          el('td.num', { text: formatMoney(summary.averageExpense, currency) }),
          el('td.num', { text: formatMoney(summary.totalExpense, currency) }),
          el('td.num', { text: String(summary.periodsWithData) }),
        ]))),
      ])),
      el('p.muted', { text: 'Averages count only the periods that have entries.' }),
    ]),
    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: 'History' }),
        el('div.segmented', {}, PERIODS.map((item) => el('button', {
          type: 'button',
          class: item === period ? 'active' : '',
          text: `${TITLES[item]}s`,
          on: { click: () => app.setUi({ statsPeriod: item }) },
        }))),
      ]),
      el('div.chart-box.tall', {
        html: barChart(points, {
          formatValue: (value) => formatMoney(value, currency),
          showIncome: app.ui.showIncome,
        }),
      }),
      el('p.legend', {}, [
        el('span.key.expense', { text: 'Expenses' }),
        app.ui.showIncome ? el('span.key.income', { text: 'Income' }) : null,
        el('label.toggle', {}, [
          el('input', {
            type: 'checkbox', checked: app.ui.showIncome,
            on: { change: (event) => app.setUi({ showIncome: event.target.checked }) },
          }),
          'show income',
        ]),
      ]),
    ]),
    el('section.grid', {}, [
      el('article.card', {}, [
        el('header.card-head', {}, [el('h2', { text: 'Categories' })]),
        breakdown.length ? el('ul.bar-list', {}, breakdown.map((item) => el('li', {}, [
          el('div.bar-head', {}, [
            el('span', {}, [el('span.dot', { style: `background:${item.color}` }), item.name]),
            el('span.num', { text: `${formatMoney(item.amount, currency)} · ${item.share}%` }),
          ]),
          el('div.track', {}, el('div.fill', { style: `width:${item.share}%;background:${item.color}` })),
        ]))) : el('p.muted', { text: 'No expenses yet.' }),
      ]),
      el('article.card', {}, [
        el('header.card-head', {}, [el('h2', { text: 'Highlights' })]),
        el('ul.facts', {}, [
          el('li', { text: `Days with spending: ${facts.daysWithSpending}` }),
          facts.largest ? el('li', {
            text: `Largest single expense: ${formatMoney(facts.largest.amount, currency)} on ${formatDate(facts.largest.date)}`,
          }) : null,
          facts.busiestDay ? el('li', {
            text: `Most spent in one day: ${formatMoney(facts.busiestDay.amount, currency)} on ${formatDate(facts.busiestDay.date)}`,
          }) : null,
          el('li', { text: `Entries: ${entries.length}` }),
        ]),
      ]),
    ]),
  ];
}
