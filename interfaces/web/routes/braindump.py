"""Braindump ルート: /api/braindump/*."""
from flask import Blueprint, jsonify, request


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('braindump', __name__)
    svc = container.braindump_service

    @bp.route('/api/braindump/save', methods=['POST'])
    def save_braindump():
        data = request.get_json()
        return jsonify(svc.save_from_chat(data.get('messages', [])))

    @bp.route('/api/braindump', methods=['GET'])
    def get_braindump():
        return jsonify(svc.list_all())

    @bp.route('/api/braindump/<session_id>', methods=['DELETE'])
    def delete_braindump(session_id):
        svc.delete(session_id)
        return jsonify({'ok': True})

    return bp
