// Battery charge chart (Wh and %) for last 24 hours

(function (ns) {
  const canvasEl = document.getElementById('chargeChart');
  if (!canvasEl || typeof Chart === 'undefined') return;

  const ctx = canvasEl.getContext('2d');

  let chargeTimestamps = [];
  let chargeWhs = [];
  let chargeFulls = [];
  let chargePercents = [];

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
    if (!chargePercents.length || startIdx == null || endIdx == null) {
      slopeEl.textContent = '–';
      return;
    }
    const s = Math.max(0, Math.min(startIdx, endIdx));
    const e = Math.min(chargePercents.length - 1, Math.max(startIdx, endIdx));
    if (e <= s) {
      slopeEl.textContent = '–';
      return;
    }
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
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.15)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          yAxisID: 'y'
        },
        {
          label: 'Charge (%)',
          data: [],
          borderColor: '#fbbf24',
          backgroundColor: 'rgba(251,191,36,0.10)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          yAxisID: 'y1'
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
          ticks: { color: '#38bdf8' },
          grid: { color: 'rgba(31,41,55,0.4)' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: '%', color: '#fbbf24' },
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
    const etaEmptyEl = document.getElementById('battery-stat-eta-empty');
    const etaFullEl = document.getElementById('battery-stat-eta-full');
    if (!etaEmptyEl || !etaFullEl) return;

    if (!chargeWhs.length || !chargeFulls.length || ns.latestPowerW == null || !Number.isFinite(ns.latestPowerW) || Math.abs(ns.latestPowerW) < 0.1) {
      etaEmptyEl.textContent = '–';
      etaFullEl.textContent = '–';
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

    const etaEmptyStr = etaEmpty && etaEmpty > 0.03 ? formatDurationHours(etaEmpty) : '–';
    const etaFullStr = etaFull && etaFull > 0.03 ? formatDurationHours(etaFull) : '–';

    etaEmptyEl.textContent = etaEmptyStr;
    etaFullEl.textContent = etaFullStr;
  }

  async function fetchChargeData() {
    try {
      const res = await fetch('/api/charge24');
      const json = await res.json();

      let timestamps = (json.timestamps || []).map(Number);
      let whs = (json.charge || []).map(Number);
      let fulls = (json.full || []).map(Number);
      let percents = whs.map((v, i) => (fulls[i] ? (v / fulls[i]) * 100 : null));

      const zipped = timestamps
        .map((t, i) => [t, whs[i], fulls[i], percents[i]])
        .filter(([t, v, f, p]) => Number.isFinite(t) && Number.isFinite(v) && Number.isFinite(f) && Number.isFinite(p))
        .sort((a, b) => a[0] - b[0]);

      if (!zipped.length) {
        chargeTimestamps = [];
        chargeWhs = [];
        chargeFulls = [];
        chargePercents = [];
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.data.datasets[1].data = [];
        chart.update('none');
        updateChargeSelectionStats(null, null);
        const lastUpdated = document.getElementById('charge-last-updated');
        if (lastUpdated) lastUpdated.textContent = 'last update: no data yet';
        return;
      }

      let tsArr = zipped.map((p) => p[0]);
      let whArr = zipped.map((p) => p[1]);
      let fullArr = zipped.map((p) => p[2]);
      let pctArr = zipped.map((p) => p[3]);

      const ds = ns.downsampleByMean(tsArr, [whArr, fullArr, pctArr]);
      chargeTimestamps = ds.timestamps;
      [chargeWhs, chargeFulls, chargePercents] = ds.values;

      const labels = chargeTimestamps.map((ts) => ns.formatTimeShort(ts));
      chart.data.labels = labels;
      chart.data.datasets[0].data = chargeWhs;
      chart.data.datasets[1].data = chargePercents;
      chart.update('none');

      const percentEl = document.getElementById('battery-stat-percent');
      const nowEl = document.getElementById('battery-stat-now');
      const fullEl = document.getElementById('battery-stat-full');
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
