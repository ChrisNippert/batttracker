from flask import Flask
from .routes import routes as main_routes

def create_app():
    app = Flask(__name__)
    
    app.register_blueprint(main_routes)

    return app