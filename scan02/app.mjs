import {ReconstructionPipeline} from './pipeline.mjs';
import {Viewer} from './viewer.mjs';import {drawFrame,vertexCoverage,ringData,drawRing,camCenter,drawLive} from './overlay.mjs';import {LiveLocator} from './locate.mjs';
import {toPLY} from './stereo.mjs';
import {makeFixture} from './fixture.mjs';
import {mayStart,shouldRun,currentResult} from './state.mjs';
import {zipSync,strToU8} from './vendor/fflate/browser.js';
const $=id=>document.getElementById(id),video=$('video');
const viewer=new Viewer($('view'));let loc=null,locTimer=null,locBusy=false,lastLoc=null,locFails=0,locAt=0;const FULL_MAX=1280;let selFrame=0,ovModel=true,ring=null,nextId=0,liveOn=false,fullSize=null;let pipeline=new ReconstructionPipeline(),frames=[],stream=null,capturing=false,busy=false,loading=false,opening=false,ready=false,calibrated=false,allowCompute=true,epoch=0,lastAttempt=0,result=null,metric=1,distance=null,abort=null,timer=null,frameSize=null,previous=null,source='camera';
const log=t=>{$('log').textContent=($('log').textContent+'\n'+t).slice(-16000);};
const status=t=>{$('status').textContent=t;};
function refresh(){const count=frames.length;$('count').textContent=`${count} / 32 ภาพ`;$('start').disabled=!stream||capturing||loading||opening||!ready;$('start').textContent=count?'สแกนชิ้นใหม่':'เริ่มสแกน';$('stop').disabled=!capturing;$('resume').disabled=!stream||capturing||loading||opening||!ready||!count;$('open').disabled=capturing||loading||opening||!!stream;$('test').disabled=busy||loading||capturing||opening||!ready;$('files').disabled=busy||loading||capturing||opening||!ready;$('roi').disabled=busy||capturing||loading;$('quality').disabled=busy||capturing||loading;$('deshade').disabled=busy||capturing||loading;$('photos').disabled=!count||loading;$('ply').disabled=!result?.mesh.faces.length;$('report').disabled=!result;$('measure').disabled=!result?.mesh.faces.length||busy||capturing;$('progress').hidden=!busy;$('retry').disabled=count<8||busy||loading||capturing;$('cancel').disabled=!busy;const free=!busy&&!capturing&&!loading&&count>0;$('ovDel').disabled=!free;$('ovBefore').disabled=!free||selFrame<1;$('ovUnused').disabled=!free||!unusedSet().size;}
async function confirmNew(message){if(!frames.length)return true;const dialog=$('confirm');$('confirmText').textContent=message;return new Promise(resolve=>{const close=value=>{dialog.close();dialog.oncancel=null;resolve(value);};$('confirmYes').onclick=()=>close(true);$('confirmNo').onclick=()=>close(false);dialog.oncancel=e=>{e.preventDefault();close(false);};dialog.showModal();});}
function save(name,data,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function canvasBlob(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('บันทึกภาพไม่ได้')),'image/jpeg',.92));}
function addFrame(blob,canvas,full){const name=`f${String(nextId++).padStart(5,'0')}.jpg`;const t=document.createElement('canvas');t.width=64;t.height=Math.round(64*canvas.height/canvas.width);t.getContext('2d').drawImage(canvas,0,0,t.width,t.height);frames.push({name,data:blob,full,thumb:t.toDataURL('image/jpeg',.6)});renderThumbs();refresh();}
function renderThumbs(){const box=$('thumbs');box.replaceChildren();frames.forEach((f,k)=>{const im=new Image();im.src=f.thumb;im.alt=`ภาพที่ ${k+1}`;im.dataset.i=k;im.onclick=()=>showFrame(k);box.append(im);});markThumbs();}
function markThumbs(){const regs=result?.reconstruction.images;[...$('thumbs').children].forEach((t,k)=>{t.classList.toggle('sel',k===selFrame);t.classList.toggle('unused',!!regs&&k<regs.length&&!regs[k].registered);});}
function stopCapture(){capturing=false;clearTimeout(timer);timer=null;$('captureHint').textContent='หยุดเก็บภาพแล้ว ระบบจะประมวลผลภาพที่เหลือให้เสร็จ';const wasBusy=busy;refresh();schedule(true);
 const n=frames.length;
 if(n<8)status(`หยุดเก็บภาพแล้ว มีเพียง ${n} ภาพ ต้องมีอย่างน้อย 8 ภาพจึงจะสร้างโมเดล — กด “สแกนชิ้นใหม่” แล้วเดินเก็บภาพให้ครบ`);
 else if(wasBusy)status(`หยุดเก็บภาพแล้ว รอบก่อนหน้ายังคำนวณอยู่ เสร็จแล้วจะคำนวณ ${n} ภาพทันที`);
 else status(`หยุดเก็บภาพแล้ว กำลังประมวลผล ${n} ภาพ…`);
}
function reset(){epoch++;abort?.abort();abort=null;clearTimeout(timer);capturing=false;busy=false;loading=false;lastAttempt=0;frames=[];nextId=0;result=null;previous=null;metric=1;calibrated=false;allowCompute=true;distance=null;frameSize=null;fullSize=null;source='camera';pipeline=new ReconstructionPipeline();$('thumbs').replaceChildren();ring=null;selFrame=0;clearOverlay();$('empty').style.display='grid';$('stats').textContent='ยังไม่มีผลการสร้างโมเดล';$('revision').textContent='รอภาพ';$('error').textContent='';$('scaleInfo').textContent='ยังไม่มีสเกลอ้างอิง ระยะในโมเดลไม่ใช่เมตร';$('scale').disabled=true;viewer.set({mesh:{vertices:new Float32Array(),colors:new Uint8Array(),faces:new Uint32Array()},reconstruction:{points:[]}});status('พร้อมเก็บภาพชิ้นใหม่');refresh();}
async function schedule(force=false){if(!allowCompute||!shouldRun({busy,loading,count:frames.length,lastAttempt,force}))return;
 const token=epoch,snapshot=frames.slice(),engine=pipeline;lastAttempt=snapshot.length;busy=true;loc?.sleep();abort=new AbortController();const controller=abort;const timeout=setTimeout(()=>controller.abort(),300000);$('error').textContent='';refresh();
 try{const r=await engine.run(snapshot,{signal:controller.signal,roi:Number($('roi').value)/100,quality:$('quality').value,deshade:$('deshade').checked,onProgress:t=>{if(token===epoch)status(t);},onLog:t=>{if(token===epoch)log(t);}});if(!currentResult(token,epoch))return;result={...r,source};metric=1;calibrated=false;distance=null;$('scale').disabled=true;$('scaleInfo').textContent='โมเดลรอบใหม่ — ยังไม่มีสเกลอ้างอิง ระยะไม่ใช่เมตร';viewer.set(r);afterResult(r);$('empty').style.display='none';$('revision').textContent=`จาก ${r.frameCount} ภาพ`;$('stats').textContent=`จับคู่ ${r.registered}/${r.frameCount} มุม · ${r.reconstruction.points.length.toLocaleString()} จุด · ${r.mesh.stats.faces.toLocaleString()} สามเหลี่ยมผิว`;
 if(r.mesh.stats.faces<20){viewer.setMode('points');$('error').textContent='สร้างจุด 3 มิติได้ แต่ผิวโมเดลยังไม่เพียงพอ ลองเปลี่ยนมุมเพิ่มโดยให้ภาพซ้อนกันมากขึ้น';status('ได้เฉพาะจุด 3 มิติ ยังไม่ใช่ผิวโมเดลที่พร้อมใช้งาน');}else{viewer.setMode('surface');status(`สร้างผิวโมเดลแล้วจาก ${r.frameCount} ภาพ${capturing?' — เก็บภาพต่อเพื่อเพิ่มมุมได้':''}`);}
 log(JSON.stringify({time:r.generatedAt,quality:r.quality,deshade:r.deshade,seconds:r.seconds,source,frames:r.frameCount,registered:r.registered,sparse:r.reconstruction.points.length,...r.mesh.stats}));
 }catch(e){if(token!==epoch)return;if(e.name==='AbortError')allowCompute=false;$('error').textContent=e.name==='AbortError'?'หยุดคำนวณแล้ว (หรือเกินเวลา 5 นาที) ภาพยังอยู่ สามารถลองคำนวณอีกครั้งหรือดาวน์โหลดเก็บไว้':e.message;status(result?'รอบใหม่ยังไม่สำเร็จ — แสดงโมเดลรอบก่อน':'ยังสร้างโมเดลไม่สำเร็จ');log(String(e));}
 finally{clearTimeout(timeout);if(token===epoch){busy=false;refresh();if(frames.length>lastAttempt&&(!capturing||(liveOn&&frames.length-lastAttempt>=4)))schedule(!capturing);}}
}
function quality(c){const t=document.createElement('canvas');t.width=80;t.height=60;const ctx=t.getContext('2d');ctx.drawImage(c,0,0,80,60);const d=ctx.getImageData(0,0,80,60).data,g=new Float32Array(4800);let mean=0,lap=0,diff=0,sat=0;for(let i=0;i<g.length;i++){g[i]=(d[4*i]+d[4*i+1]+d[4*i+2])/3;mean+=g[i];if(g[i]>=248)sat++;if(previous)diff+=Math.abs(g[i]-previous[i]);}for(let y=1;y<59;y++)for(let x=1;x<79;x++){const i=y*80+x,v=4*g[i]-g[i-1]-g[i+1]-g[i-80]-g[i+80];lap+=v*v;}return {g,sat:sat/4800,mean:mean/4800,sharp:lap/(58*78),diff:diff/4800};}
async function capture(){if(!capturing)return;const token=epoch;try{if(video.readyState<2){timer=setTimeout(capture,500);return;}const ratio=video.videoWidth/video.videoHeight;if(frameSize&&Math.abs(ratio-frameSize[0]/frameSize[1])>.02){$('error').textContent='แนวกล้องเปลี่ยนแล้ว กรุณาถือแนวเดิมหรือเริ่มชิ้นใหม่ เพื่อไม่ให้ภาพยืดผิดสัดส่วน';stopCapture();return;}if(!frameSize){const s=480/Math.max(video.videoWidth,video.videoHeight);frameSize=[Math.round(video.videoWidth*s),Math.round(video.videoHeight*s)];}if(!fullSize){const fs=Math.min(1,FULL_MAX/Math.max(video.videoWidth,video.videoHeight));fullSize=[Math.round(video.videoWidth*fs),Math.round(video.videoHeight*fs)];}const c=document.createElement('canvas');[c.width,c.height]=frameSize;c.getContext('2d').drawImage(video,0,0,c.width,c.height);const fc=document.createElement('canvas');[fc.width,fc.height]=fullSize;fc.getContext('2d').drawImage(video,0,0,fc.width,fc.height);const q=quality(c);if(q.mean<22||q.mean>240||q.sharp<45){$('captureHint').textContent='ภาพมืด สว่าง หรือเบลอเกินไป — ถือให้นิ่งชั่วครู่และเพิ่มแสง';}else if(previous&&q.diff<4){$('captureHint').textContent='ภาพยังคล้ายเดิม ขยับตำแหน่งกล้องช้า ๆ รอบวัตถุ';}else{const blob=await canvasBlob(c),fullBlob=await canvasBlob(fc);if(token!==epoch||!capturing)return;previous=q.g;addFrame(blob,c,fullBlob);$('captureHint').textContent=q.sat>.04?'เก็บภาพแล้ว แต่มีแสงจ้าหรือแสงสะท้อนมาก ลองเปลี่ยนมุมหรือใช้แสงนุ่ม เพราะแสงสะท้อนเลื่อนตามมุมกล้องและทำให้จับคู่ภาพยาก':'เก็บภาพแล้ว เดินต่อทีละน้อย ให้ภาพซ้อนกันมาก';if(liveOn)schedule();}if(frames.length>=32){stopCapture();return;}}catch(e){if(token!==epoch)return;$('error').textContent=e.message;stopCapture();return;}if(capturing&&token===epoch)timer=setTimeout(capture,1700);}
$('open').onclick=async()=>{if(opening||capturing||stream)return;opening=true;const token=epoch;refresh();try{const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});if(token!==epoch){next.getTracks().forEach(t=>t.stop());return;}stream?.getTracks().forEach(t=>t.stop());stream=next;video.srcObject=stream;await video.play();$('cameraEmpty').style.display='none';$('frame').style.display='block';status('กล้องพร้อม กดเริ่มสแกนแล้วเดินรอบวัตถุช้า ๆ');if(loc?.ready)locSchedule(500);}catch(e){if(token===epoch)$('error').textContent=`เปิดกล้องไม่ได้: ${e.message}\nเปิดลิงก์ใน Safari โดยตรงและอนุญาตใช้กล้อง`;}finally{opening=false;refresh();}};
$('start').onclick=()=>{if(!stream||capturing||loading||opening||!ready)return;if(frames.length||result||busy)reset();capturing=true;allowCompute=true;source='camera';refresh();status('กำลังเก็บภาพ… เดินช้าๆ รอบวัตถุ แล้วกด “หยุดเก็บภาพ” เมื่อได้อย่างน้อย 8 ภาพ ระบบจะสร้างโมเดลทันที');capture();};$('stop').onclick=stopCapture;$('reset').onclick=async()=>{if(!await confirmNew('เริ่มชิ้นใหม่และล้างภาพในหน้านี้? ควรดาวน์โหลดงานเดิมก่อน'))return;reset();};
$('retry').onclick=()=>{if(busy||capturing||loading||frames.length<8)return;lastAttempt=0;allowCompute=true;schedule(true);};$('cancel').onclick=()=>{allowCompute=false;capturing=false;clearTimeout(timer);abort?.abort();refresh();};
$('roi').oninput=()=>{const v=Number($('roi').value);$('roiValue').textContent=`${v}%`;$('frame').style.inset=`${(100-v)/2}%`;if(result)status('ขอบเขตเปลี่ยนแล้ว กดคำนวณชุดภาพนี้อีกครั้งเพื่ออัปเดตโมเดล');};
$('surface').onclick=()=>viewer.setMode('surface');$('points').onclick=()=>viewer.setMode('points');$('fit').onclick=()=>viewer.fit();$('cover').onclick=()=>viewer.setMode('cover');$('ovDel').onclick=()=>dropFrames(new Set([selFrame]));$('ovBefore').onclick=()=>dropFrames(new Set(frames.map((f,k)=>k).filter(k=>k<selFrame)));$('ovUnused').onclick=()=>dropFrames(unusedSet());$('ovPrev').onclick=()=>showFrame(selFrame-1);$('ovNext').onclick=()=>showFrame(selFrame+1);$('ovModel').onclick=()=>{ovModel=!ovModel;$('ovModel').textContent=ovModel?'ซ่อนโมเดล':'ทับด้วยโมเดล';showFrame(selFrame);};
$('measure').onclick=()=>{viewer.clearSelection();viewer.setMode('surface');viewer.measure=true;$('scaleInfo').textContent='แตะ 2 จุดบนผิวโมเดลที่ทราบระยะจริง';};viewer.onDistance=d=>{distance=d;$('scale').disabled=!(d>0);$('scaleInfo').textContent='เลือกครบแล้ว ใส่ระยะจริงระหว่าง 2 จุด แล้วกดใช้ขนาดนี้';};
$('scale').onclick=()=>{const value=Number($('length').value);if(!(distance>0&&value>0&&Number.isFinite(value)))return;metric=value/distance;calibrated=true;$('scaleInfo').textContent=`ตั้งสเกลจากระยะ ${value} เมตรแล้ว ใช้กับโมเดลรอบนี้เท่านั้น`;};
$('ply').onclick=()=>{if(result?.mesh.faces.length)save('object-surface.ply',toPLY(result.mesh,metric,calibrated),'text/plain');};
$('report').onclick=()=>{if(result)save('reconstruction-info.json',JSON.stringify({version:'0.2',source:result.source,generatedAt:result.generatedAt,frames:result.frameCount,registered:result.registered,sparsePoints:result.reconstruction.points.length,surface:result.mesh.stats,scale:metric,scaleVerified:false,units:calibrated?'user-calibrated meters':'relative',notes:'Multi-view image matching. Holes are unobserved or rejected. Not an engineering measurement.'},null,2),'application/json');};
$('photos').onclick=async()=>{try{const archive={};for(const f of frames)archive[f.name]=new Uint8Array(await (f.full||f.data).arrayBuffer());archive['README.txt']=strToU8('Images captured by Object Scan (up to 1280 px on the long side). No GPS/metric scale is guaranteed. Import JPG images into WebODM or other photogrammetry software.');save('object-images.zip',zipSync(archive,{level:0}),'application/zip');}catch(e){$('error').textContent=e.message;}};
$('files').onchange=async e=>{const input=Array.from(e.target.files).slice(0,32);e.target.value='';if(!input.length||!await confirmNew('แทนภาพในหน้านี้ด้วยชุดภาพที่เลือก?'))return;reset();loading=true;source='import';const token=epoch;let loaded=true;refresh();try{for(const f of input){const im=await createImageBitmap(f),s=480/Math.max(im.width,im.height),w=Math.round(im.width*s),h=Math.round(im.height*s);if(frameSize&&Math.abs(w/h-frameSize[0]/frameSize[1])>.02){im.close();throw Error('ภาพต้องมีสัดส่วนและกล้องเดียวกัน กรุณาเลือกชุดใหม่');}frameSize??=[w,h];const c=document.createElement('canvas');[c.width,c.height]=frameSize;c.getContext('2d').drawImage(im,0,0,c.width,c.height);const fs=Math.min(1,FULL_MAX/Math.max(im.width,im.height)),fc=document.createElement('canvas');fc.width=Math.round(im.width*fs);fc.height=Math.round(im.height*fs);fc.getContext('2d').drawImage(im,0,0,fc.width,fc.height);im.close();const b=await canvasBlob(c),fb=await canvasBlob(fc);if(token!==epoch)return;addFrame(b,c,fb);}status(input.length>=8?'นำเข้าภาพแล้ว':'ต้องมีภาพอย่างน้อย 8 ภาพ กรุณาเลือกชุดใหม่');}catch(err){loaded=false;if(token===epoch)$('error').textContent=err.message;}finally{if(token===epoch){loading=false;refresh();if(loaded)schedule(true);}}};
$('test').onclick=async()=>{if(!await confirmNew('แทนภาพปัจจุบันด้วยภาพจำลองเพื่อทดสอบ?'))return;reset();source='synthetic-known-depth';loading=true;const token=epoch;refresh();status('กำลังสร้างภาพจำลองใหม่ 9 มุม');try{const fixture=makeFixture({width:480,height:360,count:9});for(const im of fixture.images){const c=document.createElement('canvas');c.width=im.width;c.height=im.height;c.getContext('2d').putImageData(new ImageData(im.data,im.width,im.height),0,0);const b=await canvasBlob(c);if(token!==epoch)return;addFrame(b,c);}}catch(e){if(token===epoch)$('error').textContent=e.message;}finally{if(token===epoch){loading=false;refresh();schedule(true);}}};
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(capturing)stopCapture();}else if(stream&&stream.getVideoTracks().every(t=>t.readyState==='ended')){stream=null;video.srcObject=null;$('cameraEmpty').style.display='grid';$('frame').style.display='none';status('กล้องหยุดทำงาน กด “เปิดกล้องหลัง” ใหม่');refresh();}});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});window.addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());abort?.abort();});
try{if(!globalThis.Worker||!globalThis.WebAssembly||!globalThis.OffscreenCanvas)throw Error('เบราว์เซอร์ยังไม่รองรับการคำนวณนี้ กรุณาใช้ Safari หรือ Chrome รุ่นล่าสุด');ready=true;status('พร้อมสร้างโมเดล — เปิดกล้องหรือเลือกชุดภาพ');}catch(e){$('error').textContent=e.message;status('อุปกรณ์ยังไม่พร้อมคำนวณโมเดล');}refresh();

