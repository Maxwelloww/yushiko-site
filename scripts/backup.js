import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = path.join(root, 'data', 'yushiko.sqlite');
if (!fs.existsSync(dbPath)) { console.error('Database not found. Start the site once first.'); process.exit(1); }
const outDir = path.join(root, 'backups'); fs.mkdirSync(outDir,{recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const dest = path.join(outDir, `yushiko-${stamp}.sqlite`);
const db = new Database(dbPath, { readonly: true });
await db.backup(dest); db.close();
console.log(`Backup created: ${dest}`);
