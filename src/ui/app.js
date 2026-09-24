/** Application shell: state, navigation, dialogs and rendering. */

import { BudgetStore } from '../core/store.js';
import { AppError, currencyForLocales } from '../core/model.js';
import {
  createTranslator, CUSTOM_LANGUAGE, detectLanguage, LANGUAGES, periodTexts,
} from '../core/i18n.js';
import { APP_VERSION, SITE_URL } from '../core/version.js';
import { loadState, migrateState, pickStorage, saveState } from '../core/storage.js';
import { qrSvg } from '../core/charts.js';
import { encodeQr } from '../core/qr.js';
import { append, clear, el, render } from './dom.js';
import { entriesView, entryForm, PAGE_SIZE } from './views/entries.js';
import { homeView } from './views/home.js';
import { settingsView, categoryForm } from './views/settings.js';
import { statsView } from './views/stats.js';

const TABS = [
  { id: 'home', key: 'nav.home', icon: '\u2302' },
  { id: 'entries', key: 'nav.entries', icon: '\u2630' },
  { id: 'stats', key: 'nav.stats', icon: '\u25d4' },
  { id: 'settings', key: 'nav.settings', icon: '\u2699' },
];

export class App {
  constructor(root, options = {}) {
    this.root = root;
    const picked = options.storage ? { storage: options.storage, kind: 'memory' } : pickStorage();
    this.storageKind = picked.kind === 'localStorage' ? 'local storage' : picked.kind;
    this.storage = picked.storage;
    const loaded = loadState(this.storage);
    this.store = new BudgetStore({
      state: loaded.state,
      persist: (state) => saveState(this.storage, state),
      clock: options.clock,
    });
    this.ui = {
      tab: 'home',
      homePeriod: 'day',
      statsPeriod: 'month',
      currency: null,
      showIncome: false,
      showAverage: true,
      filter: {},
      // The list draws one row per entry, so a store with tens of thousands of them
      // would spend seconds in the DOM on every render. It grows on demand instead.
      shownEntries: PAGE_SIZE,
      importPreview: null,
      message: loaded.error ? { text: loaded.error, kind: 'error' } : null,
    };
    this.store.subscribe(() => this.render());
    this.t = (key, params) => this.translator()(key, params);
    // Before the first render, so the app opens in the right currency rather
    // than switching a moment after it is drawn.
    this.followLanguage();
    this.watchInstall();
  }

