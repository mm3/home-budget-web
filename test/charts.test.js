import test from 'node:test';
import assert from 'node:assert/strict';
import { barChart, donutChart } from '../src/core/charts.js';

const points = [
  { label: 'Jul', fullLabel: 'July 2026', expense: 0, income: 0 },
  { label: 'Aug', fullLabel: 'August 2026', expense: 3000, income: 0 },
  { label: 'Sep <b>', fullLabel: 'September 2026', expense: 4200, income: 200000 },
];

test('barChart draws one label and bars per point', () => {
  const svg = barChart(points, { formatValue: (value) => `${value} c` });
  assert.match(svg, /chart-scale/, 'the scale maximum is written out');
  assert.ok(!barChart(points, { showScale: false }).includes('chart-scale'));
  assert.match(svg, /^<svg class="chart"/);
  assert.equal((svg.match(/chart-label/g) || []).length, 3);
  assert.equal((svg.match(/class="bar-expense"/g) || []).length, 3);
  assert.equal((svg.match(/class="bar-income"/g) || []).length, 3);
  assert.match(svg, /September 2026: 200000 c/);
  assert.match(svg, /Sep &lt;b&gt;/, 'labels are escaped');
  assert.ok(!svg.includes('NaN'));
});

test('barChart hides income bars when there is no income', () => {
  const svg = barChart(points.map((point) => ({ ...point, income: 0 })));
  assert.equal((svg.match(/class="bar-income"/g) || []).length, 0);
  assert.equal((svg.match(/class="bar-expense"/g) || []).length, 3);
  assert.ok(barChart([]).includes('</svg>'));
  assert.ok(barChart(points, { showIncome: false, width: 300, height: 100 }).includes('viewBox="0 0 300 100"'));
});

test('the average line is drawn on request', () => {
  const withAverage = barChart(points, { average: 2000, averageLabel: 'avg 20.00' });
  assert.match(withAverage, /average-line/);
  assert.match(withAverage, /avg 20\.00/);
  assert.ok(!barChart(points).includes('average-line'), 'no line without an average');
  assert.ok(!barChart(points, { average: 0 }).includes('average-line'));
  assert.ok(!barChart(points, { average: Number.NaN }).includes('average-line'));
  const huge = barChart([{ label: 'a', expense: 10, income: 0 }], { average: 1000, showScale: true });
  assert.match(huge, /average-line/, 'the scale grows to fit the average');
  assert.ok(!huge.includes('NaN'));
});

test('donutChart draws one path per slice', () => {
  const svg = donutChart([
    { name: 'Food', amount: 70, color: '#ea580c', share: 70 },
    { name: 'Daily', amount: 30, color: '#4f46e5', share: 30 },
  ]);
  assert.equal((svg.match(/<path/g) || []).length, 2);
  assert.match(svg, /Food: 70%/);
  assert.ok(!svg.includes('NaN'));
});

test('donutChart shows an empty ring without data', () => {
  const svg = donutChart([], { size: 120 });
  assert.match(svg, /donut-empty/);
  assert.match(svg, /viewBox="0 0 120 120"/);
  const single = donutChart([{ name: 'All', amount: 5, color: '#000000', share: 100 }]);
  assert.equal((single.match(/<path/g) || []).length, 1);
});

test('a category with the whole circle to itself is drawn as a ring, not as nothing', () => {
  // An arc whose two ends are the same point draws nothing - that is what the
  // format says to do with it - so a full turn has to be two arcs. This is the
  // state of every installation after its first entry, so "nothing" meant an
  // empty card on the most ordinary screen there is.
  const one = donutChart([{ amount: 100, color: '#16a34a', name: 'Only', share: 100 }]);
  const paths = [...one.matchAll(/d="([^"]*)"/g)].map((match) => match[1]);
  assert.equal(paths.length, 1);
  const arcs = paths[0].match(/A /g) || [];
  assert.equal(arcs.length, 4, 'two arcs out and two back');
  const ends = paths[0].match(/M ([\d.]+) ([\d.]+)/g);
  assert.ok(ends.length === 2, 'an outer ring and an inner one');

  // ... and the slice that owns all but a rounding error is the same case: at
  // 99.999% the arc used to be a hundredth of a pixel wide.
  const dominant = donutChart([
    { amount: 999999, color: '#16a34a', name: 'Big', share: 100 },
    { amount: 1, color: '#ea580c', name: 'Tiny', share: 0 },
  ]);
  const first = [...dominant.matchAll(/d="([^"]*)"/g)][0][1];
  assert.equal((first.match(/A /g) || []).length, 4, 'the dominant slice is a ring too');

  // An ordinary split is still two ordinary arcs.
  const half = donutChart([
    { amount: 50, color: '#16a34a', name: 'A', share: 50 },
    { amount: 50, color: '#ea580c', name: 'B', share: 50 },
  ]);
  for (const [, path] of half.matchAll(/d="([^"]*)"/g)) {
    assert.equal((path.match(/A /g) || []).length, 2);
  }
});
