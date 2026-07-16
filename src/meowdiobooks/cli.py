from __future__ import annotations

import argparse
import fcntl
import os
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .assets import application_root, checkout_root


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="meowdiobooks")
    commands = root.add_subparsers(required=True)
    serve_command = commands.add_parser("serve", help="Run the local Meowdiobooks wizard")
    serve_command.add_argument("--host", default="127.0.0.1")
    serve_command.add_argument("--port", type=int, default=8000)
    serve_command.add_argument("--data", default=".meowdiobooks")
    serve_command.add_argument(
        "--rebuild-frontend",
        action="store_true",
        help="Install and build the frontend once before starting the server",
    )
    serve_command.add_argument(
        "--library",
        default=str(Path.home() / "Music" / "Meowdiobooks"),
        help="Directory for completed M4B audiobooks",
    )
    serve_command.set_defaults(handler=_serve)
    doctor_command = commands.add_parser(
        "doctor", help="Check dependencies, configured models, and local build readiness"
    )
    doctor_command.set_defaults(handler=_doctor)
    return root


def _serve(args: argparse.Namespace) -> int:
    if getattr(args, "rebuild_frontend", False):
        _rebuild_frontend()

    import uvicorn

    from .backend.app import create_app

    library = getattr(args, "library", str(Path.home() / "Music" / "Meowdiobooks"))
    with _single_instance_lock(args.data):
        uvicorn.run(create_app(args.data, library_dir=library), host=args.host, port=args.port)
    return 0


def _rebuild_frontend() -> None:
    """Build the checked-out frontend once before serving it."""

    root = checkout_root()
    if root is None:
        raise OSError("--rebuild-frontend is available only from a source checkout")
    frontend = root / "frontend"
    if not (frontend / "package.json").is_file() or not (
        frontend / "package-lock.json"
    ).is_file():
        raise OSError("frontend package files are missing from this source checkout")

    commands = (("npm", "ci"), ("npm", "run", "build"))
    for command in commands:
        try:
            subprocess.run(command, cwd=frontend, check=True)
        except FileNotFoundError as error:
            raise OSError("npm is required to rebuild the frontend") from error
        except subprocess.CalledProcessError as error:
            rendered = " ".join(command)
            raise OSError(f"frontend rebuild failed while running `{rendered}`") from error


@contextmanager
def _single_instance_lock(data_dir: str | Path) -> Iterator[None]:
    """Prevent two backends from mutating the same local job store."""

    root = Path(data_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    lock_path = root / "server.lock"
    handle = lock_path.open("a+", encoding="utf-8")
    acquired = False
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError as error:
            handle.seek(0)
            owner = handle.read().strip()
            suffix = f" (PID {owner})" if owner.isdecimal() else ""
            raise OSError(
                f"Meowdiobooks is already running for {root}{suffix}"
            ) from error

        handle.seek(0)
        handle.truncate()
        handle.write(str(os.getpid()))
        handle.flush()
        yield
    finally:
        try:
            if acquired:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _doctor(_args: argparse.Namespace) -> int:
    from .diagnostics import print_doctor

    return print_doctor(application_root())


def main() -> None:
    args = parser().parse_args()
    try:
        raise SystemExit(args.handler(args))
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2) from error
