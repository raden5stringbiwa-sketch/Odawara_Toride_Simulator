'use strict';
// 座標は x,y とも 100〜339（240×240）。表示は縦1:横2のひし形（アイソメ表示）。
const N=240,O=100,S=11,H=5;
const terrain=new Uint8Array(N*N),owner=new Int16Array(N*N).fill(-1),cm=new Uint8Array(N*N);
let forts=[],cs=3,mode='fort',aligned=[];
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),wrap=document.getElementById('wrap');
const COL=['#dfe8b8','#8a7f72','#5aa0d8','#c0504d']; // 平地,山,湖,城

function rect(x1,y1,x2,y2,t){for(let y=y1;y<=y2;y++)for(let x=x1;x<=x2;x++)terrain[(y-O)*N+(x-O)]=t}
// サンプル地形（実データに差し替え予定）
rect(150,160,175,175,2);rect(260,273,268,280,1);rect(290,300,300,312,1);rect(200,120,210,135,1);rect(215,215,221,221,3);rect(120,250,135,262,2);

// 積分画像（範囲内の合計をO(1)で求める）
function ii(a){const W=N+1,I=new Int32Array(W*W);for(let y=0;y<N;y++){let r=0;for(let x=0;x<N;x++){r+=a[y*N+x];I[(y+1)*W+x+1]=I[y*W+x+1]+r}}return I}
function box(I,x1,y1,x2,y2){const W=N+1;return I[(y2+1)*W+x2+1]-I[y1*W+x2+1]-I[(y2+1)*W+x1]+I[y1*W+x1]}

function rebuild(){
 owner.fill(-1);cm.fill(0);aligned=[];
 forts.forEach((f,i)=>{for(let y=Math.max(0,f[1]-H);y<=Math.min(N-1,f[1]+H);y++)for(let x=Math.max(0,f[0]-H);x<=Math.min(N-1,f[0]+H);x++)owner[y*N+x]=i});
 if(forts.length){
  const own=new Uint8Array(N*N),bd=new Uint8Array(N*N);
  for(let i=0;i<N*N;i++)own[i]=owner[i]>=0?1:0;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=y*N+x;
   if(!own[i]&&((x>0&&own[i-1])||(x<N-1&&own[i+1])||(y>0&&own[i-N])||(y<N-1&&own[i+N])))bd[i]=1}
  const Io=ii(own),Ib=ii(bd);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=y*N+x;
   if(terrain[i]!==0||own[i])continue;
   const x1=Math.max(0,x-H),x2=Math.min(N-1,x+H),y1=Math.max(0,y-H),y2=Math.min(N-1,y+H);
   if(box(Io,x1,y1,x2,y2)===0&&box(Ib,x1,y1,x2,y2)>0)cm[i]=1}
  forts.forEach(f=>[[S,0],[-S,0],[0,S],[0,-S]].forEach(([dx,dy])=>{const x=f[0]+dx,y=f[1]+dy;
   if(x>=0&&y>=0&&x<N&&y<N&&cm[y*N+x])aligned.push([x,y])}));
 }
 document.getElementById('cnt').textContent=forts.length;
}

function draw(){
 const W=2*N*cs,Hh=N*cs;cv.width=W;cv.height=Hh;
 // セル座標(gx,gy) → 画面: x=(gx-gy)*cs+W/2, y=(gx+gy)*cs/2
 ctx.setTransform(cs,cs/2,-cs,cs/2,W/2,0);
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=y*N+x;
  ctx.fillStyle=cm[i]?'#86efac':COL[terrain[i]];ctx.fillRect(x,y,1.05,1.05);
  if(owner[i]>=0){ctx.fillStyle='rgba(79,124,240,.55)';ctx.fillRect(x,y,1.05,1.05)}}
 ctx.fillStyle='#16a34a';aligned.forEach(a=>ctx.fillRect(a[0]+.15,a[1]+.15,.7,.7));
 ctx.strokeStyle='#1e3a8a';ctx.lineWidth=.25;
 forts.forEach(f=>ctx.strokeRect(f[0]-H,f[1]-H,S,S));
 ctx.fillStyle='#1e3a8a';ctx.strokeStyle='#fff';ctx.lineWidth=.15;
 forts.forEach(f=>{ctx.fillRect(f[0],f[1],1,1);ctx.strokeRect(f[0],f[1],1,1)});
 ctx.strokeStyle='rgba(0,0,0,.18)';ctx.lineWidth=.08;ctx.beginPath();
 for(let k=0;k<=N;k+=20){ctx.moveTo(k,0);ctx.lineTo(k,N);ctx.moveTo(0,k);ctx.lineTo(N,k)}
 ctx.stroke();
 wrap.scrollLeft=(W-wrap.clientWidth)/2;
}

function cellOf(e){
 const r=cv.getBoundingClientRect();
 const px=(e.clientX-r.left)*cv.width/r.width,py=(e.clientY-r.top)*cv.height/r.height;
 const u=(px-cv.width/2)/cs,v=py/(cs/2); // u=gx-gy, v=gx+gy
 return[Math.floor((u+v)/2),Math.floor((v-u)/2)];
}

function act(gx,gy,drag){
 if(gx<0||gy<0||gx>=N||gy>=N)return;const i=gy*N+gx;
 if(mode==='fort'){
  if(drag)return;
  if(owner[i]>=0)forts.splice(owner[i],1);
  else if(terrain[i]===0&&(forts.length===0||cm[i]))forts.push([gx,gy]);
 }else terrain[i]=mode==='erase'?0:({mountain:1,lake:2,castle:3})[mode];
 rebuild();draw();
}

let down=false;
cv.addEventListener('pointerdown',e=>{down=true;const[g,h]=cellOf(e);act(g,h,false)});
window.addEventListener('pointerup',()=>down=false);
cv.addEventListener('pointermove',e=>{const[g,h]=cellOf(e);
 document.getElementById('pos').textContent=(g>=0&&h>=0&&g<N&&h<N)?'x'+(g+O)+' y'+(h+O):'-';
 if(down&&mode!=='fort')act(g,h,true)});
document.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{mode=b.dataset.m;document.querySelectorAll('[data-m]').forEach(x=>x.classList.toggle('on',x===b))});
document.getElementById('zoom').onchange=e=>{cs=+e.target.value;draw()};
document.getElementById('clear').onclick=()=>{forts=[];rebuild();draw()};
rebuild();draw();
