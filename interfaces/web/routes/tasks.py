"""Task 関連ルート: /api/tasks/*, /api/drafts, /api/today, /api/tomorrow."""
from flask import Blueprint, jsonify, request

from core.domain.errors import NotFoundError


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('tasks', __name__)
    svc = container.task_service

    @bp.route('/api/tasks', methods=['GET'])
    def get_tasks():
        return jsonify(svc.list_all())

    @bp.route('/api/tasks', methods=['POST'])
    def create_task():
        return jsonify(svc.create(request.get_json() or {})), 201

    @bp.route('/api/tasks/<task_id>', methods=['PUT'])
    def update_task(task_id):
        return jsonify(svc.update(task_id, request.get_json() or {}))

    @bp.route('/api/tasks/<task_id>', methods=['DELETE'])
    def delete_task(task_id):
        svc.delete(task_id)
        return jsonify({'ok': True})

    @bp.route('/api/tasks/collect', methods=['POST'])
    def collect_tasks():
        data = request.get_json() or {}
        titles = data.get('titles', [])
        if not isinstance(titles, list):
            return jsonify({'error': 'titles must be a list'}), 400
        return jsonify(svc.collect(titles)), 201

    @bp.route('/api/tasks/move', methods=['POST'])
    def move_task():
        data = request.get_json() or {}
        task_id = data.get('task_id') or data.get('id')
        target = data.get('target_status')
        if not task_id:
            return jsonify({'ok': False, 'error': 'task_id is required'}), 400
        force_params = {
            'force_clear_schedule': bool(data.get('force_clear_schedule')),
            'force_detach_project': bool(data.get('force_detach_project')),
        }
        try:
            return jsonify(svc.move(task_id, target, force_params))
        except NotFoundError:
            return jsonify({'ok': False, 'error': 'not found'}), 404

    @bp.route('/api/tasks/<task_id>/schedule', methods=['POST'])
    def schedule_task(task_id):
        data = request.get_json() or {}
        if 'scheduled_for' not in data:
            return jsonify({'error': 'scheduled_for is required'}), 400
        return jsonify(svc.schedule(task_id, data['scheduled_for']))

    @bp.route('/api/tasks/<task_id>/similar', methods=['GET'])
    def get_similar_tasks(task_id):
        return jsonify(svc.find_similar(task_id))

    @bp.route('/api/drafts', methods=['GET'])
    def get_drafts():
        return jsonify(svc.list_drafts())

    @bp.route('/api/today', methods=['GET'])
    def get_today():
        return jsonify(svc.get_today_panel())

    @bp.route('/api/tomorrow', methods=['GET'])
    def get_tomorrow():
        return jsonify(svc.get_tomorrow_panel())

    @bp.route('/api/daily-log/<date_str>', methods=['GET'])
    def get_daily_log(date_str):
        # date_str: YYYY-MM-DD（軽量バリデーション）
        if len(date_str) != 10 or date_str[4] != '-' or date_str[7] != '-':
            return jsonify({'error': 'date must be YYYY-MM-DD'}), 400
        return jsonify(svc.get_daily_log(date_str))

    return bp
