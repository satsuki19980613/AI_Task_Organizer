"""Diary ルート: /api/diary/*."""
from flask import Blueprint, jsonify, request


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('diary', __name__)
    svc = container.diary_service

    @bp.route('/api/diary', methods=['GET'])
    def get_diary():
        return jsonify(svc.list_range(
            date_from=request.args.get('from', ''),
            date_to=request.args.get('to', ''),
        ))

    @bp.route('/api/diary', methods=['POST'])
    def create_diary():
        return jsonify(svc.create(request.get_json() or {})), 201

    @bp.route('/api/diary/<entry_id>', methods=['PUT'])
    def update_diary(entry_id):
        return jsonify(svc.update(entry_id, request.get_json() or {}))

    @bp.route('/api/diary/<entry_id>', methods=['DELETE'])
    def delete_diary(entry_id):
        svc.delete(entry_id)
        return jsonify({'ok': True})

    @bp.route('/api/diary/consolidate', methods=['POST'])
    def consolidate_diary():
        return jsonify(svc.consolidate())

    return bp
