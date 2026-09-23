/**
 * Statistics: sums and averages per day, week, month and year, plus the series
 * and breakdowns the charts draw.
 */

import {
  addDays, addMonths, PERIODS, periodKey, periodLabel, periodStart, todayIso,
} from './format.js';
import { findCategory } from './model.js';

/** Sums one currency of a list of entries, split into expense and income. */
export function totals(entries, categories) {
  let expense = 0;
  let income = 0;
  for (const entry of entries) {
    if (findCategory(categories, entry.categoryId).kind === 'income') income += entry.amount;
    else expense += entry.amount;
  }
  return { expense, income, net: income - expense, count: entries.length };
}

/** Groups entries by period key. */
export function groupByPeriod(entries, period) {
  const groups = new Map();
  for (const entry of entries) {
    const key = periodKey(entry.date, period);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
}

/** The period one step finer than each of these; a day has nothing under it. */
const SUB_PERIOD = { week: 'day', month: 'week', year: 'month' };

/**
 * How many sub-periods the current period has already touched: days into this
 * week, weeks into this month, months into this year.
 *
 * Elapsed, not "with entries". A day on which nothing was spent is still a day
 * that passed, and counting only the days with entries would turn a quiet week
 * into a high daily rate - exactly the wrong way round. The month is counted as
 * the calendar weeks its elapsed days fall in, because a week crosses the first
 * of the month and both halves still belong to the month a person is looking at.
 *
 * @returns {number} 0 for a day, which has no sub-period here
 */
export function elapsedSubPeriods(period, today = todayIso()) {
  const sub = SUB_PERIOD[period];
  if (!sub) return 0;
  const seen = new Set();
  // At most 366 steps, once per card, so the plain walk is worth its clarity.
  for (let day = periodStart(today, period); day <= today; day = addDays(day, 1)) {
    seen.add(periodKey(day, sub));
  }
  return seen.size;
}

/**
 * Figures for the period that contains `today`, in two different senses of
 * "average", because both answer a real question:
 *
 * - `averageExpense` is the average over all periods that have data - what a
 *   typical week of yours costs. The statistics table shows this one.
 * - `rateExpense` is the pace inside the period now running - what this month
 *   has cost per week so far. The cards on the home screen show this one, and
 *   it is the figure that tells you whether the month is going well.
 */
export function periodSummary(entries, categories, period, today = todayIso(), texts = undefined) {
  const currentKey = periodKey(today, period);
  const groups = groupByPeriod(entries, period);
  const current = totals(groups.get(currentKey) || [], categories);
  let expenseSum = 0;
  let incomeSum = 0;
  for (const group of groups.values()) {
    const groupTotals = totals(group, categories);
    expenseSum += groupTotals.expense;
    incomeSum += groupTotals.income;
  }
  const periodsWithData = groups.size;
  const subPeriod = SUB_PERIOD[period] || null;
  const subPeriods = elapsedSubPeriods(period, today);
  return {
    period,
    key: currentKey,
    label: periodLabel(currentKey, period, 'long', texts),
    current,
    periodsWithData,
    averageExpense: periodsWithData ? Math.round(expenseSum / periodsWithData) : 0,
    averageIncome: periodsWithData ? Math.round(incomeSum / periodsWithData) : 0,
    subPeriod,
    subPeriods,
    rateExpense: subPeriods ? Math.round(current.expense / subPeriods) : 0,
    rateIncome: subPeriods ? Math.round(current.income / subPeriods) : 0,
    totalExpense: expenseSum,
    totalIncome: incomeSum,
  };
}

/** One summary per period type: day, week, month, year. */
export function overview(entries, categories, today = todayIso(), texts = undefined) {
  return PERIODS.map((period) => periodSummary(entries, categories, period, today, texts));
}

/** Start dates of the last `count` periods, oldest first, ending with the one holding `today`. */
export function periodStarts(period, count, today = todayIso()) {
  const starts = [];
  let cursor = periodStart(today, period);
  for (let index = 0; index < count; index += 1) {
    starts.unshift(cursor);
    switch (period) {
      case 'day': cursor = addDays(cursor, -1); break;
      case 'week': cursor = addDays(cursor, -7); break;
      case 'month': cursor = addMonths(cursor, -1); break;
      default: cursor = `${Number(cursor.slice(0, 4)) - 1}-01-01`;
    }
  }
  return starts;
}

/**
 * Series for the bar chart: the last `count` periods with expense, income and net,
 * including periods without entries.
 */
export function series(entries, categories, period, count, today = todayIso(), texts = undefined) {
  const groups = groupByPeriod(entries, period);
  return periodStarts(period, count, today).map((start) => {
    const key = periodKey(start, period);
    const groupTotals = totals(groups.get(key) || [], categories);
    return {
      key,
      label: periodLabel(key, period, 'short', texts),
      fullLabel: periodLabel(key, period, 'long', texts),
      ...groupTotals,
    };
  });
}

/** Expense share per category, largest first. */
export function byCategory(entries, categories) {
  const sums = new Map();
  let total = 0;
  for (const entry of entries) {
    const category = findCategory(categories, entry.categoryId);
    if (category.kind === 'income') continue;
    sums.set(category.id, (sums.get(category.id) || 0) + entry.amount);
    total += entry.amount;
  }
  return [...sums.entries()]
    .map(([id, amount]) => {
      const category = findCategory(categories, id);
      return {
        id,
        name: category.name,
        color: category.color,
        amount,
        share: total ? Math.round((amount / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

/** Entries of one currency only. */
export function ofCurrency(entries, currency) {
  return entries.filter((entry) => entry.currency === currency);
}

/** Largest single expense and the busiest day, for the "highlights" line. */
export function highlights(entries, categories) {
  let largest = null;
  const perDay = new Map();
  for (const entry of entries) {
    if (findCategory(categories, entry.categoryId).kind === 'income') continue;
    if (!largest || entry.amount > largest.amount) largest = entry;
    perDay.set(entry.date, (perDay.get(entry.date) || 0) + entry.amount);
  }
  let busiestDay = null;
  for (const [date, amount] of perDay) {
    if (!busiestDay || amount > busiestDay.amount) busiestDay = { date, amount };
  }
  return { largest, busiestDay, daysWithSpending: perDay.size };
}
