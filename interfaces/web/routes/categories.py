"""Category ルート: /api/categories/*."""
from flask import Blueprint, jsonify, request


def make_blueprint(container) -> Blueprint:
    bp = Blueprint('categories', __name__)
    svc = container.category_service

    @bp.route('/api/categories', methods=['GET'])
    def get_categories():
        return jsonify(svc.list_all())

    @bp.route('/api/categories', methods=['POST'])
    def create_category():
        return jsonify(svc.create(request.get_json() or {})), 201

    @bp.route('/api/categories/<cat_id>', methods=['PUT'])
    def update_category(cat_id):
        return jsonify(svc.update(cat_id, request.get_json() or {}))

    @bp.route('/api/categories/<cat_id>', methods=['DELETE'])
    def delete_category(cat_id):
        svc.delete(cat_id)
        return jsonify({'ok': True})

    return bp
