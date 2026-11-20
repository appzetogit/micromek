// Generates src/modules/admin/styles/adminBrand.generated.css: the MIKROMEK
// brand layer for the admin panel.
//
// The panel was built with a yellow accent (yellow-* and #FFC400 / #F4B400)
// and the platform pages with indigo. Rather than rewrite hundreds of class
// names, this scans src/modules/admin for every accent class actually used
// and re-points it at the brand red, in light and dark mode. Status colours
// (emerald, amber, red, blue...) are left alone.
//
// Solid accent backgrounds get white text (red needs it; yellow had dark text).
//
// Loaded after adminTheme.css and both dark-theme files (AdminLayout.jsx).
// Selectors carry the same weight as the dark theme's own overrides, so the
// later file wins. Re-run from frontend/ after adding accent classes:
//   node scripts/generate-admin-brand-theme.cjs
const fs = require('fs');
const path = require('path');

const ADMIN_DIR = path.join(__dirname, '..', 'src', 'modules', 'admin');
const OUTPUT = path.join(ADMIN_DIR, 'styles', 'adminBrand.generated.css');

const ANY = "html[data-admin-theme] body .redigo-admin-root";
const DARK = "html[data-admin-theme='dark'] body .redigo-admin-root";

const RED = '#e1251b';
const RED_600 = '#c51d14';
const RED_700 = '#9f150e';
const RGB = '225,37,27';
const LIGHT = {
  pale: '#fdecea',
  paleHover: '#fbd9d6',
  mid: '#f7b4ae',
  text: '#d01e15',
  textSoft: '#e8655d',
  borderPale: '#f6c7c3',
};
const DARK_TONE = {
  pale: `rgba(${RGB},0.16)`,
  paleHover: `rgba(${RGB},0.24)`,
  mid: `rgba(${RGB},0.35)`,
  text: '#ff6b61',
  textSoft: '#ff8f87',
  borderPale: `rgba(${RGB},0.35)`,
};

// ---- scan ----
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) files.push(p);
  }
};
walk(ADMIN_DIR);

const COLOR = '(yellow-\\d{2,3}|indigo-\\d{2,3}|\\[#(?:FFC400|F4B400|FFB300)\\])';
const TOKEN = new RegExp(`(?<![\\w-])((?:[a-z-]+:)*)(bg|text|border|ring|accent|shadow|fill|stroke|outline|divide|placeholder|decoration)-${COLOR}(\\/\\d{1,3})?(?![\\w-])`, 'gi');
const found = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(TOKEN)) found.set(m[0], { variants: m[1], prop: m[2], color: m[3], alpha: m[4] || '' });
}

// ---- selectors ----
const esc = (name) => `.${name.replace(/([:/\[\]#.])/g, '\\$1')}`;
const PSEUDO = { hover: ':hover', focus: ':focus', 'focus-within': ':focus-within', 'focus-visible': ':focus-visible', active: ':active', within: ':focus-within' };
const selectorFor = (token, variants) => {
  const parts = variants.split(':').filter(Boolean);
  let pseudo = '';
  let prefix = '';
  for (const v of parts) {
    if (PSEUDO[v]) pseudo += PSEUDO[v];
    else if (v === 'group-hover') prefix = '.group:hover ';
    else if (v === 'group-focus-within') prefix = '.group:focus-within ';
    else if (v === 'group-focus') prefix = '.group:focus ';
    else if (v === 'peer-focus' || v === 'peer-checked' || v === 'disabled' || v === 'placeholder') return null;
    // responsive (sm:, md: ...) and dark: apply the same colour at every width
  }
  return `${prefix}${esc(token)}${pseudo}`;
};

const shadeOf = (color) => {
  if (color.startsWith('[')) return color.includes('F4B400') ? 600 : 400;
  return Number(color.split('-')[1]);
};
const alphaOf = (a) => (a ? Number(a.slice(1)) : 100);

