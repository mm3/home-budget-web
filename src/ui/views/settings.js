/** Settings screen: defaults, categories, currencies, language and data management. */

import { CUSTOM_LANGUAGE, EN, LANGUAGES, sanitizeTranslation, translationKeys } from '../../core/i18n.js';
import { formatMoney, parseAmount, PERIOD_PHRASES, toPlainAmount } from '../../core/format.js';
import { ICON_CHOICES, LIMIT_PERIODS } from '../../core/model.js';
import { APP_VERSION, REPO_URL, SITE_URL } from '../../core/version.js';
import { actionButton, el, field, fieldSlot, fileButton, options, render } from '../dom.js';
import { download, MIME } from '../files.js';

export function settingsView(app) {
  const store = app.store;
  const t = app.t;
  const usage = store.categoryUsage();
  const currency = store.currency(store.settings.defaultCurrency);

  return [
    el('section.card', {}, [
      el('header.card-head', {}, [el('h2', { text: t('settings.defaults') })]),
      el('div.filters', {}, [
        field(t('settings.quickCategory'), el('select', {
          on: { change: (event) => app.run(() => store.updateSettings({ defaultCategoryId: event.target.value })) },
        }, options(store.categories.map((category) => ({
          value: category.id, label: `${category.icon} ${app.categoryName(category)}`,
        })), store.settings.defaultCategoryId))),
        field(t('common.currency'), el('select', {
          on: { change: (event) => app.run(() => store.updateSettings({ defaultCurrency: event.target.value })) },
        }, options(store.currenciesByDefault().map((item) => ({
          value: item.code, label: `${item.flag || ''} ${item.code} ${item.symbol}`.trim(),
        })),
          store.settings.defaultCurrency))),
        field(t('settings.language'), el('select', {
          on: { change: (event) => app.setLanguage(event.target.value) },
        }, options([
          { value: 'auto', label: t('settings.languageAuto', { language: app.detectedLanguageName() }) },
          ...LANGUAGES.map((item) => ({ value: item.code, label: item.name })),
          { value: CUSTOM_LANGUAGE, label: store.settings.customLanguageName || t('settings.languageCustom') },
        ], store.settings.language))),
        field(t('settings.displayMode'), el('select', {
          on: { change: (event) => app.run(() => store.updateSettings({ uiMode: event.target.value })) },
        }, options([
          { value: 'auto', label: t('settings.modeAuto') },
          { value: 'mobile', label: t('settings.modeMobile') },
          { value: 'desktop', label: t('settings.modeDesktop') },
        ], store.settings.uiMode))),
        field(t('settings.theme'), el('select', {
          on: { change: (event) => app.run(() => store.updateSettings({ theme: event.target.value })) },
        }, options([
          { value: 'auto', label: t('settings.themeAuto') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') },
        ], store.settings.theme))),
      ]),
    ]),

    el('section.card', {}, [
      el('header.card-head', {}, [el('h2', { text: t('settings.categories') })]),
      el('div.table-wrap', {}, el('table.entries-table', {}, [
        // Type and the entry count are the two columns a phone can do without:
        // the kind is already obvious from the category, the count from the list.
        el('thead', {}, el('tr', {}, [
          el('th', { text: t('common.name') }), el('th.hide-sm', { text: t('common.type') }),
          el('th.num', { text: t('settings.limit') }), el('th.num.hide-sm', { text: t('nav.entries') }),
          el('th', {}),
        ])),
        el('tbody', {}, store.categories.map((category) => el('tr', {}, [
          el('td', {}, [
            el('span.category-icon', { text: category.icon }),
            app.categoryName(category),
            category.id === store.settings.defaultCategoryId ? el('span.badge', { text: t('common.default') }) : null,
          ]),
          el('td.hide-sm', { text: t(`common.${category.kind}`) }),
          // The amount and its period on two lines: side by side they made the
          // column wide enough to push the whole table off a phone screen.
          el('td.num', {}, category.limit ? [
            el('span.nowrap', { text: formatMoney(category.limit, currency) }),
            el('span.muted.small.block', { text: t(PERIOD_PHRASES[category.limitPeriod || 'month']) }),
          ] : '—'),
          el('td.num.hide-sm', { text: String(usage.get(category.id) || 0) }),
          el('td.row-actions', {}, [
            actionButton({
              // The variation selector asks for the drawn glyph, not the emoji.
              icon: '\u270e\ufe0e', label: t('common.edit'), onClick: () => app.editCategory(category.id),
            }),
            category.id === store.settings.defaultCategoryId ? null : actionButton({
              icon: '\u2715', label: t('common.delete'), danger: true,
              onClick: () => app.deleteCategory(category.id),
            }),
          ]),
        ]))),
      ])),
      el('div.button-row', {}, [
        el('button.primary', {
          type: 'button', text: t('settings.newCategory'), on: { click: () => app.editCategory(null) },
        }),
      ]),
    ]),

    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: t('settings.currencies') }),
        el('label.toggle', {}, [
          el('input', {
            type: 'checkbox', checked: store.settings.convertToDefault,
            on: { change: (event) => app.run(() => store.updateSettings({ convertToDefault: event.target.checked })) },
          }),
          t('settings.conversion', { currency: store.settings.defaultCurrency }),
        ]),
      ]),
      el('p.muted', { text: t('settings.conversionHint') }),
      el('div.table-wrap', {}, el('table.entries-table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: t('settings.currencyCode') }),
          el('th', { text: t('settings.currencySymbol') }),
          el('th.num.hide-sm', { text: t('settings.currencyDecimals') }),
          el('th.num', { text: t('settings.rate') }),
          el('th', {}),
        ])),
        el('tbody', {}, store.currenciesByDefault().map((item) => el('tr', {}, [
          el('td', {}, [
            el('span.currency-flag', { text: item.flag || '' }),
            el('strong', { text: item.code }),
            item.code === store.settings.defaultCurrency ? el('span.badge', { text: t('common.default') }) : null,
          ]),
          el('td', { text: item.symbol }),
          el('td.num.hide-sm', { text: String(item.decimals) }),
          el('td.num', {}, item.code === store.settings.defaultCurrency
            ? el('span.muted', { text: '1' })
            : el('input.rate-input', {
              type: 'number', step: '0.0001', min: '0.0001', value: String(item.rate),
              title: t('settings.rateHint', { currency: store.settings.defaultCurrency }),
              on: {
                change: (event) => app.run(() => store.updateCurrency(item.code, { rate: event.target.value })),
              },
            })),
          el('td.row-actions', {}, item.code === store.settings.defaultCurrency ? null : actionButton({
            icon: '\u2715', label: t('common.delete'), danger: true,
            onClick: () => app.run(() => store.deleteCurrency(item.code)),
          })),
        ]))),
      ])),
      currencyForm(app),
    ]),

    translationCard(app),

    el('section.card', {}, [
      el('header.card-head', {}, [el('h2', { text: t('settings.about') })]),
      el('p', { text: t('settings.version', { version: APP_VERSION }) }),
      el('p.muted', { text: t('settings.aboutText') }),
      // Two rows on the published page, one sentence from a file: there neither
      // installing nor asking for a new version is possible, and they used to
      // say so separately, one under the other. An install offer still wins -
      // whether the browser makes one is the browser's business, not ours.
      ...(app.canUpdate() || app.installPrompt || app.isInstalled()
        ? [installRow(app), app.canUpdate() ? updateRow(app) : null]
        : [offlineRow(app)]),
      el('p.about-links', {}, [
        el('a', { href: SITE_URL, target: '_blank', rel: 'noopener noreferrer', text: t('settings.webApp') }),
        el('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', text: t('settings.sourceCode') }),
        el('button.link', { type: 'button', text: t('settings.share'), on: { click: () => app.openShare() } }),
      ]),
    ]),

    el('section.card', {}, [
      el('header.card-head', {}, [el('h2', { text: t('settings.data') })]),
      el('p.muted', { text: t('settings.dataHint', { storage: app.storageKind }) }),
      el('div.button-row', {}, [
        el('button', { type: 'button', text: t('settings.backup'), on: { click: () => backup(app) } }),
        fileButton(t('settings.restore'), '.json', (file) => restore(app, file)),
        el('button.danger', { type: 'button', text: t('settings.deleteAll'), on: { click: () => app.clearEntries() } }),
        el('button.danger', { type: 'button', text: t('settings.resetAll'), on: { click: () => app.resetAll() } }),
      ]),
      el('p.muted', { text: t('settings.deleteHint') }),
    ]),
  ];
}

