'use strict';
// 座標は x,y とも 100〜339（240×240）。表示は縦1:横2のひし形（アイソメ表示）。
// 上の頂点が最大座標(339,339)、下の頂点が(100,100)、左の頂点が(100,339)、右の頂点が(339,100)。
const N=240,O=100,S=11,H=5;

// 地形・マークの種類。配列の番号が rect() の「種類」の番号になります。
// 追加したいときは、ここに1行足すだけでボタンと凡例も自動で増えます。
const TYPES=[
 {name:'平地',  color:'#dfe8b8', build:true}, // 0（build:true の種類には砦を置ける）
 {name:'山',    color:'#2d5a34'}, // 1
 {name:'浅瀬',  color:'#3aa8a0', build:true}, // 2
 {name:'拠点',  color:'#8c9096'}, // 3（抜け道・山城も同じ色）
 {name:'療養所',color:'#ec6fa5'}, // 4
 {name:'望楼',  color:'#f0a43a'}, // 5
 {name:'矢倉',  color:'#8b5cd6'}, // 6
 {name:'抜け道',color:'#8c9096'}, // 7
 {name:'山城',  color:'#8c9096'}, // 8
 {name:'山道',  color:'#a8794a'}  // 9
];

const terrain=new Uint8Array(N*N),owner=new Int16Array(N*N).fill(-1),cm=new Uint8Array(N*N);
let forts=[],cs=3,mode='fort',aligned=[];
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),wrap=document.getElementById('wrap');

// rect(x1,y1,x2,y2,種類) … ゲームの座標のまま四角い範囲を登録。1マスなら x1=x2,y1=y2。
function rect(x1,y1,x2,y2,t){for(let y=y1;y<=y2;y++)for(let x=x1;x<=x2;x++)if(x>=O&&x<O+N&&y>=O&&y<O+N)terrain[(y-O)*N+(x-O)]=t}
// 多角形（4隅など、頂点を順にたどる）の内側と辺を、種類tで塗る。
function poly(pts,t){
 const put=(x,y)=>{if(x>=O&&y>=O&&x<O+N&&y<O+N)terrain[(y-O)*N+(x-O)]=t};
 const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
 for(let y=Math.min(...ys);y<=Math.max(...ys);y++)for(let x=Math.min(...xs);x<=Math.max(...xs);x++){
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
   const xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1];
   if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
  }
  if(inside)put(x,y);
 }
 for(let i=0;i<pts.length;i++){
  const ax=pts[i][0],ay=pts[i][1],bx=pts[(i+1)%pts.length][0],by=pts[(i+1)%pts.length][1];
  const n=Math.max(Math.abs(bx-ax),Math.abs(by-ay))||1;
  for(let k=0;k<=n;k++)put(Math.round(ax+(bx-ax)*k/n),Math.round(ay+(by-ay)*k/n));
 }
}
// 浅瀬（1マス）。座標を書く。
function shallow(x,y){rect(x,y,x,y,2)}
// 画面上で四角く見える帯を塗る。u=x-y（画面の左右位置）、v=x+y（画面の上下位置）で範囲を指定。
function band(u1,u2,v1,v2,t){
 for(let gy=0;gy<N;gy++)for(let gx=0;gx<N;gx++){
  const x=gx+O,y=gy+O,u=x-y,v=x+y;
  if(u>=u1&&u<=u2&&v>=v1&&v<=v2)terrain[gy*N+gx]=t;
 }
}

// ---- 地形・マークのデータ ----
// 山（後に書いたものが上書きされるので、山を先に書く）
rect(265,273,269,338,1);
// 浅瀬：画面の左右に1つずつある縦長のエリア（左右対称）。概算。日曜日に測り直して修正予定。
// 左側の浅瀬の4隅（上の左・上の右・下の右・下の左）。右側は x と y を入れ替えた鏡像で作る。
const SHALLOW_L=[[193,295],[198,289],[149,240],[143,246]];

// 山の帯：浅瀬の上辺どうし・下辺どうしをつなぐ。厚みは画面で縦に MT 段。
// 位置は浅瀬の4隅から自動で決まるので、浅瀬の座標を直せば帯も追従する。
const MT=8;
const BAND_V=2*MT-1; // 帯の厚み（v=x+y の幅）。山道が端から端まで抜けるよう、16でなく15にしている
const SV=SHALLOW_L.map(([x,y])=>x+y),SU=SHALLOW_L.map(([x,y])=>Math.abs(x-y));
const V_TOP=Math.max(...SV),V_BOT=Math.min(...SV);
const U_IN=Math.round(SU.reduce((a,b)=>a+b,0)/SU.length); // 浅瀬の幅の中ほどまで食い込ませて、すき間を作らない
band(-U_IN,U_IN,V_TOP-BAND_V+1,V_TOP,1);   // 上の帯
band(-U_IN,U_IN,V_BOT,V_BOT+BAND_V-1,1);   // 下の帯

