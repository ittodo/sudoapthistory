(function(){
  const state = {
    index: null,
    stats: null,
    rows: [],
    filteredRows: [],
    trendChart: null,
    currentChart: null,
    selectedRegion: "",
    selectedGu: "",
    selectedDong: "",
    selectedBucket: "",
  };

  const regionLabels = { "0": "경기", "1": "서울", "2": "인천" };
  const colors = ["#64748b", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#f97316"];

  const $ = (id) => document.getElementById(id);
  const fmtUnits = (v) => `${Math.round(v || 0).toLocaleString()}세대`;
  const fmtPct = (v) => `${(v || 0).toFixed(1)}%`;
  const fmtPrice = (v) => v > 0 ? `${Number(v).toFixed(2)}억` : "-";
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
    for (const id of ["areaMin", "areaMax", "searchInput"]) {
      $(id).addEventListener("input", renderRows);
    }

    state.filteredRows = rows;
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

  function renderKpis(scope) {
    const buckets = state.stats.meta.buckets;
    const currentUnits = scope.current.units || 0;
    const coverageUnits = scope.coverage.units || 0;
    const over10 = scope.current.buckets.slice(2).reduce((a, b) => a + b, 0);
    const over20 = scope.current.buckets.slice(3).reduce((a, b) => a + b, 0);
    const over50 = scope.current.buckets[6] || 0;
    const topBucketIndex = scope.current.buckets.reduce((best, value, i, arr) => value > arr[best] ? i : best, 0);
    const cards = [
      ["가격 확인 세대", fmtUnits(currentUnits), `커버리지 ${fmtPct(coverageUnits ? currentUnits / coverageUnits * 100 : 0)}`],
      ["10억 이상", fmtUnits(over10), fmtPct(currentUnits ? over10 / currentUnits * 100 : 0)],
      ["20억 이상", fmtUnits(over20), fmtPct(currentUnits ? over20 / currentUnits * 100 : 0)],
      ["50억 이상", fmtUnits(over50), fmtPct(currentUnits ? over50 / currentUnits * 100 : 0)],
      ["최대 구간", buckets[topBucketIndex].label, fmtUnits(scope.current.buckets[topBucketIndex] || 0)],
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
    if (state.currentChart) state.currentChart.destroy();
    state.currentChart = new Chart($("currentChart"), {
      type: "bar",
      data: {
        labels: state.stats.meta.buckets.map((b) => b.label),
        datasets: [{
          label: "세대수",
          data: scope.current.buckets,
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
          tooltip: { callbacks: { label: (ctx) => fmtUnits(ctx.parsed.x) } },
        },
        scales: {
          x: { ticks: { callback: (v) => `${Math.round(v / 1000).toLocaleString()}천` } },
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

  function childScopes(scope) {
    const key = scopeKey();
    return Object.entries(state.stats.scopes)
      .filter(([, child]) => child.parent === key)
      .map(([childKey, child]) => ({ key: childKey, scope: child }))
      .sort((a, b) => (b.scope.current.units || 0) - (a.scope.current.units || 0));
  }

  function renderChildren(scope) {
    const bucketHeaders = state.stats.meta.buckets.map((b) => `<th class="num">${b.label}</th>`).join("");
    $("childHead").innerHTML = `<tr><th>지역</th><th class="num">합계</th>${bucketHeaders}</tr>`;
    const children = childScopes(scope).slice(0, 80);
    $("childCaption").textContent = children.length ? `${children.length.toLocaleString()}개 표시` : "하위 지역 없음";
    $("childBody").innerHTML = children.length ? children.map(({ scope: child }) => {
      const cells = child.current.buckets.map((v) => `<td class="num">${Math.round(v).toLocaleString()}</td>`).join("");
      return `<tr><td>${child.label}</td><td class="num">${Math.round(child.current.units).toLocaleString()}</td>${cells}</tr>`;
    }).join("") : `<tr><td class="empty-row" colspan="${state.stats.meta.buckets.length + 2}">표시할 하위 지역이 없습니다.</td></tr>`;
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
      return `<tr>
        <td class="name" title="${row.n || ""}">${row.n || "-"}</td>
        <td>${row.g || "-"} <span class="muted-cell">${row.d || ""}</span></td>
        <td class="num">${py ? py.toFixed(1) : "-"}평</td>
        <td class="num">${fmtPrice(row.lp)}</td>
        <td class="num">${Number(row.u || 0).toLocaleString()}</td>
        <td><span class="bucket-chip">${bucket}</span></td>
        <td class="num muted-cell">${row.ld || "-"}</td>
      </tr>`;
    }).join("") : `<tr><td class="empty-row" colspan="7">조건에 맞는 평형이 없습니다.</td></tr>`;
  }

  function renderCaptions(scope) {
    const label = scope.label || "전체";
    $("trendCaption").textContent = `${label} | 연도별 평균가 기준`;
    $("currentCaption").textContent = `${label} | 최근가 lp 기준`;
    $("statsMeta").textContent = `${state.stats.meta.updated || "-"} 업데이트 | ${state.stats.meta.indexRows.toLocaleString()}개 평형 | prices extra key ${state.stats.meta.extraPriceKeys}`;
  }

  function render() {
    const scope = currentScope();
    renderKpis(scope);
    renderTrendChart(scope);
    renderCurrentChart(scope);
    renderChildren(scope);
    renderCaptions(scope);
    renderRows();
  }

  async function init() {
    try {
      chartDefaults();
      const [stats, index] = await Promise.all([
        loadJson("../data/price_bands.json"),
        loadJson("../data/index.json"),
      ]);
      state.stats = stats;
      state.index = index;
      state.rows = index.d || [];
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
