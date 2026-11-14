import {extractFeatures,reconstruct,SiftMatcher,sequentialPairs} from './vendor/colmap/dist/index.js';
import {limitFeatures} from './matching.mjs';
import {resized,denseImage} from './prep.mjs';
// quality presets: picture size for finding/matching points, number of points kept per picture, width of the pictures used for the surface
export const QUALITY={fast:{proc:480,features:900,dense:192},normal:{proc:640,features:1100,dense:288},detailed:{proc:800,features:1400,dense:384}};
export class ReconstructionPipeline {
 constructor(){this.cache=new Map();this.matchCache=new Map();}
 reset(){this.cache.clear();this.matchCache.clear();}
 async run(frames,{signal,onProgress=()=>{},onLog=()=>{},roi=.88,quality='normal',deshade=true,sparseOnly=false}={}){   // sparseOnly: camera positions + 3D points only (no surface), used for the live point cloud while capturing
  const q=QUALITY[quality]||QUALITY.normal,t0=performance.now(),key=f=>`${f.name}|${q.proc}|${deshade?1:0}`;
  const missing=frames.filter(f=>!this.cache.has(key(f)));
  if(missing.length){const prepared=[];for(const f of missing){onProgress(`เตรียมภาพ ${prepared.length+1}/${missing.length}`);prepared.push({name:f.name,data:(await resized(f.full||f.data,q.proc,{deshade})).blob});if(signal?.aborted)throw new DOMException('Cancelled','AbortError');}
   const features=await extractFeatures(prepared,{workers:1,signal,onProgress:(done,total)=>onProgress(`ค้นหาลักษณะร่วมในภาพ ${done}/${total}`)});missing.forEach((f,i)=>this.cache.set(key(f),limitFeatures(features[i],q.features)));}
  const features=frames.map(f=>this.cache.get(key(f)));
  onProgress('จับคู่ภาพหลายมุม');onLog('SIFT features per image: '+features.map(f=>f.count).join(','));
  // CPU matching is bounded and cancellable, avoiding GPU driver compilation stalls.
  // pairs already matched in an earlier round are kept (same two pictures, same settings -> same matches): a live rebuild only matches the pairs the new pictures add
  const pairs=sequentialPairs(frames.length,{window:sparseOnly?3:5,loop:false})   /* live rounds match fewer neighbours; the final round adds the rest and keeps these */,mk=(a,b)=>`${key(frames[a])}#${frames[b].name}`,have=[],todo=[];
  for(const [a,b] of pairs){const c=this.matchCache.get(mk(a,b));if(c)have.push({a,b,ia:c.ia,ib:c.ib});else todo.push([a,b]);}
  const fresh=todo.length?await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./matching-worker.mjs',import.meta.url),{type:'module'});const finish=(fn,v)=>{worker.terminate();signal?.removeEventListener('abort',abort);fn(v);};const abort=()=>finish(reject,new DOMException('Cancelled','AbortError'));if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});worker.onerror=e=>finish(reject,Error(e.message));worker.onmessage=({data})=>{if(data.kind==='progress')onProgress(`จับคู่ภาพ ${data.done}/${data.total}`);else if(data.kind==='done')finish(resolve,data.matches);else finish(reject,Error(data.message));};worker.postMessage({descriptors:features.map(f=>f.descriptors),pairs:todo});}):[];
  for(const m of fresh)this.matchCache.set(mk(m.a,m.b),{ia:m.ia,ib:m.ib});
  const matches=have.concat(fresh);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  onProgress('คำนวณตำแหน่งกล้องและจุด 3 มิติ');
  const reconstruction=await reconstruct(frames.map(f=>f.name),features,matches,{signal,onLog});
  const registered=reconstruction.images.filter(p=>p.registered).length;
  const reliable=reconstruction.points.filter(p=>p.track.length>=3&&Number.isFinite(p.error)&&p.error<3&&p.xyz.every(Number.isFinite));
  if(registered<Math.max(4,Math.ceil(frames.length*.55))||reliable.length<50)throw Error(`ภาพเชื่อมกันยังไม่พอ (${registered}/${frames.length} มุม, ${reliable.length} จุด) เดินเปลี่ยนมุมทีละน้อย ให้ภาพซ้อนกันมาก และใช้วัตถุที่มีลวดลาย`);
  reconstruction.points=reliable;
  if(sparseOnly)return {reconstruction,mesh:{vertices:new Float32Array(),colors:new Uint8Array(),faces:new Uint32Array(),stats:{faces:0,vertices:0}},registered,frameCount:frames.length,generatedAt:new Date().toISOString(),quality,deshade,sparseOnly:true,seconds:Math.round((performance.now()-t0)/100)/10};
  onProgress(`สร้างผิวจากภาพที่จับคู่ได้ ${registered} มุม`);
  const dense=await prepareDense(frames,reconstruction,q.dense,deshade);
  const mesh=await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./dense-worker.mjs',import.meta.url),{type:'module'});let timer;
   const finish=(fn,v)=>{worker.terminate();clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(v);};
   const abort=()=>finish(reject,new DOMException('Cancelled','AbortError'));
   if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>finish(reject,Error('คำนวณผิวนานเกิน 5 นาที กรุณาลดจำนวนภาพ')),300000);
   worker.onerror=e=>finish(reject,Error(e.message||'การสร้างผิวหยุดทำงาน'));
   worker.onmessage=({data})=>{if(data.kind==='progress')onProgress(`สร้างผิว 3 มิติ ${data.done+1}/${data.total} มุม`);else if(data.kind==='done')finish(resolve,data.mesh);else finish(reject,Error(data.message));};
   worker.postMessage({...dense,roi});
  });
  return {reconstruction,mesh,registered,frameCount:frames.length,generatedAt:new Date().toISOString(),quality,deshade,seconds:Math.round((performance.now()-t0)/100)/10};
 }
}
async function prepareDense(frames,r,width,deshade){const height=Math.round(r.camera.height*width/r.camera.width),s=width/r.camera.width,sy=height/r.camera.height;
 const images=[];for(const f of frames)images.push(await denseImage(f.full||f.data,width,height,{deshade}));
 return {images,reconstruction:{...r,camera:{...r.camera,width,height,focal:r.camera.focal*s,cx:r.camera.cx*s,cy:r.camera.cy*sy}}};
}
