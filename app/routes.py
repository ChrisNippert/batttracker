from flask import Blueprint, render_template, jsonify
import pandas as pd
import os

routes = Blueprint('routes', __name__)

@routes.route('/')
def index():
    return render_template('index.html')

@routes.route('/battery_data')
def battery_data():
    if os.path.exists("data/battery_power_past_24_hours.csv"):
        df = pd.read_csv("data/battery_power_past_24_hours.csv")
        data = df.to_dict(orient='records')
        return jsonify(data)
    return jsonify([])