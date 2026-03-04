# Battery Tracker Flask Application

This project is a Flask web application that captures and displays battery power data over time. It reads battery power information from the system and provides a web interface to visualize this data.

## Project Structure

```
batttracker-flask-app
├── app
│   ├── __init__.py          # Initializes the Flask application and sets up routes
│   ├── main.py              # Contains logic to start the Flask app and capture battery data
│   ├── routes.py            # Defines routes for the web application
│   ├── static
│   │   └── styles.css       # CSS styles for the web application
│   └── templates
│       └── index.html       # HTML template for the main page
├── data
│   └── .gitkeep             # Keeps the data directory tracked by Git
├── requirements.txt         # Lists dependencies for the Flask application
└── README.md                # Documentation for the project
```

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd batttracker-flask-app
   ```

2. **Create a virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application:**
   ```bash
   python app/main.py
   ```

5. **Access the web application:**
   Open your web browser and navigate to `http://localhost:8678` to view the battery power graph.

## Usage

The application will automatically capture battery power data every 5 seconds and store it in CSV files. The web interface will display a graph of the battery power over time, providing insights into battery usage patterns.

## Contributing

Feel free to submit issues or pull requests if you have suggestions or improvements for the project.