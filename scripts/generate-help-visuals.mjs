/**
 * Reproduce localized help figures without database access or an HTTP application.
 * The navigation crop is the actual built Vue header rendered with fictional account
 * data. Explanatory diagrams are deliberately separate from application screenshots.
 * Run after npm run build: node scripts/generate-help-visuals.mjs --locale=de --figure=navigation
 * Omit --figure to reproduce all three figures; selecting one leaves other PNGs untouched.
 * Figures and their labels belong exclusively beside the release-owned localized guides.
 * Each language owns visual-labels.json beside its guides; UI labels come from the
 * same application catalog used by the actual Vue header. Inspect every PNG export.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import {apiCompatibility} from '../.generated/api/v1/policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const locale = process.argv.find(argument => argument.startsWith('--locale='))?.slice('--locale='.length) ?? 'de';
if (!/^[a-z]{2}(?:-[A-Z]{2})?$/u.test(locale)) throw new Error('A supported locale tag is required.');
const selectedFigure = process.argv.find(argument => argument.startsWith('--figure='))?.slice('--figure='.length) ?? 'all';
if (!['all', 'navigation', 'survey', 'packing'].includes(selectedFigure)) throw new Error('Choose navigation, survey, packing or all.');
const catalogPath = `src/common/locales/${locale}.json`;
const catalog = JSON.parse(await fs.readFile(path.join(root, catalogPath), 'utf8'));
// Both source labels and generated pictures belong to the approved runtime corpus. Keeping
// one fixed destination keeps authoring within the locale's reviewed Help corpus.
const outputRoot = 'docs/user-guide';
if (catalog.locale !== locale || catalog.help?.directory !== locale) throw new Error('The catalog must name its own fixed Help directory.');
const labelsPath = path.join(outputRoot, catalog.help.directory, 'visual-labels.json');
const labels = JSON.parse(await fs.readFile(path.join(root, labelsPath), 'utf8'));
const output = path.join(root, outputRoot, catalog.help.directory, 'assets');
const evidence = path.join(root, `.temp/help-visuals-${locale}`);
const ui = catalog.resources.ui;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// The diagram demonstrates the existing add-combination form. Its sample choice
// has occurrence one; the catalog still owns every displayed control/answer label.
const surveyFigureLabels = {
    surveyheading: ui.survey.addNewCombination,
    surveyweekday: ui.survey.weekdayLabel,
    surveymonday: ui.survey.weekday.MON,
    surveyday: ui.survey.dayInMonth,
    surveyfirst: ui.survey.nthDayInMonth.replace('{{nth}}', '1'),
    surveyadd: ui.survey.add,
    surveyyes: ui.survey.yes,
    surveymaybe: ui.survey.maybe,
    surveyno: ui.survey.no,
};

/** Resolve bounded figure aliases to the same UI catalog as their real controls.
 * Explanatory prose remains language-owned; neither source can supply raw HTML. */
function replaceFigureLabel(_match, key) {
    // Existing app/packing bindings retain precedence; Survey admits only the
    // explicit control/sample aliases above, never arbitrary catalog traversal.
    const translation = ui.packing[key] ?? ui.app[key] ?? surveyFigureLabels[key];
    if (typeof translation !== 'string') throw new Error(`Unknown figure UI label: ${key}`);
    return translation;
}

/** Bind authored aliases before escaping the complete visible figure text. */
function text(value) {
    // Catalog labels are text, just like the surrounding explanatory sentences.
    return escape(value.replace(/\{\{([a-z]+)\}\}/gu, replaceFigureLabel));
}
const lines = values => values.map(text).join('<br>');
await fs.mkdir(output, {recursive: true});
await fs.mkdir(evidence, {recursive: true});

