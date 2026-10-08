import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AlertEngine,DEFAULT_RULES,calculateMetrics,parseCsv} from '../lib/posture.ts';
import type {Metrics} from '../lib/posture.ts';
const metric=(time:number,trunk:number|null=10,arm:number|null=20):Metrics=>({time,trunk,arm,knee:null,confidence:1,activity:'test',landmarks:[],world:[]});
test('neutral and brief movements produce no sustained alerts',()=>{
  const engine=new AlertEngine(DEFAULT_RULES);
  for(let t=0;t<3;t+=.5)engine.update(metric(t,50));
  assert.equal(engine.alerts.length,0);engine.update(metric(3,10));
  for(let t=3.5;t<10;t+=.5)engine.update(metric(t));
  assert.equal(engine.alerts.length,0);
});
test('one sustained posture produces one event, then recovery allows a new one',()=>{
  const engine=new AlertEngine(DEFAULT_RULES);
  for(let t=0;t<=10;t+=.5)engine.update(metric(t,50));
  assert.equal(engine.alerts.length,1);assert.equal(engine.alerts[0].duration,10);
  engine.update(metric(10.5,10));assert.equal(engine.alerts[0].status,'resolved');
  for(let t=11;t<=14;t+=.5)engine.update(metric(t,50));
  assert.equal(engine.alerts.length,2);
});
test('missing measurements and sampling gaps break duration continuity',()=>{
  const engine=new AlertEngine(DEFAULT_RULES);
  engine.update(metric(0,50));engine.update(metric(.5,50));engine.update(metric(1,null));
  for(let t=1.5;t<4.5;t+=.5)engine.update(metric(t,50));
  assert.equal(engine.alerts.length,0);engine.update(metric(4.5,50));
  assert.equal(engine.alerts.length,1);engine.update(metric(5,null));
  assert.equal(engine.alerts[0].status,'tracking lost');
  engine.update(metric(10,50));engine.update(metric(11,50));
  assert.equal(engine.alerts.length,1);
});
test('example CSV produces two explained alerts at source timestamps',()=>{
  const rows=parseCsv(readFileSync(new URL('../public/sample-posture.csv',import.meta.url),'utf8'),DEFAULT_RULES);
  const engine=new AlertEngine(DEFAULT_RULES);rows.forEach(m=>engine.update(m));
  assert.equal(engine.alerts.length,2);assert.equal(engine.alerts[0].start,3);assert.equal(engine.alerts[1].start,11);
  assert.ok(engine.alerts.every(a=>a.status==='resolved'));
});
test('CSV rejects malformed and backwards timestamps; blanks remain unavailable',()=>{
  assert.throws(()=>parseCsv('timestamp,trunk_angle,arm_angle\n0,bad,20',DEFAULT_RULES));
  assert.throws(()=>parseCsv('timestamp,trunk_angle,arm_angle\n1,40,20\n0,40,20',DEFAULT_RULES));
  assert.throws(()=>parseCsv('timestamp,trunk_angle,arm_angle\n0,40,300',DEFAULT_RULES));
  assert.equal(parseCsv('timestamp,trunk_angle,arm_angle\n0,,',DEFAULT_RULES)[0].trunk,null);
});
test('geometry estimates torso lean and excludes obscured joints',()=>{
  const points=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
  points[11]={x:.1,y:-.4,z:0,visibility:1};points[12]={x:.5,y:-.4,z:0,visibility:1};
  points[23]={x:-.1,y:0,z:0,visibility:1};points[24]={x:.1,y:0,z:0,visibility:1};
  assert.ok(Math.abs(calculateMetrics(points,points,0,DEFAULT_RULES).trunk!-36.869)<.01);
  points[11].visibility=.1;assert.equal(calculateMetrics(points,points,1,DEFAULT_RULES).trunk,null);
  assert.equal(calculateMetrics([],[],0,DEFAULT_RULES).activity,'Unable to assess');
});
