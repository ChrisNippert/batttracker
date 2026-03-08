from flask import Blueprint, render_template, jsonify
import sqlite3
import os

routes = Blueprint('routes', __name__)

@routes.route('/')
def index():
    return render_template('index.html')

@routes.route('/battery_data')
def battery_data():
    """Legacy endpoint: return last 24h of battery power from SQLite.

    Shape matches old CSV-based version: list of {timestamp, power} objects.
    """
    db_path = os.path.join("data", "batttracker.db")
    if not os.path.exists(db_path):
      return jsonify([])

    conn = sqlite3.connect(db_path)
    try:
        now_ts = int(__import__('time').time())
        cutoff = now_ts - 24 * 60 * 60
        cur = conn.cursor()
        cur.execute(
            "SELECT timestamp, power FROM battery_power WHERE timestamp >= ? ORDER BY timestamp ASC",
            (cutoff,),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    data = [{"timestamp": ts, "power": power} for (ts, power) in rows]
    return jsonify(data)