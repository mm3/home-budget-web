/** Entries screen: filters, the list itself, and the export / import panel. */

import { formatDate, formatMoney, periodStart, PERIODS, todayIso } from '../../core/format.js';
import { AppError, MAX_AMOUNT } from '../../core/model.js';
import { totals } from '../../core/stats.js';
import { actionButton, dateField, el, field, fieldSlot, options, render } from '../dom.js';
import { transferPanel } from '../transfer.js';

// Today, this week, this month, this year - the four spans the rest of the app
// already thinks in, offered as one press each.
const PERIOD_TITLES = {
  day: 'period.today', week: 'period.thisWeek', month: 'period.thisMonth', year: 'period.thisYear',
};

/** Entries drawn before the list asks whether to show more. */
export const PAGE_SIZE = 200;

export function entriesView(app) {
  const store = app.store;
  const t = app.t;
  const filter = app.ui.filter;
  const entries = store.list(filter);
  const currency = store.currency(app.viewCurrency());
  const sums = totals(entries, store.categories);
  // The summary, the exports and the statistics always cover every matching entry;
  // only the table itself is cut, because drawing it is what costs the time.
  const shown = entries.slice(0, app.ui.shownEntries);
  const hidden = entries.length - shown.length;

  const categoryOptions = [{ value: '', label: t('entries.allCategories') },
    ...store.categories.map((category) => ({
      value: category.id, label: `${category.icon} ${app.categoryName(category)}`,
    }))];
  const currencyOptions = [{ value: '', label: t('entries.allCurrencies') },
    ...store.currenciesByDefault().map((item) => ({ value: item.code, label: `${item.flag || ''} ${item.code}`.trim() }))];

  const update = (changes) => app.setUi({ filter: { ...filter, ...changes } });

  return [
    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: t('entries.title') }),
        el('button.primary', { type: 'button', text: t('entries.add'), on: { click: () => app.editEntry(null) } }),
      ]),
      el('details.filters-box', { open: app.isDesktop() }, [
        el('summary', { text: t('entries.filters') }),
        el('div.filters', {}, [
          field(t('entries.from'), dateField({
            value: filter.from || '', t, clearable: true, onChange: (iso) => update({ from: iso }),
          })),
          field(t('entries.to'), dateField({
            value: filter.to || '', t, clearable: true, onChange: (iso) => update({ to: iso }),
          })),
          field(t('common.category'), el('select', {
            on: { change: (event) => update({ categoryId: event.target.value }) },
          }, options(categoryOptions, filter.categoryId || ''))),
          field(t('common.currency'), el('select', {
            on: { change: (event) => update({ currency: event.target.value }) },
          }, options(currencyOptions, filter.currency || ''))),
          field(t('entries.search'), el('input', {
            type: 'search', value: filter.text || '', placeholder: t('entries.searchHint'),
            on: { input: (event) => update({ text: event.target.value }) },
          })),
          fieldSlot(el('div.filter-buttons', {}, [
            ...PERIODS.map((period) => el('button', {
              type: 'button',
              text: t(PERIOD_TITLES[period]),
              on: { click: () => update({ from: periodStart(store.today(), period), to: store.today() }) },
            })),
            el('button', { type: 'button', text: t('common.clear'), on: { click: () => app.setUi({ filter: {} }) } }),
          ])),
        ]),
      ]),
      el('p.summary', {}, [
        el('span', { text: app.countText(entries.length) }),
        el('span.expense', { text: `${t('common.expenses')} ${formatMoney(sums.expense, currency)}` }),
        sums.income ? el('span.income', { text: `${t('common.income')} ${formatMoney(sums.income, currency)}` }) : null,
        el('span', { text: `${t('common.balance')} ${formatMoney(sums.net, currency, { sign: true })}` }),
      ]),
      entries.length
        ? el('div.table-wrap', {}, el('table.entries-table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: t('common.date') }), el('th', { text: t('common.category') }),
            el('th.hide-sm', { text: t('common.note') }), el('th.num', { text: t('common.amount') }), el('th', {}),
          ])),
          el('tbody', {}, shown.map((entry) => entryRow(app, entry))),
        ]))
        : el('p.muted', { text: t('entries.empty') }),
      hidden > 0 ? el('div.more-row', {}, [
        el('span.muted', { text: t('entries.showing', { shown: shown.length, total: entries.length }) }),
        el('button', {
          type: 'button', text: t('entries.showMore', { count: Math.min(hidden, PAGE_SIZE) }),
          on: { click: () => app.showMoreEntries() },
        }),
        el('button.link', {
          type: 'button', text: t('entries.showAll'), on: { click: () => app.showMoreEntries(true) },
        }),
      ]) : null,
    ]),
    transferPanel(app, entries),
  ];
}