  /**
   * Keeps the browser's install offer for the button in the settings.
   *
   * preventDefault() is the point of this: without it the browser decides when
   * to show its own banner. The offer is only ever used when the person presses
   * the button, and a prompt can be used once, so it is dropped after use.
   */
  watchInstall() {
    this.installPrompt = null;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installPrompt = event;
      this.render();
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.notify(this.t('settings.installDone'));
    });
  }

  /** True once the app runs from the home screen rather than in a browser tab. */
  isInstalled() {
    if (typeof window === 'undefined') return false;
    const standalone = typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches;
    return standalone || window.navigator.standalone === true;
  }

  /** iOS never offers an install prompt; there the settings show the manual steps. */
  isIos() {
    return typeof navigator === 'object' && /iPad|iPhone|iPod/.test(navigator.userAgent || '')
      && !window.MSStream;
  }

  /** Shows the browser's install dialog. Only ever called from the button. */
  async install() {
    const prompt = this.installPrompt;
    if (!prompt) return;
    this.installPrompt = null; // an offer can only be used once
    this.render();
    prompt.prompt();
    const choice = await prompt.userChoice;
    const accepted = choice && choice.outcome === 'accepted';
    this.notify(this.t(accepted ? 'settings.installDone' : 'settings.installDismissed'),
      accepted ? 'ok' : 'info');
  }

  /** True where there is a server to ask; a file opened from disk has none. */
  canUpdate() {
    return typeof location === 'object' && /^https?:$/.test(location.protocol);
  }

  /**
   * Fetches the published page past every cache and reloads if what is up there
   * is not what is running.
   *
   * Every layer in the way has to be asked to step aside, because each of them
   * is doing what it was told to. The page carries "cache this for a year,
   * immutable", which is right for a build whose name never changes and wrong
   * for the one moment somebody wants to know whether it changed - so the fetch
   * asks for `reload`, which goes past the browser's HTTP cache. The service
   * worker answers from its own cache first, and lets a `reload` request through
   * untouched for exactly this reason. Its caches are then thrown away, so the
   * reload that follows cannot be served the old app from either of them.
   *
   * The version is read from the meta tag the build stamps into the page, not
   * from the bytes being different: a rebuilt but unchanged release should not
   * announce itself as an update.
   */
  async updateApp() {
    if (this.updating || !this.canUpdate()) return;
    this.updating = true;
    this.render();
    try {
      const address = location.href.split('#')[0];
      const response = await fetch(address, { cache: 'reload' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const published = page.querySelector('meta[name="application-version"]');
      const version = published ? published.getAttribute('content') : '';
      if (!version) throw new Error('the page did not say which version it is');

      if (version === APP_VERSION) {
        this.updating = false;
        this.notify(this.t('settings.updateCurrent', { version: APP_VERSION }), 'info');
        return;
      }
      this.notify(this.t('settings.updateFound', { version }));
      if (typeof caches === 'object' && caches) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const workers = await navigator.serviceWorker.getRegistrations();
        await Promise.all(workers.map((worker) => worker.update().catch(() => {})));
      }
      this.reloadPage();
    } catch (error) {
      this.updating = false;
      this.notify(this.t('settings.updateFailed', { message: error.message }), 'error');
    }
  }

  /**
   * The last step of an update, on its own so the site check can watch for it
   * happening without the page it is inspecting disappearing underneath it.
   */
  reloadPage() {
    location.reload();
  }

  /** Translator for the language chosen in the settings. */
  translator() {
    const settings = this.store.settings;
    const language = settings.language === 'auto' ? this.detectedLanguage() : settings.language;
    const signature = `${language}|${settings.language === CUSTOM_LANGUAGE ? JSON.stringify(settings.customTranslation) : ''}`;
    if (this.translatorSignature !== signature) {
      this.translatorSignature = signature;
      this.translatorFunction = createTranslator(language, settings.customTranslation);
      this.translatedPeriods = periodTexts(this.translatorFunction);
    }
    return this.translatorFunction;
  }

  /** Month and week names for the charts, the statistics and the exports. */
  periodTexts() {
    this.translator();
    return this.translatedPeriods;
  }

  /** The locales the browser reports, best first: ['de-CH', 'de', 'en']. */
  browserLocales() {
    return typeof navigator === 'object' && navigator
      ? (navigator.languages || [navigator.language]).filter(Boolean)
      : [];
  }

  /** Language code guessed from the browser. */
  detectedLanguage() {
    return detectLanguage(this.browserLocales());
  }

  /**
   * Moves the default currency to the one the interface language suggests.
   *
   * It runs while the app is still empty and nobody has picked a currency: that
   * is what makes a fresh app opened in Russian start in rubles instead of euro,
   * and what lets someone who switches the interface to German before entering
   * anything get euro. The moment there is an entry, or the moment the person
   * picks a currency themselves, the setting is theirs and this stops touching
   * it - a figure already recorded must never change meaning underneath it.
   *
   * @param {boolean} [announce] say so in the message line; the first run is silent
   */
  followLanguage(announce = false) {
    const settings = this.store.settings;
    if (settings.currencyChosen || this.store.entries.length) return;
    // A language the person invented says nothing about money.
    if (settings.language === CUSTOM_LANGUAGE) return;
    const locales = settings.language === 'auto' ? this.browserLocales() : [settings.language];
    const code = currencyForLocales(locales, this.store.currencies.map((item) => item.code));
    if (code === settings.defaultCurrency) return;
    this.store.updateSettings({ defaultCurrency: code, currencyChosen: false });
    if (announce) this.notify(this.t('settings.currencyFollowed', { currency: code }), 'info');
  }

  /** Changes the interface language, and the currency with it while it is still a guess. */
  setLanguage(code) {
    this.run(() => this.store.updateSettings({ language: code }));
    this.followLanguage(true);
  }

  detectedLanguageName() {
    const code = this.detectedLanguage();
    const found = LANGUAGES.find((item) => item.code === code);
    return found ? found.name : code;
  }

  /** Category name, translated when it is one of the predefined categories. */
  categoryName(category) {
    return category.nameKey ? this.t(category.nameKey) : category.name;
  }

  /** "3 entries" / "1 entry" in the chosen language. */
  countText(count) {
    return count === 1 ? this.t('common.entriesOne') : this.t('common.entries', { count });
  }

  /**
   * Translates the few error messages that have a key, otherwise shows the
   * message as it was thrown. The keys are the exact English strings the core
   * throws, so changing one of those without changing it here silently drops
   * the message back to English - the test in test/i18n.test.js guards that.
   */
  errorText(error) {
    if (!(error instanceof AppError)) return error.message;
    const map = {
      'Enter an amount, for example 12.50': 'error.amountRequired',
      'Unknown category': 'error.unknownCategory',
      'This amount is too large': 'error.amountTooLarge',
      'This amount is too small': 'error.amountTooSmall',
      'Amount cannot be zero': 'error.amountZero',
      'Enter a date like 23.09.2026': 'error.badDate',
    };
    return map[error.message] ? this.t(map[error.message]) : error.message;
  }

  /** Currency the dashboard and statistics are shown in. */
  viewCurrency() {
    const used = this.store.usedCurrencies();
    return used.includes(this.ui.currency) ? this.ui.currency : used[0];
  }

  setTab(tab) {
    this.ui.tab = tab;
    this.ui.importPreview = null;
    this.render();
  }

  setUi(changes) {
    // Any new filter starts the list from the top again.
    if (changes.filter !== undefined) this.ui.shownEntries = PAGE_SIZE;
    Object.assign(this.ui, changes);
    this.render();
  }

  /** Shows the next page of entries. */
  showMoreEntries(all = false) {
    this.ui.shownEntries = all ? Number.MAX_SAFE_INTEGER : this.ui.shownEntries + PAGE_SIZE;
    this.render();
  }

  notify(text, kind = 'ok') {
    this.focusQuickInput = this.ui.tab === 'home';
    this.ui.message = { text, kind };
    this.render();
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.ui.message = null;
      this.render();
    }, 4000);
  }

  /** Runs an action that may throw a user-facing error. */
  run(action) {
    try {
      const result = action();
      return result;
    } catch (error) {
      this.notify(this.errorText(error), 'error');
      return null;
    }
  }

  // ------------------------------------------------------------- dialogs

  openDialog({ title, body, focus }) {
    const dialog = el('dialog.dialog', { on: { cancel: () => this.closeDialog() } }, [
      el('header.dialog-head', {}, [
        el('h2', { text: title }),
        el('button.link', {
          type: 'button', text: '\u2715', 'aria-label': this.t('common.close'),
          on: { click: () => this.closeDialog() },
        }),
      ]),
      body,
    ]);
    this.dialog = dialog;
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', 'open');
    if (focus) focus.focus();
  }

  closeDialog() {
    if (!this.dialog) return;
    if (typeof this.dialog.close === 'function' && this.dialog.open) this.dialog.close();
    this.dialog.remove();
    this.dialog = null;
    this.render();
  }

  editEntry(id) {
    const entry = id ? this.store.entries.find((item) => item.id === id) : null;
    this.openDialog(entryForm(this, entry));
  }

  deleteEntry(id) {
    const entry = this.store.entries.find((item) => item.id === id);
    if (!entry) return;
    if (!window.confirm(this.t('entries.confirmDelete'))) return;
    this.run(() => this.store.deleteEntry(id));
    this.notify(this.t('entries.deleted'));
  }

  editCategory(id) {
    const category = id ? this.store.categories.find((item) => item.id === id) : null;
    this.openDialog(categoryForm(this, category));
  }

  deleteCategory(id) {
    const used = this.store.categoryUsage().get(id) || 0;
    if (used > 0) {
      const target = window.prompt(
        this.t('settings.moveEntries', { category: this.categoryName(this.store.category(id)), count: used }),
        this.categoryName(this.store.category(this.store.settings.defaultCategoryId)),
      );
      if (target === null) return;
      const wanted = target.trim().toLowerCase();
      const moveTo = this.store.categories.find((item) => item.name.toLowerCase() === wanted
        || this.categoryName(item).toLowerCase() === wanted);
      if (!moveTo) {
        this.notify(this.t('settings.noCategoryNamed', { name: target }), 'error');
        return;
      }
      this.run(() => this.store.deleteCategory(id, moveTo.id));
    } else if (window.confirm(this.t('settings.confirmDeleteCategory'))) {
      this.run(() => this.store.deleteCategory(id));
    }
  }

  clearEntries() {
    if (!window.confirm(this.t('settings.confirmDeleteAll'))) return;
    const removed = this.store.clearEntries();
    this.notify(this.t('settings.deletedEntries', { count: removed }));
  }

  resetAll() {
    if (!window.confirm(this.t('settings.confirmResetAll'))) return;
    this.store.resetAll();
    this.notify(this.t('settings.resetDone'));
  }

  /**
   * Shows the app's own address as a QR code, so a phone can be pointed at the
   * screen. The code is drawn here, offline, from the same address the links use.
   */
  openShare() {
    const t = this.t;
    const code = el('div.qr-box', { html: qrSvg(encodeQr(SITE_URL, 'M').modules, { title: SITE_URL }) });
    const address = el('p.qr-address', { text: SITE_URL });
    const copy = el('button', {
      type: 'button',
      text: t('settings.copyLink'),
      on: {
        click: async () => {
          try {
            await navigator.clipboard.writeText(SITE_URL);
            this.notify(t('settings.linkCopied'));
          } catch {
            this.notify(t('settings.copyFailed'), 'error');
          }
        },
      },
    });
    this.openDialog({
      title: t('settings.share'),
      body: el('div.share-body', {}, [
        code,
        address,
        el('p.muted', { text: t('settings.shareHint') }),
        el('div.dialog-actions', {}, [
          el('span.spacer'),
          copy,
          el('button.primary', { type: 'button', text: t('common.close'), on: { click: () => this.closeDialog() } }),
        ]),
      ]),
    });
  }

  restore(rawState) {
    const state = migrateState(rawState);
    this.store.replaceState(state);
    this.notify(this.t('settings.backupRestored', { count: state.entries.length }));
  }

  // ------------------------------------------------------------- rendering

  render() {
    const settings = this.store.settings;
    document.body.dataset.mode = settings.uiMode;
    document.body.dataset.theme = settings.theme;
    document.body.classList.toggle('dark', this.prefersDark(settings.theme));
    document.documentElement.lang = settings.language === 'auto' ? this.detectedLanguage() : settings.language;
    const view = this.currentView();
    render(this.root, [
      el('header.app-bar', {}, [
        el('div.brand', {}, [this.brandLogo(), el('strong', { text: this.t('app.title') })]),
        el('nav.tabs', {}, TABS.map((tab) => el('button', {
          type: 'button',
          class: tab.id === this.ui.tab ? 'tab active' : 'tab',
          title: this.t(tab.key),
          on: { click: () => this.setTab(tab.id) },
        }, [el('span.tab-icon', { text: tab.icon }), el('span.tab-label', { text: this.t(tab.key) })]))),
      ]),
      this.ui.message ? el('p', { class: `toast ${this.ui.message.kind}`, text: this.ui.message.text }) : null,
      el('main.main', {}, view),
      el('footer.app-footer', {}, [
        el('span', { text: this.t('app.storedIn', { storage: this.storageKind }) }),
        el('span.app-version', { text: ` · v${APP_VERSION}` }),
      ]),
    ]);
  }

  /**
   * The coin in the corner. It carries the symbol of the currency the figures
   * are shown in, so switching from euro to rubles is visible at a glance; it
   * used to be a euro sign for everyone, whatever they were counting in. A
   * symbol of more than one character (CN¥, Skr, NZ$) gets smaller type so the
   * coin keeps its shape, and the flag and code are in the tooltip.
   */
  brandLogo() {
    const currency = this.store.currency(this.viewCurrency());
    const symbol = currency.symbol || currency.code;
    return el('span.logo', {
      class: symbol.length > 1 ? 'long' : '',
      text: symbol,
      title: `${currency.flag ? `${currency.flag} ` : ''}${currency.code}`,
      'aria-label': this.t('app.currencyBadge', { currency: currency.code }),
    });
  }

  /** True when the desktop layout is in use (explicit setting or a wide window). */
  isDesktop() {
    const mode = this.store.settings.uiMode;
    if (mode !== 'auto') return mode === 'desktop';
    return typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 721px)').matches;
  }

  /** True when the dark palette should be used. */
  prefersDark(theme) {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  currentView() {
    switch (this.ui.tab) {
      case 'entries': return entriesView(this);
      case 'stats': return statsView(this);
      case 'settings': return settingsView(this);
      default: return homeView(this);
    }
  }
}

/** Creates the application inside a root element. */
export function startApp(root, options) {
  const app = new App(root, options);
  app.render();
  return app;
}
