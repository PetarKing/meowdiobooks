"""Provider-neutral actions that a host must resolve before work can continue."""

from __future__ import annotations

from fastapi import HTTPException
from pydantic import ValidationError

from .models import ActionRequired


def extract_action_required(error: Exception) -> ActionRequired | None:
    """Accept only a serializable descriptor; malformed attachments remain failures."""
    value = getattr(error, "action_required", None)
    if value is None:
        return None
    try:
        action = ActionRequired.model_validate(value)
        action.model_dump_json()
        return action
    except (ValidationError, ValueError, TypeError):
        return None


def action_required_http_exception(error: Exception) -> HTTPException | None:
    action = extract_action_required(error)
    if action is None:
        return None
    status_code = getattr(error, "status_code", 409)
    if not isinstance(status_code, int) or not 400 <= status_code < 500:
        status_code = 409
    return HTTPException(status_code=status_code, detail={"actionRequired": action.model_dump(mode="json")})
