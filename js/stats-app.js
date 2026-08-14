(function(){
  const state = {
    index: null,
    stats: null,
    taxActuals: null,
    rows: [],
    filteredRows: [],
    trendChart: null,
    currentChart: null,
    liquidityChart: null,
    taxChart: null,
    currentMetric: "units",
    liquidityMetric: "turnover",
    selectedLiquidityYear: null,
    taxMetric: "holding",
    selectedRegion: "",
    selectedGu: "",
    selectedDong: "",
    selectedBucket: "",
  };

  const regionLabels = { "0": "경기", "1": "서울", "2": "인천" };
  const colors = ["#64748b", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#f97316"];
  const dataVersion = "20260814-turnover1";

  const $ = (id) => document.getElementById(id);
  const fmtUnits = (v) => `${Math.round(v || 0).toLocaleString()}세대`;
  const fmtTransactions = (v) => `${Math.round(v || 0).toLocaleString()}건`;
  const fmtPct = (v) => `${(v || 0).toFixed(1)}%`;
  const fmtTurnover = (v) => `${(v || 0).toFixed(2)}%`;
  const fmtPrice = (v) => v > 0 ? `${Number(v).toFixed(2)}억` : "-";
  const fmtTrillion = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n <= 0) return "-";
    return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}조`;
  };
  const fmtCap = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n <= 0) return "-";
    if (n >= 10000) return `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조`;
    return `${Math.round(n).toLocaleString()}억`;
  };
  const fmtTax = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n <= 0) return "-";
    if (n >= 1) return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}조`;
    return `${Math.round(n * 10000).toLocaleString()}억`;
  };
  const pyeong = (row) => row.a ? row.a / 3.3058 : 0;

  function bucketIndex(price) {
    const buckets = state.stats.meta.buckets;
    if (!Number.isFinite(price) || price <= 0) return -1;
    return buckets.findIndex((b) => price >= b.min && (b.max == null || price < b.max));
  }

  function scopeKey() {
    if (state.selectedDong) return `d:${state.selectedGu}|${state.selectedDong}`;
    if (state.selectedGu) return `g:${state.selectedGu}`;
    if (state.selectedRegion !== "") return `r:${state.selectedRegion}`;
    return "all";
  }

  function currentScope() {
    return state.stats.scopes[scopeKey()] || state.stats.scopes.all;
  }

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  function fillSelect(select, options, placeholder) {
    select.innerHTML = "";
    select.appendChild(new Option(placeholder, ""));
    for (const opt of options) select.appendChild(new Option(opt.label, opt.value));
  }

  function initFilters() {
    const rows = state.rows;
    fillSelect($("regionSelect"), [
      { value: "1", label: "서울" },
      { value: "0", label: "경기" },
      { value: "2", label: "인천" },
    ], "전체");

    fillSelect($("bucketSelect"), state.stats.meta.buckets.map((b, i) => ({ value: String(i), label: b.label })), "전체");
    const latestCompleteYear = Number(state.stats.meta.latestCompleteYear || 0);
    const latestYear = state.stats.meta.years.at(-1);
    state.selectedLiquidityYear = latestCompleteYear || latestYear;
    fillSelect($("liquidityYearSelect"), state.stats.meta.years.slice().reverse().map((year) => ({
      value: String(year),
      label: year > latestCompleteYear ? `${year} YTD` : String(year),
    })), "연도");
    $("liquidityYearSelect").value = String(state.selectedLiquidityYear || "");
    updateGuOptions();
    updateDongOptions();

    $("regionSelect").addEventListener("change", (e) => {
      state.selectedRegion = e.target.value;
      state.selectedGu = "";
      state.selectedDong = "";
      updateGuOptions();
      updateDongOptions();
      render();
    });
    $("guSelect").addEventListener("change", (e) => {
      state.selectedGu = e.target.value;
      state.selectedDong = "";
      updateDongOptions();
      render();
    });
    $("dongSelect").addEventListener("change", (e) => {
      state.selectedDong = e.target.value;
      render();
    });
    $("bucketSelect").addEventListener("change", (e) => {
      state.selectedBucket = e.target.value;
      renderRows();
    });
    $("chartUnitsBtn").addEventListener("click", () => setCurrentMetric("units"));
    $("chartCapBtn").addEventListener("click", () => setCurrentMetric("cap"));
    $("liquidityYearSelect").addEventListener("change", (e) => {
      state.selectedLiquidityYear = Number(e.target.value || state.stats.meta.latestCompleteYear);
      renderLiquidity(currentScope());
    });
    $("liquidityTurnoverBtn").addEventListener("click", () => setLiquidityMetric("turnover"));
    $("liquidityTransactionsBtn").addEventListener("click", () => setLiquidityMetric("transactions"));
    $("taxHoldingBtn").addEventListener("click", () => setTaxMetric("holding"));
    $("taxCreBtn").addEventListener("click", () => setTaxMetric("cre"));
    $("taxAcquisitionBtn").addEventListener("click", () => setTaxMetric("acquisition"));
    $("taxCapitalGainsBtn").addEventListener("click", () => setTaxMetric("capitalGains"));
    $("taxRateBtn").addEventListener("click", () => setTaxMetric("holdingRate"));
    for (const id of ["areaMin", "areaMax", "searchInput"]) {
      $(id).addEventListener("input", renderRows);
    }

    state.filteredRows = rows;
  }

  function setCurrentMetric(metric) {
    state.currentMetric = metric;
    $("chartUnitsBtn").classList.toggle("active", metric === "units");
    $("chartCapBtn").classList.toggle("active", metric === "cap");
    renderCurrentChart(currentScope());
  }

  function setLiquidityMetric(metric) {
    state.liquidityMetric = metric;
    $("liquidityTurnoverBtn").classList.toggle("active", metric === "turnover");
    $("liquidityTransactionsBtn").classList.toggle("active", metric === "transactions");
    renderLiquidityChart(currentScope());
  }

  function setTaxMetric(metric) {
    state.taxMetric = metric;
    $("taxHoldingBtn").classList.toggle("active", metric === "holding");
    $("taxCreBtn").classList.toggle("active", metric === "cre");
    $("taxAcquisitionBtn").classList.toggle("active", metric === "acquisition");
    $("taxCapitalGainsBtn").classList.toggle("active", metric === "capitalGains");
    $("taxRateBtn").classList.toggle("active", metric === "holdingRate");
    renderTaxActuals();
  }

  function updateGuOptions() {
    const gus = Array.from(new Set(state.rows
      .filter((row) => state.selectedRegion === "" || String(row.r) === state.selectedRegion)
      .map((row) => row.g)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
    fillSelect($("guSelect"), gus.map((g) => ({ value: g, label: g })), "전체");
    $("guSelect").value = state.selectedGu;
  }

  function updateDongOptions() {
    const dongs = Array.from(new Set(state.rows
      .filter((row) => state.selectedRegion === "" || String(row.r) === state.selectedRegion)
      .filter((row) => !state.selectedGu || row.g === state.selectedGu)
      .map((row) => row.d)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
    fillSelect($("dongSelect"), dongs.map((d) => ({ value: d, label: d })), "전체");
    $("dongSelect").value = state.selectedDong;
  }

  function ensureMarketCapFields(stats, rows) {
    const buckets = stats.meta.buckets || [];
    const scopeEntries = Object.entries(stats.scopes || {});
    const needsCurrentRepair = scopeEntries.some(([, scope]) => !Array.isArray(scope.current?.marketCapByBucketEok));
    if (!needsCurrentRepair) return;

    for (const [, scope] of scopeEntries) {
      scope.current.marketCapEok = 0;
      scope.current.marketCapByBucketEok = Array(buckets.length).fill(0);
    }

    for (const row of rows) {
      const units = Number(row.u || 0);
      const price = Number(row.lp || 0);
      const bi = bucketIndex(price);
      if (units <= 0 || bi < 0) continue;
      const marketCap = units * price;
      const keys = ["all", `r:${row.r}`, `g:${row.g}`, `d:${row.g}|${row.d}`];
      for (const key of keys) {
        const scope = stats.scopes[key];
        if (!scope) continue;
        scope.current.marketCapEok += marketCap;
        scope.current.marketCapByBucketEok[bi] += marketCap;
      }
    }
  }

  function renderKpis(scope) {
    const buckets = state.stats.meta.buckets;
    const currentUnits = scope.current.units || 0;
    const coverageUnits = scope.coverage.units || 0;
    const marketCap = scope.current.marketCapEok || 0;
    const over10 = scope.current.buckets.slice(2).reduce((a, b) => a + b, 0);
    const over20 = scope.current.buckets.slice(3).reduce((a, b) => a + b, 0);
    const over10Cap = (scope.current.marketCapByBucketEok || []).slice(2).reduce((a, b) => a + b, 0);
    const over20Cap = (scope.current.marketCapByBucketEok || []).slice(3).reduce((a, b) => a + b, 0);
    const topBucketIndex = scope.current.buckets.reduce((best, value, i, arr) => value > arr[best] ? i : best, 0);
    const cards = [
      ["전체 시가총액", fmtCap(marketCap), "실거래 평균가 기반 추정"],
      ["평균 세대가", fmtPrice(currentUnits ? marketCap / currentUnits : 0), fmtUnits(currentUnits)],
      ["10억+ 시총", fmtCap(over10Cap), `${fmtUnits(over10)} · ${fmtPct(currentUnits ? over10 / currentUnits * 100 : 0)}`],
      ["20억+ 시총", fmtCap(over20Cap), `${fmtUnits(over20)} · ${fmtPct(currentUnits ? over20 / currentUnits * 100 : 0)}`],
      ["가격 확인 세대", fmtUnits(currentUnits), `커버리지 ${fmtPct(coverageUnits ? currentUnits / coverageUnits * 100 : 0)}`],
      ["최대 구간", buckets[topBucketIndex].label, `${fmtUnits(scope.current.buckets[topBucketIndex] || 0)} · ${fmtCap((scope.current.marketCapByBucketEok || [])[topBucketIndex] || 0)}`],
    ];
    $("kpis").innerHTML = cards.map(([label, value, sub]) => (
      `<div class="kpi-card"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`
    )).join("");
  }

  function chartDefaults() {
    Chart.defaults.color = "#94a3b8";
    Chart.defaults.borderColor = "rgba(51,65,85,.75)";
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  }

  function renderTrendChart(scope) {
    const years = state.stats.meta.years;
    const datasets = state.stats.meta.buckets.map((bucket, i) => ({
      label: bucket.label,
      data: scope.trend.buckets[i],
      backgroundColor: colors[i],
      borderWidth: 0,
    }));
    if (state.trendChart) state.trendChart.destroy();
    state.trendChart = new Chart($("trendChart"), {
      type: "bar",
      data: { labels: years, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtUnits(ctx.parsed.y)}` } },
        },
        scales: {
          x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: { stacked: true, ticks: { callback: (v) => `${Math.round(v / 10000).toLocaleString()}만` } },
        },
      },
    });
  }

  function renderCurrentChart(scope) {
    const isCap = state.currentMetric === "cap";
    const values = isCap ? (scope.current.marketCapByBucketEok || []) : scope.current.buckets;
    if (state.currentChart) state.currentChart.destroy();
    state.currentChart = new Chart($("currentChart"), {
      type: "bar",
      data: {
        labels: state.stats.meta.buckets.map((b) => b.label),
        datasets: [{
          label: isCap ? "시가총액" : "세대수",
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => isCap ? fmtCap(ctx.parsed.x) : fmtUnits(ctx.parsed.x) } },
        },
        scales: {
          x: { ticks: { callback: (v) => isCap ? fmtCap(v) : `${Math.round(v / 1000).toLocaleString()}천` } },
          y: { ticks: { autoSkip: false } },
        },
        onClick: (_, elements) => {
          if (!elements.length) return;
          state.selectedBucket = String(elements[0].index);
          $("bucketSelect").value = state.selectedBucket;
          renderRows();
        },
      },
    });
  }

  function liquiditySnapshot(scope) {
    const years = state.stats.meta.years || [];
    const year = Number(state.selectedLiquidityYear || state.stats.meta.latestCompleteYear || years.at(-1));
    const yi = years.indexOf(year);
    const unitsByBucket = state.stats.meta.buckets.map((_, i) => Number(scope.trend?.buckets?.[i]?.[yi] || 0));
    const transactionsByBucket = state.stats.meta.buckets.map((_, i) => Number(scope.liquidity?.transactionsByBucket?.[i]?.[yi] || 0));
    const turnoverByBucket = unitsByBucket.map((units, i) => units > 0 ? transactionsByBucket[i] / units * 100 : 0);
    const units = unitsByBucket.reduce((sum, value) => sum + value, 0);
    const transactions = transactionsByBucket.reduce((sum, value) => sum + value, 0);
    const rawTransactions = Number(scope.coverage?.allTransactionsByYear?.[yi] || 0);
    let topBucketIndex = -1;
    turnoverByBucket.forEach((value, i) => {
      if (transactionsByBucket[i] > 0 && (topBucketIndex < 0 || value > turnoverByBucket[topBucketIndex])) topBucketIndex = i;
    });
    return { year, yi, unitsByBucket, transactionsByBucket, turnoverByBucket, units, transactions, rawTransactions, topBucketIndex };
  }

  function renderLiquidityKpis(scope) {
    const snap = liquiditySnapshot(scope);
    const latestCompleteYear = Number(state.stats.meta.latestCompleteYear || 0);
    const yearLabel = snap.year > latestCompleteYear ? `${snap.year} YTD` : `${snap.year}년`;
    const overallTurnover = snap.units > 0 ? snap.transactions / snap.units * 100 : 0;
    const coverage = snap.rawTransactions > 0 ? snap.transactions / snap.rawTransactions * 100 : 0;
    const topLabel = snap.topBucketIndex >= 0 ? state.stats.meta.buckets[snap.topBucketIndex].label : "-";
    const topTurnover = snap.topBucketIndex >= 0 ? snap.turnoverByBucket[snap.topBucketIndex] : 0;
    const cards = [
      [`${yearLabel} 거래량`, fmtTransactions(snap.transactions), `원자료 ${fmtTransactions(snap.rawTransactions)}`],
      [`${yearLabel} 회전율`, fmtTurnover(overallTurnover), `${fmtUnits(snap.units)} 기준`],
      ["거래량 커버리지", fmtPct(coverage), "세대수·가격대 확인 거래 기준"],
      ["최고 회전 가격대", topLabel, topLabel === "-" ? "거래 없음" : fmtTurnover(topTurnover)],
    ];
    $("liquidityKpis").innerHTML = cards.map(([label, value, sub]) => (
      `<div class="liquidity-mini"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`
    )).join("");
  }

  function renderLiquidityChart(scope) {
    const snap = liquiditySnapshot(scope);
    const isTurnover = state.liquidityMetric === "turnover";
    const values = isTurnover ? snap.turnoverByBucket : snap.transactionsByBucket;
    if (state.liquidityChart) state.liquidityChart.destroy();
    state.liquidityChart = new Chart($("liquidityChart"), {
      type: "bar",
      data: {
        labels: state.stats.meta.buckets.map((bucket) => bucket.label),
        datasets: [{
          label: isTurnover ? "회전율" : "거래건수",
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => {
            const i = ctx.dataIndex;
            return isTurnover
              ? `회전율 ${fmtTurnover(ctx.parsed.x)} · ${fmtTransactions(snap.transactionsByBucket[i])} / ${fmtUnits(snap.unitsByBucket[i])}`
              : `${fmtTransactions(ctx.parsed.x)} · 회전율 ${fmtTurnover(snap.turnoverByBucket[i])}`;
          } } },
        },
        scales: {
          x: { beginAtZero: true, ticks: { callback: (v) => isTurnover ? fmtTurnover(v) : Math.round(v).toLocaleString() } },
          y: { ticks: { autoSkip: false } },
        },
      },
    });
  }

  function renderLiquidityTable(scope) {
    const snap = liquiditySnapshot(scope);
    $("liquidityBody").innerHTML = state.stats.meta.buckets.map((bucket, i) => {
      const transactionShare = snap.transactions > 0 ? snap.transactionsByBucket[i] / snap.transactions * 100 : 0;
      return `<tr>
        <td><span class="bucket-chip">${bucket.label}</span></td>
        <td class="num">${Math.round(snap.unitsByBucket[i]).toLocaleString()}</td>
        <td class="num">${Math.round(snap.transactionsByBucket[i]).toLocaleString()}</td>
        <td class="num">${fmtPct(transactionShare)}</td>
        <td class="num">${fmtTurnover(snap.turnoverByBucket[i])}</td>
      </tr>`;
    }).join("");
  }

  function renderLiquidity(scope) {
    const snap = liquiditySnapshot(scope);
    const latestCompleteYear = Number(state.stats.meta.latestCompleteYear || 0);
    const label = scope.label || "전체";
    const yearLabel = snap.year > latestCompleteYear ? `${snap.year} YTD` : `${snap.year}년`;
    const coverage = snap.rawTransactions > 0 ? snap.transactions / snap.rawTransactions * 100 : 0;
    $("liquidityCaption").textContent = `${label} | ${yearLabel} | 거래량 커버리지 ${fmtPct(coverage)}`;
    renderLiquidityKpis(scope);
    renderLiquidityChart(scope);
    renderLiquidityTable(scope);
  }

  function childScopes(scope) {
    const key = scopeKey();
    return Object.entries(state.stats.scopes)
      .filter(([, child]) => child.parent === key)
      .map(([childKey, child]) => ({ key: childKey, scope: child }))
      .sort((a, b) => (b.scope.current.marketCapEok || 0) - (a.scope.current.marketCapEok || 0));
  }

  function renderBuckets(scope) {
    const totalUnits = scope.current.units || 0;
    const totalCap = scope.current.marketCapEok || 0;
    $("bucketHead").innerHTML = "<tr><th>가격대</th><th class=\"num\">세대수</th><th class=\"num\">세대수 %</th><th class=\"num\">시가총액</th><th class=\"num\">시총 %</th><th class=\"num\">평균가</th></tr>";
    $("bucketCaption").textContent = `${fmtUnits(totalUnits)} · ${fmtCap(totalCap)}`;
    $("bucketBody").innerHTML = state.stats.meta.buckets.map((bucket, i) => {
      const units = scope.current.buckets[i] || 0;
      const cap = (scope.current.marketCapByBucketEok || [])[i] || 0;
      return `<tr>
        <td><span class="bucket-chip">${bucket.label}</span></td>
        <td class="num">${Math.round(units).toLocaleString()}</td>
        <td class="num">${fmtPct(totalUnits ? units / totalUnits * 100 : 0)}</td>
        <td class="num">${fmtCap(cap)}</td>
        <td class="num">${fmtPct(totalCap ? cap / totalCap * 100 : 0)}</td>
        <td class="num">${fmtPrice(units ? cap / units : 0)}</td>
      </tr>`;
    }).join("");
  }

  function renderChildren(scope) {
    const totalUnits = scope.current.units || 0;
    const totalCap = scope.current.marketCapEok || 0;
    $("childHead").innerHTML = "<tr><th>지역</th><th class=\"num\">세대수</th><th class=\"num\">세대수 %</th><th class=\"num\">시가총액</th><th class=\"num\">시총 %</th><th class=\"num\">평균가</th></tr>";
    const children = childScopes(scope).slice(0, 80);
    $("childCaption").textContent = children.length ? `${children.length.toLocaleString()}개 표시` : "하위 지역 없음";
    $("childBody").innerHTML = children.length ? children.map(({ scope: child }) => {
      const units = child.current.units || 0;
      const cap = child.current.marketCapEok || 0;
      return `<tr>
        <td>${child.label}</td>
        <td class="num">${Math.round(units).toLocaleString()}</td>
        <td class="num">${fmtPct(totalUnits ? units / totalUnits * 100 : 0)}</td>
        <td class="num">${fmtCap(cap)}</td>
        <td class="num">${fmtPct(totalCap ? cap / totalCap * 100 : 0)}</td>
        <td class="num">${fmtPrice(units ? cap / units : 0)}</td>
      </tr>`;
    }).join("") : "<tr><td class=\"empty-row\" colspan=\"6\">표시할 하위 지역이 없습니다.</td></tr>";
  }

  function renderTaxActuals() {
    if (!state.taxActuals) return;
    const regions = state.taxActuals.regions || [];
    const selected = state.selectedRegion === ""
      ? regions.filter((region) => ["national", "capital", "seoul", "gyeonggi", "incheon"].includes(region.key))
      : regions.filter((region) => String(region.regionCode) === state.selectedRegion);
    const shown = selected.length ? selected : regions.filter((region) => region.key === "national");
    const years = Array.from(new Set(shown.flatMap((region) => region.series.map((row) => row.year)))).sort((a, b) => a - b);
    const palette = ["#38bdf8", "#f59e0b", "#22c55e", "#a855f7", "#f97316"];
    const metricLabel = {
      holding: "보유세",
      cre: "종부세",
      acquisition: "취득세",
      capitalGains: "양도세",
      holdingRate: "보유세/시총",
    }[state.taxMetric] || "보유세";
    const rowValue = (region, row) => {
      const propertyTax = Number(row.propertyTax?.taxTrillion || 0);
      const creTax = Number(row.comprehensiveRealEstateTax?.taxTrillion || 0);
      const hasHoldingTax = Boolean(row.propertyTax && row.comprehensiveRealEstateTax);
      const holdingTax = hasHoldingTax ? propertyTax + creTax : 0;
      if (state.taxMetric === "holding") return holdingTax || null;
      if (state.taxMetric === "cre") return creTax || null;
      if (state.taxMetric === "acquisition") return Number(row.acquisitionTax?.taxTrillion || 0) || null;
      if (state.taxMetric === "capitalGains") return Number(row.capitalGainsTax?.taxTrillion || 0) || null;
      const cap = marketCapTrillion(region, row.year);
      return cap && holdingTax ? holdingTax / cap * 100 : null;
    };
    const datasets = shown.map((region, i) => ({
      label: `${region.label} ${metricLabel}`,
      data: years.map((year) => {
        const row = region.series.find((item) => item.year === year);
        return row ? rowValue(region, row) : null;
      }),
      backgroundColor: palette[i % palette.length],
      borderWidth: 0,
    }));
    if (state.taxChart) state.taxChart.destroy();
    state.taxChart = new Chart($("taxChart"), {
      type: "bar",
      data: {
        labels: years,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${state.taxMetric === "holdingRate" ? fmtPct(ctx.parsed.y) : fmtTax(ctx.parsed.y)}` } },
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
          y: { ticks: { callback: (v) => state.taxMetric === "holdingRate" ? fmtPct(v) : fmtTax(v) } },
        },
      },
    });
    $("taxCaption").textContent = state.selectedRegion === ""
      ? "전국·수도권·서울·경기·인천 | 공식 주택분 세수"
      : `${shown[0]?.label || "선택 지역"} | 공식 주택분 세수`;
    const tableRows = shown.flatMap((region) => region.series.map((row) => ({ region, row })))
      .sort((a, b) => b.row.year - a.row.year || a.region.label.localeCompare(b.region.label, "ko"));
    $("taxBody").innerHTML = tableRows.map(({ region, row }) => {
      const propertyTax = Number(row.propertyTax?.taxTrillion || 0);
      const creTax = Number(row.comprehensiveRealEstateTax?.taxTrillion || 0);
      const hasHoldingTax = Boolean(row.propertyTax && row.comprehensiveRealEstateTax);
      const holdingTax = hasHoldingTax ? propertyTax + creTax : 0;
      const acquisitionTax = Number(row.acquisitionTax?.taxTrillion || 0);
      const capitalGainsTax = Number(row.capitalGainsTax?.taxTrillion || 0);
      const cap = marketCapTrillion(region, row.year);
      const bases = [row.propertyTax, row.comprehensiveRealEstateTax, row.acquisitionTax, row.capitalGainsTax]
        .filter(Boolean)
        .map((tax) => `${tax.source || "-"} ${tax.basis || ""}`.trim());
      return (
      `<tr>
        <td>${region.label}</td>
        <td>${row.year}</td>
        <td class="num">${fmtTax(cap)}</td>
        <td class="num">${fmtTax(propertyTax)}</td>
        <td class="num">${fmtTax(creTax)}</td>
        <td class="num">${fmtTax(holdingTax)}</td>
        <td class="num">${cap && holdingTax ? fmtPct(holdingTax / cap * 100) : "-"}</td>
        <td class="num">${fmtTax(acquisitionTax)}</td>
        <td class="num">${fmtTax(capitalGainsTax)}</td>
        <td>${Array.from(new Set(bases)).join(" · ") || "-"}</td>
      </tr>`
      );
    }).join("");
    $("taxNote").textContent = (state.taxActuals.meta.notes || []).join(" ");
  }

  function marketCapTrillion(region, year) {
    const scopeKey = region.marketCapScope;
    if (!scopeKey) return 0;
    const yi = (state.stats.meta.years || []).indexOf(year);
    if (yi < 0) return 0;
    const scope = state.stats.scopes[scopeKey];
    const eok = scope?.trend?.marketCapByYearEok?.[yi] || 0;
    return eok / 10000;
  }

  function rowMatchesScope(row) {
    if (state.selectedRegion !== "" && String(row.r) !== state.selectedRegion) return false;
    if (state.selectedGu && row.g !== state.selectedGu) return false;
    if (state.selectedDong && row.d !== state.selectedDong) return false;
    return true;
  }

  function renderRows() {
    const areaMin = Number($("areaMin").value || 0);
    const areaMax = Number($("areaMax").value || 0);
    const q = $("searchInput").value.trim().toLowerCase();
    const selectedBucket = state.selectedBucket === "" ? -1 : Number(state.selectedBucket);
    const rows = state.rows.filter((row) => {
      if (!rowMatchesScope(row)) return false;
      const units = Number(row.u || 0);
      if (units <= 0 || !(row.lp > 0)) return false;
      const py = pyeong(row);
      if (areaMin && py < areaMin) return false;
      if (areaMax && py > areaMax) return false;
      if (selectedBucket >= 0 && bucketIndex(Number(row.lp || 0)) !== selectedBucket) return false;
      if (q) {
        const hay = `${row.n || ""} ${row.g || ""} ${row.d || ""} ${row.j || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => Number(b.u || 0) - Number(a.u || 0)).slice(0, 300);

    $("rowCaption").textContent = `${rows.length.toLocaleString()}개 표시`;
    $("rowBody").innerHTML = rows.length ? rows.map((row) => {
      const bi = bucketIndex(Number(row.lp || 0));
      const bucket = bi >= 0 ? state.stats.meta.buckets[bi].label : "-";
      const py = pyeong(row);
      const cap = Number(row.u || 0) * Number(row.lp || 0);
      return `<tr>
        <td class="name" title="${row.n || ""}">${row.n || "-"}</td>
        <td>${row.g || "-"} <span class="muted-cell">${row.d || ""}</span></td>
        <td class="num">${py ? py.toFixed(1) : "-"}평</td>
        <td class="num">${fmtPrice(row.lp)}</td>
        <td class="num">${Number(row.u || 0).toLocaleString()}</td>
        <td class="num">${fmtCap(cap)}</td>
        <td><span class="bucket-chip">${bucket}</span></td>
        <td class="num muted-cell">${row.ld || "-"}</td>
      </tr>`;
    }).join("") : `<tr><td class="empty-row" colspan="8">조건에 맞는 평형이 없습니다.</td></tr>`;
  }

  function renderCaptions(scope) {
    const label = scope.label || "전체";
    const trendBasis = state.stats.meta.trendBasis === "yearly_average_price_carry_forward"
      ? "연도별 평균가·직전 유효가 이월 기준"
      : "연도별 평균가 기준";
    $("trendCaption").textContent = `${label} | ${trendBasis}`;
    $("currentCaption").textContent = `${label} | 최근가 lp 기준`;
    $("statsMeta").textContent = `${state.stats.meta.updated || "-"} 업데이트 | ${state.stats.meta.indexRows.toLocaleString()}개 평형 | 가격·거래량·세대수 결합`;
  }

  function render() {
    const scope = currentScope();
    renderKpis(scope);
    renderTrendChart(scope);
    renderCurrentChart(scope);
    renderLiquidity(scope);
    renderBuckets(scope);
    renderChildren(scope);
    renderTaxActuals();
    renderCaptions(scope);
    renderRows();
  }

  async function init() {
    try {
      chartDefaults();
      const [stats, index, taxActuals] = await Promise.all([
        loadJson(`../data/price_bands.json?v=${dataVersion}`),
        loadJson(`../data/index.json?v=${dataVersion}`),
        loadJson(`../data/tax_revenue_actuals.json?v=${dataVersion}`),
      ]);
      state.stats = stats;
      state.index = index;
      state.taxActuals = taxActuals;
      state.rows = index.d || [];
      ensureMarketCapFields(state.stats, state.rows);
      initFilters();
      render();
      $("loading").style.display = "none";
      $("app").style.display = "block";
    } catch (err) {
      console.error(err);
      $("loadMsg").textContent = "통계 로딩 실패";
    }
  }

  init();
})();