function clearOverlay(){locClear();$('unusedInfo').textContent='';$('ovCard').hidden=true;$('ovInfo').textContent='';$('ringHint').textContent='';$('covInfo').textContent='';$('liveRing').hidden=true;drawRing($('ring'),null);}
async function showFrame(i){
 if(!frames.length)return;
 selFrame=Math.max(0,Math.min(frames.length-1,i));
 const token=epoch,bmp=await createImageBitmap(frames[selFrame].data);
 if(token!==epoch){bmp.close();return;}
 const r=result?.reconstruction,info=drawFrame($('ovCanvas'),bmp,result,selFrame,{roi:Number($('roi').value)/100,showModel:ovModel});
 bmp.close();
 markThumbs();
 $('ovCard').hidden=false;
 let msg=`ภาพที่ ${selFrame+1} / ${frames.length}`;
 if(!result)msg+=' · ยังไม่มีผลคำนวณ';
 else if(selFrame>=r.images.length)msg+=' · เก็บหลังรอบคำนวณล่าสุด ยังไม่ถูกนำมาใช้';
 else if(!info.registered)msg+=' · ระบบจับคู่ภาพนี้ไม่ได้ จึงไม่ถูกใช้สร้างโมเดล ลองถ่ายซ้ำช่วงนี้ให้ซ้อนกับภาพข้างเคียงมากขึ้น';
 else if(info.coverage!=null)msg+=ovModel?` · โมเดลครอบคลุม ${Math.round(info.coverage*100)}% ของกรอบวัตถุ`:' · ภาพเดิม';
 $('ovInfo').textContent=msg;
}
function afterResult(r){
 try{
  ring=ringData(r);drawRing($('ring'),ring);drawRing($('liveRing'),ring);$('liveRing').hidden=!ring;locSetModel(r);
  $('ringHint').textContent=ring?ring.hints.join(' · ')+' (0° = จุดเริ่มสแกน เพิ่มขึ้นตามทิศที่เดิน เหมาะกับการเดินรอบวัตถุ)':'ภาพที่จับคู่ได้ยังน้อยเกินกว่าจะสรุปว่ามุมไหนยังขาด';
  const counts=vertexCoverage(r);
  viewer.setCoverage(counts,r.reconstruction.images.filter(p=>p.registered).map(p=>camCenter(p)));
  const n=counts.length||1,pc=k=>Math.round(100*counts.filter(v=>k===3?v>=3:v===k).length/n);
  $('covInfo').textContent=counts.length?`ปุ่ม “ความครอบคลุม”: เขียว = เห็นจาก ≥3 ภาพ (${pc(3)}%) · ส้ม = 2 ภาพ (${pc(2)}%) · แดง = ภาพเดียว (${pc(1)}%) ยิ่งหลายภาพโมเดลยิ่งน่าเชื่อถือ`:'';
  const un=unusedSet().size;$('unusedInfo').textContent=un?`มี ${un} ภาพที่ระบบจับคู่ไม่ได้ (กรอบแดงในแถบภาพย่อ) มักเป็นภาพคนละฉากหรือขยับกล้องเร็วเกินไป ลบภาพเหล่านี้แล้วคำนวณใหม่ได้ด้วยปุ่ม “ลบภาพที่ไม่ถูกใช้”`:'';refresh();
  let last=0;r.reconstruction.images.forEach((p,k)=>{if(p.registered)last=k;});
  showFrame(selFrame>0&&selFrame<r.reconstruction.images.length?selFrame:last);
 }catch(e){log('overlay: '+e);}
}
function unusedSet(){const regs=result?.reconstruction.images,out=new Set();if(regs)regs.forEach((p,k)=>{if(!p.registered&&k<frames.length)out.add(k);});return out;}
function dropFrames(drop){
 if(busy||capturing||loading||!drop.size)return;
 frames=frames.filter((f,k)=>!drop.has(k));
 if(!frames.length){reset();return;}
 epoch++;result=null;lastAttempt=0;allowCompute=true;previous=null;metric=1;calibrated=false;distance=null;locClear();
 selFrame=Math.min(selFrame,frames.length-1);
 viewer.set({mesh:{vertices:new Float32Array(),colors:new Uint8Array(),faces:new Uint32Array()},reconstruction:{points:[]}});
 $('empty').style.display='grid';$('stats').textContent='ยังไม่มีผลการสร้างโมเดล';$('revision').textContent='รอภาพ';$('error').textContent='';$('covInfo').textContent='';$('unusedInfo').textContent='';$('ringHint').textContent='';$('liveRing').hidden=true;drawRing($('ring'),null);ring=null;
 $('scale').disabled=true;$('scaleInfo').textContent='ยังไม่มีสเกลอ้างอิง ระยะในโมเดลไม่ใช่เมตร';
 renderThumbs();refresh();showFrame(selFrame);
 if(frames.length>=8)schedule(true);else status(`เหลือ ${frames.length} ภาพ ต้องมีอย่างน้อย 8 ภาพจึงจะคำนวณโมเดล`);
}
$('liveBuild').onchange=()=>{liveOn=$('liveBuild').checked;if(liveOn&&capturing)schedule();};
// one bar that stays at the top of the screen: what the system is doing now, or what went wrong
(function(){const bar=$('bar'),text=$('barText'),prog=$('barProg'),sync=()=>{const e=$('error').textContent.trim(),st=$('status').textContent.trim();text.textContent=e?'⚠ '+e.split(String.fromCharCode(10))[0]:st;bar.classList.toggle('err',!!e);bar.hidden=!(e||st);prog.hidden=$('progress').hidden;};
 const mo=new MutationObserver(sync);mo.observe($('status'),{childList:true,characterData:true,subtree:true});mo.observe($('error'),{childList:true,characterData:true,subtree:true});mo.observe($('progress'),{attributes:true,attributeFilter:['hidden']});sync();})();