// 浅瀬（山の上に重ねる）
poly(SHALLOW_L,2);
poly(SHALLOW_L.map(([x,y])=>[y,x]),2);

// ===== 座標の一覧 =====
// 1行に「x,y,種類,マス数」。(x,y)が中心で、マス数は 5×5 のように書く。
// マス数を空にすると1マスだけ。下の行ほど後から上書きされる。
// 見出し行や空行は無視されるので、送ってもらった表をそのまま貼れる。
const MARKS=`
x,y,地形,マス数
320,320,拠点,5×5
220,220,拠点,5×5
267,309,拠点,5×5
260,180,望楼,3×3
180,260,望楼,3×3
320,210,拠点,5×5
280,160,拠点,5×5
230,120,拠点,5×5
280,230,矢倉,3×3
210,160,療養所,3×3
210,320,拠点,5×5
160,280,拠点,5×5
120,230,拠点,5×5
160,210,矢倉,3×3
230,280,療養所,3×3
300,300,抜け道,3×3
267,330,山城,5×5
329,267,山城,5×5
120,120,拠点,5×5
140,140,抜け道,3×3
131,172,山城,5×5
172,130,山城,5×5
240,200,抜け道,3×3
200,240,抜け道,3×3
221,261,山道,3×3
261,221,山道,3×3
178,218,山道,3×3
218,178,山道,3×3
198,289,浅瀬,
198,290,浅瀬,
200,288,山,
193,295,浅瀬,
192,295,浅瀬,
195,294,浅瀬,
191,294,浅瀬,
186,290,浅瀬,
188,293,浅瀬,
144,245,浅瀬,
151,239,山,
156,245,山,
153,245,山,
144,246,浅瀬,
143,246,浅瀬,
144,244,浅瀬,
145,243,平地,
147,241,平地,
146,242,平地,
149,239,平地,
150,239,平地,
`;
(function applyMarks(){
 const byName=Object.fromEntries(TYPES.map((t,i)=>[t.name,i]));
 MARKS.split('\n').forEach(line=>{
  const f=line.split(/[,，]/).map(v=>v.trim());
  if(f.length<3||!/^\d+$/.test(f[0]))return; // 見出し・空行は無視
  const t=byName[f[2]];
  if(t===undefined){console.warn('未登録の種類:',line);return}
  const x=+f[0],y=+f[1],m=(f[3]||'').match(/(\d+)\s*[×xX*＊]\s*(\d+)/);
  const w=m?+m[1]:1,h=m?+m[2]:1;
  const x1=x-Math.floor((w-1)/2),y1=y-Math.floor((h-1)/2);
  rect(x1,y1,x1+w-1,y1+h-1,t);
  // 山道は、中心の3×3に加えて、斜め（画面の上下）両側の4×4も山道。帯を端から端まで抜ける道になる。
  if(f[2]==='山道'&&w===3&&h===3){rect(x-4,y-4,x-1,y-1,t);rect(x+1,y+1,x+4,y+4,t)}
 });
})();
// ----------------------------

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
   if(own[i])continue;
   // 斜め（角）で接する場合も隣接とみなす（8方向）
   let t=false;
   for(let dy=-1;dy<=1&&!t;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;
    if((dx||dy)&&xx>=0&&yy>=0&&xx<N&&yy<N&&own[yy*N+xx]){t=true;break}}
   if(t)bd[i]=1}
  const Io=ii(own),Ib=ii(bd);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=y*N+x;
   if(!TYPES[terrain[i]].build||own[i])continue;
   const x1=Math.max(0,x-H),x2=Math.min(N-1,x+H),y1=Math.max(0,y-H),y2=Math.min(N-1,y+H);
   if(box(Io,x1,y1,x2,y2)===0&&box(Ib,x1,y1,x2,y2)>0)cm[i]=1}
  forts.forEach(f=>[[S,0],[-S,0],[0,S],[0,-S]].forEach(([dx,dy])=>{const x=f[0]+dx,y=f[1]+dy;
   if(x>=0&&y>=0&&x<N&&y<N&&cm[y*N+x])aligned.push([x,y])}));
 }
 document.getElementById('cnt').textContent=forts.length;
}

