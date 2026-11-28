import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './cdp.mjs';
// Screenshots and the throwaway Chrome profile go to the OS temp dir, never into the repository.
const OUT = process.env.PP_QA_OUT ?? join(tmpdir(), 'processpilot-qa', 'journey');
const BASE = 'http://127.0.0.1:5174/';
const b = await launch(OUT);
const results = [];
const check = (name, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
try {
  await b.go(BASE + '#/analysis');
  check('Empty state without dataset', (await b.text()).includes('No dataset loaded'));
  await b.go(BASE + '#/overview');
  await b.shot('01-overview-empty');
  await b.click('Load UI fixture');
  let t = await b.text();
  check('Fixture loads; validation counts', t.includes('Ready for analysis') && t.includes('Accepted events'));
  // Phase 2 (engine): ENT001 Join Entry Queue and Ticket Verification start share 09:00:00Z → one timestamp_tie warning (row 9, A02).
  check('Fixture warning issue shown (engine timestamp_tie on row 9)', t.includes('timestamp_tie') && !t.includes('fixture.'));
  await b.shot('02-overview-fixture', true);

  await b.set('.sticky select', 'default');
  await b.click('Analysis', { partial: true, selector: 'nav button' });
  await new Promise((r) => setTimeout(r, 800));
  const nodes = await b.eval(`document.querySelectorAll('.react-flow__node').length`);
  const edges = await b.eval(`document.querySelectorAll('.react-flow__edge').length`);
  check('DFG renders default process (3 act + start/end, 4 edges + 1 start + 1 end)', nodes === 5 && edges === 6, `nodes=${nodes} edges=${edges}`);
  await b.eval(`[...document.querySelectorAll('.react-flow__node')].find(n => n.textContent.startsWith('A'))?.click()`);
  await new Promise((r) => setTimeout(r, 400));
  t = await b.text();
  check('Node click shows contributing cases', t.includes('2 contributing cases'));
  await b.shot('03-dfg-node');
  // click A→C edge label (count button)
  await b.eval(`(() => { const ls=[...document.querySelectorAll('.react-flow__edgelabel-renderer button')]; ls[2]?.click(); })()`);
  await new Promise((r) => setTimeout(r, 400));
  await b.shot('04-dfg-edge');

  await b.click('Resources & handoffs', { selector: '[role=tab]' });
  await new Promise((r) => setTimeout(r, 800));
  const rEdges = await b.eval(`document.querySelectorAll('.react-flow__edge').length`);
  check('Handoff network has R1→R2 and R2→R1 as separate edges', rEdges === 2, `edges=${rEdges}`);
  await b.eval(`(() => { const ls=[...document.querySelectorAll('.react-flow__edgelabel-renderer button')]; ls[0]?.click(); })()`);
  await new Promise((r) => setTimeout(r, 400));
  t = await b.text();
  check('Handoff edge click lists 1 case', t.includes('1 contributing case'));
  await b.shot('05-resources', true);

  await b.click('Findings', { partial: true, selector: '[role=tab]' });
  await b.shot('06-findings');

  // Switch to audience process
  await b.set('.sticky select', 'audience');
  await new Promise((r) => setTimeout(r, 600));
  await b.click('Resources & handoffs', { selector: '[role=tab]' });
  t = await b.text();
  check('Audience: no-handoff empty state with isolated node', t.includes('No eligible handoffs'));
  await b.shot('07-audience-resources');
  await b.click('Findings', { partial: true, selector: '[role=tab]' });
  await b.click('Create design record →');
  t = await b.text();
  check('Design record created and editor shown', t.includes('Design record') && t.includes('simulation-linked'));
  await b.shot('08-design', true);

  // Model: targets
  await b.click('Model', { partial: true, selector: 'nav button' });
  await b.set('input[aria-label="Target for audience_queue_wait_mean"]', '0.01');
  await b.click('Monitor & Control', { partial: true, selector: 'nav button' });
  t = await b.text();
  check('Monitor shows breach after target 0.01 min', t.includes('breached'));
  await b.shot('09-monitor-breached', true);
  await b.click('Model', { partial: true, selector: 'nav button' });
  await b.set('input[aria-label="Target for audience_queue_wait_mean"]', '1');
  await b.click('Monitor & Control', { partial: true, selector: 'nav button' });
  t = await b.text();
  check('Monitor shows met after target 1 min; measured unchanged', t.includes('All 1 target met') && t.includes('3 s'));

  // Scenario params
  await b.click('Model', { partial: true, selector: 'nav button' });
  const inputs = await b.eval(`[...document.querySelectorAll('main input')].map(i => i.closest('label')?.innerText.split('\\n')[0])`);
  const bi = inputs.indexOf('Baseline gates'); const ci = inputs.indexOf('Candidate gates');
  await b.set('main input', '1', bi);
  await b.set('main input', '2', ci);
  await b.shot('10-model', true);
  await b.click('Refine & Improve', { partial: true, selector: 'nav button' });
  await b.click('Run baseline + candidate');
  t = await b.text();
  check('Scenario computed (1 gate mean 3 s → 2 gates 0.7 s)', t.includes('Scenario revision 1') && t.includes('3 s') && t.includes('0.7 s'));
  await b.shot('11-refine', true);
  await b.click('Apply to Implementation plan →');
  t = await b.text() + (await b.eval(`[...document.querySelectorAll('main input')].map(i=>i.value).join('|')`));
  check('Plan created with +1 gate / +1 worker', t.includes('Open 1 staffed entry gate(s): 1 → 2') && t.includes('+1 qualified gate worker'));
  await b.set('main input[placeholder="Unassigned"]', 'Gate lead');
  await b.shot('12-implementation', true);

  // Change candidate → stale
  await b.click('Model', { partial: true, selector: 'nav button' });
  await b.set('main input', '3', ci);
  await b.click('Refine & Improve', { partial: true, selector: 'nav button' });
  t = await b.text();
  const applyDisabled = await b.eval(`[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Apply to Implementation'))?.disabled`);
  check('Stale after candidate change; apply disabled', t.includes('Stale result') && applyDisabled === true);
  await b.click('Run baseline + candidate');
  await b.click('Apply to Implementation plan →');
  t = await b.text();
  check('New revision plan; old archived', t.includes('archived') && t.includes('1 → 3'));
  await b.shot('13-implementation-rev2', true);

  // Date filter (KST 18:00:01 = 09:00:01Z) → engine recomputes on whole cases by first event:
  // ENT001 starts 09:00:00Z (excluded); ENT002 09:00:01Z and ENT003 09:00:02Z (included) → 2 of 3 cases, Join Entry Queue = 2.
  await b.set('input[aria-label="From"]', '2026-11-27T18:00:01');
  await b.click('Analysis', { partial: true, selector: 'nav button' });
  await new Promise((r) => setTimeout(r, 800));
  t = await b.eval('document.body.innerText');
  const joinNode = await b.eval(`[...document.querySelectorAll('.react-flow__node')].map(n => n.innerText).find(x => x.startsWith('Join Entry Queue')) ?? ''`);
  check('Subset filter recomputes with the engine (2 of 3 whole cases; Join Entry Queue=2)', t.includes('2 of 3 cases') && /\n2\n/.test('\n' + joinNode + '\n') && !t.includes('No UI fixture value'), JSON.stringify(joinNode));
  await b.shot('14-filter-unavailable');
  await b.click('Implementation', { partial: true, selector: 'nav button' });
  t = await b.text();
  check('Other-filter scope does not show the plan as current (history only)', t.includes('No action plans yet') && t.includes('View in Workspace history'));
  await b.set('input[aria-label="From"]', '');

  await b.click('Evidence Export', { partial: true, selector: 'nav button' });
  await b.shot('15-export');

  // Upload path: real engine stub → not implemented state
  await b.click('Overview & Data', { partial: true, selector: 'nav button' });
  await b.eval(`(() => { const input = document.querySelector('input[type=file]'); const f = new File(['case_id,activity,timestamp\\n1,A,2026-11-27T00:00:00Z\\n'], 'mini.csv', {type:'text/csv'}); const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await new Promise((r) => setTimeout(r, 600));
  t = await b.text();
  check('Upload opens mapping editor with auto-mapping', t.includes('Column mapping') && t.includes('mini.csv'));
  await b.shot('16-mapping');
  await b.click('Validate & load');
  t = await b.text();
  // Phase 2: the upload path is analysed by src/engine (1 raw row → 1 accepted event, 1 case, ready).
  check('Uploaded CSV analysed by the engine (1 accepted event, 1 case, no not-implemented state)', t.includes('Ready for analysis') && !t.includes('not implemented') && (await b.eval('document.body.innerText')).includes('1 of 1 case'));
  await b.shot('17-engine-not-implemented', true);
} catch (e) {
  results.push(`ERROR ${e.message}`);
  await b.shot('zz-error');
} finally {
  console.log(results.join('\n'));
  console.log('--- console/log ---\n' + b.logs.join('\n'));
  await b.close();
}
