"""Weekly review ルート: /api/review/*."""
from flask import Blueprint, jsonify, request


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('review', __name__)
    svc = container.task_service

    @bp.route('/api/review/summary', methods=['GET'])
    def review_summary():
        return jsonify(svc.review_summary())

    @bp.route('/api/review/complete', methods=['POST'])
    def review_complete():
        return jsonify(svc.review_complete(request.get_json() or {})), 201

    return bp
