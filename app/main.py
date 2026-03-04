import time
import threading
import pandas as pd
from flask import Flask, jsonify, render_template

import sys

app = Flask(__name__, template_folder="templates", static_folder="static")

DATA_DIR = "data"

def read_battery_power():
    print("Opening /sys/class/power_supply/BAT0/power_now to read battery power")
    with open("/sys/class/power_supply/BAT0/power_now", "r") as f:
        power = int(f.read().strip())
    return power / 1_000_000

def read_battery_charge():
    # returns tuple of (current_charge, full_charge)
    with open("/sys/class/power_supply/BAT0/energy_full", "r") as f:
        full = int(f.read().strip())
    with open("/sys/class/power_supply/BAT0/energy_full_design", "r") as f:
        full_design = int(f.read().strip())
    with open("/sys/class/power_supply/BAT0/energy_now", "r") as f:
        current = int(f.read().strip())
    return current / 1_000_000, full / 1_000_000, full_design / 1_000_000

def cap_data():
    import os
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        power = read_battery_power()
        charge, full, full_design = read_battery_charge()
        timestamp = int(time.time())
        date = time.strftime("%Y-%m-%d", time.localtime(timestamp))
        # Log power
        with open(f"{DATA_DIR}/battery_power_{date}.csv", "a") as f:
            f.write(f"{timestamp},{power}\n")
        # Log charge
        with open(f"{DATA_DIR}/battery_charge_{date}.csv", "a") as f:
            f.write(f"{timestamp},{charge},{full},{full_design}\n")
        # Update the past 24 hours file for power
        df_power = pd.read_csv(f"{DATA_DIR}/battery_power_{date}.csv", header=None, names=["timestamp", "power"])
        df_power = df_power[df_power["timestamp"] >= timestamp - 24*60*60]
        df_power.to_csv(f"{DATA_DIR}/battery_power_past_24_hours.csv", index=False)
        # Update the past 24 hours file for charge
        df_charge = pd.read_csv(f"{DATA_DIR}/battery_charge_{date}.csv", header=None, names=["timestamp", "charge", "full", "full_design"])
        df_charge = df_charge[df_charge["timestamp"] >= timestamp - 24*60*60]
        df_charge.to_csv(f"{DATA_DIR}/battery_charge_past_24_hours.csv", index=False)
    except Exception as e:
        import traceback
        print(f"[ERROR] {time.strftime('%Y-%m-%d %H:%M:%S')} Exception in cap_data: {e}")
        traceback.print_exc()

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/past24")
def api_past24():
    try:
        df = pd.read_csv(f"{DATA_DIR}/battery_power_past_24_hours.csv")
        return jsonify({
            "timestamps": df["timestamp"].tolist(),
            "powers": df["power"].tolist()
        })
    except Exception:
        return jsonify({"timestamps": [], "powers": []})

# New endpoint for battery charge
@app.route("/api/charge24")
def api_charge24():
    try:
        df = pd.read_csv(f"{DATA_DIR}/battery_charge_past_24_hours.csv")
        return jsonify({
            "timestamps": df["timestamp"].tolist(),
            "charge": df["charge"].tolist(),
            "full": df["full"].tolist(),
            "full_design": df["full_design"].tolist()
        })
    except Exception:
        return jsonify({"timestamps": [], "charge": [], "full": [], "full_design": []})
    
def main():
    while True:
        cap_data()
        time.sleep(5)

if __name__ == "__main__":
    main()