// Battery charge chart (Wh and %) for last 24 hours

(function (ns) {
  const canvasEl = document.getElementById('chargeChart');
  if (!canvasEl || typeof Chart === 'undefined') return;

  const ctx = canvasEl.getContext('2d');

  let chargeTimestamps = [];
  let chargeWhs = [];
  let chargeFulls = [];
  let chargePercents = [];
  let chargeFullDesigns = [];
  let chargeHealthPercents = [];
  let chargeCapacityWhs = [];

  let chargeSelectedStartTs = null;
  let chargeSelectedEndTs = null;
  let chargeSelectedStartIdx = null;
  let chargeSelectedEndIdx = null;
  let chargeIsDragging = false;
  let chargeDragStartIdx = null;
  let chargeDragEndIdx = null;
  let chargeHasUserSelection = false;

  function formatPercent(v) {
    if (v === null || Number.isNaN(v)) return '–';
    return v.toFixed(1);
  }

  function formatWh(v) {
    if (v === null || Number.isNaN(v)) return '–';
    return v.toFixed(2);
  }

  function formatDurationHours(h) {
    if (!Number.isFinite(h) || h <= 0) return '–';
    const totalMinutes = Math.round(h * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 12) {
      return `${h.toFixed(1)} h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  function updateChargeSelectionStats(startIdx, endIdx) {
    const slopeEl = document.getElementById('battery-stat-slope');
    if (!slopeEl) return;
    if (!chargePercents.length) {
      slopeEl.textContent = '–';
      return;
    }
    const n = chargePercents.length;
    const windowSize = Math.min(10, n);
    const s = n - windowSize;
    const e = n - 1;
    const subPercents = chargePercents.slice(s, e + 1);
    const subWhs = chargeWhs.slice(s, e + 1);
    const tsStart = chargeTimestamps[s];
    const tsEnd = chargeTimestamps[e];
    const dt = (tsEnd - tsStart) / 3600; // hours
    let slopeStr = '–';
    if (dt > 0.01) {
      const dPercent = subPercents[subPercents.length - 1] - subPercents[0];
      const dWh = subWhs[subWhs.length - 1] - subWhs[0];
      slopeStr = `${formatPercent(dPercent / dt)}%/hr, ${formatWh(dWh / dt)} W`;
    }
    slopeEl.textContent = slopeStr;
  }

  function chargeFindClosestIndexForTs(ts) {
    if (!chargeTimestamps.length || ts == null) return null;
    let bestIdx = 0;
    let bestDiff = Math.abs(chargeTimestamps[0] - ts);
    for (let i = 1; i < chargeTimestamps.length; i++) {
      const d = Math.abs(chargeTimestamps[i] - ts);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  const selectionPlugin = {
    id: 'chargeSelectionHighlight',
    beforeDraw(chart) {
      if (!chart.canvas || chart.canvas !== canvasEl) return;
      const xScale = chart.scales.x;
      const { ctx, chartArea } = chart;
      if (!xScale || !chartArea) return;
      const { top, bottom } = chartArea;

      function drawBand(startIdx, endIdx, color) {
        if (startIdx == null || endIdx == null) return;
        const s = Math.max(0, Math.min(startIdx, endIdx));
        const e = Math.min(chargePercents.length - 1, Math.max(startIdx, endIdx));
        if (e <= s) return;
        const x1 = xScale.getPixelForValue(s);
        const x2 = xScale.getPixelForValue(e);
        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(x1, top, x2 - x1, bottom - top);
        ctx.restore();
      }

      if (chargeHasUserSelection) {
        drawBand(chargeSelectedStartIdx, chargeSelectedEndIdx, 'rgba(59,130,246,0.18)');
      }
      if (chargeIsDragging) {
        drawBand(chargeDragStartIdx, chargeDragEndIdx, 'rgba(96,165,250,0.3)');
      }
    }
  };

  Chart.register(selectionPlugin);

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Charge (Wh)',
          data: [],
          borderColor: 'rgba(0,0,0,0)',
          backgroundColor: 'rgba(0,0,0,0)',
          borderWidth: 0,
          pointRadius: 0,
          tension: 0.25,
          yAxisID: 'y',
          hidden: true
        },
        {
          label: 'Charge (% of design)',
          data: [],
          borderColor: '#fbbf24',
          backgroundColor: 'rgba(251,191,36,0.10)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          yAxisID: 'y1'
        },
        {
          label: 'Health max (%)',
          data: [],
          borderColor: '#f97316',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0,
          yAxisID: 'y1',
          fill: false
        },
        {
          label: 'Design 100% line',
          data: [],
          borderColor: '#9ca3af',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          yAxisID: 'y1',
          fill: false
        },
        {
          label: 'Max capacity (Wh)',
          data: [],
          borderColor: '#9ca3af',
          borderWidth: 1.5,
          borderDash: [5, 3],
          pointRadius: 0,
          tension: 0,
          yAxisID: 'y',
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            color: '#6b7280',
            maxTicksLimit: 8,
            callback: (value) => {
              const label = chart.data.labels[value];
              return label || '';
            }
          },
          grid: { color: 'rgba(31,41,55,0.4)' }
        },
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Wh', color: '#38bdf8' },
          min: 0,
          ticks: { color: '#38bdf8' },
          grid: { color: 'rgba(31,41,55,0.4)' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: '%', color: '#fbbf24' },
          min: 0,
          max: 100,
          ticks: { color: '#fbbf24' },
          grid: { drawOnChartArea: false }
        }
      },
      plugins: {
        legend: { labels: { color: '#9ca3af' } }
      }
    }
  });

  function updateChargeEta() {
    const etaEl = document.getElementById('charge-eta');
    if (!etaEl) return;

    if (!chargeWhs.length || !chargeFulls.length || ns.latestPowerW == null || !Number.isFinite(ns.latestPowerW) || Math.abs(ns.latestPowerW) < 0.1) {
      etaEl.textContent = '–';
      return;
    }

    const currentWh = chargeWhs[chargeWhs.length - 1];
    const fullWh = chargeFulls[chargeFulls.length - 1];
    const remainingWh = Math.max(fullWh - currentWh, 0);
    const p = Math.abs(ns.latestPowerW);

    let etaEmpty = null;
    let etaFull = null;

    if (p > 0) {
      if (ns.lastBatteryStatus === 'Discharging') {
        etaEmpty = currentWh / p;
      } else if (ns.lastBatteryStatus === 'Charging') {
        if (remainingWh > 0) {
          etaFull = remainingWh / p;
        }
      } else if (ns.lastBatteryStatus === 'Full') {
        // battery is full; no ETA needed
      } else {
        // Unknown status: estimate both directions
        etaEmpty = currentWh / p;
        if (remainingWh > 0) {
          etaFull = remainingWh / p;
        }
      }
    }

    let label = '–';
    if (etaEmpty && etaEmpty > 0.03 && (!etaFull || etaFull <= 0.03)) {
      label = `${formatDurationHours(etaEmpty)} to empty`;
    } else if (etaFull && etaFull > 0.03 && (!etaEmpty || etaEmpty <= 0.03)) {
      label = `${formatDurationHours(etaFull)} to full`;
    } else if (etaEmpty && etaEmpty > 0.03 && etaFull && etaFull > 0.03) {
      label = `${formatDurationHours(etaEmpty)} to empty / ${formatDurationHours(etaFull)} to full`;
    }

    if (ns.lastBatteryStatus === 'Full') {
      label = 'Battery full';
    }

    etaEl.textContent = label;
  }

  async function fetchChargeData() {
    try {
      const res = await fetch('/api/charge24');
      const json = await res.json();

      let timestamps = (json.timestamps || []).map(Number);
      let whs = (json.charge || []).map(Number);
      let fulls = (json.full || []).map(Number);
      let fullDesigns = (json.full_design || []).map(Number);

      const zipped = timestamps
        .map((t, i) => [t, whs[i], fulls[i], fullDesigns[i]])
        .filter(([t, v, f, fd]) => Number.isFinite(t) && Number.isFinite(v) && Number.isFinite(f) && Number.isFinite(fd))
        .sort((a, b) => a[0] - b[0]);

      if (!zipped.length) {
        chargeTimestamps = [];
        chargeWhs = [];
        chargeFulls = [];
        chargeFullDesigns = [];
        chargePercents = [];
        chargeHealthPercents = [];
        chargeCapacityWhs = [];
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.data.datasets[1].data = [];
        chart.data.datasets[2].data = [];
        chart.data.datasets[3].data = [];
        chart.data.datasets[4].data = [];
        chart.update('none');
        updateChargeSelectionStats(null, null);
        const lastUpdated = document.getElementById('charge-last-updated');
        if (lastUpdated) lastUpdated.textContent = 'last update: no data yet';
        return;
      }

      let tsArr = zipped.map((p) => p[0]);
      let whArr = zipped.map((p) => p[1]);
      let fullArr = zipped.map((p) => p[2]);
      let fullDesignArr = zipped.map((p) => p[3]);

      const ds = ns.downsampleByMean(tsArr, [whArr, fullArr, fullDesignArr]);
      chargeTimestamps = ds.timestamps;
      [chargeWhs, chargeFulls, chargeFullDesigns] = ds.values;

      chargePercents = chargeWhs.map((v, i) => (chargeFullDesigns[i] ? (v / chargeFullDesigns[i]) * 100 : null));
      chargeHealthPercents = chargeWhs.map((_, i) => (chargeFullDesigns[i] && chargeFulls[i] ? (chargeFulls[i] / chargeFullDesigns[i]) * 100 : null));
      chargeCapacityWhs = chargeFulls.slice();

      const labels = chargeTimestamps.map((ts) => ns.formatTimeShort(ts));
      chart.data.labels = labels;
      chart.data.datasets[0].data = chargeWhs;
      chart.data.datasets[1].data = chargePercents;
      chart.data.datasets[2].data = chargeHealthPercents;
      chart.data.datasets[3].data = chargeTimestamps.map(() => 100);
      chart.data.datasets[4].data = chargeCapacityWhs;

      // Fix Wh axis to [0, max capacity Wh]
      const capCandidates = chargeCapacityWhs.filter((v) => Number.isFinite(v) && v > 0);
      if (capCandidates.length && chart.options && chart.options.scales && chart.options.scales.y) {
        const maxCap = Math.max(...capCandidates);
        chart.options.scales.y.min = 0;
        chart.options.scales.y.max = maxCap;
      }
      chart.update('none');

      const percentEl = document.getElementById('battery-stat-percent');
      const nowEl = document.getElementById('battery-stat-now');
      const fullEl = document.getElementById('battery-stat-full');
      const currPctEl = document.getElementById('charge-current-percent');
      const currWhEl = document.getElementById('charge-current-wh');
      if (chargePercents.length && percentEl) {
        const lastPct = chargePercents[chargePercents.length - 1];
        percentEl.textContent = Number.isFinite(lastPct) ? formatPercent(lastPct) : '–';
      }
      if (chargeWhs.length && nowEl) {
        const lastWh = chargeWhs[chargeWhs.length - 1];
        nowEl.textContent = Number.isFinite(lastWh) ? formatWh(lastWh) : '–';
      }
      if (chargeFulls.length && fullEl) {
        const lastFullWh = chargeFulls[chargeFulls.length - 1];
        fullEl.textContent = Number.isFinite(lastFullWh) ? formatWh(lastFullWh) : '–';
      }

      if (currPctEl) {
        const lastPct = chargePercents.length ? chargePercents[chargePercents.length - 1] : null;
        currPctEl.textContent = Number.isFinite(lastPct) ? formatPercent(lastPct) : '–';
      }
      if (currWhEl) {
        const lastWh = chargeWhs.length ? chargeWhs[chargeWhs.length - 1] : null;
        currWhEl.textContent = Number.isFinite(lastWh) ? formatWh(lastWh) : '–';
      }

      const lastTs = chargeTimestamps[chargeTimestamps.length - 1];
      const lastUpdated = document.getElementById('charge-last-updated');
      if (lastUpdated) {
        if (lastTs) {
          lastUpdated.textContent = 'last update: ' + new Date(lastTs * 1000).toLocaleTimeString();
        } else {
          lastUpdated.textContent = 'last update: no data yet';
        }
      }

      if (chargeHasUserSelection && chargeSelectedStartTs != null && chargeSelectedEndTs != null) {
        chargeSelectedStartIdx = chargeFindClosestIndexForTs(chargeSelectedStartTs);
        chargeSelectedEndIdx = chargeFindClosestIndexForTs(chargeSelectedEndTs);
        updateChargeSelectionStats(chargeSelectedStartIdx, chargeSelectedEndIdx);
      } else {
        if (chargePercents.length) {
          updateChargeSelectionStats(0, chargePercents.length - 1);
        } else {
          updateChargeSelectionStats(null, null);
        }
      }

      updateChargeEta();
      chart.draw();
    } catch (e) {
      console.error(e);
    }
  }

  function getRelativeX(evt) {
    const rect = canvasEl.getBoundingClientRect();
    return evt.clientX - rect.left;
  }

  function indexFromX(x) {
    const xScale = chart.scales.x;
    if (!xScale) return null;
    let v = xScale.getValueForPixel(x);
    if (!isFinite(v)) return null;
    v = Math.round(v);
    v = Math.max(0, Math.min(chargePercents.length - 1, v));
    return v;
  }

  function finishDrag() {
    if (!chargeIsDragging) return;
    chargeIsDragging = false;

    if (chargeDragStartIdx == null || chargeDragEndIdx == null) {
      chargeDragStartIdx = chargeDragEndIdx = null;
      return;
    }

    const s = Math.max(0, Math.min(chargeDragStartIdx, chargeDragEndIdx));
    const e = Math.min(chargePercents.length - 1, Math.max(chargeDragStartIdx, chargeDragEndIdx));

    if (Math.abs(e - s) < 2) {
      chargeHasUserSelection = false;
      chargeSelectedStartTs = chargeSelectedEndTs = null;
      chargeSelectedStartIdx = chargeSelectedEndIdx = null;
      chargeDragStartIdx = chargeDragEndIdx = null;
      if (chargePercents.length) {
        updateChargeSelectionStats(0, chargePercents.length - 1);
      } else {
        updateChargeSelectionStats(null, null);
      }
      chart.draw();
      return;
    }

    chargeSelectedStartIdx = s;
    chargeSelectedEndIdx = e;
    chargeSelectedStartTs = chargeTimestamps[s];
    chargeSelectedEndTs = chargeTimestamps[e];
    chargeHasUserSelection = true;
    chargeDragStartIdx = chargeDragEndIdx = null;
    updateChargeSelectionStats(chargeSelectedStartIdx, chargeSelectedEndIdx);
    chart.draw();
  }

  canvasEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!chargePercents.length) return;
    chargeIsDragging = true;
    const x = getRelativeX(e);
    const idx = indexFromX(x);
    chargeDragStartIdx = chargeDragEndIdx = idx;
    chart.draw();
  });

  canvasEl.addEventListener('mousemove', (e) => {
    e.preventDefault();
    if (!chargeIsDragging) return;
    const x = getRelativeX(e);
    const idx = indexFromX(x);
    chargeDragEndIdx = idx;
    chart.draw();
  });

  canvasEl.addEventListener('mouseup', (e) => {
    e.preventDefault();
    finishDrag();
  });

  canvasEl.addEventListener('mouseleave', (e) => {
    e.preventDefault();
    if (chargeIsDragging) finishDrag();
  });

  canvasEl.addEventListener('dragstart', (e) => {
    e.preventDefault();
  });

  // initial load + polling
  fetchChargeData();
  setInterval(fetchChargeData, 5000);
})(window.BattApp || (window.BattApp = {}));
