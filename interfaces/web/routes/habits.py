"""Habit ルート: /api/habits/*."""
from flask import Blueprint, jsonify, request


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('habits', __name__)
    svc = container.habit_service

    @bp.route('/api/habits', methods=['GET'])
    def get_habits():
        return jsonify(svc.list_with_today())

    @bp.route('/api/habits', methods=['POST'])
    def create_habit():
        return jsonify(svc.create(request.get_json() or {})), 201

    @bp.route('/api/habits/<habit_id>', methods=['PUT'])
    def update_habit(habit_id):
        return jsonify(svc.update(habit_id, request.get_json() or {}))

    @bp.route('/api/habits/<habit_id>', methods=['DELETE'])
    def delete_habit(habit_id):
        svc.delete(habit_id)
        return jsonify({'ok': True})

    @bp.route('/api/habits/<habit_id>/log', methods=['POST'])
    def log_habit(habit_id):
        data = request.get_json() or {}
        svc.log(
            habit_id,
            date_str=data.get('date', ''),
            done=bool(data.get('done', True)),
        )
        return jsonify({'ok': True})

    @bp.route('/api/habits/<habit_id>/logs', methods=['GET'])
    def get_habit_logs(habit_id):
        days = request.args.get('days', 90, type=int)
        return jsonify(svc.get_logs(habit_id, days))

    @bp.route('/api/habits/<habit_id>/stats', methods=['GET'])
    def get_habit_stats(habit_id):
        return jsonify(svc.get_stats(habit_id))

    return bp
