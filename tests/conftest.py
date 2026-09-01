"""Pytest configuration for the direct-mode contract tests.

`genlayer-test` injects the transaction message by writing it to a temporary
file and duplicating that file onto stdin, then immediately unlinking it. POSIX
allows unlinking an open file; Windows does not, so the upstream helper raises
`PermissionError` before any test body runs.

The shim below performs the same injection but defers deletion until the
interpreter exits, which is correct on both platforms. Remove it once
genlayer-test handles Windows natively.
"""

import atexit
import os
import sys
import tempfile

from gltest.direct import loader

_PENDING_DELETIONS: list[str] = []


def _cleanup_pending() -> None:
    for path in _PENDING_DELETIONS:
        try:
            os.unlink(path)
        except OSError:
            pass
    _PENDING_DELETIONS.clear()


atexit.register(_cleanup_pending)


def _inject_message_to_fd0(vm) -> None:
    try:
        from genlayer.py import calldata
        from genlayer.py.types import Address
    except ImportError:
        return

    def as_address(value):
        return Address(value) if isinstance(value, bytes) else value

    encoded = calldata.encode(
        {
            "contract_address": as_address(vm._contract_address),
            "sender_address": as_address(vm.sender),
            "origin_address": as_address(vm.origin),
            "stack": [],
            "value": vm._value,
            "datetime": vm._datetime,
            "is_init": False,
            "chain_id": vm._chain_id,
            "entry_kind": 0,
            "entry_data": b"",
            "entry_stage_data": None,
        }
    )

    fd, path = tempfile.mkstemp()
    try:
        os.write(fd, encoded)
        os.lseek(fd, 0, os.SEEK_SET)
        vm._original_stdin_fd = os.dup(0)
        os.dup2(fd, 0)
    finally:
        os.close(fd)
        if sys.platform == "win32":
            _PENDING_DELETIONS.append(path)
        else:
            try:
                os.unlink(path)
            except OSError:
                pass


loader._inject_message_to_fd0 = _inject_message_to_fd0
