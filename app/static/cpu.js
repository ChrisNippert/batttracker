// CPU package power chart (W) for last 24 hours

(function (ns) {
  const canvasEl = document.getElementById('cpuChart');
  if (!canvasEl || typeof Chart === 'undefined') return;

  const ctx = canvasEl.getContext('2d');
  let timestamps = [];
  let powers = [];

  let selectedStartTs = null;
  let selectedEndTs = null;
  let selectedStartIdx = null;
  let selectedEndIdx = null;
  let isDragging = false;
  let dragStartIdx = null;
  let dragEndIdx = null;
  let hasUserSelection = false;

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function formatW(v) {
    if (v === null || Number.isNaN(v)) return '–';
    return v.toFixed(2);
  }

  function formatTime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function updateQuarterStats() {
    const qEls = [
      document.getElementById('cpu-q1-avg'),
      document.getElementById('cpu-q2-avg'),
      document.getElementById('cpu-q3-avg'),
      document.getElementById('cpu-q4-avg')
    ];
    if (!powers.length) {
      qEls.forEach((el) => (el.textContent = '–'));
      return;
    }
    const n = powers.length;
    const base = Math.floor(n / 4) || 1;
    const boundaries = [0, Math.min(base, n), Math.min(base * 2, n), Math.min(base * 3, n), n];
    for (let i = 0; i < 4; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const slice = powers.slice(start, end);
      qEls[i].textContent = slice.length ? formatW(mean(slice)) : '–';
    }
  }

  function updateSelectionStats(startIdx, endIdx) {
    const rangeEl = document.getElementById('cpu-sel-range');
    const minEl = document.getElementById('cpu-sel-min');
    const meanEl = document.getElementById('cpu-sel-mean');
    const maxEl = document.getElementById('cpu-sel-max');

    if (!powers.length || startIdx == null || endIdx == null) {
      rangeEl.textContent = 'no selection';
      minEl.textContent = meanEl.textContent = maxEl.textContent = '–';
      return;
    }

    const s = Math.max(0, Math.min(startIdx, endIdx));
    const e = Math.min(powers.length - 1, Math.max(startIdx, endIdx));
    if (e <= s) {
      rangeEl.textContent = 'no selection';
      minEl.textContent = meanEl.textContent = maxEl.textContent = '–';
      return;
    }

    const subPowers = powers.slice(s, e + 1);
    const tsStart = timestamps[s];
    const tsEnd = timestamps[e];
    const minV = Math.min(...subPowers);
    const maxV = Math.max(...subPowers);
    const meanV = mean(subPowers);

    rangeEl.textContent = `${formatTime(tsStart)} → ${formatTime(tsEnd)}`;
    minEl.textContent = formatW(minV);
    meanEl.textContent = formatW(meanV);
    maxEl.textContent = formatW(maxV);
  }

  function findClosestIndexForTs(ts) {
    if (!timestamps.length || ts == null) return null;
    let bestIdx = 0;
    let bestDiff = Math.abs(timestamps[0] - ts);
    for (let i = 1; i < timestamps.length; i++) {
      const d = Math.abs(timestamps[i] - ts);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  const selectionPlugin = {
    id: 'cpuSelectionHighlight',
    beforeDraw(chart) {
      if (!chart.canvas || chart.canvas !== canvasEl) return;
      const xScale = chart.scales.x;
      const { ctx, chartArea } = chart;
      if (!xScale || !chartArea) return;
      const { top, bottom } = chartArea;

      function drawBand(startIdx, endIdx, color) {
        if (startIdx == null || endIdx == null) return;
        const s = Math.max(0, Math.min(startIdx, endIdx));
        const e = Math.min(powers.length - 1, Math.max(startIdx, endIdx));
        if (e <= s) return;
        const x1 = xScale.getPixelForValue(s);
        const x2 = xScale.getPixelForValue(e);
        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(x1, top, x2 - x1, bottom - top);
        ctx.restore();
      }

      if (hasUserSelection) {
        drawBand(selectedStartIdx, selectedEndIdx, 'rgba(59,130,246,0.18)');
      }
      if (isDragging) {
        drawBand(dragStartIdx, dragEndIdx, 'rgba(96,165,250,0.3)');
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
          label: 'CPU power (W)',
          data: [],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.18)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25
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
          ticks: { color: '#6b7280' },
          grid: { color: 'rgba(31,41,55,0.4)' }
        }
      },
      plugins: {
        legend: { labels: { color: '#9ca3af' } }
      }
    }
  });

  async function fetchCpuData() {
    try {
      const res = await fetch('/api/cpu24');
      const json = await res.json();

      let tsArr = (json.timestamps || []).map(Number);
      let powArr = (json.powers || []).map(Number);
      const zipped = tsArr
        .map((t, i) => [t, powArr[i]])
        .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
        .sort((a, b) => a[0] - b[0]);

      if (!zipped.length) {
        timestamps = [];
        powers = [];
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.update('none');
        updateQuarterStats();
        updateSelectionStats(null, null);
        const lastUpdated = document.getElementById('cpu-last-updated');
        if (lastUpdated) lastUpdated.textContent = 'last update: no data yet';
        return;
      }

      tsArr = zipped.map((p) => p[0]);
      powArr = zipped.map((p) => p[1]);

      const ds = ns.downsampleByMean(tsArr, [powArr]);
      timestamps = ds.timestamps;
      [powers] = ds.values;

      const labels = timestamps.map((ts) => formatTime(ts));
      chart.data.labels = labels;
      chart.data.datasets[0].data = powers;
      chart.update('none');

      const lastTs = timestamps[timestamps.length - 1];
      const lastUpdated = document.getElementById('cpu-last-updated');
      if (lastUpdated) {
        if (lastTs) {
          lastUpdated.textContent = 'last update: ' + new Date(lastTs * 1000).toLocaleTimeString();
        } else {
          lastUpdated.textContent = 'last update: no data yet';
        }
      }

      updateQuarterStats();
      if (hasUserSelection && selectedStartTs != null && selectedEndTs != null) {
        selectedStartIdx = findClosestIndexForTs(selectedStartTs);
        selectedEndIdx = findClosestIndexForTs(selectedEndTs);
        updateSelectionStats(selectedStartIdx, selectedEndIdx);
      } else {
        if (powers.length) {
          updateSelectionStats(0, powers.length - 1);
        } else {
          updateSelectionStats(null, null);
        }
      }

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
    v = Math.max(0, Math.min(powers.length - 1, v));
    return v;
  }

  function finishDrag() {
    if (!isDragging) return;
    isDragging = false;

    if (dragStartIdx == null || dragEndIdx == null) {
      dragStartIdx = dragEndIdx = null;
      return;
    }

    const s = Math.max(0, Math.min(dragStartIdx, dragEndIdx));
    const e = Math.min(powers.length - 1, Math.max(dragStartIdx, dragEndIdx));

    if (Math.abs(e - s) < 2) {
      hasUserSelection = false;
      selectedStartTs = selectedEndTs = null;
      selectedStartIdx = selectedEndIdx = null;
      dragStartIdx = dragEndIdx = null;
      if (powers.length) {
        updateSelectionStats(0, powers.length - 1);
      } else {
        updateSelectionStats(null, null);
      }
      chart.draw();
      return;
    }

    selectedStartIdx = s;
    selectedEndIdx = e;
    selectedStartTs = timestamps[s];
    selectedEndTs = timestamps[e];
    hasUserSelection = true;
    dragStartIdx = dragEndIdx = null;
    updateSelectionStats(selectedStartIdx, selectedEndIdx);
    chart.draw();
  }

  canvasEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!powers.length) return;
    isDragging = true;
    const x = getRelativeX(e);
    const idx = indexFromX(x);
    dragStartIdx = dragEndIdx = idx;
    chart.draw();
  });

  canvasEl.addEventListener('mousemove', (e) => {
    e.preventDefault();
    if (!isDragging) return;
    const x = getRelativeX(e);
    const idx = indexFromX(x);
    dragEndIdx = idx;
    chart.draw();
  });

  canvasEl.addEventListener('mouseup', (e) => {
    e.preventDefault();
    finishDrag();
  });

  canvasEl.addEventListener('mouseleave', (e) => {
    e.preventDefault();
    if (isDragging) finishDrag();
  });

  canvasEl.addEventListener('dragstart', (e) => {
    e.preventDefault();
  });

  fetchCpuData();
  setInterval(fetchCpuData, 5000);
})(window.BattApp || (window.BattApp = {}));
