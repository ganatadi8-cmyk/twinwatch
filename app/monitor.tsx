"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ScanLine, Video, Upload, Camera, ShieldCheck, SlidersHorizontal, Play, Pause, Square, Download, Clock3, AlertTriangle, Check, ChevronRight, FileText, Loader2, RefreshCw, X, Monitor as MonitorIcon, Database, Eye, CircleHelp, Radio, MoveUpRight, ChartNoAxesCombined, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs,TabsList,TabsTrigger,TabsContent } from '@/components/ui/tabs';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Table,TableHeader,TableBody,TableRow,TableHead,TableCell } from '@/components/ui/table';
import { Toaster,toast } from 'sonner';
import { PoseClient } from '@/lib/pose-client';
import { AlertEngine,DEFAULT_RULES,calculateMetrics,parseCsv,formatTime } from '@/lib/posture';
import type { Metrics,Rules,PostureAlert,Session,Sample,Landmark } from '@/lib/posture';
import TwinView from './twin-view';
import PostureChart from './posture-chart';

type Status='idle'|'ready'|'loading'|'running'|'paused'|'finished';
type Mode='video'|'webcam'|'csv';
const connections=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32]];
const emptyMetrics:Metrics={time:0,trunk:null,arm:null,knee:null,confidence:0,activity:'No session',landmarks:[],world:[]};
function download(name:string,content:string,mime='text/csv'){
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csvCell(value:unknown){return '"'+String(value).replaceAll('"','""')+'"';}
function exportReport(s:Session){
  const lines=['session,source,started_at,event,start_seconds,end_seconds,duration_seconds,peak_angle,threshold_angle,status,acknowledged'];
  for(const a of s.alerts)lines.push([s.name,s.source,s.createdAt,a.title,a.start.toFixed(2),a.end.toFixed(2),a.duration.toFixed(2),a.peak.toFixed(1),a.threshold,a.status,a.acknowledged].map(csvCell).join(','));
  if(!s.alerts.length)lines.push([s.name,s.source,s.createdAt,'No sustained posture alerts',0,s.duration.toFixed(2),s.duration.toFixed(2),'','','completed',false].map(csvCell).join(','));
  download(`twinwatch-${s.id.slice(0,8)}.csv`,lines.join('\n'));
}

export default function Monitor(){
  const [tab,setTab]=useState('monitor');
  const [mode,setMode]=useState<Mode>('video');
  const [status,setStatus]=useState<Status>('idle');
  const [file,setFile]=useState<File|null>(null);
  const [videoUrl,setVideoUrl]=useState('');
  const [videoDuration,setVideoDuration]=useState(0);
  const [metrics,setMetrics]=useState<Metrics>(emptyMetrics);
  const [alerts,setAlerts]=useState<PostureAlert[]>([]);
  const [samples,setSamples]=useState<Sample[]>([]);
  const [risk,setRisk]=useState<'idle'|'unknown'|'neutral'|'pending'|'alert'>('idle');
  const [rules,setRules]=useState<Rules>(DEFAULT_RULES);
  const [settings,setSettings]=useState(false);
  const [overlay,setOverlay]=useState(true);
  const [sound,setSound]=useState(false);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState('');
  const [saved,setSaved]=useState(false);
  const [sessions,setSessions]=useState<Session[]>([]);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyError,setHistoryError]=useState('');
  const [selected,setSelected]=useState<Session|null>(null);
  const [isDragging,setIsDragging]=useState(false);
  const [loadingText,setLoadingText]=useState('Loading the posture model…');
  const [frames,setFrames]=useState(0);
  const video=useRef<HTMLVideoElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const cameraStream=useRef<MediaStream|null>(null);
  const model=useRef<PoseClient|null>(null);
  const engine=useRef<AlertEngine|null>(null);
  const session=useRef<Session|null>(null);
  const running=useRef(false);
  const initializing=useRef(false);
  const generation=useRef(0);
  const loopTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const csvRows=useRef<Metrics[]>([]);
  const csvCursor=useRef(0);
  const modeRef=useRef(mode);modeRef.current=mode;
  const settingsRef=useRef({rules,overlay,sound});settingsRef.current={rules,overlay,sound};
  const audio=useRef<AudioContext|null>(null);
  const finishRef=useRef<()=>void>(()=>{});
  const callbackRef=useRef<(m:Metrics)=>void>(()=>{});

  const loadHistory=useCallback(async()=>{
    setHistoryLoading(true);setHistoryError('');
    try{const r=await fetch('/api/sessions');const data=await r.json() as {error?:string;sessions?:Session[]};if(!r.ok)throw new Error(data.error||'Could not load sessions.');setSessions(data.sessions??[]);}
    catch(e){setHistoryError(e instanceof Error?e.message:'Could not load sessions.');}
    finally{setHistoryLoading(false);}
  },[]);
  useEffect(()=>{void loadHistory();return()=>{running.current=false;generation.current++;if(loopTimer.current)clearTimeout(loopTimer.current);model.current?.close();cameraStream.current?.getTracks().forEach(t=>t.stop());audio.current?.close();};},[loadHistory]);
  useEffect(()=>()=>{if(videoUrl)URL.revokeObjectURL(videoUrl);},[videoUrl]);

  function beep(){
    if(!settingsRef.current.sound||!audio.current)return;
    try{const ctx=audio.current;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=720;gain.gain.setValueAtTime(.08,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.25);osc.start();osc.stop(ctx.currentTime+.25);}catch{}
  }
  function drawPose(landmarks:Landmark[],warning:boolean){
    const c=canvas.current,v=video.current;if(!c||!v)return;
    if(c.width!==v.videoWidth||c.height!==v.videoHeight){c.width=v.videoWidth||640;c.height=v.videoHeight||480;}
    const ctx=c.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,c.width,c.height);
    if(!settingsRef.current.overlay)return;
    ctx.strokeStyle=warning?'#ffb46e':'#aff38c';ctx.fillStyle=warning?'#ffb46e':'#aff38c';ctx.lineWidth=Math.max(2,c.width/300);
    for(const [a,b] of connections){if((landmarks[a]?.visibility??0)<.5||(landmarks[b]?.visibility??0)<.5)continue;ctx.beginPath();ctx.moveTo(landmarks[a].x*c.width,landmarks[a].y*c.height);ctx.lineTo(landmarks[b].x*c.width,landmarks[b].y*c.height);ctx.stroke();}
    landmarks.forEach((p,i)=>{if(i<11||(p.visibility??0)<.5)return;ctx.beginPath();ctx.arc(p.x*c.width,p.y*c.height,Math.max(3,c.width/180),0,Math.PI*2);ctx.fill();});
  }
  callbackRef.current=(m:Metrics)=>{
    if(!session.current||!engine.current)return;
    const result=engine.current.update(m);
    session.current.duration=m.time;session.current.frames++;
    if(m.trunk!==null||m.arm!==null)session.current.trackedFrames++;
    session.current.alerts=result.alerts;
    const points=session.current.samples;
    if(!points.length||m.time-points[points.length-1].time>=.5){points.push({time:m.time,trunk:m.trunk,arm:m.arm});if(points.length>600)session.current.samples=points.filter((_,i)=>i%2===0);setSamples([...session.current.samples]);}
    setMetrics(m);setFrames(session.current.frames);setAlerts(result.alerts);
    setRisk(m.trunk===null&&m.arm===null?'unknown':result.active?'alert':result.pending?'pending':'neutral');
    drawPose(m.landmarks,result.active);
    if(result.newAlerts.length){beep();result.newAlerts.forEach(a=>toast.warning(a.title,{description:a.message,duration:4500}));}
  };

  async function saveSession(s:Session){
    setSaving(true);setSaveError('');setSaved(false);
    try{const r=await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});const data=await r.json() as {error?:string};if(!r.ok)throw new Error(data.error||'Could not save the session.');setSaved(true);void loadHistory();}
    catch(e){setSaveError(e instanceof Error?e.message:'Could not save the session.');}
    finally{setSaving(false);}
  }
  function release(){
    running.current=false;initializing.current=false;generation.current++;
    if(loopTimer.current)clearTimeout(loopTimer.current);
    video.current?.pause();model.current?.close();model.current=null;
    cameraStream.current?.getTracks().forEach(t=>t.stop());cameraStream.current=null;
    if(video.current)video.current.srcObject=null;
  }
  function finish(){
    release();
    if(session.current&&engine.current){session.current.alerts=engine.current.finish();setAlerts([...session.current.alerts]);if(session.current.frames)void saveSession({...session.current});}
    setStatus('finished');
  }
  finishRef.current=finish;
  function resetView(){
    setMetrics(emptyMetrics);setAlerts([]);setSamples([]);setRisk('idle');setFrames(0);setSaved(false);setSaveError('');session.current=null;engine.current=null;
    const c=canvas.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);
  }
  function changeMode(next:Mode){
    if(next===mode)return;
    if(session.current&&session.current.frames&&status!=='finished')finish();else release();
    resetView();setError('');setFile(null);setVideoUrl('');setVideoDuration(0);csvRows.current=[];setStatus('idle');setMode(next);
  }
  async function chooseFile(next:File){
    if(running.current||initializing.current||saving)return;
    setError('');release();resetView();
    const isCsv=next.name.toLowerCase().endsWith('.csv');
    if(isCsv){
      if(next.size>10*1024*1024){setError('Please use a CSV smaller than 10 MB.');return;}
      try{csvRows.current=parseCsv(await next.text(),settingsRef.current.rules);setMode('csv');setFile(next);setVideoUrl('');setVideoDuration(csvRows.current.at(-1)?.time??0);setStatus('ready');}
      catch(e){setStatus('idle');setFile(null);setError(e instanceof Error?e.message:'Could not read the CSV.');}
      return;
    }
    if(!next.type.startsWith('video/')&&!/\.(mp4|webm|mov|m4v)$/i.test(next.name)){setError('Choose an MP4, WebM, browser-supported MOV, or CSV file.');return;}
    if(next.size>500*1024*1024){setError('Please use a video smaller than 500 MB.');return;}
    setMode('video');setFile(next);setVideoDuration(0);setVideoUrl(URL.createObjectURL(next));setStatus('ready');
  }
  function beginSession(){
    const r={...settingsRef.current.rules};engine.current=new AlertEngine(r);
    session.current={id:crypto.randomUUID(),source:modeRef.current,name:file?.name??'Live webcam session',createdAt:new Date().toISOString(),duration:0,frames:0,trackedFrames:0,alerts:[],rules:r,samples:[]};
    setMetrics(emptyMetrics);setAlerts([]);setSamples([]);setRisk('unknown');setFrames(0);setSaved(false);setSaveError('');
  }
  async function runFrame(){
    const token=generation.current;
    if(!running.current)return;
    const start=performance.now();
    try{
      if(modeRef.current==='csv'){
        const row=csvRows.current[csvCursor.current++];
        if(!row){finishRef.current();return;}callbackRef.current(row);
        // Replay CSV by source timestamps, with an upper bound for long empty gaps.
        const next=csvRows.current[csvCursor.current];
        if(!next){finishRef.current();return;}
        loopTimer.current=setTimeout(()=>void runFrame(),Math.min(1000,Math.max(50,(next.time-row.time)*1000)));return;
      }
      const v=video.current;if(!v||!model.current)return;
      if(v.ended){finishRef.current();return;}
      if(v.readyState>=2&&!v.paused){
        const time=v.currentTime;
        const result=await model.current.detect(v);
        if(!running.current||token!==generation.current)return;
        callbackRef.current(calculateMetrics(result.landmarks,result.world,time,session.current!.rules));
      }
      if(running.current)loopTimer.current=setTimeout(()=>void runFrame(),Math.max(0,125-(performance.now()-start)));
    }catch(e){
      if(!running.current||token!==generation.current)return;
      setError(e instanceof Error?e.message:'Analysis stopped. Please try again.');finishRef.current();
    }
  }
  async function start(){
    if(initializing.current||running.current||saving)return;
    const continuing=status==='paused';setError('');
    if(sound){try{audio.current??=new AudioContext();void audio.current.resume();}catch{}}
    if(continuing){
      try{if(mode!=='csv')await video.current?.play();running.current=true;setStatus('running');void runFrame();}catch{setError('Playback could not resume. Please start again.');}return;
    }
    if(mode!=='webcam'&&!file){input.current?.click();return;}
    initializing.current=true;const token=++generation.current;setStatus('loading');
    try{
      beginSession();
      if(mode==='csv'){
        csvRows.current=parseCsv(await file!.text(),session.current!.rules);csvCursor.current=0;
      }else{
        if(mode==='webcam'){
          setLoadingText('Waiting for camera permission…');
          if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access is unavailable here. Open this page in a browser tab, or upload a video.');
          const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});
          if(token!==generation.current){stream.getTracks().forEach(t=>t.stop());return;}
          cameraStream.current=stream;video.current!.srcObject=stream;
          await video.current!.play();
        }else{
          const v=video.current!;if(v.readyState<1)throw new Error('The video is still loading or its codec is unsupported. Please wait or choose an MP4 video.');v.currentTime=0;
        }
        setLoadingText('Preparing the posture model…');
        const client=new PoseClient();model.current=client;await client.init();
        if(token!==generation.current){client.close();return;}
        await video.current!.play();
      }
      if(token!==generation.current)return;
      initializing.current=false;running.current=true;setStatus('running');void runFrame();
    }catch(e){
      if(token!==generation.current)return;
      const name=e instanceof Error?e.name:'';
      setError(name==='NotAllowedError'?'Camera access was blocked. Allow camera permission or open this page in its own browser tab.':name==='NotFoundError'?'No camera was found. Connect a webcam or upload a video.':e instanceof Error?e.message:'Could not start analysis.');release();setStatus(file?'ready':'idle');
    }
  }
  function pause(){
    running.current=false;generation.current++;if(loopTimer.current)clearTimeout(loopTimer.current);video.current?.pause();setStatus('paused');setRisk('idle');
  }
  function acknowledge(id:string){engine.current?.acknowledge(id);setAlerts(prev=>prev.map(a=>a.id===id?{...a,acknowledged:true}:a));if(session.current)session.current.alerts=session.current.alerts.map(a=>a.id===id?{...a,acknowledged:true}:a);if(status==='finished'&&session.current)void saveSession({...session.current});}

  const readback=useRef({status,mode,metrics,alerts,rules});readback.current={status,mode,metrics,alerts,rules};
  useEffect(()=>{
    const context=(document as unknown as {modelContext?:{registerTool:(tool:unknown,options:unknown)=>Promise<void>|void}}).modelContext;if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    const tools=[{
      name:'read_posture_session',description:'Read the visible TwinWatch session, current posture measurements, alert events and configured thresholds.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>{const s=readback.current;return {mode:s.mode,status:s.status,time:s.metrics.time,trunk:s.metrics.trunk,arm:s.metrics.arm,activity:s.metrics.activity,alerts:s.alerts,rules:s.rules};}
    },{
      name:'configure_posture_rules',description:'Set the same posture rules shown in Settings before starting a session. Does not start a camera or analysis.',inputSchema:{type:'object',properties:{trunk:{type:'number',minimum:10,maximum:80},arm:{type:'number',minimum:45,maximum:160},hold:{type:'number',minimum:1,maximum:20}},additionalProperties:false},annotations:{readOnlyHint:false},execute:(input:unknown)=>{
        if(running.current||initializing.current||readback.current.status==='paused')throw new Error('Finish the current session before changing rules.');
        if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('An object is required.');const values=input as Record<string,unknown>;
        const limits:Record<string,[number,number]>={trunk:[10,80],arm:[45,160],hold:[1,20]};
        for(const [key,value]of Object.entries(values)){if(!limits[key]||typeof value!=='number'||!Number.isFinite(value)||value<limits[key][0]||value>limits[key][1])throw new Error('Invalid threshold.');}
        const next={...readback.current.rules,...values} as Rules;settingsRef.current.rules=next;readback.current.rules=next;setRules(next);return {rules:next};
      }
    }];
    tools.forEach(tool=>{try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}});
    return()=>lifecycle.abort();
  },[]);

  const active=status==='running'||status==='paused'||status==='loading';
  const riskText={idle:status==='finished'?'Session complete':'Awaiting session',unknown:'Unable to assess',neutral:'Below configured thresholds',pending:'Posture duration building',alert:'Posture alert'}[risk];
  const progress=videoDuration>0?Math.min(100,metrics.time/videoDuration*100):0;
  const activeAlerts=alerts.filter(a=>a.status==='active').length;

  return <div className="app-shell"><Toaster position="top-right" richColors closeButton/>
    <header className="topbar"><a href="/" className="brand"><span className="brand-mark"><ScanLine size={23}/></span><span>Twin<span className="brand-light">Watch</span><small>HUMAN DIGITAL TWIN</small></span></a><div className="topbar-right"><span className="privacy-label"><ShieldCheck size={15}/> Video stays on your device</span><span className="project-badge">Industry 5.0</span><span className="profile">GT</span></div></header>
    <Tabs value={tab} onValueChange={setTab} className="workspace-tabs"><div className="nav-wrap"><TabsList variant="line" className="nav-tabs"><TabsTrigger value="monitor"><MonitorIcon/> Monitor</TabsTrigger><TabsTrigger value="sessions"><Clock3/> Sessions</TabsTrigger><TabsTrigger value="guide"><CircleHelp/> Project guide</TabsTrigger></TabsList><span className="nav-note">AI + COMPUTER VISION</span></div>
      <TabsContent value="monitor" forceMount className="main-content persistent-tab">
        <div className="page-heading"><div><p className="eyebrow">WORKSPACE <span>/</span> POSTURE MONITORING</p><h1>Your worker. In sync.</h1><p className="page-intro">Turn movement into a live digital twin and clear posture alerts.</p></div><Button variant="outline" className="settings-button" onClick={()=>setSettings(true)}><SlidersHorizontal size={16}/> Alert settings</Button></div>
        <div className="source-toolbar"><Tabs value={mode} onValueChange={v=>changeMode(v as Mode)}><TabsList className="source-tabs"><TabsTrigger value="video" disabled={saving||status==='loading'}><Upload/> Upload video</TabsTrigger><TabsTrigger value="webcam" disabled={saving||status==='loading'}><Camera/> Live webcam</TabsTrigger><TabsTrigger value="csv" disabled={saving||status==='loading'}><Database/> CSV data</TabsTrigger></TabsList></Tabs><div className="toolbar-meta"><span className="prototype-tag">Research prototype</span><span className="status-pill"><i className={status==='running'?'live-dot':''}/>{status==='running'?'Analysis running':status==='loading'?'Preparing analysis':'Ready when you are'}</span></div></div>
        {error&&<div className="error-banner" role="alert"><AlertTriangle size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={17}/></button>{mode==='webcam'&&<a href="/" target="_blank" rel="noreferrer">Open in a new tab</a>}</div>}
        <input ref={input} type="file" accept={mode==='csv'?'.csv':'video/mp4,video/webm,video/quicktime,video/x-m4v,.csv'} className="sr-only" aria-label="Choose a worker video or posture CSV" onChange={e=>{const f=e.target.files?.[0];if(f)void chooseFile(f);e.target.value='';}}/>
        <div className="monitor-grid">
          <section className="stream-panel panel"><div className="panel-heading"><div className="panel-title"><Video size={17}/><h2>{mode==='webcam'?'Live camera':mode==='csv'?'Dataset playback':'Video analysis'}</h2></div><span className="mini-label">{mode==='webcam'?'LIVE INPUT':mode==='csv'?'TIMESTAMPED DATA':'LOCAL FILE'}</span></div>
            <div className={`video-stage ${isDragging?'dragging':''} ${videoUrl||cameraStream.current?'has-video':''}`} onDragOver={e=>{e.preventDefault();if(!active)setIsDragging(true);}} onDragLeave={()=>setIsDragging(false)} onDrop={e=>{e.preventDefault();setIsDragging(false);const f=e.dataTransfer.files[0];if(f&&!active)void chooseFile(f);}}>
              <video ref={video} src={videoUrl||undefined} className="source-video" muted playsInline preload="metadata" onLoadedMetadata={()=>{if(modeRef.current==='video'){const d=video.current?.duration??0;if(!Number.isFinite(d)||d>86400){setError('Use a video shorter than 24 hours.');setStatus('idle');return;}setVideoDuration(d);}}} onEnded={()=>{if(running.current)finishRef.current();}} onError={()=>{if(modeRef.current!=='csv'){setError('This video could not be decoded. Try an MP4 with H.264 encoding or WebM.');if(running.current)finishRef.current();}}}/>
              <canvas ref={canvas} className="pose-overlay" aria-hidden="true"/>
              <span className="frame-corner tl"/><span className="frame-corner tr"/><span className="frame-corner bl"/><span className="frame-corner br"/>
              {!videoUrl&&!cameraStream.current&&mode!=='csv'&&<div className="input-empty"><div className="input-symbol">{mode==='webcam'?<Camera size={36}/>:<ScanLine size={40}/>}</div><h3>{mode==='webcam'?'See movement as it happens':'Start with a worker video'}</h3><p>{mode==='webcam'?'Allow your camera, then step back so your body is visible.':'Drop a video here, or choose one from your device.'}</p><Button onClick={()=>mode==='webcam'?void start():input.current?.click()} disabled={status==='loading'} className="lime-button">{mode==='webcam'?<Camera size={17}/>:<Upload size={17}/>} {mode==='webcam'?'Start webcam':'Choose video'}</Button><span className="input-formats">{mode==='webcam'?'Camera only · No audio recorded':'MP4, WebM, MOV · Up to 500 MB'}</span></div>}
              {mode==='csv'&&<div className="input-empty csv-empty"><div className="input-symbol"><Database size={35}/></div><h3>{file?file.name:'Already have posture data?'}</h3><p>{file?`${csvRows.current.length.toLocaleString()} rows ready. Alerts use your data timestamps.`:'Upload measured angles and replay the same alert rules.'}</p>{file?<div className="csv-reading"><span>{metrics.trunk===null?'—':Math.round(metrics.trunk)+'°'}<small>TRUNK</small></span><span>{metrics.arm===null?'—':Math.round(metrics.arm)+'°'}<small>ARM</small></span></div>:<Button className="lime-button" onClick={()=>input.current?.click()}><Upload size={17}/> Choose CSV</Button>}<a href="/sample-posture.csv" download className="sample-link">Example CSV (simulated) <Download size={13}/></a><span className="input-formats">timestamp, trunk_angle, arm_angle · Seconds and degrees</span></div>}
              {status==='loading'&&<div className="model-loading"><Loader2 className="spin" size={29}/><strong>{loadingText}</strong><span>The first analysis may take a few moments.</span><Button variant="outline" onClick={()=>{release();setStatus(file?'ready':'idle');}}>Cancel</Button></div>}
              {(videoUrl||cameraStream.current)&&<><div className="video-top-label"><span className={status==='running'?'running-badge':''}>{status==='running'&&<Radio size={13}/>} {status==='running'?'TRACKING':status==='paused'?'PAUSED':status==='finished'?'COMPLETE':'PREVIEW'}</span><span>WORKER 01</span></div><div className="video-bottom-label"><span><ScanLine size={14}/> {status==='running'?metrics.activity:'Full body visibility recommended'}</span><span className="mono">{formatTime(metrics.time)}</span></div></>}
            </div>
            <div className="stream-footer"><div className="file-meta"><span className="file-icon">{mode==='webcam'?<Camera size={17}/>:<FileText size={17}/>}</span><div><strong>{mode==='webcam'?'Webcam session':file?.name??(mode==='csv'?'No dataset selected':'No video selected')}</strong><span>{mode==='webcam'?'Live, on-device analysis':file?`${(file.size/1024/1024).toFixed(1)} MB · ${formatTime(videoDuration)}`:'Your source stays private'}</span></div></div><div className="playback-buttons">{(file||mode==='webcam')&&<>{status==='running'?<Button variant="outline" onClick={pause} aria-label="Pause analysis"><Pause size={16}/><span>Pause</span></Button>:<Button onClick={()=>void start()} disabled={status==='loading'||saving} className="dark-button">{status==='loading'?<Loader2 className="spin" size={16}/>:<Play size={16}/>}<span>{status==='paused'?'Resume':status==='finished'?'Analyse again':mode==='webcam'?'Start camera':'Analyse'}</span></Button>}{active&&<Button variant="outline" onClick={finish} disabled={status==='loading'} aria-label="Finish and save session"><Square size={15}/></Button>}{file&&!active&&<Button variant="ghost" aria-label="Choose another file" onClick={()=>input.current?.click()}><Upload size={16}/></Button>}</>}</div></div>
            {file&&<div className="playback-progress"><Progress value={progress} aria-label="Analysis progress"/><span>{formatTime(metrics.time)} / {formatTime(videoDuration)}</span></div>}
          </section>
          <section className="twin-panel panel"><div className="panel-heading"><div className="panel-title"><Activity size={17}/><h2>Worker twin</h2></div><span className="mini-label">3D SKELETON</span></div><TwinView world={metrics.world} warning={risk==='alert'}/><div className="twin-info"><div className="twin-worker"><span className="worker-chip">01</span><div><strong>Worker 01</strong><span>{mode==='csv'?'Imported angle measurements':'Pose-derived digital model'}</span></div><span className={`twin-state ${status==='running'&&metrics.world.length?'connected':''}`}>{status==='running'&&metrics.world.length?'Synced':'Standby'}</span></div><div className={`risk-banner risk-${risk}`} role="status">{risk==='alert'||risk==='pending'?<AlertTriangle size={16}/>:risk==='neutral'?<CheckCircle2 size={16}/>:<Eye size={16}/>}<span>{riskText}</span></div><div className="twin-details"><div><span>Current observation</span><strong>{metrics.activity}</strong></div><div><span>{mode==='csv'?'Measurement source':'Landmark visibility'}</span><strong>{mode==='csv'?'Imported CSV':metrics.landmarks.length?`${Math.round(metrics.confidence*100)}%`:'—'}</strong></div></div><p className="measurement-note">{mode==='csv'?'CSV angles drive alerts. A 3D pose requires video landmarks.':'Estimated movement, with low-visibility joints excluded.'}</p></div></section>
        </div>
        <div className="metrics-grid"><Metric icon={<MoveUpRight size={18}/>} label="Trunk lean" value={metrics.trunk} unit="°" note={`Alert above ${rules.trunk}° for ${rules.hold}s`} warning={metrics.trunk!==null&&metrics.trunk>rules.trunk}/><Metric icon={<Activity size={18}/>} label="Arm elevation" value={metrics.arm} unit="°" note={`Alert above ${rules.arm}° for ${rules.hold}s`} warning={metrics.arm!==null&&metrics.arm>rules.arm}/><Metric icon={<Clock3 size={18}/>} label="Session time" text={formatTime(metrics.time)} note={`${frames.toLocaleString()} samples processed`}/><Metric icon={<AlertTriangle size={18}/>} label="Posture alerts" text={String(alerts.length)} note={activeAlerts?`${activeAlerts} currently active`:'Explained, timestamped events'} warning={activeAlerts>0}/></div>
        <div className="insights-grid"><section className="panel trends-panel"><div className="panel-heading"><div className="panel-title"><ChartNoAxesCombined size={17}/><h2>Movement over time</h2></div><div className="chart-legend"><span><i/> Trunk</span><span><i/> Arm</span></div></div><PostureChart samples={samples} rules={rules}/><div className="chart-footnote">Dashed line: trunk alert threshold. Gaps mean unavailable measurements.</div></section><section className="panel alerts-panel"><div className="panel-heading"><div className="panel-title"><AlertTriangle size={17}/><h2>Alert timeline <span className="count-badge">{alerts.length}</span></h2></div><Button variant="ghost" size="sm" disabled={!session.current||!frames} onClick={()=>session.current&&exportReport(session.current)}><Download size={14}/> Export</Button></div><div className="alert-list" aria-live="polite">{!alerts.length?<div className="alerts-empty"><span><ShieldCheck size={26}/></span><strong>{status==='running'?'Monitoring your posture':'A clear record of every alert'}</strong><p>{status==='running'?'Sustained threshold crossings will appear here.':'Start an analysis to see events and recommendations.'}</p></div>:[...alerts].reverse().map(a=><AlertRow key={a.id} alert={a} onAcknowledge={()=>acknowledge(a.id)}/>)}</div></section></div>
        {(saving||saved||saveError)&&<div className={`save-banner ${saveError?'save-failed':''}`} role="status">{saving?<Loader2 className="spin" size={16}/>:saveError?<AlertTriangle size={16}/>:<CheckCircle2 size={16}/>}<span>{saving?'Saving session summary…':saveError||'Session saved. View it in Sessions.'}</span>{saveError&&<Button size="sm" variant="outline" onClick={()=>session.current&&void saveSession(session.current)}>Retry save</Button>}</div>}
        <div className="research-note"><ShieldCheck size={16}/><p>Prototype posture indicators. These rules are configurable and are not a validated RULA / REBA assessment. Heart rate and mental fatigue are not measured.</p></div>
      </TabsContent>
      <TabsContent value="sessions" className="main-content"><div className="page-heading"><div><p className="eyebrow">WORKSPACE <span>/</span> SESSION HISTORY</p><h1>Every session, in perspective.</h1><p className="page-intro">Private reports for this browser. Clearing cookies starts a new workspace. Your footage is never stored.</p></div><Button variant="outline" onClick={()=>void loadHistory()} disabled={historyLoading}><RefreshCw size={16} className={historyLoading?'spin':''}/> Refresh</Button></div>
        {historyError&&<div className="error-banner"><AlertTriangle size={18}/><span>{historyError}</span><Button variant="outline" size="sm" onClick={()=>void loadHistory()}>Try again</Button></div>}
        <div className="panel history-panel">{historyLoading?<div className="history-empty"><Loader2 className="spin" size={28}/><h3>Loading saved sessions</h3></div>:!sessions.length?<div className="history-empty"><Clock3 size={36}/><h3>Your history starts with one session</h3><p>Finish a video, webcam or CSV analysis to save its results here.</p><Button className="dark-button" onClick={()=>setTab('monitor')}>Start monitoring</Button></div>:<Table><TableHeader><TableRow><TableHead>Session</TableHead><TableHead>Source</TableHead><TableHead>Duration</TableHead><TableHead>Visibility coverage</TableHead><TableHead>Alerts</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{sessions.map(s=><TableRow key={s.id}><TableCell><button className="session-name" onClick={()=>setSelected(s)}>{s.name}<span>{new Date(s.createdAt).toLocaleString()}</span></button></TableCell><TableCell><span className="source-badge">{s.source==='webcam'?'Webcam':s.source==='csv'?'CSV':'Video'}</span></TableCell><TableCell className="mono">{formatTime(s.duration)}</TableCell><TableCell>{s.frames?Math.round(s.trackedFrames/s.frames*100):0}%</TableCell><TableCell><span className={s.alerts.length?'alert-total':'neutral-total'}>{s.alerts.length}</span></TableCell><TableCell><div className="history-actions"><Button variant="ghost" size="icon" aria-label={`Download ${s.name} report`} onClick={()=>exportReport(s)}><Download size={17}/></Button><Button variant="ghost" size="icon" aria-label={`View ${s.name}`} onClick={()=>setSelected(s)}><ChevronRight size={17}/></Button></div></TableCell></TableRow>)}</TableBody></Table>}</div></TabsContent>
      <TabsContent value="guide" className="main-content guide-content"><div className="page-heading"><div><p className="eyebrow">HUMAN DIGITAL TWINS <span>/</span> INDUSTRY 5.0</p><h1>From movement to feedback.</h1><p className="page-intro">A software implementation of your term paper.</p></div></div><div className="guide-grid">{[
        ['01','Choose a source','Upload a worker video, allow a live webcam, or import a CSV of measured posture angles. Keep the upper body and hips clearly visible.'],
        ['02','Build the worker state','A pretrained pose model detects body joints. The application estimates trunk lean and arm elevation and updates a live skeletal twin.'],
        ['03','Detect sustained posture','A configurable angle must persist for the selected duration. Brief movements do not trigger an alert. A 5° recovery margin reduces repeated alerts near the boundary.'],
        ['04','Review and respond','Each alert includes its source timestamp, peak angle, duration and recommendation. Acknowledge it, export the report, or review the saved session.'],
      ].map(([n,title,description])=><article className="panel guide-card" key={n}><span className="step-number">{n}</span><h2>{title}</h2><p>{description}</p></article>)}</div><div className="panel guide-details"><h2>What this project measures</h2><p>Trunk lean and arm elevation are estimates from inferred 3D body landmarks. Camera angle, occlusion and lighting affect them. Landmark visibility is a tracking signal, not a claim of measurement accuracy. CSV values come from your dataset and do not generate a 3D skeleton.</p><h2>What remains unavailable</h2><p>Heart rate, brain activity, mental fatigue, clinical health status and actual robot control are not measured. The prototype provides posture feedback and requires evaluation before workplace use.</p><h2>Technology</h2><div className="tech-chips">{['React + TypeScript','MediaPipe Pose','Web Workers + WebAssembly','Three.js','Recharts','Neon PostgreSQL'].map(t=><span key={t}>{t}</span>)}</div><h2>CSV format</h2><p>Use strictly increasing elapsed seconds and angles in degrees. Empty angle cells mean unavailable data. Samples should be no more than one second apart to establish a sustained event. The example contains simulated angles and is labelled as demonstration data.</p><pre>timestamp,trunk_angle,arm_angle{'\n'}0.0,12,25{'\n'}0.5,45,30{'\n'}1.0,46,32</pre><a href="/sample-posture.csv" download className="text-link"><Download size={16}/> Download demonstration data</a></div></TabsContent>
    </Tabs>
    <footer className="app-footer"><span><span className="footer-mark">TW</span> TwinWatch</span><span>Human Digital Twins in Industry 5.0 <span className="footer-divider">/</span> Gana Tadi</span><span>SOFTWARE PROTOTYPE</span></footer>
    <Dialog open={settings} onOpenChange={setSettings}><DialogContent className="settings-dialog"><DialogHeader><p className="eyebrow">MONITORING RULES</p><DialogTitle>Make alerts fit the task.</DialogTitle><DialogDescription>Prototype thresholds for sustained posture. Finish your session before changing them.</DialogDescription></DialogHeader><div className="settings-fields">{[
      {key:'trunk',label:'Trunk lean threshold',min:10,max:80,step:5,unit:'°',description:'Estimated deviation of the torso from vertical.'},
      {key:'arm',label:'Arm elevation threshold',min:45,max:160,step:5,unit:'°',description:'Upper arm angle relative to the torso.'},
      {key:'hold',label:'Minimum posture duration',min:1,max:20,step:1,unit:'s',description:'How long a posture must persist before an alert.'},
      {key:'confidence',label:'Minimum landmark visibility',min:.3,max:.95,step:.05,unit:'%',description:'Exclude joints with uncertain visibility.'},
    ].map(f=><div className="setting-field" key={f.key}><div><label id={`label-${f.key}`}>{f.label}</label><strong>{f.key==='confidence'?Math.round(rules.confidence*100):rules[f.key as keyof Rules]}{f.unit}</strong></div><Slider aria-labelledby={`label-${f.key}`} min={f.min} max={f.max} step={f.step} value={[rules[f.key as keyof Rules]]} disabled={active} onValueChange={v=>setRules(r=>({...r,[f.key]:v[0]}))}/><p>{f.description}</p></div>)}</div><div className="switch-row"><div><strong>Skeleton overlay</strong><span>Show detected joints on the video.</span></div><Switch checked={overlay} onCheckedChange={setOverlay} aria-label="Show skeleton overlay"/></div><div className="switch-row"><div><strong>Alert sound</strong><span>Play a short tone when a new alert appears.</span></div><Switch checked={sound} onCheckedChange={setSound} aria-label="Enable alert sound"/></div><div className="dialog-buttons"><Button variant="outline" disabled={active} onClick={()=>setRules(DEFAULT_RULES)}>Reset defaults</Button><Button className="dark-button" onClick={()=>setSettings(false)}>Done</Button></div></DialogContent></Dialog>
    <Dialog open={!!selected} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent className="report-dialog"><DialogHeader><p className="eyebrow">SESSION REPORT</p><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{selected?new Date(selected.createdAt).toLocaleString():''}</DialogDescription></DialogHeader>{selected&&<><div className="report-stats"><div><span>Duration</span><strong>{formatTime(selected.duration)}</strong></div><div><span>Alerts</span><strong>{selected.alerts.length}</strong></div><div><span>Processed samples</span><strong>{selected.frames}</strong></div></div><PostureChart samples={selected.samples} rules={selected.rules}/><div className="report-alerts">{selected.alerts.length?selected.alerts.map(a=><AlertRow key={a.id} alert={a}/>):<p>No sustained posture alerts in this session.</p>}</div><Button className="dark-button" onClick={()=>exportReport(selected)}><Download size={16}/> Download report</Button></>}</DialogContent></Dialog>
  </div>;
}