/** Editor for the user's own translation, stored with the settings. */
function translationCard(app) {
  const t = app.t;
  const store = app.store;
  const draft = { ...store.settings.customTranslation };
  const nameInput = el('input', { type: 'text', value: store.settings.customLanguageName, maxlength: '40' });

  const save = (useIt) => app.run(() => {
    store.updateSettings({
      customTranslation: draft,
      customLanguageName: nameInput.value,
      ...(useIt ? { language: CUSTOM_LANGUAGE } : {}),
    });
    app.notify(t('settings.translationSaved'));
  });

  return el('details.card', { open: store.settings.language === CUSTOM_LANGUAGE }, [
    el('summary.card-summary', { text: t('settings.translation') }),
    el('p.muted', { text: t('settings.translationHint') }),
    el('div.filters', {}, [field(t('settings.translationName'), nameInput)]),
    el('div.table-wrap.translation-table', {}, el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'English' }), el('th', { text: t('settings.translationName') }),
      ])),
      el('tbody', {}, translationKeys().map((key) => el('tr', {}, [
        el('td', {}, [el('span.muted.small.block', { text: key }), EN[key]]),
        el('td', {}, el('input', {
          type: 'text', value: draft[key] || '', placeholder: EN[key],
          on: { input: (event) => { draft[key] = event.target.value; } },
        })),
      ]))),
    ])),
    el('div.button-row', {}, [
      el('button.primary', { type: 'button', text: t('common.save'), on: { click: () => save(false) } }),
      el('button', { type: 'button', text: t('settings.translationUse'), on: { click: () => save(true) } }),
      el('button', {
        type: 'button',
        text: t('settings.translationExport'),
        on: {
          click: () => {
            download(JSON.stringify({ name: nameInput.value, texts: draft }, null, 2),
              'home-budget-translation.json', MIME.json);
          },
        },
      }),
      fileButton(t('settings.translationImport'), '.json', (file) => loadTranslation(app, file)),
    ]),
  ]);
}

