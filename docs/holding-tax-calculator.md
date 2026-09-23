# 보유세 비교표

Entry: `/calc/holding-tax.html`. Client-only; no account, API, database, or publication change.

## Rules and scope

- Rule snapshot: 2026-09-23, individual ordinary housing. `RULES.sources` in `js/holding-tax.js` links the primary references.
- UI defaults to **2027 reform scenario**, using the Aug 3 proposal plus Sep 1 revised government bill. An explicit selector restores the 2026 continuation scenario. Neither is enacted 2027 law. Property-tax temporary relief and fair-market ratios continue at 2026 values in both scenarios.
- Market mode converts each year's market price with that year's realization assumption. Assessed mode bypasses realization entirely. 69% is the joint-housing default; actual assessed price takes precedence through the explicit mode switch.
- Main table defaults to 2026 before caps and 2027 with assessment/CRE caps, using 2026 calculated references. The cap switch restores both years before caps. Before-cap total and cap savings are included in the table and CSV. For two/three-home presets the total price is divided equally (remainder KRW distributed without losing value). Detail input supports unequal property values.
- Property tax uses the whole house to select the fair-market ratio and progressive rate, then apportions the tax to owners. Local education tax excludes the urban component. Owner totals exclude manually entered, unallocated resource-facility tax.
- CRE aggregates each owner's share. The property-tax credit follows the NTS declaration ratio: actually assessed property main tax × (CRE base × property fair-market ratio × 0.4%) / standard progressive property tax on aggregate property base. Credits cannot exceed main property tax or CRE gross tax.
- A spouse selected by agreement may be the special-rule taxpayer regardless of share (2026 change). Only that spouse's age/holding period is used; the 2026 ordinary joint mode has individual 900-million deductions and no single-owner credits.
- Integer KRW intermediates and 10-KRW payable truncation produce annual estimates. Installment-specific truncation, small-tax collection exemptions, local ordinance adjustments, special exemptions and excluded property types are not simulated.

## Detail caps

2027 caps default on in the table. Detail has separate 2026/2027 cap switches; 2026 requires 2025 inputs. Detail changes never broadcast to other table rows. Missing values remain `null`, not zero. The table does not assume eligibility for pre-2023 property-tax burden-cap transitions; that remains a detail-only choice.

1. Assessment cap: prior assessed price × **current** property ratio + 5% × current uncapped assessment; take the smaller assessment. Do not multiply last year's tax base by 1.05.
2. Transitional burden cap: only when the property was taxed by 2022. Through 2028, compare each of property main and urban components to its entered previous-year equivalent at 105%, 110%, or 130% according to current full-house assessed price.
3. CRE burden cap: current property main plus CRE cannot exceed 150% of the entered previous total-tax equivalent; only CRE is reduced, to a minimum of zero. Supplementary taxes are excluded from this comparison.
4. Next-year references assume unchanged houses and ownership. Use the current assessed price for the next assessment cap. Recompute the current CRE total-tax equivalent without the previous burden-cap reductions (decree article 5), retaining assessment-cap treatment. The UI excludes acquisition, demolition, extension and ownership changes from this automatic carry-forward case.

## Verification

Run `npm run verify:holding-tax` for calculator-only changes. This runs focused tests
and packages 11 calculator/shared UI files into `cloudflare/dist/holding-tax-local`.
It does not generate or validate sale/jeonse/monthly-rent regional caches, modify the
full deployment output, or publish anything. `npm run build` remains the full release
build and should not be run just to verify this calculator. The local preview reads
source files directly, so a browser reload is enough after calculator edits.

Independent arithmetic anchors (2026, single household, no age/holding credits, urban included, no caps):

| Assessed price | Main property | Urban | Education | CRE | Rural | Annual total |
|---|---:|---:|---:|---:|---:|---:|
| 600,000,000 | 348,000 | 369,600 | 69,600 | 0 | 0 | 787,200 |
| 2,000,000,000 | 2,970,000 | 1,260,000 | 594,000 | 1,896,000 | 379,200 | 7,099,200 |

Tests cover rate and deduction boundaries, zero/missing values, separate property and CRE caps, co-ownership, taxpayer selection, combined credit ceiling, annual transitions, unequal property values, sum reconciliation, price conversion, public asset packaging and cache dependency mapping.

