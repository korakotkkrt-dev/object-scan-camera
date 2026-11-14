import {extractFeatures,reconstruct,SiftMatcher,sequentialPairs} from './vendor/colmap/dist/index.js';
import {limitFeatures} from './matching.mjs';
export class ReconstructionPipeline {
 constructor(){this.cache=new Map();}
 reset(){this.cache.clear();}
 async run(frames,{signal,onProgress=()=>{},onLog=()=>{},roi=.88}={}){
  const missing=frames.filter(f=>!this.cache.has(f.name));
  if(missing.length){const features=await extractFeatures(missing,{workers:1,signal,onProgress:(done,total)=>onProgress(`ค้นหาลักษณะร่วมในภาพ ${done}/${total}`)});missing.forEach((f,i)=>this.cache.set(f.name,limitFeatures(features[i])));}
  const features=frames.map(f=>this.cache.get(f.name));
  onProgress('จับคู่ภาพหลายมุม');onLog('SIFT features per image: '+features.map(f=>f.count).join(','));
  // CPU matching is bounded and cancellable, avoiding GPU driver compilation stalls.
  const matches=await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./matching-worker.mjs',import.meta.url),{type:'module'});const finish=(fn,v)=>{worker.terminate();signal?.removeEventListener('abort',abort);fn(v);};const abort=()=>finish(reject,new DOMException('Cancelled','AbortError'));if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});worker.onerror=e=>finish(reject,Error(e.message));worker.onmessage=({data})=>{if(data.kind==='progress')onProgress(`จับคู่ภาพ ${data.done}/${data.total}`);else if(data.kind==='done')finish(resolve,data.matches);else finish(reject,Error(data.message));};worker.postMessage({descriptors:features.map(f=>f.descriptors),pairs:sequentialPairs(frames.length,{window:5,loop:false})});});
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  onProgress('คำนวณตำแหน่งกล้องและจุด 3 มิติ');
  const reconstruction=await reconstruct(frames.map(f=>f.name),features,matches,{signal,onLog});
  const registered=reconstruction.images.filter(p=>p.registered).length;
  const reliable=reconstruction.points.filter(p=>p.track.length>=3&&Number.isFinite(p.error)&&p.error<3&&p.xyz.every(Number.isFinite));
  if(registered<Math.max(4,Math.ceil(frames.length*.55))||reliable.length<50)throw Error(`ภาพเชื่อมกันยังไม่พอ (${registered}/${frames.length} มุม, ${reliable.length} จุด) เดินเปลี่ยนมุมทีละน้อย ให้ภาพซ้อนกันมาก และใช้วัตถุที่มีลวดลาย`);
  reconstruction.points=reliable;
  onProgress(`สร้างผิวจากภาพที่จับคู่ได้ ${registered} มุม`);
  const dense=await prepareDense(frames,reconstruction);
  const mesh=await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./dense-worker.mjs',import.meta.url),{type:'module'});let timer;
   const finish=(fn,v)=>{worker.terminate();clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(v);};
   const abort=()=>finish(reject,new DOMException('Cancelled','AbortError'));
   if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>finish(reject,Error('คำนวณผิวนานเกิน 5 นาที กรุณาลดจำนวนภาพ')),300000);
   worker.onerror=e=>finish(reject,Error(e.message||'การสร้างผิวหยุดทำงาน'));
   worker.onmessage=({data})=>{if(data.kind==='progress')onProgress(`สร้างผิว 3 มิติ ${data.done+1}/${data.total} มุม`);else if(data.kind==='done')finish(resolve,data.mesh);else finish(reject,Error(data.message));};
   worker.postMessage({...dense,roi});
  });
  return {reconstruction,mesh,registered,frameCount:frames.length,generatedAt:new Date().toISOString()};
 }
}
async function prepareDense(frames,r){const width=192,height=Math.round(r.camera.height*width/r.camera.width),s=width/r.camera.width,sy=height/r.camera.height;
 const images=[];for(const f of frames){const im=await createImageBitmap(f.data),c=new OffscreenCanvas(width,height),ctx=c.getContext('2d');ctx.drawImage(im,0,0,width,height);im.close();images.push({width,height,data:ctx.getImageData(0,0,width,height).data});}
 return {images,reconstruction:{...r,camera:{...r.camera,width,height,focal:r.camera.focal*s,cx:r.camera.cx*s,cy:r.camera.cy*sy}}};
}
