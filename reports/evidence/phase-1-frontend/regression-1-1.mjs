// Phase 1.1 regression checks (UI paths). Results using the UI fixture are UI-path checks, NOT engine validation.
// Run with the dev server or `vite preview` on http://127.0.0.1:5174. Output goes to the OS temp dir.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const OUT = process.env.PP_QA_OUT ?? join(tmpdir(), 'processpilot-qa', 'regression-1-1');
const BASE = process.env.PP_BASE ?? 'http://127.0.0.1:5174/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch(OUT, 9335);
const out = [];
const check = (id, name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? ' — ' + detail : ''}`);
const nav = (label) => b.click(label, { partial: true, selector: 'nav button' });
const text = () => b.eval('document.body.innerText');
const upload = (name, content) => b.eval(`(() => { const input = document.querySelector('input[type=file][accept=".csv,text/csv"]');
  const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: 'text/csv' }));
  input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const captureDownloads = () => b.eval(`(() => { window.__dl = []; const o = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { blob.text().then(t => window.__dl.push(t)); return o(blob); };
  HTMLAnchorElement.prototype.click = function () {}; return true; })()`);
const lastDownload = async () => { await wait(300); return b.eval('window.__dl[window.__dl.length-1]'); };

try {
  // ---------- R-LEGACY: seed a pre-1.1 (v1) record before the app loads ----------
  await b.go(BASE + '#/overview');
  await b.eval(`localStorage.clear(); localStorage.setItem('processpilot.workspaces.v1', JSON.stringify({ version: 1, workspaces: { 'oldds::audience': {
    targets: [{ metricId: 'fixture.audience.queue_wait_mean', value: 1, unit: 'min', direction: 'max' }], designs: [], activeDesignId: null,
    scenarioParams: { serviceActivity: 'Ticket Verification', serviceMode: 'observed', assumedServiceSec: null, baselineGates: 1, candidateGates: 2 },
    paramsRevision: 1, scenarios: [], selectedScenarioId: null, activePlanId: 'p1',
    plans: [{ id: 'p1', revision: 1, title: 'Old fixture plan', source: { kind: 'proposal_only', designId: 'd' }, designId: 'd',
      scope: { datasetId: 'oldds', processKey: 'audience', analysisFilterFingerprint: 'x' }, tasks: [], state: 'current', createdAt: 0, updatedAt: 0 }] } } })); location.reload(); true`);
  await wait(1500);
  await nav('Evidence Export');
  let t = await text();
  check('R-LEGACY', 'Pre-1.1 records are listed read-only as legacy (not deleted, not current)', t.includes('legacy (pre-1.1)') && t.includes('1 plans'));
  const v1Kept = await b.eval(`!!localStorage.getItem('processpilot.workspaces.v1')`);
  check('R-LEGACY', 'Legacy v1 storage key is left untouched', v1Kept);

  // ---------- R-CSV: normal CSV parsing (quoted comma, leading zeros) ----------
  await nav('Overview & Data');
  await upload('normal.csv', 'case_id,activity,timestamp,resource\n001,"Check, left",2026-11-27T00:00:00Z,R1\n0002,A,2026-11-27T00:01:00Z,\n');
  await wait(500);
  t = await text();
  check('R-CSV', 'Normal CSV: no malformed-row notice', !t.includes('wrong number of columns'));
  check('R-CSV', 'Quoted comma kept in one field and leading zeros preserved in preview', t.includes('Check, left') && t.includes('001') && t.includes('0002'));
  const festivalDefault = await b.eval(`[...document.querySelectorAll('label')].find(l => l.textContent.includes('Enable Festival case-study adapters'))?.querySelector('input').checked`);
  check('R-GEN', 'Uploads start with Festival adapters OFF', festivalDefault === false);
  const festFieldsCollapsed = await b.eval(`(() => { const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('Festival case-study fields')); return !!d && !d.open; })()`);
  check('R-GEN', 'Festival-only columns are grouped separately and collapsed for general logs', festFieldsCollapsed);
  await b.click('Cancel');

  // ---------- R-CSV: malformed rows ----------
  await upload('ragged.csv', 'case_id,activity,timestamp\n1,A,2026-11-27T00:00:00Z\n2,B,2026-11-27T00:01:00Z,EXTRA\n3,C\n4,D,2026-11-27T00:03:00Z\n');
  await wait(500);
  t = await text();
  check('R-CSV', 'Malformed rows listed with file row and reason (rows 1 TooManyFields, 2 TooFewFields)', /1\s*TooManyFields/.test(t) && /2\s*TooFewFields/.test(t), '');
  let disabled = await b.eval(`[...document.querySelectorAll('button')].find(x=>x.textContent==='Validate & load').disabled`);
  check('R-CSV', 'Validate & load blocked until explicit consent', disabled === true);
  await b.click('Exclude these 2 rows', { partial: true, selector: 'label' });
  disabled = await b.eval(`[...document.querySelectorAll('button')].find(x=>x.textContent==='Validate & load').disabled`);
  check('R-CSV', 'Consent enables loading', disabled === false);
  await b.click('Validate & load');
  await wait(500);
  t = await text();
  check('R-CSV', 'Dataset card reports file rows, excluded malformed rows and rows sent to validation', t.includes('4 data rows · 2 malformed excluded with consent · 2 sent to validation'));
  const rawNums = await b.eval(`(() => { const c=[...document.querySelectorAll('section')].find(s=>s.innerText.startsWith('Raw rows')); return [...c.querySelectorAll('tbody tr')].map(r=>r.cells[0].innerText.trim()).join(','); })()`);
  check('R-CSV', 'Rows sent to the engine keep original file row numbers (0,3)', rawNums === '0,3', rawNums);
  check('R-CSV', 'Excluded rows remain listed in an import report card', t.includes('Excluded malformed rows'));
  check('R-PROV', 'Uploaded log: source "User-uploaded log", provider "engine"', t.includes('User-uploaded log') && t.includes('Provider: engine'));
  check('R-PROV', 'Engine stub shows not-implemented state (NOT TESTABLE for real values)', t.includes('Engine function not implemented yet'));
  await b.shot('r-csv-malformed', true);

  // ---------- R-PROV: fixture provenance ----------
  await b.click('Load UI fixture');
  await b.set('.sticky select', 'audience');
  t = await text();
  check('R-PROV', 'Fixture: source "UI fixture CSV" and provider "UI fixture (hand-authored)" shown separately', t.includes('UI fixture CSV') && t.includes('Provider: UI fixture (hand-authored)'));
  await nav('Model');
  const baseIdx = await b.eval(`[...document.querySelectorAll('main input')].map(i => i.closest('label')?.innerText.split('\\n')[0]).indexOf('Baseline gates')`);
  await b.set('main input', '1', baseIdx);
  await b.set('main input', '2', baseIdx + 1);
  await b.set('input[aria-label="Target for audience_queue_wait_mean"]', '1');
  await nav('Analysis');
  await b.click('Findings', { partial: true, selector: '[role=tab]' });
  await b.click('Create design record →');
  await nav('Refine & Improve');
  await b.click('Run baseline + candidate');
  await b.click('Apply to Implementation plan →');
  t = await text();
  check('R-PROV', 'Plan created from fixture scenario is labelled UI fixture', t.includes('UI fixture (hand-authored)') && t.includes('Plan generated from hand-authored UI fixture results'));
  await nav('Evidence Export');
  await captureDownloads();
  await b.click('Action plans (all revisions)');
  const plansCsv = await lastDownload();
  check('R-PROV', 'Plans CSV carries provider=ui_fixture', /(^|,)provider(,|$)/.test(plansCsv.split('\n')[0]) && plansCsv.includes('ui_fixture'));
  await b.click('Download evidence JSON');
  const ev = JSON.parse(await lastDownload());
  check('R-PROV', 'Evidence JSON records provider, workspace scope and plan provider', ev.provider === 'ui_fixture' && ev.workspace?.provider === 'ui_fixture' && ev.plans.every((p) => p.provider === 'ui_fixture'));
  check('R-PROV', 'Evidence JSON uses engine metric IDs/units (audience_queue_wait_mean, min)', ev.kpis.status === 'ok' && ev.kpis.data.some((m) => m.id === 'audience_queue_wait_mean' && m.unit === 'min'));

  // ---------- R-SCOPE: analysis filter → separate records, archived/history view ----------
  // 00:00 local (KST) is before every fixture case, so the case set is unchanged but the filter fingerprint differs.
  await b.set('input[aria-label="From"]', '2026-11-27T00:00');
  await nav('Model');
  t = await text();
  check('R-SCOPE', 'New filter scope starts without targets and offers an explicit copy', t.includes('Targets exist for another case filter'));
  await nav('Implementation');
  t = await text();
  check('R-SCOPE', 'Plan from the unfiltered scope is not shown as current under the new filter', t.includes('No action plans yet') && t.includes('View in Workspace history'));
  await nav('Evidence Export');
  t = await text();
  check('R-SCOPE', 'Workspace history lists the unfiltered scope as "other case filter"', t.includes('other case filter'));
  await nav('Model');
  await b.click('Copy 1 target', { partial: true });
  await nav('Monitor & Control');
  t = await text();
  check('R-SCOPE', 'Explicitly copied target evaluates in the new scope', t.includes('Target ≤ 1 min'));
  await b.set('input[aria-label="From"]', '');
  await nav('Implementation');
  t = await text() + (await b.eval(`[...document.querySelectorAll('main input')].map(i=>i.value).join('|')`));
  check('R-SCOPE', 'Clearing the filter restores the original scope records', t.includes('Open 1 staffed entry gate'));

  // ---------- R-BPMN: design without To-be reference → genuine change-note-only state ----------
  await nav('Design');
  await b.click('To-be BPMN', { selector: '[role=tab]' });
  t = await text();
  check('R-BPMN', 'Design without To-be reference shows "change note only" (not a missing-file state)', t.includes('No To-be BPMN: change note only') && !t.includes('reference saved, diagram not loaded'));

  // ---------- R-DISPLAY: resource display filter does not change analysis ----------
  await b.set('.sticky select', 'default');
  await nav('Analysis');
  await b.click('Resources & handoffs', { selector: '[role=tab]' });
  await wait(500);
  await b.click('R1', { selector: '[aria-label="Resource display filter"] button' });
  await wait(500);
  t = await text();
  const rowsShown = await b.eval(`(() => { const c=[...document.querySelectorAll('section')].find(s=>s.innerText.startsWith('Workload table')); return c.querySelectorAll('tbody tr').length; })()`);
  check('R-DISPLAY', 'Display filter narrows the workload table (1 of 2 resources)', rowsShown === 1 && t.includes('Showing 1 of 2 resources'));
  check('R-DISPLAY', 'Coverage and scope totals unchanged under display filter', t.includes('87.5%') && t.includes('Known resources (scope)\n2'));
  await nav('Evidence Export');
  await captureDownloads();
  await b.click('Download evidence JSON');
  const ev2 = JSON.parse(await lastDownload());
  check('R-DISPLAY', 'Export still contains all resources (display filter not exported as analysis)', ev2.resources.data.resources.length === 2);

  // ---------- R-GEN: same data with Festival adapters disabled ----------
  await nav('Overview & Data');
  await b.click('Disable Festival adapters');
  await b.set('.sticky select', 'audience');
  t = await text();
  check('R-GEN', 'Festival process names not applied when adapters are off', !t.includes('Audience Entry') && t.includes('Festival adapters') && t.includes('off (general process log)'));
  await nav('Monitor & Control');
  t = await text();
  check('R-GEN', 'No Festival KPIs (audience_*) without Festival adapters', !t.includes('audience_queue_wait_mean') && t.includes('case_elapsed_mean'));
  await nav('Refine & Improve');
  t = await text();
  check('R-GEN', 'Gate simulation not offered for a general log', t.includes('No quantified simulation for this process') && !t.includes('Run baseline + candidate'));
  await b.shot('r-gen-refine');
} catch (e) {
  out.push(`ERROR ${e.message}`);
  await b.shot('regression-error');
} finally {
  console.log(out.join('\n'));
  console.log('--- console/log ---\n' + b.logs.join('\n'));
  await b.close();
}
