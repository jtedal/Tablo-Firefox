import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'src'
manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
if not version or any(character not in '0123456789.' for character in version):
    raise SystemExit('Некорректная версия в manifest.json.')
files = sorted(path for path in source.rglob('*') if path.is_file())
if any(path.is_symlink() for path in source.rglob('*')):
    raise SystemExit('Символические ссылки в src не поддерживаются.')
destination = root / 'dist'
destination.mkdir(exist_ok=True)
output = destination / f'Tablo-Firefox-{version}-unsigned.xpi'
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in files:
        name = path.relative_to(source).as_posix()
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
digest = hashlib.sha256(output.read_bytes()).hexdigest()
print(f'{output.name}: {len(files)} файлов, {output.stat().st_size} байт')
print(f'SHA256 {digest}')