// ---- rules ----
const rules = { any: new Map(), dark: new Map() };
const add = (bucket, selector, body) => {
  if (!rules[bucket].has(body)) rules[bucket].set(body, new Set());
  rules[bucket].get(body).add(selector);
};

for (const [token, t] of found) {
  const sel = selectorFor(token, t.variants);
  if (!sel) continue;
  const shade = shadeOf(t.color);
  const alpha = alphaOf(t.alpha);
  const isHover = /hover/.test(t.variants);

  switch (t.prop) {
    case 'bg': {
      if (shade <= 200 || alpha <= 30) {
        add('any', sel, `background-color: ${isHover ? LIGHT.paleHover : LIGHT.pale} !important;`);
        add('dark', sel, `background-color: ${isHover ? DARK_TONE.paleHover : DARK_TONE.pale} !important;`);
      } else if (shade === 300 || alpha < 80) {
        add('any', sel, `background-color: ${LIGHT.mid} !important;`);
        add('dark', sel, `background-color: ${DARK_TONE.mid} !important;`);
      } else {
        const solid = isHover || shade >= 600 ? (shade >= 700 ? RED_700 : RED_600) : RED;
        add('any', sel, `background-color: ${solid} !important;`);
        // White text on solid red, including children (yellow used dark text).
        if (!isHover) add('any', `${sel}, ${sel} *`, 'color: #ffffff !important;');
      }
      break;
    }
    case 'text':
    case 'placeholder':
    case 'decoration': {
      const prop = t.prop === 'decoration' ? 'text-decoration-color' : 'color';
      const target = t.prop === 'placeholder' ? `${sel}::placeholder` : sel;
      add('any', target, `${prop}: ${shade >= 400 ? LIGHT.text : LIGHT.textSoft} !important;`);
      add('dark', target, `${prop}: ${shade >= 400 ? DARK_TONE.text : DARK_TONE.textSoft} !important;`);
      break;
    }
    case 'border':
    case 'divide':
    case 'outline': {
      const prop = t.prop === 'outline' ? 'outline-color' : 'border-color';
      const target = t.prop === 'divide' ? `${sel} > * + *` : sel;
      if (shade <= 200 || alpha <= 40) {
        add('any', target, `${prop}: ${LIGHT.borderPale} !important;`);
        add('dark', target, `${prop}: ${DARK_TONE.borderPale} !important;`);
      } else {
        add('any', target, `${prop}: ${RED} !important;`);
      }
      break;
    }
    case 'ring':
      add('any', sel, `--tw-ring-color: rgba(${RGB},${alpha <= 20 ? 0.18 : 0.38}) !important;`);
      break;
    case 'accent':
      add('any', sel, `accent-color: ${RED} !important;`);
      break;
    case 'shadow':
      add('any', sel, `--tw-shadow-color: rgba(${RGB},0.25) !important;`);
      break;
    case 'fill':
      add('any', sel, `fill: ${RED} !important;`);
      break;
    case 'stroke':
      add('any', sel, `stroke: ${RED} !important;`);
      break;
    default:
  }
}

const emit = (bucket, scope) =>
  [...rules[bucket]].map(([body, sels]) => `${[...sels].sort().map((s) => `${scope} ${s.replace(/, /g, `,\n${scope} `)}`).join(',\n')} {\n  ${body}\n}`).join('\n\n');

const header = `/* Generated by scripts/generate-admin-brand-theme.cjs. Do not edit by hand.\n   MIKROMEK brand layer: accent classes (yellow, indigo, #FFC400) → brand red. */\n`;
fs.writeFileSync(OUTPUT, `${header}\n${emit('any', ANY)}\n\n/* Dark mode tints */\n${emit('dark', DARK)}\n`);
console.log(`classes: ${found.size}; light rules: ${rules.any.size}; dark rules: ${rules.dark.size} → ${path.relative(process.cwd(), OUTPUT)}`);