UI checks: default 48 rows; 10% growth; assessed-input bypass; detail/table parity; spouse credit and three-way joint comparison; cap missing-input messages; resource tax input; invalid range recovery; CSV; light/dark appearance; 390px horizontal table with sticky header/first column. Preview: `npm run preview`, then `/calc/holding-tax.html` on port 8793.

## 2027 reform snapshot (checked 2026-09-23)

Primary sources: [Aug 3 detailed proposal, pp.60–64](https://www.mofe.go.kr/nw/nes/detailNesDtaView.do?searchNttId1=MOSF_000000000078809), [Sep 1 government bill amendments, items 3–4](https://www.mofe.go.kr/nw/nes/detailNesDtaView.do?searchNttId1=MOSF_000000000079193). Downloaded HWPX originals were inspected, including the separate eligibility threshold and staged 2027 rate table. The ministry landing-page FAQ still describes the original nonresident deduction, so the later amendment takes precedence.

- Entry gate: single-house taxpayer assessed value > 1.4bn; other taxpayer > 0.9bn. This is distinct from deductions and checked per taxpayer, including joint owners.
- Deductions: single resident 1.4bn / nonresident 1.2bn; ordinary joint one-house resident 0.9bn each / nonresident 0.6bn each; others 0.4bn + 0.5bn × resident assessed share / total assessed share.
- CRE fair-market ratio 70% for all supported 2027 cases. This does not replace or change the independent 69% realization assumption.
- 2027 marginal rates at the existing 3/6/12/25/50/94억 boundaries: up to two houses 0.5/0.7/1.3/1.5/2/2.7/3.5%; three or more 0.5/0.7/1.3/2/3/4/5%. The 2028 unified rates are deliberately not used.
- Age credit unchanged. Period credit is max(half of old holding credit, residence credit), with 5/10/15-year residence rates 20/40/50%; combined percentage <=80%, total credit <=8m KRW. Prior residence can count even when currently nonresident. Inactive special spouse has no credit.
- CRE burden cap remains 150%, superseding the original proposed 200%.
- Household uses the same residence in both years; spouses share residence in supported presets. Periods are entered for 2026 and increase one year when resident. Detail has explicit 2027 residence years. Statutory deemed-residence exceptions are not automatically classified.
- The unequal-value detail recomputes the residence fraction and retains the selected proposal. CSV identifies policy, residence and period assumptions.
- Independent 20억 assessed resident example, no credits/caps: 2027 gross CRE 2,340,000, property overlap 756,000, CRE 1,584,000, rural 316,800, annual total 6,724,800 KRW.


## Transaction tables and market-value percentages

Holding totals now show annual tax / same-year market value (including next-year price growth), with CSV percentage columns. Direct assessed-price input and zero market value leave the percentage unavailable.

The separate single-property transaction calculator uses frozen 2026 current rules, not the holding-tax reform scenario or a future law forecast. Acquisition compares prices with household counts, adjusted-area surcharges and national housing size. CGT compares six months, one year, and complete years through a selectable maximum of 30. Purchase/sale prices stay fixed to isolate tenure. Residence, single-house exemption and 12억 high-price allocation, long-term deduction, short-term rates, adjusted-area multi-house surcharges, local income tax and remaining annual basic deduction are modeled. Acquisition taxes are automatically included in deductible costs; other costs are additional. Special relief and transition eligibility require the user's explicit settings; joint ownership and corporate/unregistered transactions are outside scope.

Sources: Seoul ETAX AcqutaxCalcAction.view; NTS cntntsId 7710/7711/8799 and press release nttSn 1349339. Tests include that release's 10억 purchase / 20억 sale / 15-year holding examples (national tax 257,010,000 / 582,510,000 / 682,260,000 KRW). `verify:holding-tax` passes 33 tests and packages 13 assets without regional cache generation. Browser checked percentage rendering, input recalculation and the 12억 exemption boundary.

CGT uses direct purchase and sale prices. Gross profit is calculated automatically and is not an editable input. The purchase price in the acquisition section is shared with CGT. Both prices and the cost bridge appear above the table. CGT amounts include explicit 억/만원 units; the table includes total sale tax / gross profit.

The transaction UI now has one tenure-based purchase/sale table. Independent acquisition price-range inputs/table were removed. Rows show both prices, gross gain, acquisition taxes, national/local sale taxes, combined tax and net profit. Acquisition tax is included once in each alternative, not accumulated annually. Tax/gain ratio now includes acquisition taxes; net profit still deducts acquisition costs exactly once.
