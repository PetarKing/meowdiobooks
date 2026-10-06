"""Check source publication hygiene; this is not a history or credential scanner."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)")
HTML_LINK = re.compile(r"(?:src|href)=[\"']([^\"']+)[\"']")
PRIVATE_PATH = re.compile(r"/(?:Users|home)/([\w.-]+)/")


def check_files(root: Path, names: list[str]) -> list[str]:
    errors = []
    for name in names:
        path = root / name
        if not path.is_file():
            continue
        parts = path.relative_to(root).parts
        forbidden = (
            (path.name.startswith('.env') and path.name != '.env.example')
            or path.suffix.lower() in {'.pem', '.key', '.gguf', '.safetensors', '.sqlite', '.sqlite3', '.db'}
            or parts[0] in {'internal-docs', '.review-evidence', 'models', '.local', '.meowdiobooks', '.meowdiobooks-v2'}
            or (path.suffix.lower() == '.pdf' and parts[:2] != ('SampleBooks', 'public-domain-evaluation'))
        )
        if forbidden:
            errors.append(f'{name}: private or generated material must not be tracked')
        if path.suffix.lower() not in {'.md', '.json', '.toml', '.yml', '.yaml', '.py', '.mjs', '.cjs', '.ts', '.tsx', '.sh'}:
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        if any(match.group(1) != 'test' for match in PRIVATE_PATH.finditer(text)):
            errors.append(f'{name}: personal filesystem path')
        if path.suffix.lower() != '.md':
            continue
        prose = re.sub(r'```.*?```', '', text, flags=re.S)
        targets = [m.group(1).strip('<>') for m in LINK.finditer(prose)]
        targets += HTML_LINK.findall(prose)
        for target in targets:
            url = urlsplit(target)
            if url.scheme or url.netloc or not url.path:
                continue
            destination = (path.parent / unquote(url.path)).resolve()
            if not destination.is_relative_to(root.resolve()) or not destination.exists():
                errors.append(f'{name}: missing local link {target}')
    return errors


def check_licenses(root: Path) -> list[str]:
    license_text = (root / 'LICENSE').read_bytes()
    return [f'{name}: must match the root LICENSE'
            for name in ('frontend/LICENSE', 'release/python/LICENSE')
            if not (root / name).is_file() or (root / name).read_bytes() != license_text]


def main() -> int:
    names = subprocess.check_output(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        cwd=ROOT,
    ).decode().split('\0')
    errors = check_files(ROOT, list(dict.fromkeys(filter(None, names)))) + check_licenses(ROOT)
    if errors:
        print('\n'.join(errors))
        return 1
    print('Publication hygiene passed: local links, private-file exclusions and license copies.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
