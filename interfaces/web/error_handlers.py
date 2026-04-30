"""DomainError 階層を HTTP レスポンスに変換する一元化ポイント。"""
from flask import Flask, jsonify

from core.domain.errors import (
    DomainError, NotFoundError, ValidationError, ConflictError,
)


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(NotFoundError)
    def _not_found(e: NotFoundError):
        return jsonify({'error': e.message}), 404

    @app.errorhandler(ValidationError)
    def _validation(e: ValidationError):
        return jsonify({'error': e.message}), 400

    @app.errorhandler(ConflictError)
    def _conflict(e: ConflictError):
        return jsonify({'error': e.message}), 409

    @app.errorhandler(DomainError)
    def _domain(e: DomainError):
        return jsonify({'error': e.message}), 400
