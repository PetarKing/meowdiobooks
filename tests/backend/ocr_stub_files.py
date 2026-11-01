"""Confined filesystem operations for injected OCR command stubs."""
import os
from pathlib import Path


def write_stub_text(root, candidate, text):
    trusted_root = os.path.realpath(root)
    output = os.path.realpath(candidate)
    if not output.startswith(trusted_root + os.sep):
        raise ValueError("Stub path is outside the trusted test directory")
    Path(output).write_text(text)


def write_stub_png(root, candidate):
    from PIL import Image

    trusted_root = os.path.realpath(root)
    output = os.path.realpath(candidate)
    if not output.startswith(trusted_root + os.sep):
        raise ValueError("Stub path is outside the trusted test directory")
    Image.new('RGB', (400, 600), 'white').save(output)


def read_stub_pdf(root, candidate):
    from pypdf import PdfReader

    trusted_root = os.path.realpath(root)
    source = os.path.realpath(candidate)
    if not source.startswith(trusted_root + os.sep):
        raise ValueError("Stub path is outside the trusted test directory")
    return PdfReader(source)