const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/public/app/.vite/manifest.json'), 'utf8'));
const entry = manifest['src/frontend/app/entry-client.ts'];
const builtCss = (await Promise.all(entry.css.map(name => fs.readFile(path.join(root, 'dist/public/app', name), 'utf8')))).join('\n');
const embeddedFonts = new Map();
const assetHashes = {};
// The manifest supplies the same font files as the real browser. Embed those
// release bytes only for this server-free capture, without another CSS inventory
// or a network fallback that could silently differ from the built application.
for (const name of entry.assets ?? []) {
    if (!/\.woff2?$/u.test(name)) continue;
    const bytes = await fs.readFile(path.join(root, 'dist/public/app', name));
    const format = name.endsWith('.woff2') ? 'woff2' : 'woff';
    embeddedFonts.set(`/app/${name}`, `data:font/${format};base64,${bytes.toString('base64')}`);
    assetHashes[name] = hash(bytes);
}
const applicationCss = builtCss.replace(/url\((["']?)(\/app\/assets\/[^"'()\s]+)\1\)/gu,
    function embedBuiltFont(_match, _quote, url) {
        // Upstream cache suffixes do not belong on a data URL. Only fonts
        // declared by this build may replace a stylesheet resource reference.
        const source = embeddedFonts.get(url.split(/[?#]/u, 1)[0]);
        if (!source) throw new Error(`Cannot embed built stylesheet asset: ${url}`);
        return `url("${source}")`;
    });
const logo = await fs.readFile(path.join(root, 'src/public/img/logo.png'));
const renderer = await import(pathToFileURL(path.join(root, 'dist/frontend-server/entry-server.mjs')).href);
const profile = {id: '00000000-0000-4000-8000-000000000001', name: labels.fictionalProfile};
const rendered = await renderer.render(`/help?locale=${locale}`, {session: {
        kind: 'account', context: 'fictional-help-figure', csrfToken: 'fictional-not-a-token', locale,
        // The actual shell requires deployment metadata even for a server-only
        // figure. Reuse its generated compatibility owner; this fixture never sends commands.
        deployment: {buildId: 'fictional-help-figure', apiCompatibility},
        activeProfile: profile, profiles: [profile], loginUrl: '/users/login', logoutUrl: '/users/login',
        shell: {version: '', imprintUrl: '', privacyPolicyUrl: '', localLoginEnabled: true, oidcEnabled: false, oidcName: ''},
    }});

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1344, height: 1080}, deviceScaleFactor: 1});
const exports = [];
try {
    // Keep the application markup and translated labels intact. Only resolve its
    // shipped image URL to inline bytes so this source capture stays server-free.
    await page.setContent(`<!doctype html><html lang="${locale}" data-bs-theme="dark"><head><style>${applicationCss}</style></head><body>${rendered.html.replaceAll('/img/logo.png', `data:image/png;base64,${logo.toString('base64')}`)}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const header = page.locator('header');
    const headerLabels = await header.innerText();
    for (const label of [ui.app.home, ui.app.new, ui.app.overview, ui.app.help, profile.name, catalog.nativeName]) {
        if (!headerLabels.includes(label)) throw new Error(`Localized source header omitted ${label}`);
    }
    const headerBytes = await header.screenshot({animations: 'disabled'});
    await fs.writeFile(path.join(evidence, 'source-rendered-header.png'), headerBytes);

    const styles = `
        * {box-sizing:border-box} body {margin:0;background:#161d23;color:#f1f4f8;font-family:"Segoe UI",system-ui,sans-serif}
        .figure {width:1440px;padding:36px 48px 48px} h1 {font-size:48px;line-height:1.15;margin:0 0 20px;font-weight:700}
        .intro {font-size:30px;line-height:1.4;color:#bdc7cf;margin:0} p {margin:0;line-height:1.4}
        .panel {border:2px solid #536574;border-radius:22px;background:#222a31;padding:28px 34px}
        .number {display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;font-size:34px;font-weight:700;color:#161d23;flex:none}
        .blue {color:#8db8ff}.teal {color:#65d6ce}.yellow {color:#ffdc7f}.number.blue {background:#8db8ff;color:#161d23}.number.teal {background:#65d6ce;color:#161d23}.number.yellow {background:#ffdc7f;color:#161d23}
        .muted {color:#bdc7cf} .heading {display:flex;align-items:center;gap:22px;font-size:40px;font-weight:700;line-height:1.2}
        .copy {font-size:30px;line-height:1.4} .note {font-size:26px;color:#bdc7cf;line-height:1.45}
        .navigation {padding-top:42px}.navigation .header {border:2px solid #536574;margin-top:66px}.navigation .header img {display:block;width:100%}
        .markers {position:relative;height:98px}.marker {position:absolute;top:26px;transform:translateX(-50%)}.marker:before {content:"";position:absolute;height:22px;border-left:3px solid currentColor;left:50%;top:-24px}
        .marker.blue:before {border-color:#8db8ff}.marker.teal:before {border-color:#65d6ce}.marker.yellow:before {border-color:#ffdc7f}
        .nav-panel {display:grid;grid-template-columns:320px 1fr;column-gap:30px;margin-bottom:24px;min-height:168px;padding:24px}
        .nav-label {display:flex;gap:20px;align-items:flex-start;font-size:38px;font-weight:700;line-height:1.4}.nav-panel h2 {font-size:36px;margin:0 0 8px;line-height:1.2}
        .survey .first {margin-top:66px}.survey .fields {display:grid;grid-template-columns:1fr 1fr;gap:76px;margin-top:30px}
        .survey .label {font-size:30px;color:#bdc7cf;margin-bottom:16px}.survey .field {border:2px solid #698293;border-radius:14px;padding:16px 20px;background:#293640;font-size:34px;font-weight:700}
        .survey .translation {font-size:24px;color:#bdc7cf;margin-top:10px}.survey .instruction {font-size:28px;margin-top:24px;color:#bdc7cf}
        .arrow {position:relative;width:4px;height:42px;background:#65d6ce;margin:16px auto 36px}.arrow:after {content:"";position:absolute;left:-12px;bottom:-18px;border:14px solid transparent;border-top:18px solid #65d6ce;border-bottom:0}
        .survey .months {display:grid;grid-template-columns:repeat(3,1fr);gap:38px;margin-top:38px}.month {border:2px solid #607787;border-radius:12px;padding:16px 12px;text-align:center;font-size:26px;font-weight:700}
        .survey .answer {font-size:36px;font-weight:700;line-height:1.3;margin-top:50px}.survey .foot {margin-top:30px}
        .packing .row-panel {margin-top:66px;padding:24px 26px}.packing .row-grid {display:grid;grid-template-columns:210px 260px 288px 245px 1fr;column-gap:8px;align-items:center}
        .packing .row-head {font-size:28px;font-weight:700;color:#bdc7cf;padding-bottom:28px;border-bottom:2px solid #536574;min-height:66px}
        .packing .row-body {font-size:30px;padding-top:32px}.packing .counts {font-weight:700;text-align:center}.packing .action {font-size:28px;font-weight:700}
        .tick {width:48px;height:48px;border:2px solid #ffdc7f;border-radius:7px;margin-left:34px;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;color:#ffdc7f;background:#394431}
        .packing .lines {display:grid;grid-template-columns:210px 1fr;gap:8px;margin-top:24px}.packing .lines div:first-child {border-bottom:4px solid #ffdc7f;width:108px;margin-left:18px}.packing .lines div:last-child {border-bottom:4px solid #65d6ce}
        .packing .panels {display:grid;grid-template-columns:1fr 1fr;gap:44px;margin-top:50px}.packing h2 {font-size:38px;margin:0 0 34px;line-height:1.3}.packing h3 {font-size:36px;margin:0 0 30px;line-height:1.3}.packing .panels .panel {min-height:462px}
        .packing .panels .foot {margin-top:48px}.packing > .foot {margin-top:44px}
    `;

    // Anchor annotations to actual source-header controls instead of guessed positions.
    const navLinks = header.locator('.navbar-nav').first();
    const newBox = await navLinks.locator('details').nth(0).boundingBox();
    const overviewBox = await navLinks.locator('details').nth(1).boundingBox();
    const helpBox = await navLinks.locator('a.nav-link').last().boundingBox();
    const centers = [newBox, overviewBox, helpBox].map(box => box.x + box.width / 2);
    const n = labels.navigation;
    const nav = `<section class="figure navigation">
        <h1>${text(n.title)}</h1><p class="intro">${text(n.intro)}</p>
        <div class="header"><img src="data:image/png;base64,${headerBytes.toString('base64')}" alt=""></div>
        <div class="markers">${centers.map((center, index) => `<span class="marker number ${['blue','teal','yellow'][index]}" style="left:${center}px">${index + 1}</span>`).join('')}</div>
        ${n.rows.map((row, index) => `<div class="panel nav-panel"><div class="nav-label ${['blue','teal','yellow'][index]}"><span class="number ${['blue','teal','yellow'][index]}">${index + 1}</span>${escape([ui.app.new, ui.app.overview, ui.app.help][index])}</div><div><h2>${text(row.title)}</h2><p class="copy muted">${lines(row.body)}</p></div></div>`).join('')}
    </section>`;
    const s = labels.survey;
    const survey = `<section class="figure survey">
        <h1>${text(s.title)}</h1><p class="intro">${text(s.intro)}</p>
        <div class="panel first"><div class="heading"><span class="number blue">1</span>${text(s.firstHeading)}</div>
        <div class="fields">${s.fields.map(field => `<div><p class="label">${text(field.label)}</p><div class="field">${text(field.value)}</div><p class="translation">${text(field.meaning)}</p></div>`).join('')}</div>
        <p class="instruction">${text(s.instruction)}</p></div>
        <div class="arrow"></div>
        <div class="panel"><div class="heading"><span class="number teal">2</span>${text(s.recurrenceHeading)}</div>
        <p class="copy muted" style="margin-top:28px">${text(s.recurrenceBody)}</p>
        <div class="months">${s.months.map(month => `<div class="month">${text(month)}</div>`).join('')}</div></div>
        <p class="answer">${text(s.answer)}</p>
        <p class="foot copy muted">${lines(s.foot)}</p>
    </section>`;
    const p = ui.packing;
    const packingLabels = labels.packing;
    const packing = `<section class="figure packing">
        <h1>${text(packingLabels.title)}</h1><p class="intro">${text(packingLabels.intro)}</p>
        <div class="panel row-panel"><div class="row-grid row-head"><div>${escape(p.packed)}</div><div>${escape(p.assignees)}</div><div>${escape(p.item)}</div><div style="text-align:center">${escape(p.capacity)}</div><div>${escape(p.action)}</div></div>
        <div class="row-grid row-body"><div><span class="tick">✓</span></div><div>${text(labels.fictionalProfile)}</div><div style="font-weight:700">${text(packingLabels.fictionalItem)}</div><div class="counts">1 / 2</div><div class="action teal">${escape(p.unassign)}</div></div>
        <div class="lines"><div></div><div></div></div></div>
        <div class="panels"><div class="panel"><h2 class="yellow">${text(packingLabels.personalHeading)}</h2><h3>${escape(p.packed)}</h3><p class="copy muted">${lines(packingLabels.personalBody)}</p><p class="foot note">${lines(packingLabels.personalFoot)}</p></div>
        <div class="panel"><h2 class="teal">${text(packingLabels.sharedHeading)}</h2><h3>${escape(p.assign)} / ${escape(p.unassign)}</h3><p class="copy muted">${lines(packingLabels.sharedBody)}</p><p class="foot note">${lines(packingLabels.sharedFoot)}</p></div></div>
        <p class="foot copy muted">${text(packingLabels.foot)}</p>
    </section>`;

    const figures = [['navigation', 'navigation-at-a-glance.png', nav], ['survey', 'survey-recurring-pattern.png', survey], ['packing', 'packing-shared-vs-local.png', packing]];
    for (const [figure, name, markup] of figures) {
        if (selectedFigure !== 'all' && selectedFigure !== figure) continue;
        await page.setViewportSize({width: 1440, height: 1600});
        await page.setContent(`<!doctype html><html lang="${locale}"><head><meta charset="UTF-8"><style>${styles}</style></head><body>${markup}</body></html>`);
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => [...document.querySelectorAll('.panel,.field,.month')].filter(el => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight).map(el => el.className));
        if (overflow.length) throw new Error(`Figure has overflowing content: ${name}: ${overflow.join(', ')}`);
        const bytes = await page.locator('.figure').screenshot({path: path.join(output, name), animations: 'disabled'});
        exports.push({name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: hash(bytes)});
        // Export exact browser-scaled image previews for separate human inspection.
        for (const width of [768, 298]) {
            await page.setContent(`<html><body style="margin:0;background:#161d23"><img style="display:block;width:${width}px;height:auto" src="data:image/png;base64,${bytes.toString('base64')}"></body></html>`);
            await page.locator('img').screenshot({path: path.join(evidence, name.replace('.png', `-${width}.png`))});
        }
    }
    const sources = {};
    for (const name of ['scripts/generate-help-visuals.mjs', labelsPath, 'src/frontend/components/AppHeader.vue', 'src/frontend/components/AppNavigationDropdown.vue', catalogPath, 'src/public/img/logo.png', 'dist/frontend-server/entry-server.mjs', 'dist/public/app/.vite/manifest.json']) {
        sources[name] = hash(await fs.readFile(path.join(root, name)));
    }
    await fs.writeFile(path.join(evidence, 'evidence.json'), JSON.stringify({generatedAt: new Date().toISOString(), locale, selectedFigure, header: {width: 1344, sha256: hash(headerBytes), provenance: 'Built Vue SSR AppHeader; fictional account; no relabelling'}, sources, builtAssets: {styles: hash(Buffer.from(builtCss)), fonts: assetHashes}, exports, inspectionWidths: [1440, 768, 298]}, null, 2));
    console.log(JSON.stringify(exports, null, 2));
} finally { await browser.close(); }
