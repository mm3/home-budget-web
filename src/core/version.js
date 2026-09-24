/**
 * The single place where the application version lives.
 * The build stamps it into the file name, the bundle banner and the page.
 */
export const APP_VERSION = '4.0.1';

/**
 * Where the app lives. Both are shown in Settings -> About and written into the
 * build banner, and the site build uses the address as its canonical URL.
 * Change them here if the project moves.
 */
export const REPO_URL = 'https://github.com/mm3/home-budget-web';
export const SITE_URL = 'https://mm3.github.io/home-budget-web/';

/**
 * Storage document version; raised when the saved shape changes.
 *
 * It is also the major version of the app: 4.x.y writes documents of version 4.
 * That is a rule, not a coincidence - a unit test fails if the two drift apart -
 * and it is what lets someone holding a backup file see at a glance which
 * releases can read it without opening either.
 */
// 4: an entry holds a list of categories rather than a single one. Anything
// older is read and upgraded by migrateState; nothing is lost either way.
export const DATA_VERSION = 4;
