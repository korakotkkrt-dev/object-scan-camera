// Independent ray/surface fixture; known depths, deterministic surface textures.
const hash=(x,y,s)=>{let v=Math.imul(x+1031,73856093)^Math.imul(y+917,19349663)^s;v=Math.imul(v^(v>>>16),0x45d9f3b);return ((v^(v>>>16))>>>0)/4294967295;};
function tex(x,y,s){const u=x*32,v=y*32,a=Math.floor(u),b=Math.floor(v),dx=u-a,dy=v-b;const mix=(p,q,t)=>p*(1-t)+q*t;return 35+200*mix(mix(hash(a,b,s),hash(a+1,b,s),dx),mix(hash(a,b+1,s),hash(a+1,b+1,s),dx),dy);}
export function makeFixture({width=160,height=120,count=7}={}){
 const camera={width,height,focal:width*1.05,cx:width/2,cy:height/2,model:'SIMPLE_PINHOLE'},images=[],poses=[],truth=[];
 for(let i=0;i<count;i++){const cx=(i/(count-1)-.5)*1.25,cy=.09*Math.sin(i*1.3),R=[1,0,0,0,1,0,0,0,1],t=[-cx,-cy,0];poses.push({name:`frame_${String(i).padStart(3,'0')}.jpg`,R,t,registered:true});const data=new Uint8ClampedArray(width*height*4),depth=new Float32Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const rx=(x+.5-camera.cx)/camera.focal,ry=(y+.5-camera.cy)/camera.focal;let z=6;
   const ax=cx+rx*4.2,ay=cy+ry*4.2;if(ax>-.85&&ax<.35&&ay>-.7&&ay<.7)z=4.2;
   const bx=cx+rx*4.9,by=cy+ry*4.9;if(z>4.9&&bx>.42&&bx<1.1&&by>-.55&&by<.6)z=4.9;
   const wx=cx+rx*z,wy=cy+ry*z,s=z<4.5?125:z<5.5?446:732;
   const value=tex(wx,wy,s),at=(y*width+x)*4;data[at]=value;data[at+1]=value*(z<4.5?.82:z<5.5?1:.9);data[at+2]=value*(z<4.5?.65:z<5.5?.85:1);data[at+3]=255;depth[y*width+x]=z;
 }images.push({width,height,data});truth.push(depth);}
 return {camera,images,poses,truth};
}
