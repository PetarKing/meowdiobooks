"""Explicit public recovery text, independent of private exception diagnostics."""


class WorkflowInputError(ValueError):
    """An invalid workflow input with reviewed guidance for the reader."""

    def __init__(self, message: str, *, public_message: str | None = None) -> None:
        super().__init__(message)
        self.public_message = public_message or message


def public_error_message(error: Exception, fallback: str) -> str:
    message = getattr(error, "public_message", None)
    return message if isinstance(message, str) and message.strip() else fallback
