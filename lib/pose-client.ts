import type { Landmark } from './posture';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

export class PoseClient {
  private worker: Worker | null=null;
  private detector: PoseLandmarker | null=null;
  private count=0;
  private stamp=0;
  private stopped=false;
  private cancelInit:(()=>void)|null=null;
  private pending = new Map<number,{resolve:(r:{landmarks:Landmark[];world:Landmark[]})=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  async init() {
    this.stopped=false;
    if(typeof OffscreenCanvas!=='undefined'&&typeof createImageBitmap!=='undefined') {
      try {
        const worker=this.worker=new Worker('/pose-worker.js');
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Worker initialization timed out.')),30000);
          this.cancelInit=()=>{clearTimeout(timer);reject(new Error('Session ended.'));};
          worker.onerror=()=>{clearTimeout(timer);reject(new Error('The analysis worker could not start.'));};
          worker.onmessage=({data})=>{
            if(data.type==='ready'){clearTimeout(timer);resolve();}
            else if(data.type==='error'){clearTimeout(timer);reject(new Error(data.message));}
          };
          worker.postMessage({type:'init'});
        });
        worker.onerror=()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('The analysis worker stopped. Please restart the session.'));}this.pending.clear();};
        worker.onmessage=({data})=>{
          const p=this.pending.get(data.id);if(!p)return;
          clearTimeout(p.timer);this.pending.delete(data.id);
          if(data.type==='error')p.reject(new Error(data.message));else p.resolve({landmarks:data.landmarks,world:data.world});
        };
        this.cancelInit=null;
        return;
      } catch {this.cancelInit=null;this.worker?.terminate();this.worker=null;if(this.stopped)throw new Error('Session ended.');}
    }
    const {FilesetResolver,PoseLandmarker}=await import('@mediapipe/tasks-vision');
    const files=await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    this.detector=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:0.55,minPosePresenceConfidence:0.55,minTrackingConfidence:0.55,outputSegmentationMasks:false});
    if(this.stopped){this.detector.close();this.detector=null;throw new Error('Session ended.');}
  }
  async detect(video:HTMLVideoElement) {
    this.stamp=Math.max(this.stamp+1,performance.now());
    if(this.worker) {
      const scale=Math.min(1,640/video.videoWidth);
      const bitmap=await createImageBitmap(video,{resizeWidth:Math.round(video.videoWidth*scale),resizeHeight:Math.round(video.videoHeight*scale)});
      const id=++this.count;
      return await new Promise<{landmarks:Landmark[];world:Landmark[]}>((resolve,reject)=>{
        const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Pose analysis timed out. Please restart.'));},15000);
        this.pending.set(id,{resolve,reject,timer});
        this.worker!.postMessage({type:'frame',bitmap,id,stamp:this.stamp},[bitmap]);
      });
    }
    if(!this.detector)throw new Error('The posture model is not ready.');
    const r=this.detector.detectForVideo(video,this.stamp);
    return {landmarks:r.landmarks[0]??[],world:r.worldLandmarks[0]??[]};
  }
  close() {
    this.stopped=true;this.cancelInit?.();this.cancelInit=null;
    this.worker?.terminate();this.detector?.close();
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Session ended.'));}
    this.pending.clear();this.worker=null;this.detector=null;
  }
}
