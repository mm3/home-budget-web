/**
 * The single place where the application version lives.
 * The build stamps it into the file name, the bundle banner and the page.
 */
export const APP_VERSION = '3.20.0';

/**
 * Where the app lives. Both are shown in Settings -> About and written into the
 * build banner, and the site build uses the address as its canonical URL.
 * Change them here if the project moves.
 */
export const REPO_URL = 'https://github.com/mm3/home-budget-web';
export const SITE_URL = 'https://mm3.github.io/home-budget-web/';

/** Storage document version; raised when the saved shape changes. */
// 4: an entry holds a list of categories rather than a single one. Anything
// older is read and upgraded by migrateState; nothing is lost either way.
export const DATA_VERSION = 4;
