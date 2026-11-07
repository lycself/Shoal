"""YAML helpers.

GOTM and FABM configuration files use YAML 1.2 semantics where words like
``off`` are strings; PyYAML (YAML 1.1) would turn them into booleans and break
GOTM. ruamel.yaml round-trips them and keeps comments.
"""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.allow_duplicate_keys = True  # some reference ERSEM files repeat a key
    y.width = 4096
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def load(path: str | Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return _yaml().load(f)


def loads(text: str) -> Any:
    return _yaml().load(text)


_QUOTED = re.compile(r"""^(\s*(?:-\s+)?[^\s#'"][^:#]*:\s+|\s*-\s+)(['"])(.*)\2(\s*(?:#.*)?)$""")


def _unquote(text: str) -> str:
    """GOTM/FABM's YAML reader rejects quoted scalars; emit them plain."""
    out = []
    for line in text.splitlines():
        m = _QUOTED.match(line)
        if m:
            inner = m.group(3).replace("''", "'") if m.group(2) == "'" else m.group(3)
            line = f"{m.group(1)}{inner}{m.group(4)}"
        out.append(line)
    return "\n".join(out) + "\n"


def dump(data: Any, path: str | Path) -> None:
    Path(path).write_text(dumps(data), encoding="utf-8")


def dumps(data: Any) -> str:
    buf = io.StringIO()
    _yaml().dump(data, buf)
    return _unquote(buf.getvalue())


def to_plain(data: Any) -> Any:
    """Convert ruamel containers to plain dict/list (for JSON)."""
    if isinstance(data, dict):
        return {str(k): to_plain(v) for k, v in data.items()}
    if isinstance(data, list):
        return [to_plain(v) for v in data]
    return data


def cmap(d: dict | None = None) -> CommentedMap:
    m = CommentedMap()
    for k, v in (d or {}).items():
        m[k] = v
    return m


def set_path(root: Any, dotted: str, value: Any) -> None:
    """Set root['a']['b']['c'] = value for dotted path 'a/b/c' (creating maps)."""
    keys = [k for k in dotted.strip("/").split("/") if k]
    node = root
    for k in keys[:-1]:
        if k not in node or node[k] is None:
            node[k] = CommentedMap()
        node = node[k]
    node[keys[-1]] = value


def get_path(root: Any, dotted: str, default: Any = None) -> Any:
    node = root
    for k in [k for k in dotted.strip("/").split("/") if k]:
        if not isinstance(node, dict) or k not in node:
            return default
        node = node[k]
    return node
