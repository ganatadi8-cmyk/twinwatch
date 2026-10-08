export type Landmark = { x: number; y: number; z: number; visibility?: number };
export type Rules = { trunk: number; arm: number; hold: number; confidence: number };
export const DEFAULT_RULES: Rules = { trunk: 35, arm: 90, hold: 3, confidence: 0.6 };
export type Metrics = { time: number; trunk: number | null; arm: number | null; knee: number | null; confidence: number; activity: string; landmarks: Landmark[]; world: Landmark[] };
export type PostureAlert = { id: string; kind: "trunk" | "arm"; title: string; message: string; start: number; end: number; duration: number; peak: number; threshold: number; status: "active" | "resolved" | "tracking lost" | "session ended"; acknowledged: boolean };
export type Sample = { time: number; trunk: number | null; arm: number | null };
export type Session = { id: string; source: "video" | "webcam" | "csv"; name: string; createdAt: string; duration: number; frames: number; trackedFrames: number; alerts: PostureAlert[]; rules: Rules; samples: Sample[] };

const radToDeg = 180 / Math.PI;
function jointAngle(a: Landmark, b: Landmark, c: Landmark) {
  const u = [a.x-b.x, a.y-b.y, a.z-b.z];
  const v = [c.x-b.x, c.y-b.y, c.z-b.z];
  const size = Math.hypot(...u) * Math.hypot(...v);
  return size < 1e-8 ? null : Math.acos(Math.max(-1, Math.min(1, u.reduce((s,n,i)=>s+n*v[i],0)/size))) * radToDeg;
}

export function calculateMetrics(landmarks: Landmark[], world: Landmark[], time: number, rules: Rules): Metrics {
  const points = world.length === 33 ? world : [];
  const visible = (ids: number[]) => !!points.length && ids.every(id => (landmarks[id]?.visibility ?? 0) >= rules.confidence);
  let trunk: number | null = null;
  if (visible([11,12,23,24])) {
    const dx=(points[11].x+points[12].x-points[23].x-points[24].x)/2;
    const dy=(points[11].y+points[12].y-points[23].y-points[24].y)/2;
    const dz=(points[11].z+points[12].z-points[23].z-points[24].z)/2;
    if(Math.hypot(dx,dy,dz)>0.01) trunk=Math.atan2(Math.hypot(dx,dz), Math.abs(dy))*radToDeg;
  }
  const arms=[[23,11,13],[24,12,14]].filter(ids=>visible(ids)).map(ids=>jointAngle(points[ids[0]],points[ids[1]],points[ids[2]])).filter((x):x is number=>x!==null);
  const knees=[[23,25,27],[24,26,28]].filter(ids=>visible(ids)).map(ids=>jointAngle(points[ids[0]],points[ids[1]],points[ids[2]])).filter((x):x is number=>x!==null);
  const arm=arms.length?Math.max(...arms):null;
  const knee=knees.length?Math.min(...knees):null;
  const confidence=landmarks.length?[11,12,23,24].reduce((s,i)=>s+(landmarks[i]?.visibility??0),0)/4:0;
  const activity=trunk===null&&arm===null?"Unable to assess":trunk!==null&&trunk>rules.trunk?"Forward bending":arm!==null&&arm>rules.arm?"Raised arm":"Neutral posture";
  return {time,trunk,arm,knee,confidence,activity,landmarks,world};
}

type Track = { start: number | null; peak: number; event: PostureAlert | null };
export class AlertEngine {
  rules: Rules;
  alerts: PostureAlert[]=[];
  private tracks: Record<"trunk"|"arm",Track>={trunk:{start:null,peak:0,event:null},arm:{start:null,peak:0,event:null}};
  private previous: number | null=null;
  constructor(rules: Rules) {this.rules={...rules};}
  private close(kind:"trunk"|"arm",status:PostureAlert["status"]) {
    const tr=this.tracks[kind];
    if(tr.event) tr.event.status=status;
    this.tracks[kind]={start:null,peak:0,event:null};
  }
  update(m:Metrics) {
    const newAlerts:PostureAlert[]=[];
    if(this.previous!==null&&(m.time<=this.previous||m.time-this.previous>1.1)) {
      this.close("trunk","tracking lost");this.close("arm","tracking lost");
    }
    this.previous=m.time;
    for(const kind of ["trunk","arm"] as const) {
      const angle=m[kind],limit=this.rules[kind],tr=this.tracks[kind];
      if(angle===null) {this.close(kind,"tracking lost");continue;}
      if(angle<limit-5) {this.close(kind,"resolved");continue;}
      if(tr.start===null) {if(angle<=limit) continue;tr.start=m.time;}
      tr.peak=Math.max(tr.peak,angle);
      const duration=m.time-tr.start;
      if(!tr.event&&duration>=this.rules.hold) {
        tr.event={id:crypto.randomUUID(),kind,title:kind==="trunk"?"Sustained forward bending":"Sustained raised arm",message:kind==="trunk"?"Adjust your posture or bring the work closer.":"Lower your arm or adjust the work height.",start:tr.start,end:m.time,duration,peak:tr.peak,threshold:limit,status:"active",acknowledged:false};
        this.alerts.push(tr.event);newAlerts.push(tr.event);
      }
      if(tr.event){tr.event.end=m.time;tr.event.duration=duration;tr.event.peak=tr.peak;}
    }
    return {newAlerts,alerts:this.alerts.map(a=>({...a})),active:Object.values(this.tracks).some(t=>!!t.event),pending:Object.values(this.tracks).some(t=>t.start!==null&&!t.event)};
  }
  finish() {this.close("trunk","session ended");this.close("arm","session ended");return this.alerts.map(a=>({...a}));}
  acknowledge(id:string) {const a=this.alerts.find(a=>a.id===id);if(a)a.acknowledged=true;}
}

export function formatTime(seconds:number) {
  const n=Math.max(0,Math.floor(seconds));
  return `${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`;
}

export function parseCsv(text:string,rules:Rules):Metrics[] {
  const lines=text.replace(/^\uFEFF/,"").trim().split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2) throw new Error("The CSV needs a header and at least one data row.");
  const headers=lines[0].split(",").map(h=>h.trim().toLowerCase());
  if(["timestamp","trunk_angle","arm_angle"].some(h=>!headers.includes(h))) throw new Error("Required CSV columns: timestamp, trunk_angle, arm_angle. Timestamp must be elapsed seconds.");
  if(lines.length>100001)throw new Error("Please use a CSV with at most 100,000 rows.");
  let previous=-1;
  return lines.slice(1).map((line,i)=>{
    const cells=line.split(",").map(c=>c.trim());
    const value=(key:string,max:number,required=false)=>{
      const raw=cells[headers.indexOf(key)];
      if(raw===undefined||raw==="") {if(required) throw new Error(`Missing ${key} on row ${i+2}.`);return null;}
      const n=Number(raw);
      if(!Number.isFinite(n)||n<0||n>max)throw new Error(`Invalid ${key} on row ${i+2}.`);
      return n;
    };
    const time=value("timestamp",86400,true)!;
    if(time<=previous)throw new Error(`Timestamps must increase on row ${i+2}.`);
    previous=time;
    const trunk=value("trunk_angle",90),arm=value("arm_angle",180);
    return {time,trunk,arm,knee:null,confidence:1,activity:trunk===null&&arm===null?"Unable to assess":trunk!==null&&trunk>rules.trunk?"Forward bending":arm!==null&&arm>rules.arm?"Raised arm":"Neutral posture",landmarks:[],world:[]};
  });
}
