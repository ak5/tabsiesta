"""Export checked-in logo sizes on macOS with sips; strip ancillary PNG metadata.

Normal extension builds use the committed icons and do not run this script.
"""
import shutil
import struct
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
SOURCE = PROJECT / 'docs' / 'assets' / 'logo.png'
ICONS = PROJECT / 'public' / 'icons'


def strip_metadata(path):
    data = path.read_bytes()
    output = bytearray(data[:8])
    offset = 8
    while offset < len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        end = offset + length + 12
        kind = data[offset + 4:offset + 8]
        if kind in (b'IHDR', b'PLTE', b'tRNS', b'IDAT', b'IEND'):
            output.extend(data[offset:end])
        offset = end
    path.write_bytes(output)


if not SOURCE.exists():
    raise SystemExit('Missing docs/assets/logo.png.')
if not shutil.which('sips'):
    raise SystemExit('Icon export uses macOS sips. Build with the checked-in icons on other platforms.')
ICONS.mkdir(parents=True, exist_ok=True)
for size in [16, 32, 48, 128]:
    destination = ICONS / f'icon{size}.png'
    subprocess.run(['sips', '--resampleHeightWidth', str(size), str(size), str(SOURCE), '--out', str(destination)], check=True, stdout=subprocess.DEVNULL)
    strip_metadata(destination)
print('Exported 16, 32, 48, and 128 px icons without ancillary metadata.')
