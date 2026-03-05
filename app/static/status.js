// Battery status panel updater

(function (ns) {
  async function updateBatteryStatusBar() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const json = await res.json();

      const status = json.status || 'Unknown';
      const cycles = json.cycles;
      const designCap = json.design_capacity;
      const health = json.health;
      const temp = json.temperature;
      const manuf = json.manufacturer;
      const model = json.model;

      const statusEl = document.getElementById('battery-stat-status');
      const healthEl = document.getElementById('battery-stat-health');
      const tempEl = document.getElementById('battery-stat-temp');
      const cyclesEl = document.getElementById('battery-stat-cycles');
      const designEl = document.getElementById('battery-stat-design');
      const manufEl = document.getElementById('battery-stat-manuf');

      if (statusEl) statusEl.textContent = status;

      if (cycles !== null && cycles !== undefined) {
        if (cyclesEl) cyclesEl.textContent = cycles;
      } else if (cyclesEl) {
        cyclesEl.textContent = '–';
      }

      if (designCap !== null && designCap !== undefined) {
        if (designEl) designEl.textContent = designCap.toFixed(2);
      } else if (designEl) {
        designEl.textContent = '–';
      }

      if (health !== null && health !== undefined) {
        if (healthEl) healthEl.textContent = `${health.toFixed(1)}%`;
      } else if (healthEl) {
        healthEl.textContent = '–';
      }

      if (temp !== null && temp !== undefined) {
        if (tempEl) tempEl.textContent = temp.toFixed(1);
      } else if (tempEl) {
        tempEl.textContent = '–';
      }

      if (manuf || model) {
        if (manufEl) manufEl.textContent = `${manuf || ''}${manuf && model ? ' ' : ''}${model || ''}`;
      } else if (manufEl) {
        manufEl.textContent = '–';
      }

      // Save status string for ETA logic in charge chart
      ns.lastBatteryStatus = status;
    } catch (e) {
      const statusEl = document.getElementById('battery-stat-status');
      if (statusEl) statusEl.textContent = 'Unknown';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateBatteryStatusBar();
    setInterval(updateBatteryStatusBar, 10000);
  });
})(window.BattApp || (window.BattApp = {}));