function entryRow(app, entry) {
  const category = app.store.category(entry.categoryId);
  const currency = app.store.currency(entry.currency);
  const signed = category.kind === 'income' ? entry.amount : -entry.amount;
  const open = (event) => {
    if (event.target.closest('button')) return; // the row buttons handle their own click
    app.editEntry(entry.id);
  };
  return el('tr.entry-row', { on: { click: open } }, [
    el('td', { text: formatDate(entry.date) }),
    el('td', {}, [
      el('span.category-icon', { text: entry.categoryIds.map((id) => app.store.category(id).icon).join('') }),
      app.categoryNames(entry.categoryIds),
    ]),
    el('td.hide-sm', { text: entry.note }),
    el('td', {
      class: `num ${category.kind === 'income' ? 'income' : 'expense'}`,
      text: formatMoney(signed, currency, { sign: true }),
    }),
    el('td.row-actions', {}, [
      // Tapping the row itself already opens the editor, so on a phone the
      // pencil is one target too many in a table that has to fit 390 pixels.
      actionButton({
        icon: '\u270e\ufe0e', label: app.t('common.edit'), extraClass: 'hide-sm',
        onClick: () => app.editEntry(entry.id),
      }),
      actionButton({
        icon: '\u2715', label: app.t('common.delete'), danger: true, onClick: () => app.deleteEntry(entry.id),
      }),
    ]),
  ]);
}

/** Dialog contents for creating or editing one entry. */
export function entryForm(app, entry) {
  const store = app.store;
  const t = app.t;
  const message = el('p.error');
  const decimals = store.currency(entry ? entry.currency : store.settings.defaultCurrency).decimals;
  const amountInput = el('input', {
    type: 'number', step: '0.01', min: '0', max: String(MAX_AMOUNT / 10 ** decimals), required: true,
    value: entry ? (entry.amount / 10 ** decimals).toFixed(decimals) : '',
  });
  const dateInput = dateField({ value: entry ? entry.date : todayIso(new Date()), t, required: true,
    onChange: () => {} });
  const categorySelect = el('select', {}, options(
    store.categories.map((category) => ({
      value: category.id,
      label: `${category.icon} ${app.categoryName(category)} (${t(`common.${category.kind}`)})`,
    })),
    entry ? entry.categoryId : store.settings.defaultCategoryId,
  ));
  // The main category decides whether this is money in or money out, so it stays
  // a single choice. The rest are labels: the entry's whole amount counts under
  // each of them, which is what makes "how much did I spend on anything to do
  // with the car" a question the app can answer.
  const extra = new Set((entry ? entry.categoryIds : []).slice(1));
  const alsoChips = el('ul.chips.also-chips', {}, store.categories.map((category) => {
    const box = el('input', {
      type: 'checkbox',
      checked: extra.has(category.id),
      on: { change: (event) => (event.target.checked ? extra.add(category.id) : extra.delete(category.id)) },
    });
    const chip = el('li', {}, el('label.chip', {}, [
      box,
      el('span.chip-label', { text: `${category.icon} ${app.categoryName(category)}` }),
    ]));
    // The main category is not also an extra one; the chip hides while it is.
    const sync = () => {
      const isMain = category.id === categorySelect.value;
      chip.hidden = isMain;
      if (isMain) extra.delete(category.id);
    };
    categorySelect.addEventListener('change', sync);
    sync();
    return chip;
  }));
  const currencySelect = el('select', {}, options(
    store.currenciesByDefault().map((item) => ({
      value: item.code, label: `${item.flag || ''} ${item.code} ${item.symbol}`.trim(),
    })),
    entry ? entry.currency : store.settings.defaultCurrency,
  ));
  const noteInput = el('input', { type: 'text', maxlength: '200', value: entry ? entry.note : '' });

  const form = el('form.dialog-form', {
    on: {
      submit: (event) => {
        event.preventDefault();
        try {
          const currency = store.currency(currencySelect.value);
          const amount = Math.round(Number(amountInput.value) * 10 ** currency.decimals);
          // An unreadable date must not quietly become today.
          if (!dateInput.value) throw new AppError('Enter a date like 23.09.2026');
          const data = {
            amount: Math.abs(amount),
            date: dateInput.value,
            categoryIds: [categorySelect.value, ...extra],
            currency: currency.code,
            note: noteInput.value,
          };
          if (entry) store.updateEntry(entry.id, data);
          else store.addEntry(data);
          app.closeDialog();
        } catch (error) {
          render(message, app.errorText(error));
        }
      },
    },
  }, [
    field(t('common.amount'), amountInput),
    field(t('common.category'), categorySelect),
    field(t('entries.alsoIn'), alsoChips, t('entries.alsoInHint')),
    field(t('common.date'), dateInput),
    field(t('common.currency'), currencySelect),
    field(t('common.note'), noteInput),
    message,
    el('div.dialog-actions', {}, [
      entry ? el('button.link.danger', {
        type: 'button', text: t('common.delete'),
        on: { click: () => { app.closeDialog(); app.deleteEntry(entry.id); } },
      }) : null,
      el('span.spacer'),
      el('button', { type: 'button', text: t('common.cancel'), on: { click: () => app.closeDialog() } }),
      el('button.primary', { type: 'submit', text: entry ? t('common.save') : t('common.add') }),
    ]),
  ]);
  return { title: entry ? t('entries.editEntry') : t('entries.newEntry'), body: form, focus: amountInput };
}
