# Power Tracker

This project is a Flask web application that captures and displays power and charge data over time for your laptop battery, CPU package, and GPU (Intel/AMD where supported). It reads metrics from Linux sysfs/RAPL, logs them to CSVs, and provides a web dashboard to visualize the last 24 hours.

## Project Structure

```
batttracker-flask-app
├── app
│   ├── __init__.py          # Initializes the Flask application
│   ├── main.py              # Data capture loop + JSON APIs
│   ├── routes.py            # (Legacy) route setup helper
│   ├── static
│   │   ├── styles.css       # Dashboard styles
│   │   ├── core.js          # Shared JS utilities and state
│   │   ├── status.js        # Battery info panel
│   │   ├── power.js         # Battery power chart
│   │   ├── charge.js        # Battery charge chart + ETA
│   │   ├── cpu.js           # CPU power chart
│   │   └── gpu.js           # GPU power chart
│   └── templates
│       └── index.html       # Single-page dashboard
├── data
│   ├── battery_power_YYYY-MM-DD.csv   # Battery power (W)
│   ├── battery_charge_YYYY-MM-DD.csv  # Battery charge / full / design (Wh)
│   ├── cpu_power_YYYY-MM-DD.csv       # CPU package power (W)
│   └── gpu_power_YYYY-MM-DD.csv       # GPU power (W)
├── requirements.txt         # Python dependencies
└── README.md                # This file
```

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd batttracker
   ```

2. **Run `install.sh**
   ```bash
   ./install.sh
   ```

6. **Access the web dashboard:**
   Open your browser to `http://localhost:8678` to view the dashboard.

## Usage

- Sampling: by default `app/main.py` captures a sample roughly every 5 seconds (battery) and every ~1s internally for RAPL to estimate CPU/GPU power.
- Logging format (daily CSVs in `data/`):
   - `battery_power_YYYY-MM-DD.csv`: `timestamp,power_W`
   - `battery_charge_YYYY-MM-DD.csv`: `timestamp,charge_Wh,full_Wh,full_design_Wh`
   - `cpu_power_YYYY-MM-DD.csv`: `timestamp,power_W`
   - `gpu_power_YYYY-MM-DD.csv`: `timestamp,power_W`
- The backend exposes JSON endpoints that the frontend polls:
   - `/api/past24` — battery power, last 24 hours
   - `/api/charge24` — battery charge/percent, last 24 hours
   - `/api/cpu24` — CPU package power, last 24 hours
   - `/api/gpu24` — GPU power, last 24 hours
   - `/api/status` — point-in-time battery health/info
- The frontend (index.html + JS) shows:
   - Battery info panel: status, health, temperature, cycles, manufacturer/model, etc.
   - Battery charge chart (Wh and %) with slope and ETA to empty/full.
   - Battery power chart with quarter averages and drag-to-select stats.
   - CPU and GPU power charts with similar quarter and selection stats.

CPU/GPU logging does not require a battery to be present; battery metrics are logged only when a battery is detected.

### Supported hardware / permissions

- Battery: expects `/sys/class/power_supply/BAT0` or `CMB0` on Linux.
- CPU power: uses Intel RAPL `energy_uj` counters (paths such as `/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj`).
- GPU power:
   - Intel iGPU via RAPL `intel-rapl:0:1/energy_uj` when available.
   - AMD GPUs via `power1_average` under `/sys/class/drm/card*/device/hwmon/hwmon*/power1_average` (microwatts → watts).

On some systems these files are only readable as root; you may need to adjust permissions/udev rules or run the capture process with elevated privileges.

## Contributing

Feel free to submit issues or pull requests if you have suggestions or improvements for the project.