async function loadTranslation(app, file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const texts = sanitizeTranslation(parsed.texts || parsed);
    app.store.updateSettings({
      customTranslation: texts,
      customLanguageName: typeof parsed.name === 'string' ? parsed.name : app.store.settings.customLanguageName,
      language: CUSTOM_LANGUAGE,
    });
    app.notify(app.t('settings.translationLoaded'));
  } catch {
    app.notify(app.t('settings.translationError'), 'error');
  }
}

function currencyForm(app) {
  const t = app.t;
  const code = el('input', { type: 'text', placeholder: 'SEK', maxlength: '5', size: '6' });
  const symbol = el('input', { type: 'text', placeholder: 'kr', maxlength: '4', size: '4' });
  const flag = el('input', { type: 'text', placeholder: '\ud83c\uddf8\ud83c\uddea', maxlength: '8', size: '3' });
  const decimals = el('input', { type: 'number', min: '0', max: '4', value: '2', size: '2' });
  const rate = el('input', { type: 'number', min: '0.0001', step: '0.0001', value: '1', size: '4' });
  const message = el('p.error');
  return el('form.inline-form', {
    on: {
      submit: (event) => {
        event.preventDefault();
        try {
          app.store.addCurrency({
            code: code.value,
            symbol: symbol.value,
            flag: flag.value,
            decimals: Number(decimals.value),
            rate: Number(rate.value),
          });
          code.value = '';
          symbol.value = '';
          flag.value = '';
        } catch (error) {
          render(message, app.errorText(error));
        }
      },
    },
  }, [
    field(t('settings.currencyCode'), code),
    field(t('settings.currencySymbol'), symbol),
    field(t('settings.currencyFlag'), flag, t('settings.currencyFlagHint')),
    field(t('settings.currencyDecimals'), decimals),
    field(t('settings.rate'), rate, t('settings.rateHint', { currency: app.store.settings.defaultCurrency })),
    fieldSlot(el('button', { type: 'submit', text: t('settings.addCurrency') })),
    message,
  ]);
}

/**
 * The install offer. The browser hands one over only on the published page, and
 * only when the app is not installed yet; everywhere else this explains what to
 * do instead of showing a button that could not work.
 */
