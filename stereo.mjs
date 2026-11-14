// Measured multiview geometry only. World->camera R,t, COLMAP pixel centres.
export const mv=(r,p)=>[r[0]*p[0]+r[1]*p[1]+r[2]*p[2],r[3]*p[0]+r[4]*p[1]+r[5]*p[2],r[6]*p[0]+r[7]*p[1]+r[8]*p[2]];
export const mt=(r,p)=>[r[0]*p[0]+r[3]*p[1]+r[6]*p[2],r[1]*p[0]+r[4]*p[1]+r[7]*p[2],r[2]*p[0]+r[5]*p[1]+r[8]*p[2]];
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const norm=p=>Math.hypot(...p);
export const center=p=>mt(p.R,p.t.map(v=>-v));
export function project(pose,cam,p){const q=add(mv(pose.R,p),pose.t);return [cam.focal*q[0]/q[2]+cam.cx,cam.focal*q[1]/q[2]+cam.cy,q[2]];}
export function unproject(pose,cam,x,y,z){return mt(pose.R,sub([(x-cam.cx)*z/cam.focal,(y-cam.cy)*z/cam.focal,z],pose.t));}
export function gray(image){const g=new Float32Array(image.width*image.height); for(let i=0;i<g.length;i++)g[i]=.299*image.data[4*i]+.587*image.data[4*i+1]+.114*image.data[4*i+2];return g;}
const sample=(g,w,h,x,y)=>{x-=.5;y-=.5;const a=Math.floor(x),b=Math.floor(y);if(a<0||b<0||a>=w-1||b>=h-1)return NaN;const u=x-a,v=y-b,k=b*w+a;return (1-v)*((1-u)*g[k]+u*g[k+1])+v*((1-u)*g[k+w]+u*g[k+w+1]);};
const quant=(a,q)=>a[Math.min(a.length-1,Math.floor(q*(a.length-1)))];
export function selectNeighbors(poses,idx,depth){const p=poses[idx],a=center(p); return poses.map((q,i)=>{if(i===idx||!q.registered)return null;const d=norm(sub(center(q),a))/depth,ang=p.R[6]*q.R[6]+p.R[7]*q.R[7]+p.R[8]*q.R[8];return d>.025&&d<.55&&ang>.65?{i,score:Math.abs(d-.12)}:null;}).filter(Boolean).sort((a,b)=>a.score-b.score).slice(0,3).map(v=>v.i);}
export function inferRanges(reconstruction){return reconstruction.images.map((p)=>{if(!p.registered)return null;const z=reconstruction.points.filter(q=>q.error<3&&q.track.length>=3).map(q=>project(p,reconstruction.camera,q.xyz)[2]).filter(z=>z>0&&Number.isFinite(z)).sort((a,b)=>a-b);if(z.length<20)return null;return [quant(z,.05)*.8,quant(z,.95)*1.2,quant(z,.5)];});}
// Patch NCC after frontoparallel plane warp. No smoothing/filling of failed depth.
export function depthForView({images,poses,camera,reference,range,step=4,planes=64,roi=.88,minNcc=.88,minMargin=.012},progress=()=>{}){
 const p=poses[reference],cam=camera,w=cam.width,h=cam.height;
 const gw=Math.floor((w-1)/step)+1,gh=Math.floor((h-1)/step)+1;
 const depths=new Float32Array(gw*gh),confidence=new Float32Array(gw*gh);
 const near=range[0],far=range[1],mid=range[2]??(near+far)/2;
 const neighbors=selectNeighbors(poses,reference,mid);
 if(neighbors.length<2||!(near>0&&far>near))return {depths,confidence,gw,gh,step,reference,neighbors};
 const grids=images.map(im=>im.gray??gray(im));
 const offsets=[];for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)offsets.push([dx,dy]);
 const rs=new Float64Array(25),scores=new Float64Array(planes),supports=new Uint8Array(planes);
 // Each reference camera ray is rotated to world once per patch sample.
 const c=center(p),dirs=offsets.map(()=>[0,0,0]);
 let accepted=0;
 for(let gy=1;gy<gh-1;gy++){
  const y=gy*step+.5;
  for(let gx=1;gx<gw-1;gx++){
   const x=gx*step+.5;if(Math.abs(x-w/2)>w*roi/2||Math.abs(y-h/2)>h*roi/2)continue;
   let sum=0,sum2=0;
   for(let k=0;k<25;k++){const [dx,dy]=offsets[k];rs[k]=sample(grids[reference],w,h,x+dx,y+dy);sum+=rs[k];sum2+=rs[k]*rs[k];dirs[k]=mt(p.R,[(x+dx-cam.cx)/cam.focal,(y+dy-cam.cy)/cam.focal,1]);}
   const variance=sum2-sum*sum/25;if(!(variance>25*25))continue;
   scores.fill(-2);supports.fill(0);
   for(let di=0;di<planes;di++){
    const inv=1/near+(1/far-1/near)*di/(planes-1),z=1/inv;const cs=[];
    for(const ni of neighbors){let bsum=0,b2=0,ab=0,valid=true;const n=poses[ni];
     for(let k=0;k<25;k++){const d=dirs[k],q=project(n,cam,[c[0]+d[0]*z,c[1]+d[1]*z,c[2]+d[2]*z]);if(q[2]<=0){valid=false;break;}const b=sample(grids[ni],w,h,q[0],q[1]);if(!Number.isFinite(b)){valid=false;break;}bsum+=b;b2+=b*b;ab+=rs[k]*b;}
     const bv=b2-bsum*bsum/25;cs.push(valid&&bv>25*16?(ab-sum*bsum/25)/Math.sqrt(variance*bv):-2);
    }
    cs.sort((a,b)=>b-a);if(cs[1]>minNcc-.06){scores[di]=(cs[0]+cs[1])/2;supports[di]=cs.filter(v=>v>minNcc-.06).length;}
   }
   let best=0;for(let i=1;i<planes;i++)if(scores[i]>scores[best])best=i;
   let second=-2;for(let i=0;i<planes;i++)if(Math.abs(i-best)>2)second=Math.max(second,scores[i]);
   if(best===0||best===planes-1||scores[best]<minNcc||scores[best]-second<minMargin||supports[best]<2)continue;
   // Quadratic sub-plane refinement is bounded to the adjacent depth bin.
   const aa=scores[best-1],bb=scores[best],cc=scores[best+1],den=aa-2*bb+cc;
   const delta=aa>0&&cc>0&&den<-.00001?Math.max(-.5,Math.min(.5,.5*(aa-cc)/den)):0;
   depths[gy*gw+gx]=1/(1/near+(1/far-1/near)*(best+delta)/(planes-1));confidence[gy*gw+gx]=bb;accepted++;
  }
  if(gy%8===0)progress({row:gy,total:gh,accepted});
 }
 return {depths,confidence,gw,gh,step,reference,neighbors};
}
export function surfacesFromDepth({maps,poses,camera,images,tolerance=.025,minSupport=1}){
 const vertices=[],colors=[],faces=[],byRef=new Map(maps.map(m=>[m.reference,m]));
 let candidate=0,rejected=0;
 for(const m of maps){const p=poses[m.reference],indices=new Int32Array(m.depths.length).fill(-1),points=new Array(m.depths.length);
  for(let y=1;y<m.gh-1;y++)for(let x=1;x<m.gw-1;x++){
   const at=y*m.gw+x,z=m.depths[at];if(!z)continue;candidate++;const xyz=unproject(p,camera,x*m.step+.5,y*m.step+.5,z);let agrees=0;
   for(const ni of m.neighbors){const nm=byRef.get(ni);if(!nm)continue;const q=project(poses[ni],camera,xyz);const gx=Math.round((q[0]-.5)/nm.step),gy=Math.round((q[1]-.5)/nm.step);
    if(q[2]<=0||gx<0||gy<0||gx>=nm.gw||gy>=nm.gh)continue;const other=nm.depths[gy*nm.gw+gx];if(!other)continue;
    const repro=project(p,camera,unproject(poses[ni],camera,gx*nm.step+.5,gy*nm.step+.5,other));
    if(Math.abs(other-q[2])/q[2]<tolerance&&Math.hypot(repro[0]-(x*m.step+.5),repro[1]-(y*m.step+.5))<m.step*1.5)agrees++;
   }
   if(agrees<minSupport){rejected++;continue;} indices[at]=vertices.length/3;points[at]=xyz;vertices.push(...xyz);
   const offset=((y*m.step)*camera.width+x*m.step)*4;colors.push(...images[m.reference].data.slice(offset,offset+3));
  }
  const tri=(a,b,c)=>{if(indices[a]<0||indices[b]<0||indices[c]<0)return;const z=Math.min(m.depths[a],m.depths[b],m.depths[c]),maxZ=Math.max(m.depths[a],m.depths[b],m.depths[c]);if(maxZ-z>.04*z)return;const maxEdge=3*m.step*z/camera.focal;if(norm(sub(points[a],points[b]))>maxEdge||norm(sub(points[b],points[c]))>maxEdge||norm(sub(points[c],points[a]))>maxEdge)return;faces.push(indices[a],indices[b],indices[c]);};
  for(let y=1;y<m.gh-2;y++)for(let x=1;x<m.gw-2;x++){const a=y*m.gw+x,b=a+1,c=a+m.gw,d=c+1;tri(a,b,c);tri(b,d,c);}
 }
 return {vertices:new Float32Array(vertices),colors:new Uint8Array(colors),faces:new Uint32Array(faces),stats:{candidate,rejected,vertices:vertices.length/3,faces:faces.length/3}};
}
export function toPLY(model,scale=1,calibrated=false){if(!(Number.isFinite(scale)&&scale>0))throw Error('Invalid scale');const n=model.vertices.length/3,f=model.faces.length/3;let text=`ply\nformat ascii 1.0\ncomment image-matched multiview surface; ${calibrated?'user-calibrated meters':'relative units, not meters'}\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${f}\nproperty list uchar int vertex_indices\nend_header\n`;for(let i=0;i<n;i++)text+=`${Array.from(model.vertices.slice(3*i,3*i+3),v=>(v*scale).toFixed(6)).join(' ')} ${Array.from(model.colors.slice(3*i,3*i+3)).join(' ')}\n`;for(let i=0;i<f;i++)text+=`3 ${Array.from(model.faces.slice(3*i,3*i+3)).join(' ')}\n`;return text;}
