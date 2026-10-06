// Persistência em JSON/JSONL dentro de /data (versionável no Git, zero custo).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = () => process.env.HUNTER_DATA_DIR || path.join(ROOT, 'data');
const CONFIG = () => process.env.HUNTER_CONFIG_DIR || path.join(ROOT, 'config');

export const dataPath = (f) => path.join(DATA(), f);
export const configPath = (f) => path.join(CONFIG(), f);
export function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
export function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, file); }
export function appendJsonl(file, rows) { if (!rows.length) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); }
export function readJsonl(file) { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }
