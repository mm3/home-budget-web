/** Home screen: quick add, key figures, budgets, charts and the latest entries. */

import { barChart, donutChart } from '../../core/charts.js';
import { MAX_AMOUNT } from '../../core/model.js';
import { formatDate, formatMoney, PERIODS } from '../../core/format.js';
import { byCategory, overview, series } from '../../core/stats.js';
import { el, field, options } from '../dom.js';

const PERIOD_TITLES = {
  day: 'period.today', week: 'period.thisWeek', month: 'period.thisMonth', year: 'period.thisYear',
};
// What each card says under its figure. The week, the month and the year show
// the pace inside the period now running - a week by its days, a month by its
// weeks, a year by its months - because that is the number that says whether
// the period is going well. A day has nothing finer to divide by, so that card
// keeps the long-run average instead: what a day of yours usually costs.
const RATE_TEXTS = { week: 'home.rateDay', month: 'home.rateWeek', year: 'home.rateMonth' };
const CHART_LENGTH = { day: 14, week: 12, month: 12, year: 5 };

export function homeView(app) {
  const store = app.store;
  const t = app.t;
  const currencyCode = app.viewCurrency();
  const currency = store.currency(currencyCode);
  const entries = store.entriesIn(currencyCode);
  const today = store.today();
  const summaries = overview(entries, store.categories, today, app.periodTexts());
  const period = app.ui.homePeriod;
  const points = series(entries, store.categories, period, CHART_LENGTH[period], today, app.periodTexts());
  const breakdown = byCategory(entries, store.categories);
  const recent = (store.settings.convertToDefault ? store.list() : store.list({ currency: currencyCode })).slice(0, 8);
  const budgets = store.budgets(currencyCode, today);

  return [
    quickAddCard(app, currency),
    store.settings.convertToDefault && store.usedCurrencies().length > 1
      ? el('p.muted.converted-note', { text: t('home.converted', { currency: currency.code }) })
      : null,
    el('section.cards', {}, summaries.map((summary) => statCard(app, summary, currency))),
    el('section.grid', {}, [
      el('article.card', {}, [
        el('header.card-head', {}, [
          el('h2', { text: t('home.spendingOverTime') }),
          el('div.segmented', {}, PERIODS.map((item) => el('button', {
            type: 'button',
            class: item === period ? 'active' : '',
            text: t(`period.${item}s`),
            on: { click: () => app.setUi({ homePeriod: item }) },
          }))),
        ]),
        el('div.chart-box', { html: chartMarkup(app, points, currency) }),
        chartLegend(app, points),
      ]),
      el('article.card', {}, [
        el('header.card-head', {}, [el('h2', { text: t('home.byCategory') })]),
        breakdown.length ? el('div.donut-box', {}, [
          el('div', { html: donutChart(breakdown) }),
          el('ul.legend-list', {}, breakdown.slice(0, 6).map((item) => el('li', {}, [
            el('span.legend-icon', { text: store.category(item.id).icon }),
            el('span.legend-name', { text: app.categoryName(store.category(item.id)) }),
            el('span.legend-value', { text: `${formatMoney(item.amount, currency)} · ${item.share}%` }),
          ]))),
        ]) : el('p.muted', { text: t('home.noExpenses') }),
      ]),
    ]),
    budgetCard(app, budgets, currency),
    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: t('home.latest') }),
        el('button.link', { type: 'button', text: t('home.allEntries'), on: { click: () => app.setTab('entries') } }),
      ]),
      recent.length
        ? el('ul.entry-list', {}, recent.map((entry) => entryRow(app, entry, currency)))
        : el('p.muted', { text: t('home.empty') }),
    ]),
  ];
}

/** Bar chart with the average of the periods that have spending. */
export function chartMarkup(app, points, currency) {
  const withSpending = points.filter((point) => point.expense > 0);
  const average = withSpending.length
    ? Math.round(withSpending.reduce((sum, point) => sum + point.expense, 0) / withSpending.length)
    : 0;
  return barChart(points, {
    formatValue: (value) => formatMoney(value, currency),
    showIncome: app.ui.showIncome,
    average: app.ui.showAverage ? average : null,
    averageLabel: app.t('home.average.label', { amount: formatMoney(average, currency) }),
  });
}

export function chartLegend(app, points) {
  const t = app.t;
  return el('p.legend', {}, [
    el('span.key.expense', { text: t('common.expenses') }),
    app.ui.showIncome ? el('span.key.income', { text: t('common.income') }) : null,
    toggle(app, 'showIncome', t('home.showIncome')),
    toggle(app, 'showAverage', t('home.showAverage')),
    points.length === 0 ? el('span', { text: '' }) : null,
  ]);
}

function toggle(app, key, label) {
  return el('label.toggle', {}, [
    el('input', {
      type: 'checkbox', checked: Boolean(app.ui[key]),
      on: { change: (event) => app.setUi({ [key]: event.target.checked }) },
    }),
    label,
  ]);
}

