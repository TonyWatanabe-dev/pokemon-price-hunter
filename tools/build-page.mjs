// Monta index.html a partir de tools/page.template.html: embute a fonte (base64) e os ícones (sprite SVG).
// Uso: node tools/build-page.mjs <pasta node_modules com @fontsource-variable/rubik e @phosphor-icons/core>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = process.argv[2];
if (!nm) { console.error('Informe a pasta node_modules.'); process.exit(1); }
const font = fs.readFileSync(path.join(nm, '@fontsource-variable/rubik/files/rubik-latin-wght-normal.woff2')).toString('base64');
const ICONS = { bold: ['tag', 'storefront', 'bell', 'warning', 'x', 'arrow-square-out', 'plus', 'check-circle', 'clock', 'truck', 'caret-down', 'seal-check', 'trend-down', 'moon', 'sun', 'info', 'arrow-clockwise', 'package', 'funnel', 'calendar-blank', 'magnifying-glass', 'lightbulb', 'house', 'dots-three', 'heart', 'user-circle', 'sign-out', 'google-logo', 'trash', 'bell-ringing', 'gear-six'],
  fill: ['lightning', 'flame', 'drop', 'leaf', 'sparkle', 'cylinder', 'tag', 'seal-check', 'heart', 'cube', 'cards', 'crown', 'stack', 'package'] };
let sprite = '';
for (const [w, names] of Object.entries(ICONS)) for (const n of names) {
  const svg = fs.readFileSync(path.join(nm, `@phosphor-icons/core/assets/${w}/${n}${w === 'regular' ? '' : '-' + w}.svg`), 'utf8');
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  sprite += `<symbol id="i-${n}${w === 'fill' ? '-f' : ''}" viewBox="0 0 256 256">${inner}</symbol>`;
}
const tpl = fs.readFileSync(path.join(root, 'tools/page.template.html'), 'utf8');
const logo = fs.readFileSync(path.join(root, 'tools/logo.svg')).toString('base64');
const out = tpl.replaceAll('/*LOGO*/', logo).replace('/*FONT_RUBIK*/', font).replace('<!--SPRITE-->', `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${sprite}</svg>`);
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log(`index.html: ${(out.length / 1024).toFixed(0)} KB`);
