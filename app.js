import * as THREE from 'https://esm.sh/three@0.170.0';
import {OrbitControls} from 'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js';
const $=id=>document.getElementById(id),video=$('video');
const scene=new THREE.Scene();scene.background=new THREE.Color('#08111b');scene.add(new THREE.AxesHelper(1));
const camera=new THREE.PerspectiveCamera(65,1,.01,300);camera.position.set(0,0,8);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));$('viewer').appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
let stream=null,scanning=false,timer=null,frames=0,accepted=0,previous=null;
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const message=s=>{$('message').textContent=s;$('state').textContent=s.slice(0,35)};
function animate(){requestAnimationFrame(animate);const w=$('viewer').clientWidth,h=$('viewer').clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();controls.update();renderer.render(scene,camera)}animate();
$('engine').textContent='กล้องพร้อมใช้งานเมื่ออนุญาต';
$('open').onclick=async()=>{try{if(!isSecureContext)throw Error('ต้องเปิดผ่าน HTTPS');stream?.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:960},height:{ideal:720}},audio:false});video.srcObject=stream;await video.play();$('start').disabled=false;message('กล้องพร้อม · กดเริ่มสแกนเพื่อเก็บเฟรม')}catch(e){message('เปิดกล้องไม่ได้: '+e.message)}};
function sample(){if(!scanning||!video.videoWidth)return;canvas.width=160;canvas.height=Math.round(160*video.videoHeight/video.videoWidth);ctx.drawImage(video,0,0,canvas.width,canvas.height);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;const gray=new Uint8Array(data.length/4);let mean=0,sharp=0,diff=0;for(let i=0;i<gray.length;i++){gray[i]=(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114)|0;mean+=gray[i];if(previous)diff+=Math.abs(gray[i]-previous[i])}for(let y=1;y<canvas.height-1;y++)for(let x=1;x<canvas.width-1;x++){const i=y*canvas.width+x;const v=4*gray[i]-gray[i-1]-gray[i+1]-gray[i-canvas.width]-gray[i+canvas.width];sharp+=v*v}mean/=gray.length;diff/=gray.length;sharp/=(canvas.width-2)*(canvas.height-2);frames++;$('frames').textContent=frames;if(mean<20||mean>245||sharp<40){message('ภาพเบลอหรือแสงไม่เหมาะสม · ถือกล้องให้นิ่ง')}else if(previous&&diff<4){message('ขยับตำแหน่งกล้องช้า ๆ เพื่อให้ภาพต่างจากเดิม')}else{previous=gray;accepted++;$('pairs').textContent=accepted;message('รับภาพจริงแล้ว '+accepted+' เฟรม · รอระบบสร้างโมเดลหลายมุม')} }
function loop(){if(!scanning)return;try{sample()}catch(e){message('ประมวลผลภาพผิดพลาด: '+e.message)}timer=setTimeout(loop,900)}
$('start').onclick=()=>{if(!stream)return;scanning=true;$('start').disabled=true;$('stop').disabled=false;message('กำลังเก็บเฟรมภาพจริง');loop()};
$('stop').onclick=()=>{scanning=false;clearTimeout(timer);$('stop').disabled=true;$('start').disabled=!stream;message('หยุดเก็บเฟรมแล้ว')};
$('clear').onclick=()=>{scanning=false;clearTimeout(timer);frames=accepted=0;previous=null;$('frames').textContent=$('pairs').textContent=$('points').textContent='0';$('stop').disabled=true;$('start').disabled=!stream;message('ล้างข้อมูลเฟรมแล้ว')};
$('limit').oninput=()=>{$('limitValue').textContent=$('limit').value};
addEventListener('pagehide',()=>{scanning=false;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop())});