function quickAddCard(app, currency) {
  const t = app.t;
  const input = el('input.quick-input', {
    type: 'number', step: '0.01', min: '0', max: String(MAX_AMOUNT / 10 ** currency.decimals), inputmode: 'decimal',
    placeholder: '0.00', 'aria-label': t('common.amount'), id: 'quick-amount',
  });
  const submit = (event) => {
    event.preventDefault();
    try {
      // the store re-renders the page, so the confirmation goes to the shared message line
      const entry = app.store.quickAdd(input.value);
      app.notify(t('quick.added', {
        amount: formatMoney(entry.amount, currency),
        category: app.categoryName(app.store.category(entry.categoryId)),
      }));
    } catch (error) {
      app.notify(app.errorText(error), 'error');
    }
  };
  const form = el('form.quick-form', { on: { submit } }, [
    el('div.quick-input-wrap', {}, [input, el('span.quick-currency', { text: currency.symbol })]),
    el('button.primary', { type: 'submit', text: t('common.add') }),
  ]);
  // The quick form fills in the date, the category and the currency; this opens
  // the same dialog the Entries tab uses, for an entry that needs other ones.
  const detailed = el('div.quick-more', {}, [
    el('p.quick-hint.muted', { text: t('quick.hint') }),
    el('button', {
      type: 'button', text: t('quick.detailed'), title: t('quick.detailedHint'),
      on: { click: () => app.editEntry(null) },
    }),
  ]);
  // keep the cursor in the amount field after the page re-renders
  setTimeout(() => { if (app.ui.tab === 'home' && app.focusQuickInput) input.focus(); }, 0);

  const defaultCategory = app.store.category(app.store.settings.defaultCategoryId);
  return el('section.card.quick-card', {}, [
    el('header.card-head', {}, [
      el('h2', {}, [
        el('span.category-icon', { text: defaultCategory.icon }),
        t('quick.title', { category: app.categoryName(defaultCategory) }),
      ]),
      currencySelector(app),
    ]),
    form,
    detailed,
  ]);
}

function currencySelector(app) {
  const used = app.store.usedCurrencies();
  if (used.length < 2 || app.store.settings.convertToDefault) return null;
  return field(app.t('common.currency'), el('select', {
    on: { change: (event) => app.setUi({ currency: event.target.value }) },
  }, options(used.map((code) => ({ value: code, label: code })), app.viewCurrency())));
}

function statCard(app, summary, currency) {
  return el('article.card.stat', {}, [
    el('span.stat-title', { text: app.t(PERIOD_TITLES[summary.period]) }),
    el('strong.stat-value', { text: formatMoney(summary.current.expense, currency) }),
    el('span.stat-sub', {
      text: RATE_TEXTS[summary.period]
        ? app.t(RATE_TEXTS[summary.period], { amount: formatMoney(summary.rateExpense, currency) })
        : app.t('home.average', {
          amount: formatMoney(summary.averageExpense, currency),
          per: app.t('period.perDay'),
        }),
    }),
    summary.current.income
      ? el('span.stat-sub.income', {
        text: app.t('home.income', { amount: formatMoney(summary.current.income, currency, { symbol: false }) }),
      })
      : null,
  ]);
}

function budgetCard(app, budgets, currency) {
  const t = app.t;
  return el('section.card', {}, [
    el('header.card-head', {}, [
      el('h2', { text: t('home.budgets') }),
      el('button.link', { type: 'button', text: t('nav.settings'), on: { click: () => app.setTab('settings') } }),
    ]),
    budgets.length ? el('ul.bar-list', {}, budgets.map((budget) => el('li', {}, [
      el('div.bar-head', {}, [
        el('span', {}, [
          el('span.category-icon', { text: budget.category.icon }),
          app.categoryName(budget.category),
          budget.over ? el('span.badge.over', { text: `${budget.percent}%` })
            : el('span.badge', { text: `${budget.percent}%` }),
        ]),
        el('span.num', {
          class: budget.over ? 'expense' : '',
          text: `${t('home.budgetOf', {
            spent: formatMoney(budget.spent, currency),
            limit: formatMoney(budget.limit, currency),
          })} · ${t('home.budgetPeriod', { period: t(`period.${budget.period}`).toLowerCase() })}`,
        }),
      ]),
      el('div.track', {}, el('div', {
        class: `fill ${budget.over ? 'over' : ''}`,
        style: `width:${Math.min(budget.percent, 100)}%;background:${budget.over ? '' : budget.category.color}`,
      })),
      el('span.muted.small', {
        text: budget.over
          ? t('home.budgetOver', { amount: formatMoney(-budget.remaining, currency) })
          : t('home.budgetLeft', { amount: formatMoney(budget.remaining, currency) }),
      }),
    ]))) : el('p.muted', { text: t('home.budgetsHint') }),
  ]);
}

function entryRow(app, entry, currency) {
  const category = app.store.category(entry.categoryId);
  const shownCurrency = app.store.settings.convertToDefault ? currency : app.store.currency(entry.currency);
  const amount = app.store.settings.convertToDefault && entry.currency !== currency.code
    ? app.store.convert(entry.amount, entry.currency, currency.code)
    : entry.amount;
  return el('li.entry', { on: { click: () => app.editEntry(entry.id) } }, [
    el('span.category-icon', { text: category.icon }),
    el('span.entry-main', {}, [
      el('span.entry-title', { text: entry.note || app.categoryName(category) }),
      el('span.entry-sub', {
        text: `${formatDate(entry.date)} · ${app.categoryName(category)}`
          + (app.store.settings.convertToDefault && entry.currency !== currency.code ? ` · ${entry.currency}` : ''),
      }),
    ]),
    el('span', {
      class: `entry-amount ${category.kind === 'income' ? 'income' : 'expense'}`,
      text: formatMoney(category.kind === 'income' ? amount : -amount, shownCurrency, { sign: true }),
    }),
  ]);
}
