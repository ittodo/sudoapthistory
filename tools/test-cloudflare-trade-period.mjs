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

test('group coverage keeps historical and partial dates separate', () => {
  const partial = context.tradeCoveragePresentation({ basis_date: '2026-07-01', basis_month_label: '2026년 7월', coverage_status: 'partial', expected_prefix_count: 4, available_prefix_count: 3, verified_prefix_count: 2 });
  assert.equal(partial.basis, '2026년 7월');
  assert.equal(partial.comparisons, false);
  assert.match(partial.label, /일부 검증/);
  assert.equal(partial.counts, '이번 검증 2/4 · 보유 3/4');
  const historical = context.tradeCoveragePresentation({ basis_date: '2026-06-01', coverage_status: 'historical', expected_prefix_count: 4, available_prefix_count: 4, verified_prefix_count: 0 });
  assert.equal(historical.basis, '2026-06-01');
  assert.match(historical.label, /기존 보유 자료/);
  assert.equal(historical.comparisons, false);
});

test('group is not marked complete from a label without matching counts', () => {
  const invalid = context.tradeCoveragePresentation({ coverage_status: 'complete', expected_prefix_count: 3, available_prefix_count: 3, verified_prefix_count: 1 });
  assert.notEqual(invalid.status, 'complete');
  assert.equal(invalid.comparisons, false);
  const complete = context.tradeCoveragePresentation({ coverage_status: 'complete', expected_prefix_count: 3, available_prefix_count: 3, verified_prefix_count: 3 });
  assert.equal(complete.status, 'complete');
  assert.equal(complete.comparisons, true);
});

test('partial collection is explicitly not a completed collection', () => {
  context.esc = value => String(value).replaceAll('<', '&lt;');
  const notice = context.renderTradeCollectionNotice({ status: 'partial', validated_units: 5, unavailable_units: 2 });
  assert.match(notice, /일부 자료 먼저 공개/);
  assert.match(notice, /확인 5개 · 미완료 2개/);
  assert.match(notice, /전체 수집 완료 상태가 아닙니다/);
  assert.equal(context.renderTradeCollectionNotice({ status: 'complete' }), '');
});

test('actual HS row renderer suppresses partial/historical growth even if payload claims flags', () => {
  vm.runInContext(html.slice(html.indexOf('const TR_MONTH_KEYS='), html.indexOf('// Keep amounts and labels')), context);
  vm.runInContext(html.slice(html.indexOf('function tradeObj('), html.indexOf('function tradeBalanceEntry(')), context);
  context.tradeNumber = value => value;
  context.fmtTradeAmount = value => value == null ? '-' : String(value);
  context.fmtTradePct = value => value == null ? '-' : `${value}%`;
  context.tradePctStyle = () => '';
  const row = { group_name: '반도체', basis_month_label: '2026년 7월', export_usd: 12, import_usd: 9, balance_usd: 3, export_mom_pct: 987, export_yoy_pct: 654, has_export_mom: true, has_export_yoy: true, expected_prefix_count: 3, available_prefix_count: 2, verified_prefix_count: 1 };
  for (const status of ['partial', 'historical']) {
    const output = context.renderTradeHsRows([{ ...row, coverage_status: status }]);
    assert.match(output, /2026년 7월/);
    assert.doesNotMatch(output, /987%|654%/);
    assert.match(output, />12</);
  }
  const output = context.renderTradeHsRows([{ ...row, coverage_status: 'complete', available_prefix_count: 3, verified_prefix_count: 3, has_export_mom: false, has_export_yoy: false }]);
  assert.doesNotMatch(output, /987%|654%/);
});