function installRow(app) {
  const t = app.t;
  if (app.isInstalled()) return el('p.muted.install-row', { text: t('settings.installed') });
  if (app.installPrompt) {
    return el('div.install-row', {}, [
      el('button.primary', { type: 'button', text: t('settings.install'), on: { click: () => app.install() } }),
      el('span.muted', { text: t('settings.installHint') }),
    ]);
  }
  return el('p.muted.install-row', { text: app.isIos() ? t('settings.installIos') : t('settings.installWhere') });
}

/** What a file opened from disk can say about installing and updating: nothing. */
function offlineRow(app) {
  return el('p.muted.install-row', { text: app.t('settings.fromFile') });
}

/**
 * The way to ask the published page whether it has changed. A file opened from
 * disk has no server to ask, so there the row says what to do instead.
 */
function updateRow(app) {
  const t = app.t;
  return el('div.install-row.update-row', {}, [
    el('button', {
      type: 'button',
      text: app.updating ? t('settings.updateChecking') : t('settings.update'),
      disabled: Boolean(app.updating),
      on: { click: () => app.updateApp() },
    }),
    el('span.muted', { text: t('settings.updateHint') }),
  ]);
}

/** Dialog contents for creating or editing a category. */
export function categoryForm(app, category) {
  const store = app.store;
  const t = app.t;
  const currency = store.currency(store.settings.defaultCurrency);
  const message = el('p.error');
  const name = el('input', {
    type: 'text', required: true, maxlength: '40', value: category ? app.categoryName(category) : '',
  });
  const kind = el('select', {}, options([
    { value: 'expense', label: t('common.expense') },
    { value: 'income', label: t('common.income') },
  ], category ? category.kind : 'expense'));
  const color = el('input', { type: 'color', value: category ? category.color : '#4f46e5' });
  const limit = el('input', {
    type: 'number', min: '0', step: '0.01', placeholder: t('common.none'),
    value: category && category.limit ? toPlainAmount(category.limit, currency.decimals) : '',
  });
  const limitPeriod = el('select', {}, options(
    LIMIT_PERIODS.map((period) => ({ value: period, label: t(`period.${period}`) })),
    category && category.limitPeriod ? category.limitPeriod : 'month',
  ));
  const iconInput = el('input.icon-input', {
    type: 'text', maxlength: '2', value: category ? category.icon : '💸', 'aria-label': t('common.icon'),
  });
  const iconPicker = el('div.icon-picker', {}, ICON_CHOICES.map((choice) => el('button', {
    type: 'button', text: choice, class: 'icon-choice',
    on: { click: () => { iconInput.value = choice; } },
  })));

  const form = el('form.dialog-form', {
    on: {
      submit: (event) => {
        event.preventDefault();
        try {
          const limitValue = limit.value.trim()
            ? parseAmount(limit.value, currency.decimals)
            : null;
          const data = {
            name: name.value,
            kind: kind.value,
            color: color.value,
            icon: iconInput.value,
            limit: limitValue,
            limitPeriod: limitPeriod.value,
          };
          if (category) store.updateCategory(category.id, data);
          else store.addCategory(data);
          app.closeDialog();
        } catch (error) {
          render(message, app.errorText(error));
        }
      },
    },
  }, [
    field(t('common.name'), name),
    field(t('common.type'), kind),
    el('div.row-2', {}, [field(t('common.colour'), color), field(t('common.icon'), iconInput)]),
    iconPicker,
    el('div.row-2', {}, [
      field(`${t('settings.limit')} (${currency.symbol})`, limit, t('settings.limitHint')),
      field(t('settings.limitPeriod'), limitPeriod),
    ]),
    message,
    el('div.dialog-actions', {}, [
      el('span.spacer'),
      el('button', { type: 'button', text: t('common.cancel'), on: { click: () => app.closeDialog() } }),
      el('button.primary', { type: 'submit', text: category ? t('common.save') : t('common.create') }),
    ]),
  ]);
  return {
    title: category ? t('settings.editCategory') : t('settings.createCategory'),
    body: form,
    focus: name,
  };
}

function backup(app) {
  download(JSON.stringify(app.store.state, null, 2), `home-budget-backup-${app.store.today()}.json`, MIME.json);
  app.notify(app.t('settings.backupDownloaded'));
}

async function restore(app, file) {
  if (!file) return;
  try {
    const state = JSON.parse(await file.text());
    app.restore(state);
  } catch (error) {
    app.notify(app.t('settings.backupError', { message: error.message }), 'error');
  }
}
