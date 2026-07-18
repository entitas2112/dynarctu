"""
QDF (Question Data Format) parser — server-side Python port.

This is a line-based, indentation-sensitive parser matching the semantics
of the original js/qdf.js engine. It is intentionally kept server-side
only: QDF files contain answer keys and must never be shipped to the
browser as raw files (see backend/quiz_engine.py, which strips answers
before anything reaches the client).

Only parsing (no serialization) is needed for this application.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional, Union

_KEY_RE = re.compile(r"^[A-Za-z0-9_]+$")


class QDFParseError(Exception):
    def __init__(self, message: str, line: Optional[int] = None, raw: Optional[str] = None):
        prefix = f"QDF parse error (line {line}): " if line is not None else "QDF parse error: "
        super().__init__(prefix + message)
        self.line = line
        self.raw = raw


def _parse_keyed(s: str):
    """Splits `key: value` / `key:` / `key: >` without heavy regex on the hot path."""
    colon = s.find(":")
    if colon == -1:
        return None
    key = s[:colon]
    if not _KEY_RE.match(key):
        return None
    rest = s[colon + 1:]
    if rest == "":
        return ("obj", key, None)
    if rest == " >":
        return ("ml", key, None)
    if rest.startswith(" "):
        return ("kv", key, rest[1:].strip())
    return None


@dataclass
class _Frame:
    n: int
    ref: Any
    parent_ref: Any = None
    key_in_parent: Any = None


class _StateMachine:
    def __init__(self):
        self._reset_record()
        self.line_num = 0
        self.is_multiline = False
        self.ml_target = None
        self.ml_key = None
        self.ml_base_indent = 0
        self.ml_buffer: list[str] = []

    def _reset_record(self):
        self.root: dict = {}
        self.stack = [_Frame(n=-2, ref=self.root, parent_ref=None, key_in_parent=None)]

    def hard_reset(self):
        self._reset_record()
        self.is_multiline = False
        self.ml_target = None
        self.ml_key = None
        self.ml_buffer = []

    def _flush_multiline(self):
        if self.is_multiline:
            self.ml_target[self.ml_key] = "\n".join(self.ml_buffer).rstrip()
            self.is_multiline = False
            self.ml_target = None
            self.ml_key = None
            self.ml_buffer = []

    def feed_line(self, raw_line: str):
        self.line_num += 1
        line = raw_line[:-1] if raw_line.endswith("\r") else raw_line

        length = len(line)
        i = 0
        saw_tab = False
        while i < length:
            c = line[i]
            if c == " ":
                i += 1
            elif c == "\t":
                saw_tab = True
                i += 1
            else:
                break
        n = i
        content = line[n:]
        trimmed_content = content.rstrip()

        # 1. Record separator.
        if n == 0 and trimmed_content == "---":
            self._flush_multiline()
            finished = self.root if self.root else None
            self._reset_record()
            return finished

        # 2. Multiline capture mode.
        if self.is_multiline:
            if trimmed_content == "":
                self.ml_buffer.append("")
                return None
            if saw_tab:
                raise QDFParseError("tabs are forbidden in indentation", self.line_num, raw_line)
            if n < self.ml_base_indent:
                self._flush_multiline()
                # falls through to standard processing below
            else:
                self.ml_buffer.append(line[self.ml_base_indent:])
                return None

        # 3. Blank lines and comments.
        if trimmed_content == "" or (trimmed_content and trimmed_content[0] == "#"):
            return None

        # 4. Indentation validation.
        if saw_tab:
            raise QDFParseError("tabs are forbidden in indentation", self.line_num, raw_line)
        if n % 2 != 0:
            raise QDFParseError("indent must be a multiple of 2 spaces", self.line_num, raw_line)

        # 5. Array items ("- ...").
        if len(content) >= 2 and content[0] == "-" and content[1] == " ":
            item_content = content[2:]

            while self.stack[-1].n > n:
                self.stack.pop()
            top = self.stack[-1]

            if not isinstance(top.ref, list):
                if top.parent_ref is not None and top.key_in_parent is not None:
                    new_list: list = []
                    top.parent_ref[top.key_in_parent] = new_list
                    top.ref = new_list
                else:
                    raise QDFParseError("root level cannot be an array", self.line_num, raw_line)

            parsed = _parse_keyed(item_content)

            if parsed and parsed[0] == "ml":
                obj: dict = {}
                top.ref.append(obj)
                self.stack.append(_Frame(n=n + 1, ref=obj, parent_ref=top.ref, key_in_parent=len(top.ref) - 1))
                self.is_multiline = True
                self.ml_target = obj
                self.ml_key = parsed[1]
                self.ml_base_indent = n + 2
            elif parsed and parsed[0] == "obj":
                inner_obj: dict = {}
                wrapper = {parsed[1]: inner_obj}
                top.ref.append(wrapper)
                self.stack.append(_Frame(n=n + 1, ref=inner_obj, parent_ref=wrapper, key_in_parent=parsed[1]))
            elif parsed and parsed[0] == "kv":
                obj = {parsed[1]: parsed[2]}
                top.ref.append(obj)
                self.stack.append(_Frame(n=n + 1, ref=obj, parent_ref=top.ref, key_in_parent=len(top.ref) - 1))
            else:
                top.ref.append(item_content.strip())
            return None

        # 6. Plain key/value, key: (object), key: > (multiline).
        parsed = _parse_keyed(content)
        if parsed:
            while self.stack[-1].n >= n:
                self.stack.pop()
            top = self.stack[-1]

            if isinstance(top.ref, list):
                raise QDFParseError("cannot attach a raw key to an array", self.line_num, raw_line)

            kind, key, value = parsed
            if kind == "ml":
                top.ref[key] = ""
                self.is_multiline = True
                self.ml_target = top.ref
                self.ml_key = key
                self.ml_base_indent = n + 2
            elif kind == "obj":
                top.ref[key] = {}
                self.stack.append(_Frame(n=n, ref=top.ref[key], parent_ref=top.ref, key_in_parent=key))
            else:
                top.ref[key] = value
            return None

        raise QDFParseError(f'unrecognized syntax -> "{raw_line}"', self.line_num, raw_line)

    def finish(self):
        self._flush_multiline()
        return self.root if self.root else None


OnError = Union[str, Callable[[Exception], None]]


def parse_stream(lines: Iterable[str], on_error: OnError = "throw"):
    sm = _StateMachine()
    skipping = False

    for raw_line in lines:
        if skipping:
            line = raw_line[:-1] if raw_line.endswith("\r") else raw_line
            sm.line_num += 1
            if line == "---":
                sm.hard_reset()
                skipping = False
            continue

        try:
            record = sm.feed_line(raw_line)
        except QDFParseError as err:
            if on_error == "throw":
                raise
            if callable(on_error):
                on_error(err)
            skipping = True
            continue
        if record:
            yield record

    if not skipping:
        try:
            last = sm.finish()
            if last:
                yield last
        except QDFParseError as err:
            if on_error == "throw":
                raise
            if callable(on_error):
                on_error(err)


def parse(text: str, on_error: OnError = "skip") -> list[dict]:
    """Parses a full QDF string into a list of dict records.

    Defaults to 'skip' (rather than 'throw') so one malformed question in a
    large bank doesn't take the whole subject offline; callers that want
    strict validation (e.g. an authoring/admin tool) can pass on_error='throw'.
    """
    return list(parse_stream(text.split("\n"), on_error=on_error))
