import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../div/index.html', import.meta.url), 'utf8');
const start = html.indexOf('function tradePeriodPresentation(');
const end = html.indexOf('function tradeObj(', start);
assert.ok(start >= 0 && end > start, 'period presentation helper exists');
const context = vm.createContext({});
vm.runInContext(html.slice(start, end), context);
const present = context.tradePeriodPresentation;
const summary = { date: '2026-09-01', month_label: '2026년 9월', source: 'CUSTOMS_NEWT', export_usd: 150 };
const flash = { period_start: '2026-09-01', period_end: '2026-09-10', period_label: '9월 1~10일', release_type: 'flash_10d', source: 'CUSTOMS_PRLST', export_usd: 100 };
const old = { ...flash, period_start: '2026-08-01', period_end: '2026-08-31', period_label: '8월 전체', release_type: 'monthly_provisional', export_usd: 90 };

test('inline scripts remain syntactically valid', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});

test('summary amounts and displayed period use the same latest exact source', () => {
  const view = present({ release_snapshots: [old, flash] }, summary);
  assert.equal(view.total.export_usd, 100);
  assert.equal(view.totalLabel, '2026년 9월 1~10일');
  assert.match(view.totalNote, /관세청 수출입 속보 · 잠정/);
});

test('older product items retain their own period and source', () => {
  const view = present({ release_snapshots: [old, flash], release_items: [{ date: '2026-08-01', month_label: '2026년 8월', release_type: 'monthly_provisional', source: 'CUSTOMS_PRLST_EXPORT' }] }, summary);
  assert.equal(view.itemsLabel, '2026년 8월 전체');
  assert.match(view.itemsSource, /관세청/);
});

test('unknown end date never becomes a completed month or replaces totals', () => {
  const view = present({ release_snapshots: [{ ...flash, source: 'CUSTOMS_NEWT', period_end: '' }] }, summary);
  assert.equal(view.total.export_usd, 150);
  assert.match(view.totalNote, /집계 종료일 미확인, 월 전체 확정치 아님/);
});

test('confirmed monthly fallback is not labelled provisional', () => {
  const view = present({}, { ...summary, release_type: 'confirmed' });
  assert.match(view.totalNote, /확정 월 전체/);
  assert.doesNotMatch(view.totalNote, /잠정|미확인/);
});

test('MOTIE item does not borrow a Customs period in the same month', () => {
  const view = present({ release_snapshots: [flash], release_items: [{ date: '2026-09-01', month_label: '2026년 9월', release_type: 'monthly_provisional', source: 'MOTIE_RELEASE' }] }, summary);
  assert.equal(view.itemsLabel, '2026년 9월');
  assert.match(view.itemsSource, /산업통상자원부 발표 · 세부 집계 기간 미확인/);
});