function draw(){
 const W=Math.round(2*N*cs),Hh=Math.round(N*cs);cv.width=W;cv.height=Hh;
 // セル座標(gx,gy) → 画面: x=(gx-gy)*cs+W/2, y=Hh-(gx+gy)*cs/2
 // （左の頂点が y大・x小、右の頂点が x大・y小）
 ctx.setTransform(cs,-cs/2,-cs,-cs/2,W/2,Hh);
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=y*N+x;
  ctx.fillStyle=cm[i]?'#86efac':TYPES[terrain[i]].color;ctx.fillRect(x,y,1.05,1.05);
  if(owner[i]>=0){ctx.fillStyle='rgba(79,124,240,.55)';ctx.fillRect(x,y,1.05,1.05)}}
 ctx.fillStyle='#16a34a';aligned.forEach(a=>ctx.fillRect(a[0]+.15,a[1]+.15,.7,.7));
 ctx.strokeStyle='#1e3a8a';ctx.lineWidth=.25;
 forts.forEach(f=>ctx.strokeRect(f[0]-H,f[1]-H,S,S));
 ctx.fillStyle='#1e3a8a';ctx.strokeStyle='#fff';ctx.lineWidth=.15;
 forts.forEach(f=>{ctx.fillRect(f[0],f[1],1,1);ctx.strokeRect(f[0],f[1],1,1)});
 ctx.strokeStyle='rgba(0,0,0,.18)';ctx.lineWidth=.08;ctx.beginPath();
 for(let k=0;k<=N;k+=20){ctx.moveTo(k,0);ctx.lineTo(k,N);ctx.moveTo(0,k);ctx.lineTo(N,k)}
 ctx.stroke();
}

function cellOf(e){
 const r=cv.getBoundingClientRect();
 const px=(e.clientX-r.left)*cv.width/r.width,py=(e.clientY-r.top)*cv.height/r.height;
 const u=(px-cv.width/2)/cs,v=(cv.height-py)/(cs/2); // u=gx-gy, v=gx+gy
 return[Math.floor((v+u)/2),Math.floor((v-u)/2)];
}

function act(gx,gy,drag){
 if(gx<0||gy<0||gx>=N||gy>=N)return;const i=gy*N+gx;
 if(mode==='fort'){
  if(drag)return;
  if(owner[i]>=0)forts.splice(owner[i],1);
  else if(TYPES[terrain[i]].build&&(forts.length===0||cm[i]))forts.push([gx,gy]);
 }else terrain[i]=mode==='erase'?0:+mode;
 rebuild();draw();
}

// ボタンと凡例を TYPES から自動生成
const tools=document.getElementById('tools');
function addBtn(label,m,on){const b=document.createElement('button');b.textContent=label;b.dataset.m=m;if(on)b.className='on';
 b.onclick=()=>{mode=m;tools.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b))};tools.appendChild(b)}
addBtn('砦','fort',true);
TYPES.forEach((t,i)=>{if(i)addBtn(t.name,String(i))});
addBtn('平地に戻す','erase');
const colorGroups=new Map();
TYPES.forEach(t=>colorGroups.set(t.color,(colorGroups.get(t.color)||[]).concat(t.name)));
const legendItems=[...colorGroups].map(([c,names])=>[names.join('・'),c]).concat([['砦の範囲','#4f7cf0'],['砦（中央）','#1e3a8a'],['置ける場所','#86efac'],['ぴったり接続（11マス先）','#16a34a']]);
document.getElementById('legend').innerHTML=legendItems.map(([n,c])=>'<span><i style="background:'+c+'"></i>'+n+'</span>').join('');

let down=false;
let start=null;
cv.addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse'){down=true;const[g,h]=cellOf(e);act(g,h,false)}
 else start={x:e.clientX,y:e.clientY}; // タッチはタップ（指が動かなかったとき）だけ反応
});
cv.addEventListener('pointerup',e=>{
 if(e.pointerType!=='mouse'&&start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<8){const[g,h]=cellOf(e);act(g,h,false)}
 start=null;
});
cv.addEventListener('pointercancel',()=>{start=null});
window.addEventListener('pointerup',()=>down=false);
cv.addEventListener('pointermove',e=>{const[g,h]=cellOf(e);
 document.getElementById('pos').textContent=(g>=0&&h>=0&&g<N&&h<N)?'x'+(g+O)+' y'+(h+O):'-';
 if(down&&mode!=='fort')act(g,h,true)});
// ズーム：'fit'＝鳥の目（全体が1画面に収まる倍率）、数字＝1マスのピクセル数（虫の目は10）
let zoomMode='3';
function fitScale(){return Math.max(0.3,Math.min((wrap.clientWidth-2)/(2*N),(wrap.clientHeight-2)/N))}
function setZoom(v){
 zoomMode=v;
 // 切替前に画面の中心にあった地点を、切替後も画面の中心に保つ
 const fx=(wrap.scrollLeft+wrap.clientWidth/2)/cv.width,fy=(wrap.scrollTop+wrap.clientHeight/2)/cv.height;
 cs=v==='fit'?fitScale():+v;
 draw();
 wrap.scrollLeft=fx*cv.width-wrap.clientWidth/2;
 wrap.scrollTop=fy*cv.height-wrap.clientHeight/2;
}
document.getElementById('zoom').onchange=e=>setZoom(e.target.value);
window.addEventListener('resize',()=>{if(zoomMode==='fit')setZoom('fit')});
document.getElementById('clear').onclick=()=>{forts=[];rebuild();draw()};
rebuild();draw();
wrap.scrollLeft=(cv.width-wrap.clientWidth)/2;
