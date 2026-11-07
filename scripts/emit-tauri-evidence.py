#!/usr/bin/env python3
"""Emit only top-level owned evidence files as bounded, lossless JSON lines."""
import base64
import hashlib
import json
from pathlib import Path
import sys

CHUNK = 12 * 1024
MAX_FILE = 64 * 1024 * 1024


def records(directory):
    directory = Path(directory)
    if directory.is_symlink():
        raise ValueError('evidence root symlink rejected: ' + str(directory))
    priority = {'report.json': 0, 'test.log': 1, 'inventory.log': 2}
    for path in sorted(directory.iterdir(), key=lambda p: (priority.get(p.name, 3), p.name)):
        if path.is_symlink():
            raise ValueError('evidence symlink rejected: ' + str(path))
        if not path.is_file():
            continue
        size = path.stat().st_size
        if size > MAX_FILE:
            raise ValueError('evidence exceeds explicit file limit: ' + str(path))
        raw = path.read_bytes()
        if len(raw) != size:
            raise ValueError('evidence changed while reading: ' + str(path))
        common = {'group': directory.name, 'file': path.name}
        count = (len(raw) + CHUNK - 1) // CHUNK
        yield dict(common, type='file', bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), chunks=count)
        for index in range(count):
            part = raw[index * CHUNK:(index + 1) * CHUNK]
            yield dict(common, type='chunk', index=index, bytes=len(part), sha256=hashlib.sha256(part).hexdigest(), base64=base64.b64encode(part).decode('ascii'))


def main():
    complete = bool(sys.argv[1:])
    for arg in sys.argv[1:]:
        directory = Path(arg)
        if directory.is_symlink() or not directory.is_dir():
            print(json.dumps({'type': 'missing_or_invalid_group', 'group': directory.name}), flush=True)
            complete = False
            continue
        try:
            for record in records(directory):
                print(json.dumps(record, separators=(',', ':')), flush=True)
        except (OSError, ValueError) as error:
            print(json.dumps({'type': 'incomplete_group', 'group': directory.name, 'error': str(error)}), flush=True)
            complete = False
    if not complete:
        raise SystemExit('Evidence is incomplete; see explicit group status records.')


if __name__ == '__main__':
    main()
