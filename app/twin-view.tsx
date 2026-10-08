"use client";
import { useEffect, useRef, useState } from 'react';
import type { Landmark } from '@/lib/posture';
import { Scan, Rotate3D } from 'lucide-react';

const bones=[[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
export default function TwinView({world,warning}:{world:Landmark[];warning:boolean}){
  const host=useRef<HTMLDivElement>(null);
  const data=useRef({world,warning});data.current={world,warning};
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    let disposed=false,cleanup=()=>{};
    Promise.all([import('three'),import('three/addons/controls/OrbitControls.js')]).then(([T,{OrbitControls}])=>{
      if(disposed||!host.current)return;
      const element=host.current;
      let renderer:InstanceType<typeof T.WebGLRenderer>;
      try{renderer=new T.WebGLRenderer({antialias:true,alpha:true});}catch{setFailed(true);return;}
      renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
      element.appendChild(renderer.domElement);
      const scene=new T.Scene();
      const camera=new T.PerspectiveCamera(40,1,.01,100);camera.position.set(1.5,.8,3.5);
      const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.3,0);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=1.6;controls.maxDistance=6;
      const grid=new T.GridHelper(6,24,0x47616b,0x233943);grid.position.y=-1.05;scene.add(grid);
      scene.add(new T.AmbientLight(0xffffff,2));
      const light=new T.DirectionalLight(0xffffff,3);light.position.set(2,3,4);scene.add(light);
      const group=new T.Group();scene.add(group);
      const material=new T.MeshStandardMaterial({color:0xa9f580,roughness:.45,metalness:.15});
      const joints=Array.from({length:33},()=>new T.Mesh(new T.SphereGeometry(.025,12,8),material));
      const edges=bones.map(()=>new T.Mesh(new T.CylinderGeometry(.014,.014,1,8),material));
      joints.forEach(j=>group.add(j));edges.forEach(e=>group.add(e));
      const resize=()=>{const {width,height}=element.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();};
      const observer=new ResizeObserver(resize);observer.observe(element);resize();
      let frame=0;
      const up=new T.Vector3(0,1,0);
      const draw=()=>{
        if(disposed)return;
        const current=data.current;group.visible=current.world.length===33;
        material.color.set(current.warning?0xffb06b:0xa9f580);
        if(group.visible){
          current.world.forEach((p,i)=>{joints[i].position.set(p.x,-p.y,-p.z);joints[i].visible=i>=11&&(p.visibility??1)>.4;});
          bones.forEach(([a,b],i)=>{
            const av=joints[a].position,bv=joints[b].position;
            edges[i].visible=joints[a].visible&&joints[b].visible;
            edges[i].position.copy(av).add(bv).multiplyScalar(.5);
            const diff=bv.clone().sub(av);edges[i].scale.y=diff.length();edges[i].quaternion.setFromUnitVectors(up,diff.normalize());
          });
        }
        controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(draw);
      };draw();
      cleanup=()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();joints.forEach(j=>j.geometry.dispose());edges.forEach(e=>e.geometry.dispose());grid.geometry.dispose();(grid.material as InstanceType<typeof T.Material>).dispose();material.dispose();renderer.dispose();renderer.domElement.remove();};
    }).catch(()=>{if(!disposed)setFailed(true);});
    return()=>{disposed=true;cleanup();};
  },[]);
  return <div className="twin-stage"><div ref={host} className="twin-canvas" role="img" aria-label="Three dimensional skeletal twin from detected body landmarks" />
    {(world.length!==33||failed)&&<div className="twin-empty"><Scan size={26}/><span>{failed?'3D view unavailable':'Waiting for a tracked pose'}</span></div>}
    <span className="twin-hint"><Rotate3D size={14}/> Drag to rotate</span>
    <span className="twin-axis">X / Y / Z</span>
  </div>;
}
