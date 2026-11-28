// Phase 2 — engine + frontend integration checks in a real browser (headless Chrome via CDP).
// Every expected value is a hand calculation from the CSV rows (see reports/evidence/phase-2-integration.md
// and tests/fixtures/integration/README.md); none is copied from engine output.
// Run against `npm run dev` or `vite preview` on http://127.0.0.1:5174 (PP_BASE overrides).
// Screenshots and the throwaway Chrome profile go to the OS temp dir (PP_QA_OUT), never into the repository.
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from '../phase-1-frontend/cdp.mjs';

const OUT = process.env.PP_QA_OUT ?? join(tmpdir(), 'processpilot-qa', 'integration-2');
const BASE = process.env.PP_BASE ?? 'http://127.0.0.1:5174/';
const ROOT = new URL('../../../', import.meta.url);
const fx = (p) => readFileSync(new URL(`tests/fixtures/${p}`, ROOT), 'utf8');
const bpmnWithDi = readFileSync(new URL('../phase-1-frontend/qa/qa-data/with-di.bpmn', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch(OUT, 9336);
const out = [];
const check = (id, name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail !== '' ? ' — ' + detail : ''}`);
const nav = async (label) => { await b.click(label, { partial: true, selector: 'nav button' }); await wait(350); };
const tab = async (label) => { await b.click(label, { partial: true, selector: '[role=tab]' }); await wait(700); };
const body = () => b.eval('document.body.innerText');
const main = () => b.text();
const key = (p, c) => JSON.stringify([p, c]);
const sortJ = (a) => JSON.stringify([...a].sort());

const ONLY = process.env.PP_ONLY ? process.env.PP_ONLY.split(',') : null;
async function section(name, fn) {
  if (ONLY && !ONLY.some((p) => name.startsWith(p))) return;
  try { await fn(); } catch (e) { out.push(`ERROR [${name}] ${e.message}`); try { await b.shot(`err-${name}`); } catch {} }
}
const uploadFile = (name, text) => b.eval(`(() => { const input = document.querySelector('input[type=file][accept=".csv,text/csv"]');
  const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'text/csv' }));
  input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const uploadBpmn = (name, xml) => b.eval(`(() => { const input = document.querySelector('main input[type=file][accept=".bpmn,.xml"]');
  const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(xml)}], ${JSON.stringify(name)}, { type: 'application/xml' }));
  input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const setText = (selector, value) => b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const clickLabel = (text) => b.click(text, { partial: true, selector: 'label' });
/** Upload → (mapping) → options → Validate & load. map: [[selectIndex, header]] in mapping order case_id, activity, timestamp, event_id, process_type, lifecycle, activity_instance_id, resource. */
async function loadCsv(name, text, { map = [], festival = false, require = false } = {}) {
  await nav('Overview & Data');
  await uploadFile(name, text);
  await wait(500);
  for (const [i, v] of map) await b.set('main select', v, i);
  if (require) await clickLabel('Require process_type on every row');
  if (festival) await clickLabel('Enable Festival case-study adapters');
  await b.click('Validate & load');
  await wait(800);
}
const captureDownloads = () => b.eval(`(() => { if (window.__dlHooked) { window.__dl = []; return true; } window.__dlHooked = true; window.__dl = []; const o = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { blob.text().then(t => window.__dl.push(t)); return o(blob); };
  HTMLAnchorElement.prototype.click = function () {}; return true; })()`);
async function download(label) { await captureDownloads(); await b.click(label, { partial: true }); await wait(400); return b.eval('window.__dl[window.__dl.length-1]'); }
/** Minimal RFC-4180 CSV reader for the exported files (quoted fields may contain commas, quotes and newlines). */
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [h = [], ...data] = rows;
  return data.filter((r) => r.length > 1 || r[0] !== '').map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const nodeTexts = () => b.eval(`[...document.querySelectorAll('.react-flow__node')].map(n => n.innerText.replace(/\\n+/g, '|'))`);
const edgeLabels = () => b.eval(`[...document.querySelectorAll('.react-flow__edgelabel-renderer button')].map(x => x.textContent.trim())`);
const viewport = () => b.eval(`document.querySelector('.react-flow__viewport').style.transform`);
const clickEdge = (id) => b.eval(`(() => { const e = [...document.querySelectorAll('.react-flow__edge')].find(x => x.getAttribute('data-testid') === ${JSON.stringify('rf__edge-')} + ${JSON.stringify(id)}); if (!e) return false; e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
const clickNode = (id) => b.eval(`(() => { const e = [...document.querySelectorAll('.react-flow__node')].find(x => x.getAttribute('data-id') === ${JSON.stringify(id)}); if (!e) return false; e.click(); return true; })()`);
const caseButtons = (scopeSel = 'main') => b.eval(`[...document.querySelectorAll(${JSON.stringify(scopeSel)} + ' button[title^="["]')].map(x => x.getAttribute('title'))`);
const tableRows = (sectionTitle) => b.eval(`(() => { const c = [...document.querySelectorAll('section')].find(s => s.innerText.startsWith(${JSON.stringify(sectionTitle)})); if (!c) return null; return [...c.querySelectorAll('tbody tr')].map(r => [...r.cells].map(td => td.innerText.trim())); })()`);
const inputIndexByLabel = (label) => b.eval(`[...document.querySelectorAll('main input')].map(i => i.closest('label')?.innerText.split('\\n')[0]).indexOf(${JSON.stringify(label)})`);
async function setGates(base, cand) {
  await nav('Model');
  const bi = await inputIndexByLabel('Baseline gates');
  if (base !== null) await b.set('main input', String(base), bi);
  if (cand !== null) await b.set('main input', String(cand), bi + 1);
}
const setTarget = (metricId, value) => b.set(`input[aria-label="Target for ${metricId}"]`, String(value));
const evidenceJson = async () => { await nav('Evidence Export'); return JSON.parse(await download('Download evidence JSON')); };

const ORDER = fx('order-processing-event-log.csv');
const ORDER_MAP = [[0, 'order'], [1, 'step'], [2, 'occurred_at'], [5, 'state'], [6, 'instance'], [7, 'owner']];
const K = (c) => key('default', c);

try {
  await b.go(BASE + '#/overview');
  await b.eval('localStorage.clear(); true');
  await b.go(BASE + '#/overview');

  // ===================== A. General event log: Order Processing (no Festival) =====================
  await section('A-import', async () => {
    await uploadFile('order-processing-event-log.csv', ORDER);
    await wait(500);
    let t = await main();
    const blocked = await b.eval(`[...document.querySelectorAll('button')].find(x => x.textContent === 'Validate & load').disabled`);
    check('A01', 'Non-canonical headers: mapping editor blocks loading until required fields are mapped', t.includes('Column mapping') && t.includes('Map the required fields: case_id, activity, timestamp') && blocked === true);
    const fest = await b.eval(`[...document.querySelectorAll('label')].find(l => l.textContent.includes('Enable Festival case-study adapters'))?.querySelector('input').checked`);
    check('A02', 'Upload starts with Festival adapters OFF', fest === false);
    for (const [i, v] of ORDER_MAP) await b.set('main select', v, i);
    await b.click('Validate & load');
    await wait(800);
    t = await body();
    check('A03', 'Validation: 11 raw rows, 11 accepted, 0 excluded, 0 errors, 0 warnings, ready',
      /Raw rows\n11\n/.test(t) && /Accepted events\n11\n/.test(t) && /Excluded rows\n0\n/.test(t) && /Errors\n0\n/.test(t) && /Warnings\n0\n/.test(t) && t.includes('Ready for analysis'));
    check('A04', 'Scope bar: 3 of 3 cases, provider engine, source user-uploaded, no Festival badge', t.includes('3 of 3 cases') && t.includes('Provider: engine') && t.includes('User-uploaded log') && !t.includes('Festival adapters on'));
    const traces = await tableRows('Trace view');
    check('A05', 'Trace view: 001 (5 rows, 4 discovery, 10 min), 002 (4, 4, 15 min), 003 (2, 2, 2 min)',
      JSON.stringify(traces?.map((r) => [r[0], r[2], r[3], r[4]])) === JSON.stringify([['001', '5', '4', '10 min'], ['002', '4', '4', '15 min'], ['003', '2', '2', '2 min']]), JSON.stringify(traces?.map((r) => r.slice(0, 5))));
    check('A06', 'Raw preview keeps original strings (quoted comma, UTC Z timestamps)', t.includes('Packed, boxed') && t.includes('2028-07-01T09:07:00Z'));
    await b.eval(`[...document.querySelectorAll('main tr')].find(r => r.cells[0]?.innerText.trim() === '001')?.click()`);
    await wait(500);
    const drawer = await b.eval(`document.querySelector('aside[aria-label="Case trace"]')?.innerText ?? ''`);
    check('A07', 'Case drawer for 001 lists all 5 accepted rows incl. Payment Authorized start/complete', drawer.includes('Payment Authorized') && (drawer.match(/Payment Authorized/g) ?? []).length >= 2 && drawer.includes('start') && drawer.includes('complete'));
    await b.eval(`document.querySelector('aside[aria-label="Case trace"]')?.parentElement.click()`);
    await wait(300);
  });

  await section('A-dfg', async () => {
    await nav('Analysis');
    await tab('Process map (DFG)');
    await wait(500);
    const nodes = await nodeTexts();
    const edges = await b.eval(`document.querySelectorAll('.react-flow__edge').length`);
    check('A10', 'DFG renders 5 activities + Start + End and 4 transitions + 1 start edge + 2 end edges', nodes.length === 7 && edges === 7, `nodes=${nodes.length} edges=${edges}`);
    const counts = Object.fromEntries(nodes.filter((n) => !/^(START|END)/.test(n)).map((n) => { const [a, c] = n.split('|'); return [a, c]; }));
    check('A11', 'Activity frequency: Order Received 3, Payment Authorized 2, Packed, boxed 2, Order Shipped 2, Order Cancelled 1',
      JSON.stringify(counts) === JSON.stringify({ 'Order Received': '3', 'Payment Authorized': '2', 'Packed, boxed': '2', 'Order Shipped': '2', 'Order Cancelled': '1' }), JSON.stringify(counts));
    check('A12', 'Edge count labels = {3 start, 2,2,2,1 transitions, 2,1 end}', sortJ(await edgeLabels()) === sortJ(['3', '2', '2', '2', '1', '2', '1']), JSON.stringify(await edgeLabels()));
    const t = await main();
    check('A13', 'Inspector: 5 activities, 4 transitions, 0 self-loops, 1 start activity, 2 end activities', /Activities\n5\nTransitions\n4\nSelf-loops\n0\nStart activities\n1\nEnd activities\n2/.test(t));
    await clickNode('a:Order Received');
    await wait(400);
    check('A14', 'Node click Order Received → 3 contributing cases (001, 002, 003), starts here 3', sortJ(await caseButtons()) === sortJ([K('001'), K('002'), K('003')]) && /Starts here\n3/.test(await main()));
    const ok = await clickEdge(`e:${JSON.stringify(['Order Received', 'Order Cancelled'])}`);
    await wait(400);
    const t2 = await main();
    check('A15', 'Edge click Order Received → Order Cancelled: 1 occurrence, case 003, inter-event gap 2 min (n=1)', ok && JSON.stringify(await caseButtons()) === JSON.stringify([K('003')]) && /Occurrences\n1/.test(t2) && t2.includes('2 min · n=1'));
    // Zoom / pan / drawer viewport
    await b.eval(`document.querySelector('.react-flow__pane').click()`);
    const v0 = await viewport();
    await b.eval(`document.querySelector('.react-flow__controls-zoomin').click()`);
    await wait(400);
    const v1 = await viewport();
    const pane = await b.eval(`(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return [r.x + r.width - 60, r.y + 40]; })()`);
    await b.drag(pane[0], pane[1], pane[0] - 120, pane[1] + 40);
    const v2 = await viewport();
    check('A16', 'Zoom-in changes scale; dragging the pane pans the graph', v0 !== v1 && v1 !== v2 && /scale/.test(v2), `${v0} → ${v1} → ${v2}`);
    await clickNode('a:Packed, boxed');
    await wait(300);
    const v3 = await viewport();
    await b.click('001', { selector: 'main button' });
    await wait(600);
    const opened = await b.eval(`!!document.querySelector('aside[aria-label="Case trace"]')`);
    await b.eval(`document.querySelector('aside[aria-label="Case trace"]').parentElement.click()`);
    await wait(600);
    check('A17', 'DFG: opening and closing a case drawer keeps the viewport', opened && v3 === (await viewport()), `${v3} vs ${await viewport()}`);
  });

  await section('A-variants-perf', async () => {
    await tab('Variants');
    const rows = await tableRows('Exact variants');
    check('A20', 'Variants: [2, 66.7%, 12.5 min, 4] and [1, 33.3%, 2 min, 2]', JSON.stringify(rows?.map((r) => r.slice(0, 4))) === JSON.stringify([['2', '66.7%', '12.5 min', '4'], ['1', '33.3%', '2 min', '2']]), JSON.stringify(rows?.map((r) => r.slice(0, 4))));
    await b.eval(`[...document.querySelectorAll('main tbody tr')][1].click()`);
    await wait(300);
    check('A21', 'Variant drill-down: Order Received › Order Cancelled → case 003', JSON.stringify(await caseButtons()) === JSON.stringify([K('003')]));
    await tab('Performance');
    let t = await main();
    check('A22', 'Performance header: 1 matched pair, 0 ambiguous, 0 overlaps, 5 summaries', /Matched lifecycle pairs\n1\n/.test(t) && /Ambiguous pairs \(skipped\)\n0\n/.test(t) && /Overlaps\n0\n/.test(t) && /Summaries\n5/.test(t));
    const ie = await tableRows('Bottleneck table');
    check('A23', 'Inter-event bottleneck table: Packed→Shipped 5.5, Payment→Packed 4, Received→Payment 3, Received→Cancelled 2 min; all low support',
      JSON.stringify(ie?.map((r) => [r[0], r[2], r[3]])) === JSON.stringify([['Packed, boxed → Order Shipped', '5.5 min', '2 low support'], ['Payment Authorized → Packed, boxed', '4 min', '2 low support'], ['Order Received → Payment Authorized', '3 min', '2 low support'], ['Order Received → Order Cancelled', '2 min', '1 low support']]), JSON.stringify(ie));
    await b.click('Matched transition gap', { selector: 'main button' });
    t = await main();
    check('A24', 'Matched transition gap: explicit N/A empty state (point event precedes the only paired start)', t.includes('No matched transition gap measurements') && t.includes('N/A, not zero'));
    await b.click('Service time', { selector: 'main button' });
    const sv = await tableRows('Bottleneck table');
    check('A25', 'Lifecycle service time: Payment Authorized 2 min (n=1)', JSON.stringify(sv?.map((r) => [r[0], r[2], r[3]])) === JSON.stringify([['Payment Authorized', '2 min', '1 low support']]), JSON.stringify(sv));
  });

  await section('A-resources', async () => {
    await tab('Resources & handoffs');
    await wait(500);
    const t = await main();
    check('A30', 'Resource stats: 5 known, raw coverage 100% (11 of 11), instance 100% (10 of 10), 4 pairs / 7 handoffs',
      /Known resources \(scope\)\n5/.test(t) && t.includes('11 of 11 rows') && t.includes('10 of 10 discovery instances') && /Directed handoff pairs \(scope\)\n4\n7 handoffs total/.test(t));
    const hrows = await tableRows('Handoff table');
    const labels = await edgeLabels();
    check('A31', 'Handoff graph edge counts equal the handoff table (2,2,2,1)', sortJ(labels) === sortJ(hrows.map((r) => r[2])) && sortJ(labels) === sortJ(['2', '2', '2', '1']), `graph=${labels} table=${hrows.map((r) => r[2])}`);
    check('A32', 'Handoff table: Customer→Billing 2, Billing→Warehouse 2, Warehouse→Carrier 2, Customer→Support 1',
      sortJ(hrows.map((r) => `${r[0]}>${r[1]}=${r[2]}`)) === sortJ(['Customer>Billing=2', 'Billing>Warehouse=2', 'Warehouse>Carrier=2', 'Customer>Support=1']));
    const w = await tableRows('Workload table');
    const wl = Object.fromEntries(w.map((r) => [r[0], [r[2], r[3], r[4], r[5]]]));
    check('A33', 'Workload: Customer 3/3/3 N/A, Billing 3/2/2 2 min, Warehouse 2/2/2, Carrier 2/2/2, Support 1/1/1',
      JSON.stringify(wl) === JSON.stringify({ Customer: ['3', '3', '3', 'N/A'], Billing: ['3', '2', '2', '2 min'], Warehouse: ['2', '2', '2', 'N/A'], Carrier: ['2', '2', '2', 'N/A'], Support: ['1', '1', '1', 'N/A'] }), JSON.stringify(wl));
    check('A34', 'Network nodes = 5 known resources; no bidirectional pair in this log', (await nodeTexts()).length === 5 && !(await b.eval(`[...document.querySelectorAll('.react-flow__edge path')].some(p => (p.getAttribute('style') || '').includes('dasharray') || p.getAttribute('stroke-dasharray'))`)));
    const ok = await clickEdge(`h:${JSON.stringify(['Customer', 'Support'])}`);
    await wait(400);
    const t2 = await main();
    check('A35', 'Handoff edge Customer → Support: 1 handoff, reverse 0, case 003', ok && /Handoffs\n1\nReverse direction\n0/.test(t2) && JSON.stringify(await caseButtons()) === JSON.stringify([K('003')]));
    await clickNode('r:Billing');
    await wait(400);
    const t3 = await main();
    check('A36', 'Resource node Billing: 3 raw, 2 instances, 2 cases, active 2 min, outgoing 2, incoming 2',
      /Raw events\n3\nCompleted instances\n2\nDistinct cases\n2\nActive time\n2 min/.test(t3) && /Outgoing handoffs\n2\nIncoming handoffs\n2/.test(t3));
    const v0 = await viewport();
    await b.click('001', { selector: 'main button' });
    await wait(600);
    await b.eval(`document.querySelector('aside[aria-label="Case trace"]').parentElement.click()`);
    await wait(600);
    check('A37', 'Handoff network: case drawer open/close keeps the viewport', v0 === (await viewport()));
    await b.click('Support', { selector: '[aria-label="Resource display filter"] button' });
    await wait(500);
    const t4 = await main();
    const w2 = await tableRows('Workload table');
    const h2 = await tableRows('Handoff table');
    check('A38', 'Display filter "Support": network = Support + partner Customer, handoff table 1 row, workload table Support (1 of 5); scope totals unchanged',
      (await nodeTexts()).length === 2 && t4.includes('Showing 1 of 5 resources') && JSON.stringify(w2.map((r) => r[0])) === '["Support"]' && h2.length === 1 && /Known resources \(scope\)\n5/.test(t4) && t4.includes('11 of 11 rows') && (await edgeLabels()).length === 1);
  });

  await section('A-findings-targets', async () => {
    await tab('Findings');
    let t = await main();
    check('A40', 'Findings: largest inter-event gap Packed, boxed → Order Shipped 5.5 min, n = 2, low support, cases 001, 002',
      t.includes('Packed, boxed → Order Shipped has the largest mean inter-event gap') && t.includes('5.5 min') && t.includes('low support (n < 3)') && t.includes('2 cases: 001, 002'));
    check('A41', 'Findings: Customer has the most discovered instances (3; coverage 10 of 10); no rework finding (no self-loop)',
      t.includes('Customer has the most discovered instances among known resources. Resource coverage is 10 of 10.') && t.includes('3 instances') && !t.includes('rework_case_rate'));
    check('A42', 'General log: no Festival KPI / rule / process name / gate simulation leaks in', !t.includes('audience_') && !t.includes('Audience Entry') && !t.includes('Festival adapters on'));
    await nav('Monitor & Control');
    t = await main();
    check('A43', 'Monitor (general log): case_elapsed_mean 9 min; utilization N/A with reason; no Festival KPIs',
      /case_elapsed_mean\nno target\n9 min/.test(t) && /resource_utilization\nno target\nN\/A/.test(t) && t.includes('No known resources have both measured activity intervals and valid shifts.') && !t.includes('audience_'));
    check('A44', 'Monitor: no throughput series for a general log (empty state, not zero)', t.includes('No throughput series for this process'));
    await nav('Model');
    await setTarget('case_elapsed_mean', '9');
    await nav('Monitor & Control');
    t = await main();
    check('A45', 'Exact-equality target (max 9 min, measured 9 min) → met (QA-01 in UI)', t.includes('All 1 target met') && /case_elapsed_mean\nmet\n9 min/.test(t));
    await nav('Model');
    await setTarget('case_elapsed_mean', '8');
    await nav('Monitor & Control');
    t = await main();
    check('A46', 'Target max 8 → breached; measured value unchanged (9 min)', /case_elapsed_mean\nbreached\n9 min/.test(t) && t.includes('Measured 9 min vs target ≤ 8 min'));
    check('A47', 'Breach alert links the engine target finding evidence (3 cases)', t.includes('Inspect 3 evidence cases'));
    await b.click('Inspect 3 evidence cases', { partial: true });
    check('A48', 'Breach drill-down lists 001, 002, 003', sortJ(await caseButtons()) === sortJ([K('001'), K('002'), K('003')]));
    await nav('Analysis');
    await tab('Findings');
    t = await main();
    check('A49', 'Target breach appears as a third finding (case_elapsed_mean 9 vs maximum 8)', t.includes('case_elapsed_mean measured 9 min against a maximum target of 8 min.') && (await b.eval(`[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.startsWith('Findings'))?.textContent`)) === 'Findings3');
  });

  await section('A-design-plan', async () => {
    await b.click('Create design record →');
    await wait(500);
    let t = await main();
    const kindDisabled = await b.eval(`[...document.querySelectorAll('main option')].find(o => o.value === 'simulation')?.disabled`);
    check('A50', 'Design record from the inter-event finding: proposal-only (simulation disabled), affected Packed, boxed + Order Shipped',
      t.includes('Design record') && kindDisabled === true && (await b.eval(`[...document.querySelectorAll('main button.border-brand-500.text-xs')].map(x=>x.textContent).join('|')`)) === 'Packed, boxed|Order Shipped');
    check('A51', 'Generic log has no BPMN: explicit import/empty state, no unrelated sample BPMN', (await b.eval(`document.querySelectorAll('.djs-container .djs-element.djs-shape').length`)) === 0 && /Import BPMN/i.test(t));
    await b.set('main select', 'ready', 0);
    await b.set('main select', 'case_elapsed_mean', 1);
    await setText('main textarea', 'Test change note: check packing-to-shipping handover (integration test).');
    await b.click('Save changes');
    t = await main();
    check('A52', 'Design saved with target KPI and linked finding', t.includes('All changes saved to this workspace') && (await b.eval(`document.querySelectorAll('main select')[1].value`)) === 'case_elapsed_mean');
    await nav('Refine & Improve');
    t = await main();
    check('A53', 'Refine (general log): no quantified simulation offered; recommendations list engine findings', t.includes('No quantified simulation for this process') && !t.includes('Run baseline + candidate') && t.includes('Evidence: Packed, boxed → Order Shipped has the largest mean inter-event gap'));
    await b.click('Proposal-only plan from', { partial: true });
    await wait(500);
    t = await main() + (await b.eval(`[...document.querySelectorAll('main input')].map(i=>i.value).join('|')`));
    check('A54', 'Proposal-only plan created: 3 tasks, provider engine, no quantified effect claimed',
      t.includes('Proposal-only plan:') && t.includes('Proposal-only plan: no quantified effect is claimed') && /Results provider\nengine/.test(t) && t.includes('0 of 3 tasks done'));
    await b.set('main input[placeholder="Unassigned"]', 'Ops lead');
    await b.set('main input[type=date]', '2026-12-05');
    await b.set('main tbody select', 'done');
    t = await main();
    check('A55', 'Owner / due date / status edits persist in the plan (1 of 3 done)', t.includes('1 of 3 tasks done'));
    const planCsv = parseCsv(await download('Export CSV'));
    check('A56', 'Plan CSV: owner, due date, status and provider engine', planCsv[0]?.owner === 'Ops lead' && planCsv[0]?.due_date === '2026-12-05' && planCsv[0]?.status === 'done' && planCsv.every((r) => r.provider === 'engine'), JSON.stringify(planCsv[0]));
    const planJson = JSON.parse(await download('Export JSON'));
    check('A57', 'Plan JSON: provider engine, scope matches dataset/process, design linked', planJson.provider === 'engine' && planJson.scope.processKey === 'default' && planJson.design?.targetMetricId === 'case_elapsed_mean');
    await nav('Monitor & Control');
    t = await main();
    check('A58', 'Monitor shows plan progress separately; measured KPI unchanged by plan edits', t.includes('1/3 done') && t.includes('proposal only') && /case_elapsed_mean\nbreached\n9 min/.test(t));
  });

  await section('A-export', async () => {
    const ev = await evidenceJson();
    const scopeBarId = (await body()).match(/Dataset ([0-9a-f]+)/)?.[1];
    check('A60', 'Evidence JSON identity: provider engine, dataset id = scope bar id, process default, 3 selected cases, no Festival',
      ev.provider === 'engine' && ev.providerDescription === 'src/engine' && ev.dataset.id === scopeBarId && ev.scope.processKey === 'default' && ev.filter.selectedCases === 3 && ev.dataset.festivalAdapters === false);
    check('A61', 'Evidence JSON: DFG / variants / KPI / findings equal the hand counts shown on screen',
      ev.dfg.data.nodes.find((n) => n.activity === 'Order Received').count === 3 && ev.dfg.data.edges.length === 4 && ev.variants.data.map((v) => v.count).join() === '2,1' &&
      ev.kpis.data.find((m) => m.id === 'case_elapsed_mean').value === 9 && ev.kpis.data.find((m) => m.id === 'case_elapsed_mean').unit === 'min' && ev.findings.data.length === 3 &&
      ev.targetEvaluations.data[0].status === 'breached');
    check('A62', 'Evidence JSON: design and plan records with provider/scope; raw rows excluded', ev.designs.length === 1 && ev.plans.length === 1 && ev.plans[0].provider === 'engine' && !JSON.stringify(ev).includes('"occurred_at":"2028'));
    const dfg = parseCsv(await download('DFG edges'));
    check('A63', 'DFG edges CSV = graph (4 rows, counts 2,2,2,1; scope columns)', dfg.length === 4 && sortJ(dfg.map((r) => `${r.from}>${r.to}=${r.count}`)) === sortJ(['Order Received>Payment Authorized=2', 'Payment Authorized>Packed, boxed=2', 'Packed, boxed>Order Shipped=2', 'Order Received>Order Cancelled=1']) && dfg.every((r) => r.dataset_id === scopeBarId && r.provider === 'engine' && r.process === 'default' && r.selected_cases === '3'));
    const vars = parseCsv(await download('Variants'));
    check('A64', 'Variants CSV: shares 2/3 and 1/3 (fraction scale stated), case keys', vars.length === 2 && Math.abs(+vars[0].share - 2 / 3) < 1e-12 && vars[0].share_scale === 'fraction 0-1' && JSON.parse(vars[1].case_keys)[0] === K('003'));
    const perf = parseCsv(await download('Performance gaps'));
    check('A65', 'Performance CSV: 5 summaries incl. service Payment Authorized 2 and inter-event 5.5 (n=2)', perf.length === 5 && perf.some((r) => r.metric_type === 'service' && r.from === 'Payment Authorized' && r.mean_min === '2') && perf.some((r) => r.to === 'Order Shipped' && r.mean_min === '5.5' && r.n === '2'));
    const res = parseCsv(await download('Resource workload'));
    check('A66', 'Resources CSV: all 5 resources (display filter not exported), Billing active 2 min', res.length === 5 && res.find((r) => r.resource === 'Billing').active_min === '2');
    const hand = parseCsv(await download('Resource handoffs'));
    check('A67', 'Handoffs CSV = handoff table (4 rows, total 7)', hand.length === 4 && hand.reduce((s, r) => s + +r.count, 0) === 7);
    const kpis = parseCsv(await download('KPIs + targets'));
    const ce = kpis.find((r) => r.metric_id === 'case_elapsed_mean');
    check('A68', 'KPI CSV: case_elapsed_mean 9 min, target 8 max, breached; utilization N/A', ce.value === '9' && ce.unit === 'min' && ce.target === '8' && ce.direction === 'max' && ce.status === 'breached' && kpis.find((r) => r.metric_id === 'resource_utilization').value === 'N/A');
    const fnd = parseCsv(await download('Findings'));
    check('A69', 'Findings CSV: 3 findings with value/unit/n/eligible/case keys', fnd.length === 3 && fnd[0].metric_id === 'inter_event' && fnd[0].value === '5.5' && fnd[0].support === 'low' && fnd[2].metric_id === 'case_elapsed_mean' && JSON.parse(fnd[2].case_keys).length === 3);
    const issuesText = await download('Validation issues');
    check('A70', 'Validation issues CSV: no issue rows for this clean log', parseCsv(issuesText ?? '').length === 0);
  });

  // ===================== B. T13 / T17: other CSVs replace every result =====================
  await section('B-t13-t17', async () => {
    await loadCsv('t03-resources.csv', fx('integration/t03-resources.csv'));
    let t = await body();
    check('B01', 'T13: loading another CSV updates every view (1 of 1 case, 4 accepted events)', t.includes('1 of 1 case') && /Accepted events\n4\n/.test(t));
    await nav('Analysis');
    await tab('Resources & handoffs');
    await wait(500);
    t = await main();
    const labels = await edgeLabels();
    const w = await tableRows('Workload table');
    check('B02', 'T03/T17a: R1 raw 1, R2 raw 2; missing endpoint excluded; raw coverage 75% (3 of 4)', JSON.stringify(w.map((r) => [r[0], r[2]])) === JSON.stringify([['R2', '2'], ['R1', '1']]) && t.includes('75%') && t.includes('3 of 4 rows'));
    check('B03', 'T17a: graph shows only R1 → R2 = 1 (no same-resource R2→R2, no missing endpoint edge); table matches', JSON.stringify(labels) === '["1"]' && JSON.stringify((await tableRows('Handoff table')).map((r) => r.slice(0, 3))) === JSON.stringify([['R1', 'R2', '1']]));
    await nav('Design');
    t = await main();
    check('B04', 'Design records of the previous dataset are not shown as current (history pointer only)', !t.includes('Test change note') && t.includes('View in Workspace history'));
    await loadCsv('t17-reverse-handoffs.csv', fx('integration/t17-reverse-handoffs.csv'));
    await nav('Analysis');
    await tab('Resources & handoffs');
    await wait(500);
    const lab2 = await edgeLabels();
    const h = await tableRows('Handoff table');
    check('B05', 'T17b: both directions drawn as separate edges (2 edges, 1 each) and equal the table', lab2.length === 2 && sortJ(lab2) === sortJ(['1', '1']) && sortJ(h.map((r) => `${r[0]}>${r[1]}=${r[2]}`)) === sortJ(['R2>R1=1', 'R1>R2=1']));
    const dashed = await b.eval(`[...document.querySelectorAll('.react-flow__edge')].filter(e => e.querySelector('path')?.getAttribute('style')?.includes('dash') || e.querySelector('path')?.getAttribute('stroke-dasharray')).length`);
    check('B06', 'T17b: reverse edge of the pair is visually distinguished (dashed)', dashed === 1, `dashed=${dashed}`);
    await clickEdge(`h:${JSON.stringify(['R1', 'R2'])}`);
    await wait(400);
    const c12 = await caseButtons();
    await clickEdge(`h:${JSON.stringify(['R2', 'R1'])}`);
    await wait(400);
    const c21 = await caseButtons();
    check('B07', 'T17b: edge R1→R2 lists C2, edge R2→R1 lists C1', JSON.stringify(c12) === JSON.stringify([K('C2')]) && JSON.stringify(c21) === JSON.stringify([K('C1')]));
    await nav('Evidence Export');
    const dfg = parseCsv(await download('DFG edges'));
    const hand = parseCsv(await download('Resource handoffs'));
    check('B08', 'T13: exports follow the new CSV (DFG A→B = 2; handoffs R2→R1 1, R1→R2 1)', dfg.length === 1 && dfg[0].from === 'A' && dfg[0].count === '2' && sortJ(hand.map((r) => `${r.from}>${r.to}=${r.count}`)) === sortJ(['R2>R1=1', 'R1>R2=1']));
    t = await main();
    check('B09', 'Workspace history lists the Order Processing records as another dataset revision', t.includes('other dataset revision') && t.includes('order-processing-event-log.csv'));
  });

  // ===================== C. Data-quality cases T05–T08, T15, QA-02, QA-05 =====================
  await section('C-quality', async () => {
    await loadCsv('t05-parsing-order.csv', fx('integration/t05-parsing-order.csv'));
    let t = await body();
    check('C01', 'T05: invalid timestamp blocks analysis until exclusion consent; tie warning shown', t.includes('invalid_timestamp') && t.includes('timestamp_tie') && !t.includes('Ready for analysis') && t.includes('I confirm excluding the 1 row'));
    await clickLabel('I confirm excluding the 1 row');
    await wait(600);
    t = await body();
    check('C02', 'T05: after consent 3 accepted events, 2 cases; quoted comma kept as one activity', /Accepted events\n3\n/.test(t) && t.includes('2 of 2 cases') && t.includes('Sound, check'));
    await nav('Analysis');
    await tab('Process map (DFG)');
    await wait(500);
    check('C03', 'T05: B→A = 1 (tie keeps source order); no cross-case edge to "Sound, check"', (await b.eval(`[...document.querySelectorAll('.react-flow__edge')].filter(e => !/rf__edge-[st]:/.test(e.getAttribute('data-testid'))).map(e => e.getAttribute('data-testid'))`)).join() === `rf__edge-e:${JSON.stringify(['B', 'A'])}`);
    await clickEdge(`e:${JSON.stringify(['B', 'A'])}`);
    await wait(300);
    check('C04', 'T05: B→A inter-event gap 0 min', (await main()).includes('0 min · n=1'));

    await loadCsv('t06-same-case-two-processes.csv', fx('integration/t06-same-case-two-processes.csv'));
    const opts = await b.eval(`[...document.querySelectorAll('.sticky select option')].map(o => o.value)`);
    check('C05', 'T06: same case ID in stage and equipment → two processes', JSON.stringify(opts) === '["equipment","stage"]');
    await b.set('.sticky select', 'stage');
    await nav('Analysis');
    await tab('Process map (DFG)');
    await wait(500);
    const stageNodes = (await nodeTexts()).map((n) => n.split('|')[0]);
    await b.set('.sticky select', 'equipment');
    await wait(700);
    const eqNodes = (await nodeTexts()).map((n) => n.split('|')[0]);
    check('C06', 'T06: separate graphs (stage Setup/Check; equipment Request/Ready); no cross-process edge', sortJ(stageNodes) === sortJ(['START', 'Setup', 'Check', 'END']) && sortJ(eqNodes) === sortJ(['START', 'Request', 'Ready', 'END']));

    await loadCsv('t07-ambiguous-lifecycle.csv', fx('integration/t07-ambiguous-lifecycle.csv'));
    t = await body();
    check('C07', 'T07: repeated starts without IDs → 3 ambiguous_lifecycle warnings, still analysable', (t.match(/ambiguous_lifecycle/g) ?? []).length === 3 && t.includes('Ready for analysis'));
    await nav('Analysis');
    await tab('Performance');
    t = await main();
    await b.click('Service time', { selector: 'main button' });
    const t2 = await main();
    check('C08', 'T07: ambiguous pair counted (1), no service duration, completion trace A→B retained', /Ambiguous pairs \(skipped\)\n1/.test(t) && t2.includes('No service time measurements') && t.includes('A → B'));

    await loadCsv('t08-quality-issues.csv', fx('integration/t08-quality-issues.csv'));
    t = await body();
    check('C09', 'T08: Feb 30 and repeated event ID flagged as errors; analysis blocked', t.includes('invalid_timestamp') && t.includes('duplicate_event_id') && t.includes('I confirm excluding the 2 rows'));
    await clickLabel('I confirm excluding the 2 rows');
    await wait(500);
    await nav('Analysis');
    await tab('Resources & handoffs');
    t = await main();
    check('C10', 'T08: NONE placeholder counted as missing → raw coverage 50% (1 of 2)', t.includes('50%') && t.includes('1 of 2 rows'));
    await nav('Monitor & Control');
    check('C11', 'T08: utilization N/A without shifts (never 0%)', /resource_utilization\nno target\nN\/A/.test(await main()));

    await loadCsv('t15-overlap-no-shift.csv', fx('integration/t15-overlap-no-shift.csv'));
    await nav('Analysis');
    await tab('Resources & handoffs');
    const w15 = await tableRows('Workload table');
    check('C12', 'T15: overlapping R1 intervals union to 15 min (not 20)', w15[0][0] === 'R1' && w15[0][5] === '15 min');
    await nav('Monitor & Control');
    check('C13', 'T15: resource_utilization N/A, no inflated %', /resource_utilization\nno target\nN\/A/.test(await main()));

    await loadCsv('qa02-same-name-two-festivals.csv', fx('integration/qa02-same-name-two-festivals.csv'));
    await nav('Analysis');
    await tab('Resources & handoffs');
    const w02 = await tableRows('Workload table');
    check('C14', 'QA-02: "Local Crew" in F1 and F2 stays two resources (10 min, 5 min), readable labels', sortJ(w02.map((r) => `${r[0]}=${r[5]}=${r[4]}`)) === sortJ(['Local Crew · F1=10 min=1', 'Local Crew · F2=5 min=1']), JSON.stringify(w02));
    await tab('Findings');
    t = await main();
    check('C15', 'QA-02: finding text shows the readable label, not the internal key', /Local Crew · F[12] has the most discovered instances/.test(t) && !t.includes('@resource:'));
    const ev = await evidenceJson();
    check('C16', 'QA-02: export keeps the internal resource keys unchanged', ev.resources.data.resources.every((r) => r.resource.startsWith('@resource:["festival",')));

    await loadCsv('qa05-start-only.csv', fx('integration/qa05-start-only.csv'));
    await nav('Analysis');
    await tab('Resources & handoffs');
    await clickNode('r:R7');
    await wait(300);
    const nodeCases = await caseButtons();
    await tab('Findings');
    t = await main();
    check('C17', 'QA-05: R7 node drill-down = raw-event cases (Finished, Started); instance finding evidence = Finished only',
      sortJ(nodeCases) === sortJ([K('Finished'), K('Started')]) && t.includes('1 case: Finished'));
  });

  // ===================== D. BPM lifecycle on the labelled audience gate test log =====================
  const GATE = fx('integration/audience-gate-test-log.csv');
  await section('D-load-kpi', async () => {
    await loadCsv('audience-gate-test-log.csv', GATE, { festival: true, require: true });
    let t = await body();
    check('D01', 'Festival opt-in: badge on, Audience Entry label, 3 timestamp ties, no time-order warning', t.includes('Festival adapters on') && t.includes('Audience Entry') && (t.match(/timestamp_tie/g) ?? []).length === 3 && !t.includes('audience_event_before_arrival') && /Accepted events\n34\n/.test(t));
    await nav('Monitor & Control');
    t = await main();
    const v = (id) => t.match(new RegExp(`${id}\\n[a-z ]+\\n([^\\n]+)`))?.[1];
    check('D02', 'Observed KPIs: queue wait 26.3 s, entry elapsed 1.52 min, completed 8 / 88.9%, rejected 1 / 11.1%, manual 0%',
      v('audience_queue_wait_mean') === '26.3 s' && v('audience_entry_elapsed_mean') === '1.52 min' && v('audience_completed_count') === '8 cases' && v('audience_completed_rate') === '88.9%' &&
      v('audience_rejected_count') === '1 cases' && v('audience_rejected_rate') === '11.1%' && v('audience_manual_verification_rate') === '0%',
      JSON.stringify(['audience_queue_wait_mean', 'audience_entry_elapsed_mean', 'audience_completed_count', 'audience_completed_rate', 'audience_rejected_count', 'audience_rejected_rate', 'audience_manual_verification_rate'].map(v)));
    check('D03', 'Throughput with 60-min bucket: 8 cases/bucket', v('audience_throughput') === '8 cases/bucket');
    await b.set('main select', '15');
    await wait(500);
    t = await main();
    check('D04', '15-min buckets: mean 2.67 cases/bucket; caption explains recorded zero vs not observed', t.includes('audience_throughput · 2.67 cases/bucket mean') && t.includes('A bucket with 0 means no completion was recorded in this log'));
    const ev = await evidenceJson();
    const tp = ev.kpis.data.find((m) => m.id === 'audience_throughput');
    check('D05', 'Throughput buckets [8, 0, 0] over 10:00–10:45 UTC (zero = recorded, not N/A)', JSON.stringify(tp.buckets.map((x) => x.count)) === '[8,0,0]' && tp.buckets[0].startMs === Date.UTC(2026, 10, 28, 10, 0) && ev.filter.throughputBucketMinutes === 15);
    await nav('Monitor & Control');
    await b.set('main select', '60');
  });

  await section('D-targets', async () => {
    await nav('Model');
    await setTarget('audience_completed_rate', '95');
    await b.set('select[aria-label="Direction for audience_completed_rate"]', 'min').catch(() => {});
    await nav('Model');
    const dirSel = await b.eval(`(() => { const i = document.querySelector('input[aria-label="Target for audience_completed_rate"]'); const sel = i.closest('tr').querySelector('select'); return !!sel; })()`);
    if (dirSel) {
      await b.eval(`(() => { const i = document.querySelector('input[aria-label="Target for audience_completed_rate"]'); const sel = i.closest('tr').querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'min'); sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await wait(400);
    }
    await setTarget('audience_queue_wait_mean', '0.4375');
    await nav('Monitor & Control');
    let t = await main();
    check('D10', 'Exact-equality target: queue wait 0.4375 min (= 26.25 s) with max 0.4375 → met', /audience_queue_wait_mean\nmet\n26.3 s/.test(t));
    check('D11', 'Minimum completed-rate target 95% → breached; measured 88.9% unchanged', /audience_completed_rate\nbreached\n88.9%/.test(t) && t.includes('Measured 88.9% vs target ≥ 95%'));
    check('D12', 'QA-04 in UI: breach alert links 1 problem case (engine target evidence), not the 8 numerator cases', t.includes('Inspect 1 evidence case'));
    await b.click('Inspect 1 evidence case', { partial: true });
    check('D13', 'Breach drill-down lists ENT009 (the non-completed attempt)', JSON.stringify(await caseButtons()) === JSON.stringify([key('audience', 'ENT009')]));
    await b.eval(`[...document.querySelectorAll('main button')].find(x => x.innerText.startsWith('audience_completed_rate'))?.click()`);
    await wait(300);
    check('D14', 'KPI card drill-down keeps the 8 completed (numerator) cases, labelled separately', (await caseButtons()).length === 8);
    await nav('Model');
    await setTarget('audience_queue_wait_mean', '0.3');
    await nav('Monitor & Control');
    t = await main();
    check('D15', 'Model target change reflects immediately (0.3 min → breached) without changing the measurement', /audience_queue_wait_mean\nbreached\n26.3 s/.test(t));
  });

  await section('D-design', async () => {
    await nav('Analysis');
    await tab('Findings');
    let t = await main();
    // festival_id=TEST-ONLY scopes resource keys per festival (QA-02 policy), so the readable label is "Gate1 · TEST-ONLY".
    check('D20', 'Audience findings: Join→Verification gap 1.44 min (86.25 s), Gate1 · TEST-ONLY 6 instances (17 of 26), positive queue wait, completed-rate breach', t.includes('Join Entry Queue → Ticket Verification has the largest mean inter-event gap') && t.includes('1.44 min') && t.includes('Gate1 · TEST-ONLY has the most discovered instances among known resources. Resource coverage is 17 of 26.') && t.includes('show a positive mean queue wait') && t.includes('audience_completed_rate measured'));
    await b.eval(`(() => { const card = [...document.querySelectorAll('main section, main div')].filter(c => c.innerText?.includes('show a positive mean queue wait') && c.querySelector('button')?.innerText.includes('Create design record')).sort((a, b) => a.innerText.length - b.innerText.length)[0]; [...card.querySelectorAll('button')].find(x => x.innerText.includes('Create design record')).click(); return true; })()`);
    await wait(600);
    t = await main();
    check('D21', 'Design from the queue-wait finding: simulation-linked, target KPI audience_queue_wait_mean', (await b.eval(`document.querySelectorAll('main select')[2].value`)) === 'simulation' && (await b.eval(`document.querySelectorAll('main select')[1].value`)) === 'audience_queue_wait_mean');
    await uploadBpmn('audience-to-be-test.bpmn', bpmnWithDi);
    await wait(600);
    await b.set('main select', 'audience-to-be-test.bpmn', 4);
    await setText('main textarea', 'Test only: add one staffed gate at peak (integration test, not a Festival decision).');
    await b.click('Save changes');
    await tab('To-be BPMN');
    await wait(1500);
    const shapes = await b.eval(`document.querySelectorAll('.djs-container .djs-element.djs-shape').length`);
    check('D22', 'To-be BPMN imported, linked and rendered (bpmn-js shapes)', shapes >= 3, `shapes=${shapes}`);
  });

  await section('D-refine-plan', async () => {
    await setGates(3, 4);
    let t = await main();
    check('D30', 'Model: baseline 3 / candidate 4; observed service mode for Ticket Verification', t.includes('Ticket Verification') && (await b.eval(`[...document.querySelectorAll('main input')].map(i=>i.value)`)).includes('4'));
    await nav('Refine & Improve');
    await b.click('Run baseline + candidate');
    await wait(500);
    t = await main();
    check('D31', 'Gate vector: 8 of 9 eligible cases simulated; ENT009 excluded (missing or invalid service)', t.includes('8 entrants simulated of 9 eligible cases. 1 excluded.'));
    await b.eval(`document.querySelector('main details summary')?.click()`);
    await wait(200);
    check('D32', 'Excluded list names ENT009 with reason', (await main()).includes('ENT009 — missing or invalid service'));
    const rows = await b.eval(`(() => { const t = [...document.querySelectorAll('main table')].find(x => /modeled measure/i.test(x.innerText)); return [...t.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText.trim())); })()`);
    const R = Object.fromEntries(rows.map((r) => [r[0], r.slice(1)]));
    check('D33', 'Scenario 3 → 4: mean 26.3 s → 10 s, p95 1 min → 20 s, max 1 min → 20 s, finish 3.17 → 2.5 min, 151.6 → 192 /h, +1 gate/+1 worker',
      JSON.stringify(R['Mean wait'].slice(0, 2)) === '["26.3 s","10 s"]' && JSON.stringify(R['p95 wait (nearest rank)'].slice(0, 2)) === '["1 min","20 s"]' && JSON.stringify(R['Max wait'].slice(0, 2)) === '["1 min","20 s"]' &&
      JSON.stringify(R['Finish elapsed from first arrival'].slice(0, 2)) === '["3.17 min","2.5 min"]' && JSON.stringify(R['Throughput'].slice(0, 2)) === '["151.6 /h","192 /h"]' && R['Gates (staffed)'][2] === '+1' && R['Qualified gate workers (1 per gate)'][2] === '+1', JSON.stringify(R));
    check('D34', 'Target check on the design KPI (max 0.3 min): baseline breached → candidate met (modeled, separate from observed)', /breached\n→\nmet/.test(t) || /breached → met/.test(t));
    check('D35', 'Observed log KPI panel shows the measured queue wait separately (26.3 s)', /Observed log KPIs[\s\S]*audience_queue_wait_mean\n26.3 s/.test(t));
    await b.click('Apply to Implementation plan →');
    await wait(500);
    t = await main() + (await b.eval(`[...document.querySelectorAll('main input')].map(i=>i.value).join('|')`));
    check('D36', 'T11: plan from scenario rev 1 → "Open 1 staffed entry gate(s): 3 → 4", +1 qualified worker, provider engine', t.includes('Open 1 staffed entry gate(s): 3 → 4') && t.includes('+1 qualified gate worker') && /Results provider\nengine/.test(t) && t.includes('Scenario rev 1'));
    await b.set('main input[placeholder="Unassigned"]', 'Gate lead');
    await b.set('main input[type=date]', '2026-12-01');
    await b.set('main tbody select', 'in_progress');
    await nav('Monitor & Control');
    t = await main();
    check('D37', 'Monitor: plan status (scenario 3→4 gates) separate from measured KPI (still 26.3 s)', t.includes('scenario 3→4 gates') && /audience_queue_wait_mean\nbreached\n26.3 s/.test(t));
    // T12: parameter change → stale
    await setGates(null, 5);
    await nav('Refine & Improve');
    t = await main();
    const dis = await b.eval(`[...document.querySelectorAll('button')].find(x => x.textContent.includes('Apply to Implementation'))?.disabled`);
    check('D38', 'T12: candidate 5 → previous result stale, apply disabled', t.includes('Stale result — cannot be applied') && dis === true);
    await b.click('Run baseline + candidate');
    await wait(500);
    const rows5 = await b.eval(`(() => { const t = [...document.querySelectorAll('main table')].find(x => /modeled measure/i.test(x.innerText)); return [...t.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText.trim())); })()`);
    const R5 = Object.fromEntries(rows5.map((r) => [r[0], r.slice(1)]));
    check('D39', 'Revision 2 (3 → 5): mean 3.8 s, max 10 s, finish 2.33 min, +2 gates', (await main()).includes('Scenario revision 2: 3 → 5 gates') && R5['Mean wait'][1] === '3.8 s' && R5['Max wait'][1] === '10 s' && R5['Finish elapsed from first arrival'][1] === '2.33 min' && R5['Gates (staffed)'][2] === '+2', JSON.stringify(R5));
    await b.click('Apply to Implementation plan →');
    await wait(600);
    t = await main() + (await b.eval(`[...document.querySelectorAll('main input')].map(i=>i.value).join('|')`));
    check('D40', 'New plan revision (3 → 5); previous plan archived, not deleted', t.includes('Open 2 staffed entry gate(s): 3 → 5') && t.includes('archived'));
    await nav('Refine & Improve');
    await b.click('Apply to Implementation plan →');
    await wait(500);
    const ev = await evidenceJson();
    check('D41', 'Re-applying the same scenario keeps the existing plan (2 plans total, 1 current)', ev.plans.length === 2 && ev.plans.filter((p) => p.state === 'current').length === 1);
    check('D42', 'Evidence: archived plan keeps its edits; scenarios record params, provider and same input count',
      ev.plans.find((p) => p.state === 'archived').tasks[0].owner === 'Gate lead' && ev.scenarios.length === 2 && ev.scenarios.every((s) => s.provider === 'engine' && s.inputCount === 8 && s.params.serviceMode === 'observed') && ev.scenarios[1].candidate.gateCount === 5);
    const plansCsv = parseCsv(await download('Action plans (all revisions)'));
    // Each scenario plan has 4 template tasks (open gates, layout, briefing, re-measure) → 8 rows over 2 revisions.
    check('D43', 'Plans CSV: rev 1 archived (+1 gate, owner kept) and rev 2 current (+2 gates), provider engine, audience scope',
      plansCsv.length === 8 && plansCsv.every((r) => r.provider === 'engine' && r.process === 'audience' && r.plan_source === 'scenario') &&
      plansCsv.filter((r) => r.plan_revision === '1').every((r) => r.plan_state === 'archived' && r.gate_delta === '1') &&
      plansCsv.filter((r) => r.plan_revision === '2').every((r) => r.plan_state === 'current' && r.gate_delta === '2') &&
      plansCsv.find((r) => r.plan_revision === '1').owner === 'Gate lead', JSON.stringify(plansCsv.map((r) => [r.plan_revision, r.plan_state, r.gate_delta])));
    // Scope change → stale
    await b.set('input[aria-label="From"]', '2026-11-28T19:00:15');
    await nav('Refine & Improve');
    t = await body();
    // First events ENT001 10:00:00Z and ENT002 10:00:10Z fall before 10:00:15Z; ENT003–ENT009 remain → 7 of 9 whole cases.
    check('D44', 'Case filter (first event ≥ 10:00:15Z) → 7 of 9 cases; scenarios of the unfiltered scope not current', t.includes('7 of 9 cases') && !t.includes('Scenario revision 2: 3 → 5 gates') && t.includes('View in Workspace history'));
    await b.set('input[aria-label="From"]', '');
    await nav('Implementation');
    t = await main() + (await b.eval(`[...document.querySelectorAll('main input')].map(i=>i.value).join('|')`));
    check('D45', 'Clearing the filter restores the same-scope records', t.includes('Open 2 staffed entry gate(s): 3 → 5'));
  });

  await section('E-t10-qa06-qa07', async () => {
    await loadCsv('t10-audience-wait-8min.csv', fx('integration/t10-audience-wait-8min.csv'), { festival: true });
    await nav('Model');
    await setTarget('audience_queue_wait_mean', '5');
    await nav('Monitor & Control');
    let t = await main();
    check('E01', 'T10: mean wait 8 min, target max 5 → breached', /audience_queue_wait_mean\nbreached\n8 min/.test(t));
    await nav('Model');
    await setTarget('audience_queue_wait_mean', '10');
    await nav('Monitor & Control');
    t = await main();
    check('E02', 'T10: target max 10 → met; measured 8 min unchanged', /audience_queue_wait_mean\nmet\n8 min/.test(t));

    await loadCsv('qa06-audience-reverse-order.csv', fx('integration/qa06-audience-reverse-order.csv'));
    t = await body();
    check('E03', 'QA-06 opt-in: adapters off → no audience time-order warning, no audience KPI', !t.includes('audience_event_before_arrival'));
    await nav('Monitor & Control');
    check('E04', 'QA-06 opt-in: adapters off → only general KPIs', !(await main()).includes('audience_queue_wait_mean'));
    await loadCsv('qa06-audience-reverse-order.csv', fx('integration/qa06-audience-reverse-order.csv'), { festival: true, require: true });
    t = await body();
    check('E05', 'QA-06: adapters on + process_type required + festival_id mapped → 3 audience_event_before_arrival warnings', (t.match(/audience_event_before_arrival/g) ?? []).length === 3);
    await nav('Monitor & Control');
    t = await main();
    check('E06', 'QA-06: out-of-order evidence excluded from queue wait and outcome KPIs (N/A, n = 0)', /audience_queue_wait_mean\nno target\nN\/A/.test(t) && /audience_rejected_rate\nno target\nN\/A\nn = 0 of 1/.test(t));

    await loadCsv('qa07-decimal-seconds.csv', fx('integration/qa07-decimal-seconds.csv'), { festival: true });
    await setGates(1, 2);
    await nav('Refine & Improve');
    await b.click('Run baseline + candidate');
    await wait(400);
    const ev = await evidenceJson();
    const s = ev.scenarios[0];
    check('E07', 'QA-07: decimal-second services (0.1/0.2/0.05 s) → exactly zero wait on 1 gate', s && s.baseline.meanWaitMin === 0 && s.baseline.p95WaitMin === 0 && s.baseline.maxWaitMin === 0 && Math.abs(s.baseline.finishElapsedMin * 60 - 0.35) < 1e-9);
  });

  // ===================== T. TEST_PLAN T01 / T02 / T04 / T09 inputs through the UI =====================
  await section('T-basic', async () => {
    await loadCsv('t01.csv', 'case_id,activity,timestamp\nC1,A,2026-11-27T00:00:00Z\nC1,B,2026-11-27T00:10:00Z\nC1,C,2026-11-27T00:30:00Z\nC2,A,2026-11-27T00:00:00Z\nC2,C,2026-11-27T00:20:00Z\n');
    await nav('Analysis');
    await tab('Process map (DFG)');
    await wait(400);
    let ids = await b.eval(`[...document.querySelectorAll('.react-flow__edge')].map(e => e.getAttribute('data-testid'))`);
    check('T01a', 'T01: edges A→B, B→C, A→C (1 each); start A = 2, end C = 2',
      sortJ(ids) === sortJ([`rf__edge-e:${JSON.stringify(['A', 'B'])}`, `rf__edge-e:${JSON.stringify(['B', 'C'])}`, `rf__edge-e:${JSON.stringify(['A', 'C'])}`, 'rf__edge-s:A', 'rf__edge-t:C']) && sortJ(await edgeLabels()) === sortJ(['2', '1', '1', '1', '2']));
    await tab('Variants');
    const v = await tableRows('Exact variants');
    check('T01b', 'T01: variants ABC and AC, 50% each', JSON.stringify(v.map((r) => r[1])) === '["50%","50%"]');
    await nav('Monitor & Control');
    check('T01c', 'T01: mean case elapsed 25 min', /case_elapsed_mean\nno target\n25 min/.test(await main()));

    await loadCsv('t02.csv', 'case_id,activity,timestamp,lifecycle\nC1,A,2026-11-27T00:00:00Z,complete\nC1,A,2026-11-27T00:01:00Z,complete\nC1,B,2026-11-27T00:02:00Z,complete\nC2,A,2026-11-27T00:00:00Z,complete\nC2,B,2026-11-27T00:01:00Z,complete\n');
    await nav('Analysis');
    await tab('Process map (DFG)');
    await wait(400);
    const n02 = Object.fromEntries((await nodeTexts()).filter((n) => !/^(START|END)/.test(n)).map((n) => n.split('|').slice(0, 2)));
    const t = await main();
    const l02 = await edgeLabels(); // start A 2, A→A 1, A→B 2, B end 2
    await clickEdge(`e:${JSON.stringify(['A', 'A'])}`);
    await wait(300);
    const loop = await main();
    check('T02a', 'T02: A = 3, B = 2; self-loop A→A = 1 (case C1); A→B = 2', JSON.stringify(n02) === JSON.stringify({ A: '3', B: '2' }) && sortJ(l02) === sortJ(['2', '1', '2', '2']) && /Self-loops\n1/.test(t) && loop.includes('Self-loop') && /Occurrences\n1/.test(loop) && JSON.stringify(await caseButtons()) === JSON.stringify([K('C1')]));
    await tab('Variants');
    check('T02b', 'T02: repeats retained → 2 variants (A,A,B and A,B)', (await tableRows('Exact variants')).length === 2);

    await loadCsv('t04.csv', 'case_id,activity,timestamp,lifecycle,activity_instance_id\n1,A,2026-11-27T00:00:00Z,start,a\n1,A,2026-11-27T00:05:00Z,complete,a\n1,B,2026-11-27T00:08:00Z,start,b\n1,B,2026-11-27T00:12:00Z,complete,b\n');
    await nav('Analysis');
    await tab('Performance');
    const ie = await tableRows('Bottleneck table');
    await b.click('Matched transition gap', { selector: 'main button' });
    const mg = await tableRows('Bottleneck table');
    await b.click('Service time', { selector: 'main button' });
    const sv = await tableRows('Bottleneck table');
    check('T04', 'T04: sequence A→B; service A 5 / B 4 min; matched gap 3 min; inter-event 7 min',
      JSON.stringify(ie.map((r) => [r[0], r[2]])) === '[["A → B","7 min"]]' && JSON.stringify(mg.map((r) => [r[0], r[2]])) === '[["A → B","3 min"]]' && sortJ(sv.map((r) => `${r[0]}=${r[2]}`)) === sortJ(['A=5 min', 'B=4 min']));
    await nav('Monitor & Control');
    check('T04b', 'T04: case elapsed 12 min', /case_elapsed_mean\nno target\n12 min/.test(await main()));

    await nav('Overview & Data');
    await b.click('Load UI fixture');
    await b.set('.sticky select', 'audience');
    await setGates(1, 2);
    await nav('Refine & Improve');
    await b.click('Run baseline + candidate');
    await wait(400);
    const rows = await b.eval(`(() => { const t = [...document.querySelectorAll('main table')].find(x => /modeled measure/i.test(x.innerText)); return [...t.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText.trim())); })()`);
    const R = Object.fromEntries(rows.map((r) => [r[0], r.slice(1, 3)]));
    check('T09', 'T09 (UI fixture, engine): 1 gate waits 0,3,6 → mean 3 s, p95 = max 6 s, finish 12 s; 2 gates 0,0,2 → mean 0.7 s, p95 = max 2 s, finish 8 s',
      JSON.stringify([R['Mean wait'], R['p95 wait (nearest rank)'], R['Max wait'], R['Finish elapsed from first arrival']]) === JSON.stringify([['3 s', '0.7 s'], ['6 s', '2 s'], ['6 s', '2 s'], ['12 s', '8 s']]), JSON.stringify(R));
  });

  // ===================== F. Fixture-era records never become engine records; same-scope restore =====================
  await section('F-provider-restore', async () => {
    await nav('Overview & Data');
    await b.click('Load UI fixture');
    await b.set('.sticky select', 'default');
    await nav('Model');
    await setTarget('case_elapsed_mean', '20');
    // Simulate a pre-integration record: copy this scope's workspace under the ui_fixture provider key with a fixture plan.
    const seeded = await b.eval(`(() => { const s = JSON.parse(localStorage.getItem('processpilot.workspaces.v2'));
      const [k, ws] = Object.entries(s.workspaces).find(([k, w]) => k.includes('::engine::default::') && w.meta.sourceKind === 'ui_fixture');
      const fk = k.replace('::engine::', '::ui_fixture::');
      s.workspaces[fk] = { ...ws, meta: { ...ws.meta, provider: 'ui_fixture' }, targets: [{ metricId: 'fixture.case_elapsed_mean', value: 1, unit: 'min', direction: 'max' }],
        plans: [{ id: 'fixture-plan', revision: 1, title: 'Fixture-era plan (hand-authored values)', source: { kind: 'proposal_only', designId: 'd' }, designId: 'd', scope: ws.meta.scope, provider: 'ui_fixture', tasks: [], state: 'current', createdAt: 0, updatedAt: 0 }] };
      localStorage.setItem('processpilot.workspaces.v2', JSON.stringify(s)); return fk; })()`);
    await b.eval(`location.hash = '#/overview'; setTimeout(() => location.reload(), 0); true`);
    await wait(2000);
    await nav('Overview & Data');
    await b.click('Load UI fixture');
    await b.set('.sticky select', 'default');
    await nav('Implementation');
    let t = await main();
    check('F01', 'Fixture-provider plan is not shown as a current engine plan for the same dataset scope', !t.includes('Fixture-era plan') && t.includes('No action plans yet'));
    await nav('Model');
    t = await main();
    check('F02', 'Engine-scope target restored after reload (case_elapsed_mean 20); fixture target not mixed in', (await b.eval(`document.querySelector('input[aria-label="Target for case_elapsed_mean"]')?.value`)) === '20' && !t.includes('fixture.case_elapsed_mean'));
    await nav('Evidence Export');
    t = await main();
    check('F03', 'Workspace history lists the fixture-era scope as "other provider (ui_fixture)", read-only', t.includes('other provider (ui_fixture)') && t.includes('UI fixture'), seeded);
    // Same-scope restore for an uploaded log: re-upload Order Processing with the same mapping.
    await nav('Overview & Data');
    await uploadFile('order-processing-event-log.csv', ORDER);
    await wait(500);
    for (const [i, v] of ORDER_MAP) await b.set('main select', v, i);
    await b.click('Validate & load');
    await wait(700);
    await nav('Design');
    t = await main();
    check('F04', 'Same dataset + mapping after reload restores its design record and target', t.includes('Review the contributing cases for possible handover delays') && (await (async () => { await nav('Model'); return b.eval(`document.querySelector('input[aria-label="Target for case_elapsed_mean"]')?.value`); })()) === '8');
  });
} catch (e) {
  out.push(`ERROR ${e.message}`);
  await b.shot('integration-error');
} finally {
  console.log(out.join('\n'));
  const pass = out.filter((l) => l.startsWith('PASS')).length;
  const fail = out.filter((l) => l.startsWith('FAIL') || l.startsWith('ERROR')).length;
  console.log(`--- summary: ${pass} PASS, ${fail} FAIL/ERROR ---`);
  console.log('--- console/log ---\n' + b.logs.join('\n'));
  await b.close();
}
