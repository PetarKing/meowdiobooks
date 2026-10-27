"""Stable, reviewed import failures shared by local and hosted document readers."""

from typing import Literal

DocumentImportErrorCode = Literal[
    "encrypted-pdf", "encrypted-epub", "unsupported-epub-compression",
]

_MESSAGES: dict[DocumentImportErrorCode, str] = {
    "encrypted-pdf": (
        "This PDF is encrypted or password-protected. Upload an unprotected copy to continue."
    ),
    "encrypted-epub": (
        "This EPUB contains protected content. Upload an unprotected copy to continue."
    ),
    "unsupported-epub-compression": (
        "This EPUB uses unsupported compression. Upload another EPUB or a PDF, TXT, or Markdown file."
    ),
}


class DocumentImportError(ValueError):
    """A classified import rejection with a fixed public message and stable code."""

    def __init__(self, code: DocumentImportErrorCode):
        self.code = code
        super().__init__(_MESSAGES[code])
