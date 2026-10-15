"""Validate the Linux unit with this checkout's paths, without installing it."""

import pathlib
import shutil
import subprocess
import sys
import tempfile


def main():
    verifier = shutil.which('systemd-analyze')
    if not verifier:
        raise SystemExit('systemd-analyze is required for Linux service verification.')
    root = pathlib.Path(__file__).resolve().parent.parent
    unit = (root / 'deploy/phutai-webgis.service').read_text()
    # Resolve deployment paths for syntax checking on the development machine.
    # The actual target unit remains unchanged and is not installed or started.
    unit = unit.replace('/opt/phutai-webgis/.venv/bin/python', sys.executable)
    unit = unit.replace('/opt/phutai-webgis', str(root))
    with tempfile.TemporaryDirectory(prefix='phutai-unit-') as directory:
        config = pathlib.Path(directory) / 'runtime.env'
        config.write_text('ENVIRONMENT=production\n')
        unit = unit.replace('/etc/phutai-webgis.env', str(config))
        path = pathlib.Path(directory) / 'phutai-webgis.service'
        path.write_text(unit)
        result = subprocess.run([verifier, 'verify', '--man=no', str(path)])
        if result.returncode:
            raise SystemExit(result.returncode)
    print('Linux service syntax verified; no host service was installed or started.')


if __name__ == '__main__':
    main()