function Metric({icon,label,value,unit,text,note,warning}:{icon:React.ReactNode;label:string;value?:number|null;unit?:string;text?:string;note:string;warning?:boolean}){
  return <div className={`metric-card panel ${warning?'metric-warning':''}`}><div className="metric-label"><span>{label}</span>{icon}</div><div className="metric-value">{text??(value===null||value===undefined?'—':Math.round(value))}<span>{text||value===null?'':unit}</span></div><p>{note}</p></div>;
}
function AlertRow({alert:a,onAcknowledge}:{alert:PostureAlert;onAcknowledge?:()=>void}){
  return <div className={`alert-row ${a.status==='active'?'active-alert':''}`}><span className="alert-icon"><AlertTriangle size={17}/></span><div className="alert-content"><div><strong>{a.title}</strong><span className="mono">{formatTime(a.start)}</span></div><p>{a.message}</p><div className="alert-details"><span>{a.duration.toFixed(1)}s</span><span>Peak {a.peak.toFixed(0)}°</span><span>{a.status}</span></div>{onAcknowledge&&!a.acknowledged?<button className="acknowledge" onClick={onAcknowledge}><Check size={13}/> Acknowledge</button>:a.acknowledged?<span className="acknowledged"><CheckCircle2 size={13}/> Acknowledged</span>:null}</div></div>;
}
