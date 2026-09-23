/** Home screen: quick add, key figures, charts and the latest entries. */

import { barChart, donutChart } from '../../core/charts.js';
import { formatDate, formatMoney, PERIODS } from '../../core/format.js';
import { byCategory, ofCurrency, overview, series } from '../../core/stats.js';
import { el, field, options } from '../dom.js';

const PERIOD_TITLES = { day: 'Today', week: 'This week', month: 'This month', year: 'This year' };
const CHART_LENGTH = { day: 14, week: 12, month: 12, year: 5 };

export function homeView(app) {
  const store = app.store;
  const currencyCode = app.viewCurrency();
  const currency = store.currency(currencyCode);
  const entries = ofCurrency(store.entries, currencyCode);
  const today = store.today();
  const summaries = overview(entries, store.categories, today);
  const period = app.ui.homePeriod;
  const points = series(entries, store.categories, period, CHART_LENGTH[period], today);
  const breakdown = byCategory(entries, store.categories);
  const recent = store.list({ currency: currencyCode }).slice(0, 8);

  return [
    quickAddCard(app, currency),
    el('section.cards', {}, summaries.map((summary) => statCard(summary, currency))),
    el('section.grid', {}, [
      el('article.card', {}, [
        el('header.card-head', {}, [
          el('h2', { text: 'Spending over time' }),
          el('div.segmented', {}, PERIODS.map((item) => el('button', {
            type: 'button',
            class: item === period ? 'active' : '',
            text: item === 'day' ? 'Days' : `${item[0].toUpperCase()}${item.slice(1)}s`,
            on: { click: () => app.setUi({ homePeriod: item }) },
          }))),
        ]),
        el('div.chart-box', {
          html: barChart(points, {
            formatValue: (value) => formatMoney(value, currency),
            showIncome: app.ui.showIncome,
          }),
        }),
        el('p.legend', {}, [
          el('span.key.expense', { text: 'Expenses' }),
          app.ui.showIncome ? el('span.key.income', { text: 'Income' }) : null,
          incomeToggle(app),
        ]),
      ]),
      el('article.card', {}, [
        el('header.card-head', {}, [el('h2', { text: 'By category' })]),
        el('div.donut-box', {}, [
          el('div', { html: donutChart(breakdown) }),
          el('ul.legend-list', {}, breakdown.slice(0, 6).map((item) => el('li', {}, [
            el('span.dot', { style: `background:${item.color}` }),
            el('span.legend-name', { text: item.name }),
            el('span.legend-value', { text: `${formatMoney(item.amount, currency)} · ${item.share}%` }),
          ]))),
        ]),
        breakdown.length ? null : el('p.muted', { text: 'No expenses yet.' }),
      ]),
    ]),
    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: 'Latest entries' }),
        el('button.link', { type: 'button', text: 'All entries', on: { click: () => app.setTab('entries') } }),
      ]),
      recent.length
        ? el('ul.entry-list', {}, recent.map((entry) => entryRow(app, entry, currency)))
        : el('p.muted', { text: 'Nothing here yet - add your first amount above.' }),
    ]),
  ];
}

function quickAddCard(app, currency) {
  const input = el('input.quick-input', {
    type: 'number', step: '0.01', min: '0', inputmode: 'decimal',
    placeholder: '0.00', 'aria-label': 'Amount', id: 'quick-amount',
  });
  const submit = (event) => {
    event.preventDefault();
    try {
      // the store re-renders the page, so the confirmation goes to the shared message line
      const entry = app.store.quickAdd(input.value);
      app.notify(`Added ${formatMoney(entry.amount, currency)} to ${app.store.category(entry.categoryId).name}`);
    } catch (error) {
      app.notify(error.message, 'error');
    }
  };
  const form = el('form.quick-form', { on: { submit } }, [
    el('div.quick-input-wrap', {}, [input, el('span.quick-currency', { text: currency.symbol })]),
    el('button.primary', { type: 'submit', text: 'Add' }),
  ]);
  // keep the cursor in the amount field after the page re-renders
  setTimeout(() => { if (app.ui.tab === 'home' && app.focusQuickInput) input.focus(); }, 0);
  return el('section.card.quick-card', {}, [
    el('header.card-head', {}, [
      el('h2', { text: `Add to ${app.store.category(app.store.settings.defaultCategoryId).name}` }),
      currencySelector(app),
    ]),
    form,
    el('p.quick-hint.muted', { text: 'Type an amount and press Add - date, category and currency are filled in for you.' }),
  ]);
}

/** Income is usually much larger than a day's spending, so it is hidden by default. */
function incomeToggle(app) {
  return el('label.toggle', {}, [
    el('input', {
      type: 'checkbox', checked: app.ui.showIncome,
      on: { change: (event) => app.setUi({ showIncome: event.target.checked }) },
    }),
    'show income',
  ]);
}

function currencySelector(app) {
  const used = app.store.usedCurrencies();
  if (used.length < 2) return null;
  return field('Currency', el('select', {
    on: { change: (event) => app.setUi({ currency: event.target.value }) },
  }, options(used.map((code) => ({ value: code, label: code })), app.viewCurrency())));
}

function statCard(summary, currency) {
  const average = summary.averageExpense;
  return el('article.card.stat', {}, [
    el('span.stat-title', { text: PERIOD_TITLES[summary.period] }),
    el('strong.stat-value', { text: formatMoney(summary.current.expense, currency) }),
    el('span.stat-sub', { text: `avg ${formatMoney(average, currency)} / ${summary.period}` }),
    summary.current.income
      ? el('span.stat-sub.income', { text: `+${formatMoney(summary.current.income, currency, { symbol: false })} income` })
      : null,
  ]);
}

function entryRow(app, entry, currency) {
  const category = app.store.category(entry.categoryId);
  return el('li.entry', { on: { click: () => app.editEntry(entry.id) } }, [
    el('span.dot', { style: `background:${category.color}` }),
    el('span.entry-main', {}, [
      el('span.entry-title', { text: entry.note || category.name }),
      el('span.entry-sub', { text: `${formatDate(entry.date)} · ${category.name}` }),
    ]),
    el('span', {
      class: `entry-amount ${category.kind === 'income' ? 'income' : 'expense'}`,
      text: formatMoney(category.kind === 'income' ? entry.amount : -entry.amount, currency, { sign: true }),
    }),
  ]);
}
