import os
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from datetime import datetime, date, timedelta 
from textblob import TextBlob
from flask_cors import CORS
# --- NEW IMPORTS ---
from flask_socketio import SocketIO
# --- END NEW IMPORTS ---

# --- ML IMPORTS ---
from transformers import pipeline

# --- 1. Configuration ---

basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'feedback.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
CORS(app)

# --- NEW: Initialize SocketIO ---
# Allow all origins for simplicity in development
socketio = SocketIO(app, cors_allowed_origins="*")
# --- END NEW ---

db = SQLAlchemy(app)

# --- Load the ML Model ---
print("Loading classification model...")
classifier = pipeline("zero-shot-classification", model="facebook/bart-large-mnli")
print("Model loaded successfully.")

# --- 2. Database Models (No Changes) ---
class Store(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    area = db.Column(db.String(200), nullable=True) 
    feedbacks = db.relationship('Feedback', backref='store', lazy=True)

class Feedback(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    platform = db.Column(db.String(100), nullable=False)
    text = db.Column(db.String(1000), nullable=False)
    timestamp = db.Column(db.DateTime, index=True, default=datetime.utcnow)
    category = db.Column(db.String(100), nullable=True)
    sentiment = db.Column(db.String(50), nullable=True)
    sentiment_score = db.Column(db.Float, nullable=True)
    store_id = db.Column(db.Integer, db.ForeignKey('store.id'), nullable=True)
    status = db.Column(db.String(50), nullable=False, default='New')

# --- 3. API Endpoints ---

@app.route('/v1/feedback', methods=['POST'])
def add_feedback():
    data = request.get_json()
    if not data or 'text' not in data or 'platform' not in data:
        return jsonify({"error": "Missing required data: platform and text"}), 400

    feedback_text = data['text']
    
    # --- Analysis (No Change) ---
    blob = TextBlob(feedback_text)
    sentiment = "Neutral"
    if blob.sentiment.polarity > 0.2: sentiment = "Positive"
    elif blob.sentiment.polarity < -0.1: sentiment = "Negative"
    candidate_labels = ["Quality of food", "Customer service", "Speed", "Ambience"]
    result = classifier(feedback_text, candidate_labels)
    category = result['labels'][0]
    category_confidence = result['scores'][0]

    new_feedback = Feedback(
        platform=data['platform'], text=data['text'], category=category,
        sentiment=sentiment, sentiment_score = blob.sentiment.polarity,
        store_id=data.get('store_id'), status='New'
    )
    
    db.session.add(new_feedback)
    db.session.commit()
    
    # --- NEW: "SHOUT" THE UPDATE ---
    # This sends a 'new_feedback' message to all connected clients
    socketio.emit('new_feedback', {'message': f'New feedback {new_feedback.id} added'})
    # --- END NEW ---
    
    return jsonify({
        "message": "Feedback added successfully", "id": new_feedback.id,
        "analysis": { "category": category, "category_confidence": category_confidence,
                      "sentiment": sentiment, "polarity_score": blob.sentiment.polarity }
    }), 201

@app.route('/v1/feedback/<int:feedback_id>/resolve', methods=['POST'])
def resolve_feedback(feedback_id):
    feedback_item = Feedback.query.get(feedback_id)
    if feedback_item is None:
        return jsonify({"error": "Feedback item not found"}), 404
    feedback_item.status = 'Resolved'
    db.session.commit()
    
    # --- NEW: "SHOUT" THIS UPDATE TOO ---
    # We send a specific event so the Alerts tab can refresh
    socketio.emit('feedback_resolved', {'id': feedback_id})
    # --- END NEW ---
    
    return jsonify({"message": f"Feedback {feedback_id} marked as Resolved"})

# --- All other helper functions and endpoints (get_feedback, get_metrics, etc.) are unchanged ---
def build_filtered_query():
    start_date_str = request.args.get('start')
    end_date_str = request.args.get('end')
    store_id_str = request.args.get('store_id')
    area_str = request.args.get('area')
    status_str = request.args.get('status')
    query = Feedback.query
    if area_str:
        query = query.join(Store).filter(Store.area == area_str)
    try:
        if start_date_str:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
            query = query.filter(Feedback.timestamp >= start_date)
        if end_date_str:
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
            query = query.filter(Feedback.timestamp < (end_date + timedelta(days=1)))
        if store_id_str:
            query = query.filter(Feedback.store_id == int(store_id_str))
        if status_str:
            query = query.filter(Feedback.status == status_str)
    except ValueError:
        return None 
    return query

@app.route('/v1/feedback', methods=['GET'])
def get_feedback():
    query = build_filtered_query()
    if query is None: return jsonify({"error": "Invalid date format"}), 400
    all_feedback = query.order_by(Feedback.timestamp.desc()).all()
    results = []
    for feedback in all_feedback:
        results.append({
            "id": feedback.id, "platform": feedback.platform, "text": feedback.text,
            "timestamp": feedback.timestamp.isoformat(), "category": feedback.category,
            "sentiment": feedback.sentiment, "sentiment_score": feedback.sentiment_score,
            "store_id": feedback.store_id, "status": feedback.status
        })
    return jsonify(results)

@app.route('/v1/metrics', methods=['GET'])
def get_metrics():
    query = build_filtered_query()
    if query is None: return jsonify({"error": "Invalid date format"}), 400
    total_feedback = query.count()
    category_metrics = query.group_by(Feedback.category).with_entities(
        Feedback.category, func.count(Feedback.id).label('count'),
        func.avg(Feedback.sentiment_score).label('average_sentiment')
    ).all()
    categories = {}
    for c, count, avg in category_metrics: categories[c] = {"count": count, "average_sentiment_score": avg}
    sentiment_counts = query.group_by(Feedback.sentiment).with_entities(
        Feedback.sentiment, func.count(Feedback.id).label('count')
    ).all()
    sentiments = {"Positive": 0, "Negative": 0, "Neutral": 0}
    for s, count in sentiment_counts:
        if s in sentiments: sentiments[s] = count
    return jsonify({
        "total_feedback": total_feedback,
        "feedback_by_sentiment": sentiments,
        "feedback_by_category": categories
    })

@app.route('/v1/metrics/trend', methods=['GET'])
def get_metrics_trend():
    query = build_filtered_query()
    if query is None: return jsonify({"error": "Invalid date format"}), 400
    daily_trend = query.with_entities(
        func.strftime('%Y-%m-%d', Feedback.timestamp).label('date'),
        func.avg(Feedback.sentiment_score).label('average_sentiment')
    ).group_by(func.strftime('%Y-%m-%d', Feedback.timestamp)).order_by('date').all()
    results = []
    for row in daily_trend:
        results.append({ "date": row.date, "average_sentiment": row.average_sentiment })
    return jsonify(results)

@app.route('/v1/stores', methods=['POST'])
def add_store():
    data = request.get_json()
    if not data or 'name' not in data: return jsonify({"error": "Missing required data: name"}), 400
    new_store = Store(name=data['name'], area=data.get('area'))
    db.session.add(new_store)
    db.session.commit()
    return jsonify({"message": "Store added", "id": new_store.id}), 201

@app.route('/v1/stores', methods=['GET'])
def get_stores():
    area_str = request.args.get('area')
    query = Store.query
    if area_str: query = query.filter(Store.area == area_str)
    all_stores = query.all()
    results = []
    for store in all_stores:
        results.append({ "id": store.id, "name": store.name, "area": store.area })
    return jsonify(results)

@app.route('/v1/areas', methods=['GET'])
def get_areas():
    area_query = db.session.query(Store.area).distinct().filter(Store.area != None)
    areas = [row[0] for row in area_query]
    return jsonify(areas)

@app.route('/')
def hello():
    return "Hello! Your feedback server is running."

# --- 4. Run the App (UPDATED) ---
if __name__ == '__main__':
    with app.app_context():
        db.create_all() 
    # --- CHANGED: Use socketio.run ---
    socketio.run(app, debug=True, port=5000)