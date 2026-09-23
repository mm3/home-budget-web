/**
 * Formatting and parsing of money, dates and period keys.
 * Amounts are integer minor units (cents) everywhere in the application.
 */

/** Thousands separator used in the UI (narrow no-break space). */
export const GROUP_SEPARATOR = ' ';

/**
 * Formats minor units with the currency symbol, e.g. 123456 -> "1 234.56 €".
 * @param {number} minorUnits
 * @param {{symbol?: string, code?: string, decimals?: number}} [currency]
 * @param {{sign?: boolean, symbol?: boolean}} [options]
 */
export function formatMoney(minorUnits, currency = {}, options = {}) {
  const decimals = Number.isInteger(currency.decimals) ? currency.decimals : 2;
  const factor = 10 ** decimals;
  const negative = minorUnits < 0;
  const absolute = Math.abs(minorUnits);
  const whole = Math.floor(absolute / factor);
  const fraction = absolute - whole * factor;
  let text = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  if (decimals > 0) text += '.' + String(fraction).padStart(decimals, '0');
  if (options.sign) text = (negative ? '−' : '+') + text;
  else if (negative) text = '−' + text;
  const symbol = currency.symbol || currency.code || '';
  return options.symbol === false || !symbol ? text : text + ' ' + symbol;
}

/** Plain machine-readable amount, e.g. 123456 -> "1234.56". */
export function toPlainAmount(minorUnits, decimals = 2) {
  const factor = 10 ** decimals;
  const sign = minorUnits < 0 ? '-' : '';
  const absolute = Math.abs(minorUnits);
  const whole = Math.floor(absolute / factor);
  if (decimals === 0) return sign + String(whole);
  return sign + whole + '.' + String(absolute - whole * factor).padStart(decimals, '0');
}

/**
 * Parses user input into minor units. Accepts "12", "12,5", "1 234.56", "-3", "(3)", "12.50 €".
 * @returns {number|null} null when the text is not a number
 */
export function parseAmount(text, decimals = 2) {
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * 10 ** decimals) : null;
  if (typeof text !== 'string') return null;
  let cleaned = text.trim();
  if (!cleaned) return null;
  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.replace(/[^\d,.\-+]/g, '');
  if (cleaned.startsWith('-')) {
    negative = !negative;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }
  cleaned = cleaned.replace(/[-+]/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const separator = Math.max(lastComma, lastDot);
  let integerPart = cleaned;
  let fractionPart = '';
  if (separator >= 0) {
    const tail = cleaned.slice(separator + 1);
    // "1,234" is a thousands separator, "1,23" is a decimal separator
    if (/^\d{3}$/.test(tail) && cleaned.slice(0, separator).replace(/[.,]/g, '').length > 0
        && (lastComma >= 0) !== (lastDot >= 0) && cleaned.replace(/[^.,]/g, '').length === 1
        && cleaned.length - separator - 1 === 3 && !/^0/.test(cleaned)) {
      integerPart = cleaned.replace(/[.,]/g, '');
    } else {
      integerPart = cleaned.slice(0, separator).replace(/[.,]/g, '');
      fractionPart = tail.replace(/[.,]/g, '');
    }
  }
  if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fractionPart) || integerPart + fractionPart === '') return null;
  const rounded = Math.round(Number('0.' + (fractionPart || '0')) * 10 ** decimals);
  const value = Number(integerPart || '0') * 10 ** decimals + rounded;
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Today's date as yyyy-mm-dd in local time. */
export function todayIso(now = new Date()) {
  return toIsoDate(now);
}

/** Local date of a Date object as yyyy-mm-dd. */
export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** True for a well-formed and existing yyyy-mm-dd date. */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Parses dates in common formats: ISO, d.m.yyyy, d/m/yyyy, d-m-yyyy, yyyy/m/d.
 * Two digit years are mapped to 2000..2099. Returns yyyy-mm-dd or null.
 */
export function parseDateLoose(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toIsoDate(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (isIsoDate(text)) return text;
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day]; // m/d/yyyy
    return buildIso(year, month, day);
  }
  return null;
}

function buildIso(year, month, day) {
  const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoDate(text) ? text : null;
}

/** Date arithmetic on yyyy-mm-dd strings (UTC based, so DST cannot shift a day). */
export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function addMonths(isoDate, months) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Monday of the ISO week that contains the date. */
export function startOfWeek(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(isoDate, -weekday);
}

/** ISO 8601 week number and week-based year. */
export function isoWeek(isoDate) {
  const monday = startOfWeek(isoDate);
  const thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4));
  const firstThursday = startOfWeek(`${year}-01-04`);
  const week = Math.round((Date.parse(monday) - Date.parse(firstThursday)) / (7 * 86400000)) + 1;
  return { year, week };
}

export const PERIODS = ['day', 'week', 'month', 'year'];

/** Key that identifies the period a date belongs to. */
export function periodKey(isoDate, period) {
  switch (period) {
    case 'day': return isoDate;
    case 'week': {
      const { year, week } = isoWeek(isoDate);
      return `${year}-W${String(week).padStart(2, '0')}`;
    }
    case 'month': return isoDate.slice(0, 7);
    case 'year': return isoDate.slice(0, 4);
    default: throw new Error(`Unknown period: ${period}`);
  }
}

/** First day of the period that contains the date. */
export function periodStart(isoDate, period) {
  switch (period) {
    case 'day': return isoDate;
    case 'week': return startOfWeek(isoDate);
    case 'month': return isoDate.slice(0, 7) + '-01';
    case 'year': return isoDate.slice(0, 4) + '-01-01';
    default: throw new Error(`Unknown period: ${period}`);
  }
}

/** Last day of the period that contains the date. */
export function periodEnd(isoDate, period) {
  switch (period) {
    case 'day': return isoDate;
    case 'week': return addDays(startOfWeek(isoDate), 6);
    case 'month': {
      const [year, month] = isoDate.split('-').map(Number);
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return `${isoDate.slice(0, 8)}${String(days).padStart(2, '0')}`;
    }
    case 'year': return `${isoDate.slice(0, 4)}-12-31`;
    default: throw new Error(`Unknown period: ${period}`);
  }
}

/** First day of the period before the one containing the date. */
export function previousPeriodStart(isoDate, period) {
  const start = periodStart(isoDate, period);
  switch (period) {
    case 'day': return addDays(start, -1);
    case 'week': return addDays(start, -7);
    case 'month': return addMonths(start, -1);
    case 'year': return `${Number(start.slice(0, 4)) - 1}-01-01`;
    default: throw new Error(`Unknown period: ${period}`);
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Human readable label for a period key, e.g. "Sep 2026" or "W38 2026". */
export function periodLabel(key, period, style = 'short') {
  switch (period) {
    case 'day': {
      const [year, month, day] = key.split('-');
      return style === 'short' ? `${day}.${month}` : `${day}.${month}.${year}`;
    }
    case 'week': {
      const [year, week] = key.split('-W');
      return style === 'short' ? `W${Number(week)}` : `Week ${Number(week)}, ${year}`;
    }
    case 'month': {
      const [year, month] = key.split('-');
      const name = MONTH_NAMES[Number(month) - 1];
      return style === 'short' ? `${name.slice(0, 3)} ${year.slice(2)}` : `${name} ${year}`;
    }
    case 'year': return key;
    default: throw new Error(`Unknown period: ${period}`);
  }
}

/** Formats a date for display: 22.09.2026. */
export function formatDate(isoDate) {
  if (!isIsoDate(isoDate)) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}
