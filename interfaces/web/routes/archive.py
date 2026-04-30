"""Archive 関連ルート: /api/tasks/<id>/archive, /api/archive/*."""
from flask import Blueprint, jsonify, request


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('archive', __name__)
    svc = container.task_service

    @bp.route('/api/tasks/<task_id>/archive', methods=['POST'])
    def archive_task_route(task_id):
        archived = svc.archive(task_id)
        return jsonify({'ok': True, 'archived_at': archived.get('archived_at')})

    @bp.route('/api/archive', methods=['GET'])
    def get_archive():
        return jsonify(svc.list_archived(
            query=request.args.get('q', '').strip(),
            category=request.args.get('category', ''),
            sort=request.args.get('sort', 'newest'),
        ))

    @bp.route('/api/archive/<task_id>', methods=['DELETE'])
    def delete_archived(task_id):
        svc.delete_archived(task_id)
        return jsonify({'ok': True})

    @bp.route('/api/archive/<task_id>/restore', methods=['POST'])
    def restore_archived(task_id):
        return jsonify(svc.restore_from_archive(task_id))

    return bp
