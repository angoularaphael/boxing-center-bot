'use strict';

/**
 * Export Sport2000 xlsx → data/sport2000-audience.json (dédup email).
 *   node scripts/export-sport2000-audience.js
 *   node scripts/export-sport2000-audience.js "path/to/file.xlsx"
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'sport2000-audience.json');
const DEFAULT_XLSX = path.join(
  ROOT,
  '..',
  'sport2000 France City and dob Filter FIXED.xlsx'
);

const xlsxPath = path.resolve(process.argv[2] || DEFAULT_XLSX);
if (!fs.existsSync(xlsxPath)) {
  console.error('Fichier introuvable:', xlsxPath);
  process.exit(1);
}

const py = `
import json, sys
try:
    import openpyxl
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "openpyxl", "-q"])
    import openpyxl

path = sys.argv[1]
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
by = {}
rows = 0
for r in ws.iter_rows(values_only=True):
    rows += 1
    prenom = str(r[0] or "").strip()
    nom = str(r[1] or "").strip()
    email = str(r[2] or "").strip().lower()
    if not email or "@" not in email:
        continue
    if email in by:
        continue
    by[email] = {"prenom": prenom, "nom": nom, "email": email}
out = sorted(by.values(), key=lambda x: x["email"])
print(json.dumps({"rows": rows, "unique": len(out), "audience": out}, ensure_ascii=False))
`;

const result = spawnSync('python', ['-c', py, xlsxPath], {
  encoding: 'utf8',
  maxBuffer: 80 * 1024 * 1024,
});
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'python failed');
  process.exit(result.status || 1);
}

const parsed = JSON.parse(result.stdout);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(parsed.audience, null, 0), 'utf8');
console.log(`OK rows=${parsed.rows} unique=${parsed.unique} → ${OUT}`);