// ---- live overlay: the model built so far, drawn over the camera picture ----
function locClear(){clearTimeout(locTimer);locTimer=null;lastLoc=null;locFails=0;loc?.clearModel();const c=$('liveOv');c.getContext('2d').clearRect(0,0,c.width,c.height);$('liveOvInfo').textContent='';}
async function locSetModel(r){
 try{if(!loc){if(!globalThis.OffscreenCanvas)return;loc=new LiveLocator();}
  const ok=await loc.setModel(r,pipeline,frames);if(result?.generatedAt!==r.generatedAt)return;
  if(ok){log(`live locator: ${loc.points} descriptors`);locFails=0;locSchedule(300);}else $('liveOvInfo').textContent='โมเดลยังมีจุดน้อยเกินไปที่จะใช้ทับภาพกล้อง';
 }catch(e){log('locator: '+e);}
}
function locSchedule(ms=1200){clearTimeout(locTimer);locTimer=setTimeout(locTick,ms);}
async function locTick(){
 const on=$('liveOvOn').checked;
 if(!loc?.ready||!result||!stream||!on){if(!on){const c=$('liveOv');c.getContext('2d').clearRect(0,0,c.width,c.height);$('liveOvInfo').textContent='';}return;}
 if(busy||loading||document.hidden||video.readyState<2||locBusy){locSchedule(1500);return;}
 locBusy=true;const token=epoch,gen=result.generatedAt;
 try{
  const r=await loc.locate(video);if(token!==epoch||result?.generatedAt!==gen)return;
  lastLoc=r;
  if(r.ok){locFails=0;locAt=Date.now();const cov=drawLive($('liveOv'),result,{R:r.R,t:r.t},{roi:Number($('roi').value)/100});
   const cc=camCenter({R:r.R,t:r.t});if(ring?.where)drawRing($('liveRing'),ring,ring.where(cc));
   $('liveOvInfo').textContent=`ทับโมเดลบนภาพกล้อง · เขียว = มีโมเดลแล้ว · ส้ม = ยังไม่มี${cov!=null?` · ครอบคลุม ${Math.round(cov*100)}% ของกรอบ`:''} (${r.inliers} จุดอ้างอิง, ${r.totalMs} ms)`;}
  else{locFails++;if(locFails>=2){const c=$('liveOv');c.getContext('2d').clearRect(0,0,c.width,c.height);if(ring)drawRing($('liveRing'),ring);}
   $('liveOvInfo').textContent=r.reason==='model-changed'?'':`หาตำแหน่งกล้องจากโมเดลเดิมไม่ได้ (${locReason(r.reason)}) — หันให้เห็นส่วนที่สแกนไปแล้วบางส่วน`;}
 }catch(e){if(!/asleep/.test(String(e))){locFails++;log('locate: '+e);}}
 finally{locBusy=false;if(token===epoch)locSchedule(lastLoc?.ok?700:1800);}
}
const locReason=k=>({'few-features':'ภาพมีลวดลายน้อย','few-matches':'ภาพไม่ตรงกับส่วนที่สแกน','no-consensus':'ภาพไม่ตรงกับส่วนที่สแกน','refine-failed':'ไม่แน่นอนพอ','no-model':'ยังไม่มีโมเดล'}[k]||k);
setInterval(()=>{if(lastLoc?.ok&&locAt&&Date.now()-locAt>4000){const c=$('liveOv');c.getContext('2d').clearRect(0,0,c.width,c.height);if(ring)drawRing($('liveRing'),ring);}},700);
$('liveOvOn').onchange=()=>{if($('liveOvOn').checked)locSchedule(200);else locTick();};
$('resume').onclick=()=>{if(!stream||capturing||loading||opening||!ready||!frames.length)return;if(frames.length>=32){status('ครบ 32 ภาพแล้ว เก็บเพิ่มไม่ได้ ลบภาพที่ไม่ใช้ในส่วนที่ 03 หรือเริ่มชิ้นใหม่');return;}capturing=true;allowCompute=true;source=source||'camera';refresh();
 status('เก็บภาพเพิ่มต่อจากเดิม… ดูสีบนกล้อง: เขียว = ตรงนี้มีโมเดลแล้ว ส้ม = ยังไม่มี เดินไปถ่ายตรงสีส้ม แล้วกด “หยุดเก็บภาพ”');capture();};
window.__scan={get loc(){return loc;},get lastLoc(){return lastLoc;},get result(){return result;},get frames(){return frames;},get pipeline(){return pipeline;},locTick};
$('quality').onchange=$('deshade').onchange=()=>{if(result)status('เปลี่ยนการตั้งค่าแล้ว กด “คำนวณชุดภาพนี้อีกครั้ง” เพื่ออัปเดตโมเดล');};
