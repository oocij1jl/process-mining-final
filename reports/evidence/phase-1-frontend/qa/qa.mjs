// Phase 1 frontend QA: additional checks beyond journey.mjs (no product code changes).
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from '../cdp.mjs';
const OUT = process.env.PP_QA_OUT ?? join(tmpdir(), 'processpilot-qa', 'qa');
const BASE = 'http://127.0.0.1:5174/';
const withDi = readFileSync(new URL('./qa-data/with-di.bpmn', import.meta.url), 'utf8');
const noDi = readFileSync(new URL('./qa-data/no-di.bpmn', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch(OUT, 9334);
const out = [];
const check = (id, name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? ' — ' + detail : ''}`);
const note = (id, text) => out.push(`INFO  [${id}] ${text}`);
const nav = (label) => b.click(label, { partial: true, selector: 'nav button' });
const captureDownloads = () => b.eval(`(() => { window.__dl = []; const o = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { blob.text().then(t => window.__dl.push(t)); return o(blob); };
  HTMLAnchorElement.prototype.click = function () {}; return true; })()`);
const lastDownload = async () => { await wait(300); return b.eval('window.__dl[window.__dl.length-1]'); };
const upload = (selector, name, text, type) => b.eval(`(() => { const input = document.querySelector(${JSON.stringify(selector)});
  const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
  input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

try {
  await b.go(BASE + '#/overview');
  await b.click('Load UI fixture');
  await b.set('.sticky select', 'default');

  // Q6: does opening a case drawer reset graph zoom (scope/base recomputation)?
  await nav('Analysis');
  await wait(800);
  await b.eval(`document.querySelector('.react-flow__controls-zoomin').click()`);
  await b.eval(`document.querySelector('.react-flow__controls-zoomin').click()`);
  await wait(500);
  const t1 = await b.eval(`document.querySelector('.react-flow__viewport').style.transform`);
  await b.eval(`[...document.querySelectorAll('.react-flow__node')].find(n => n.textContent.startsWith('A'))?.click()`);
  await wait(300);
  await b.click('001', { selector: 'aside button, main button' });
  await wait(700);
  const drawerOpen = (await b.eval(`!!document.querySelector('aside[aria-label="Case trace"]')`));
  await b.eval(`document.querySelector('aside[aria-label="Case trace"]').parentElement.click()`);
  await wait(700);
  const t2 = await b.eval(`document.querySelector('.react-flow__viewport').style.transform`);
  check('Q6', 'Case drawer opens from DFG drill-down', drawerOpen);
  check('Q6', 'Graph zoom/pan preserved after opening a case', t1 === t2, `before=${t1} after=${t2}`);

  // Q9: graph vs table consistency (fixture)
  await b.click('Resources & handoffs', { selector: '[role=tab]' });
  await wait(600);
  const graphLabels = await b.eval(`[...document.querySelectorAll('.react-flow__edgelabel-renderer button')].map(x=>x.textContent).sort().join(',')`);
  const tableCounts = await b.eval(`(() => { const t=[...document.querySelectorAll('table')].find(t=>t.innerText.includes('FROM')); return [...t.querySelectorAll('tbody tr')].map(r=>r.cells[2].innerText).sort().join(','); })()`);
  check('Q9', 'Handoff edge counts equal handoff table counts', graphLabels === tableCounts, `graph=${graphLabels} table=${tableCounts}`);

  // Q12: evidence export content
  await nav('Evidence Export');
  await captureDownloads();
  await b.click('Download evidence JSON');
  const ev = JSON.parse(await lastDownload());
  // Phase 2: the UI fixture CSV is analysed by src/engine; the provider label must say so (never "UI fixture").
  check('Q12', 'Evidence JSON labels provider as engine (src/engine), source stays UI fixture CSV', ev.provider === 'engine' && ev.providerDescription === 'src/engine' && ev.dataset.sourceKind === 'ui_fixture');
  check('Q12', 'Evidence JSON has dataset id, scope, filter, metric definitions', !!ev.dataset.id && ev.scope?.processKey === 'default' && ev.filter.selectedCases === 2 && !!ev.metricFamilies);
  check('Q12', 'Evidence DFG equals on-screen fixture DFG (A=3,B=1,C=2; 4 edges)', ev.dfg.status === 'ok' && ev.dfg.data.nodes.map(n=>`${n.activity}=${n.count}`).join(',') === 'A=3,B=1,C=2' && ev.dfg.data.edges.length === 4);
  check('Q12', 'Evidence JSON excludes raw rows', !JSON.stringify(ev).includes('2026-11-27T00:21:00Z'));
  await b.click('Resource handoffs');
  const hcsv = await lastDownload();
  check('Q12', 'Handoff CSV carries dataset_id/process/filter/provider columns', /^dataset_id,process,filter,provider,from,to,count/.test(hcsv), hcsv.split('\n')[0]);
  const planBtnDisabled = await b.eval(`[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Action plans'))?.disabled`);
  note('Q12', `Plans CSV button disabled without plans: ${planBtnDisabled}`);

  // Q8/Q13: audience design + BPMN import with and without DI
  await b.set('.sticky select', 'audience');
  await nav('Analysis');
  await b.click('Findings', { partial: true, selector: '[role=tab]' });
  await b.click('Create design record →');
  await upload('main input[type=file][accept=".bpmn,.xml"]', 'to-be-qa.bpmn', withDi, 'application/xml');
  await wait(600);
  await b.set('main select', 'to-be-qa.bpmn', 4); // To-be BPMN reference select
  await b.click('Save changes');
  await b.click('To-be BPMN', { selector: '[role=tab]' });
  await wait(1500);
  const shapes = await b.eval(`document.querySelectorAll('.djs-container .djs-element.djs-shape').length`);
  check('Q13', 'BPMN with DI renders shapes in bpmn-js viewer', shapes >= 3, `shapes=${shapes}`);
  await b.shot('q13-bpmn-with-di');
  await upload('main input[type=file][accept=".bpmn,.xml"]', 'as-is-no-di.bpmn', noDi, 'application/xml');
  await wait(400);
  await b.set('main select', 'as-is-no-di.bpmn', 3);
  await b.click('Save changes');
  await b.click('As-is BPMN', { selector: '[role=tab]' });
  await wait(1500);
  const noDiText = await b.text();
  const noDiShapes = await b.eval(`document.querySelectorAll('.djs-container .djs-element.djs-shape').length`);
  check('Q13', 'BPMN without DI shows an explicit error (not a blank canvas)', /could not be rendered|warning/i.test(noDiText), `shapes=${noDiShapes}`);
  await b.shot('q13-bpmn-no-di');

  // Q7: reload → workspace restored; BPMN XML not persisted → To-be reference message
  // Engine finding for the fixture audience process: largest inter-event gap Join Entry Queue → Ticket Verification
  // (4, 7, 10 s → mean 7 s), so the design title is that finding's proposal text.
  const titleBefore = await b.eval(`Object.values(JSON.parse(localStorage.getItem('processpilot.workspaces.v2')).workspaces).flatMap(w => w.designs).map(d => d.title)[0] ?? ''`);
  await b.eval(`location.hash = '#/overview'; setTimeout(() => location.reload(), 0); true`);
  await wait(2000);
  const inMemoryGone = await b.eval(`!document.body.innerText.includes('Ready for analysis')`);
  note('Q7', `Full page reload performed; dataset cleared from memory: ${inMemoryGone}`);
  await b.click('Load UI fixture');
  await b.set('.sticky select', 'audience');
  await nav('Design');
  await wait(400);
  const designsRestored = titleBefore.startsWith('Review the contributing cases for possible handover delays') && (await b.text()).includes(titleBefore);
  check('Q7', 'Design record restored after reload for the same dataset', designsRestored);
  await b.click('To-be BPMN', { selector: '[role=tab]' });
  const tobeMsg = await b.text();
  check('Q13', 'After reload, missing To-be XML is reported as missing (not "change note only")', tobeMsg.includes('To-be reference saved, diagram not loaded') && !tobeMsg.includes('No To-be BPMN: change note only') && !tobeMsg.includes('uses a change note only'));
  const refKept = await b.eval(`[...document.querySelectorAll('main select')][4]?.value`);
  note('Q13', `To-be reference kept in restored design record: "${refKept}"`);

  // Q10: upload edge cases (real engine path)
  await nav('Overview & Data');
  await upload('input[type=file][accept=".csv,text/csv"]', 'empty.csv', '', 'text/csv');
  await wait(400);
  check('Q10', 'Empty CSV → explicit "no header row" error', (await b.text()).includes('no header row'));
  await upload('input[type=file][accept=".csv,text/csv"]', 'log.xes', '<log/>', 'application/xml');
  await wait(400);
  check('Q10', 'Non-CSV file → explicit unsupported message', (await b.text()).includes('not a CSV file'));
  await upload('input[type=file][accept=".csv,text/csv"]', 'ragged.csv', 'case_id,activity,timestamp\n1,A,2026-11-27T00:00:00Z,EXTRA\n2,B\n', 'text/csv');
  await wait(500);
  const ragged = await b.text();
  const validateEnabled = await b.eval(`![...document.querySelectorAll('button')].find(x=>x.textContent==='Validate & load').disabled`);
  check('Q10', 'Ragged CSV lists malformed rows with position and reason', ragged.includes('with the wrong number of columns') && ragged.includes('TooManyFields') && ragged.includes('TooFewFields'));
  check('Q10', 'Ragged CSV cannot be loaded without explicit exclusion consent', validateEnabled === false);
  await b.click('Exclude these 2 rows', { partial: true, selector: 'label' });
  await b.set('main select', '', 1); // unmap activity
  const blocked = await b.eval(`[...document.querySelectorAll('button')].find(x=>x.textContent==='Validate & load').disabled`);
  check('Q10', 'Unmapped required field blocks Validate & load', blocked === true);
  await b.set('main select', 'activity', 1);
  await b.click('Validate & load');
  await nav('Monitor & Control');
  check('Q10', 'Downstream page shows "not ready" state when engine validation is unavailable', (await b.text()).includes('Dataset is not ready for analysis'));
  await b.shot('q10-not-ready');
} catch (e) {
  out.push(`ERROR ${e.message}`);
  await b.shot('qa-error');
} finally {
  console.log(out.join('\n'));
  console.log('--- console/log ---\n' + b.logs.join('\n'));
  await b.close();
}
