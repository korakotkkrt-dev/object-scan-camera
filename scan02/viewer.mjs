import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
export class Viewer {
 constructor(canvas){this.canvas=canvas;this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#102731');this.camera=new THREE.PerspectiveCamera(45,1,.001,1e5);this.camera.position.set(4,-3,-5);this.camera.up.set(0,-1,0);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.group=new THREE.Group();this.scene.add(this.group);this.mode='surface';this.selection=[];this.measure=false;
 this.scene.add(new THREE.HemisphereLight(0xffffff,0x223344,2));const l=new THREE.DirectionalLight(0xffffff,2);l.position.set(2,-4,-3);this.scene.add(l);new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);
 const draw=()=>{requestAnimationFrame(draw);this.controls.update();this.renderer.render(this.scene,this.camera);};draw();
 canvas.addEventListener('pointerdown',e=>{this.start=[e.clientX,e.clientY];});canvas.addEventListener('pointerup',e=>{if(!this.measure||!this.mesh||Math.hypot(e.clientX-this.start[0],e.clientY-this.start[1])>8)return;const b=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(2*(e.clientX-b.left)/b.width-1,1-2*(e.clientY-b.top)/b.height),this.camera);const hit=ray.intersectObject(this.mesh)[0];if(!hit)return;if(this.selection.length===2)this.clearSelection();this.selection.push(hit.point);const dot=new THREE.Mesh(new THREE.SphereGeometry(this.radius*.012,10,10),new THREE.MeshBasicMaterial({color:0xffcc33}));dot.position.copy(hit.point);dot.userData.mark=true;this.group.add(dot);if(this.selection.length===2){this.onDistance?.(this.selection[0].distanceTo(this.selection[1]));this.measure=false;}});
 }
 resize(){const p=this.canvas.parentElement,w=p.clientWidth,h=p.clientHeight;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 clearSelection(){this.selection=[];for(const o of [...this.group.children])if(o.userData.mark){this.group.remove(o);o.geometry?.dispose();o.material?.dispose();}}
 set(result){for(const o of [...this.group.children]){this.group.remove(o);o.geometry?.dispose();o.material?.dispose();}this.selection=[];this.measure=false;this.mesh=null;this.photoColors=null;this.coverColors=null;this.cams=null;const mesh=result.mesh;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(mesh.vertices,3));g.setAttribute('color',new THREE.BufferAttribute(mesh.colors,3,true));g.setIndex(new THREE.BufferAttribute(mesh.faces,1));g.computeVertexNormals();this.mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1}));this.group.add(this.mesh);
 const verts=result.reconstruction.points.flatMap(p=>p.xyz),colors=result.reconstruction.points.flatMap(p=>p.color.map(v=>v/255));const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));pg.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));this.points=new THREE.Points(pg,new THREE.PointsMaterial({vertexColors:true,size:3,sizeAttenuation:false}));this.group.add(this.points);this.setMode(this.mode);this.fit();}
 setCoverage(counts,centers){
  const n=counts.length,c=new Uint8Array(n*3);
  for(let i=0;i<n;i++){const k=counts[i],col=k>=3?[53,224,160]:k===2?[255,170,60]:k===1?[235,80,70]:[90,100,106];c[3*i]=col[0];c[3*i+1]=col[1];c[3*i+2]=col[2];}
  this.coverColors=c;
  for(const o of [...this.group.children])if(o.userData.cams){this.group.remove(o);o.geometry?.dispose();o.material?.dispose();}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(centers.flat(),3));
  const cams=new THREE.Points(g,new THREE.PointsMaterial({color:0xffffff,size:9,sizeAttenuation:false}));
  cams.userData.cams=true;cams.visible=this.mode==='cover';
  this.group.add(cams);this.cams=cams;
 }
 setMode(mode){this.mode=mode;
  if(this.mesh){this.mesh.visible=mode==='surface'||mode==='cover';
   if(!this.photoColors)this.photoColors=this.mesh.geometry.attributes.color.array;
   const src=mode==='cover'&&this.coverColors?this.coverColors:this.photoColors;
   if(this.mesh.geometry.attributes.color.array!==src)this.mesh.geometry.setAttribute('color',new THREE.BufferAttribute(src,3,true));
  }
  if(this.points)this.points.visible=mode==='points';
  if(this.cams)this.cams.visible=mode==='cover';
 }
 fit(){if(!this.points?.geometry.attributes.position.count)return;const b=new THREE.Box3().setFromObject(this.mesh?.geometry.attributes.position.count?this.mesh:this.points),c=b.getCenter(new THREE.Vector3()),s=b.getSize(new THREE.Vector3()).length();if(!Number.isFinite(s)||s<1e-8)return;this.radius=Math.max(s/2,.01);this.controls.target.copy(c);this.camera.position.copy(c).add(new THREE.Vector3(.7,-.5,-1.3).multiplyScalar(s));this.camera.near=s/1000;this.camera.far=s*100;this.camera.updateProjectionMatrix();this.controls.update();}
}
