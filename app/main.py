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

def cap_data():
    import os
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        power = read_battery_power()
        timestamp = int(time.time())
        date = time.strftime("%Y-%m-%d", time.localtime(timestamp))
        with open(f"{DATA_DIR}/battery_power_{date}.csv", "a") as f:
            f.write(f"{timestamp},{power}\n")
        # also update the past 24 hours file
        df = pd.read_csv(f"{DATA_DIR}/battery_power_{date}.csv", header=None, names=["timestamp", "power"])
        df = df[df["timestamp"] >= timestamp - 24*60*60]
        df.to_csv(f"{DATA_DIR}/battery_power_past_24_hours.csv", index=False)
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
    
def main():
    while True:
        cap_data()
        time.sleep(5)

if __name__ == "__main__":
    main()