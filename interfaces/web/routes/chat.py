"""Chat ルート: /api/chat, /api/tasks/<id>/chat, /api/projects/<id>/chat."""
from flask import Blueprint, jsonify, request


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('chat', __name__)
    svc = container.chat_service

    @bp.route('/api/chat', methods=['POST'])
    def api_chat():
        data = request.get_json()
        return jsonify(svc.general_chat(
            messages=data.get('messages', []),
            mode=data.get('mode', 'task'),
        ))

    @bp.route('/api/tasks/<task_id>/chat', methods=['POST'])
    def task_chat(task_id):
        data = request.get_json() or {}
        return jsonify(svc.task_detail_chat(task_id, data.get('messages', [])))

    @bp.route('/api/projects/<project_id>/chat', methods=['POST'])
    def project_chat(project_id):
        data = request.get_json() or {}
        return jsonify(svc.project_chat(project_id, data.get('messages', [])))

    return bp
