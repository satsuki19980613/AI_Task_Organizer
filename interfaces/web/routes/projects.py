"""Project 関連ルート: /api/projects/*."""
from flask import Blueprint, jsonify, request

from core.domain.errors import ValidationError


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('projects', __name__)
    svc = container.project_service

    @bp.route('/api/projects', methods=['GET'])
    def get_projects():
        return jsonify(svc.list_all(
            status=request.args.get('status', '').strip(),
            archived=request.args.get('archived'),
        ))

    @bp.route('/api/projects', methods=['POST'])
    def create_project():
        return jsonify(svc.create(request.get_json() or {})), 201

    @bp.route('/api/projects/<project_id>', methods=['PUT'])
    def update_project(project_id):
        return jsonify(svc.update(project_id, request.get_json() or {}))

    @bp.route('/api/projects/<project_id>', methods=['DELETE'])
    def delete_project(project_id):
        svc.delete(project_id)
        return jsonify({'ok': True})

    @bp.route('/api/projects/<project_id>/activate', methods=['POST'])
    def activate_project(project_id):
        try:
            return jsonify(svc.activate(project_id))
        except ValidationError as e:
            return jsonify({'ok': False, 'error': e.message}), 400

    @bp.route('/api/projects/<project_id>/tasks', methods=['GET'])
    def get_project_tasks(project_id):
        return jsonify(svc.list_tasks(project_id))

    @bp.route('/api/projects/<project_id>/tasks', methods=['POST'])
    def add_project_task(project_id):
        return jsonify(svc.add_task(project_id, request.get_json() or {})), 201

    return bp
