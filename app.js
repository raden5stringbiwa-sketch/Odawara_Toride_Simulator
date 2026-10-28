'use strict';
// 座標は x,y とも 100〜339（240×240）。表示は縦1:横2のひし形（アイソメ表示）。
// 上の頂点が最大座標(339,339)、下の頂点が(100,100)、左の頂点が(100,339)、右の頂点が(339,100)。
const N=240,O=100,S=11,H=5;

// 地形・マークの種類。配列の番号が rect() の「種類」の番号になります。
// 追加したいときは、ここに1行足すだけで凡例も自動で増えます。
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
const ov=document.getElementById('ov'),octx=ov.getContext('2d'); // 置く前の仮の砦を描く上の層（軽く動かすため別にしている）
let ghost=null,snapT=[],snapOn=true,touchUI=false,showArea=true,attack=[];

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

// ===== 攻撃できるエリア =====
// 拠点・矢倉・療養所・抜け道には、まわりにエリアがあり、砦の範囲がそのエリアに隣接する（辺・角で接する、または重なる）と攻撃できる。
// エリアは建物の中心を中心にした正方形で、値は一辺のマス数（奇数）。望楼・山城にはエリアがない。
// 「拠点の大きさ(5×5)から3マスずつ広げた正方形」なので、いまは4種類とも11。
// 3×3の建物は「建物の大きさから3マス広げた9×9」にしたいなら、矢倉・療養所・抜け道を 9 にする。
const AREAS={拠点:11,矢倉:11,療養所:11,抜け道:11};
const buildings=[]; // {name,x,y}：エリアを持つ建物（x,yはマップ上の位置。砦と同じ0始まり）

// ===== 座標の一覧 =====
// 1行に「x,y,種類,マス数」。(x,y)が中心で、マス数は 5×5 のように書く。
// 5番目に「エリアなし」と書くと、その建物には攻撃エリアを付けない（例: 240,200,抜け道,3×3,エリアなし）。
// マス数を空にすると1マスだけ。「x1,y1～x2,y2,種類」と書くと四角い範囲（1列の線も）になる。
// 「多角形 x,y x,y x,y x,y 種類」と書くと、点を順につないだ多角形の内側を塗る（斜めの帯に使う）。
// 下の行ほど後から上書きされる。見出し行・空行・#で始まる行は無視されるので、送ってもらった表をそのまま貼れる。
const MARKS=`
x,y,地形,マス数
320,320,拠点,5×5
220,220,拠点,5×5
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
120,120,拠点,5×5
140,140,抜け道,3×3
240,200,抜け道,3×3,エリアなし
200,240,抜け道,3×3,エリアなし
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
# 訂正（10/21）
256,152,浅瀬
179,210,平地
178,211,平地
178,212,平地
173,216,平地
172,217,平地
173,217,平地
171,218,平地
172,218,平地
170,219,平地
171,219,平地
172,219,平地
169,220,平地
170,220,平地
171,220,平地
168,221,平地
169,221,平地
170,221,平地
166,223,平地
179,223,平地
165,224,平地
166,224,平地
164,225,平地
165,225,平地
163,226,平地
162,227,平地
161,228,平地
162,228,平地
175,228,平地
160,229,平地
174,229,平地
173,230,平地
158,231,平地
157,232,平地
156,233,平地
157,233,平地
156,234,平地
154,235,平地
153,236,平地
154,236,平地
151,238,平地
168,272,浅瀬
168,273,浅瀬
169,272,浅瀬
169,273,浅瀬
170,273,浅瀬
186,289,浅瀬
187,290,浅瀬
188,291,浅瀬
188,292,浅瀬
189,292,浅瀬
189,293,浅瀬
190,293,浅瀬
253,149,浅瀬
254,149,浅瀬
255,149,浅瀬
256,149,浅瀬
254,150,浅瀬
255,150,浅瀬
256,150,浅瀬
255,151,浅瀬
256,151,浅瀬
233,156,平地
230,158,山
229,160,平地
229,161,平地
227,162,平地
224,165,平地
221,167,山
220,169,平地
219,170,平地
218,171,平地
218,172,平地
218,173,平地
148,240,浅瀬
144,244,平地
146,250,浅瀬
147,251,浅瀬
148,252,浅瀬
189,200,平地
188,201,平地
189,201,平地
188,202,平地
189,202,平地
186,203,平地
185,204,平地
184,205,平地
181,208,平地
180,209,平地
181,209,平地
180,210,平地
177,212,平地
176,213,平地
177,213,平地

`;

// ===== 対称に置くもの =====
// 「@左右」「@上下」「@左右上下」の行から、次の @ の行までに書いたものは、対称な位置にも自動で置かれる。
//   左右＝x と y を入れ替えた位置（画面で左右に折り返し）／上下＝画面で上下に折り返した位置。
//   @左右上下 なら、元と合わせて4か所。左上側の1つ分だけ書けばよい。
// 対称の中心は (220,220)。
const MARKS_SYM=`
@左右上下
# 左上の山の帯（y289から。x265〜269・y273〜288は平地）
265,289～269,338,山
# 帯の左側の張り出し（塗りつぶし）と、1マスの山
230,290～265,295,山
229,295,山,
# 帯の左右をつなぐ山（x=270,y289〜295 から、右側の山の帯へ。画面で横にのびる）
多角形 270,289 270,295 295,270 289,270 山
# 山城（左上の2か所。対称の位置にも置かれて、全部で8か所）
267,309,山城,5×5
267,330,山城,5×5
# 山城の両脇（山の帯をはさむ3×11。中心から x は±3〜5、y は±5。すべての山城に同じ形で付く）
262,304～264,314,山城
270,304～272,314,山城
262,325～264,335,山城
270,325～272,335,山城
`;

(function applyMarks(){
 const byName=Object.fromEntries(TYPES.map((t,i)=>[t.name,i]));
 const RANGE=/^\s*(\d+)\s*[,，]\s*(\d+)\s*[~～〜]\s*(\d+)\s*[,，]\s*(\d+)\s*[,，]\s*([^,，\s]+)/;
 // 1行 → 塗る四角（山道は、中心の3×3に加えて斜め両側の4×4も山道）。読めない行は null。
 function parse(line){
  if(line.trim().startsWith('多角形')){
   const pts=[...line.matchAll(/(\d+)\s*[,，]\s*(\d+)/g)].map(m=>[+m[1],+m[2]]);
   const t=byName[line.trim().split(/[\s,，]+/).pop()];
   if(t===undefined||pts.length<3){console.warn('多角形の書き方が違います:',line);return null}
   return{t,poly:pts};
  }
  const r=line.match(RANGE);
  if(r){
   const t=byName[r[5]];if(t===undefined){console.warn('未登録の種類:',line);return null}
   const a=+r[1],b=+r[2],c=+r[3],d=+r[4];
   return{t,rects:[[Math.min(a,c),Math.min(b,d),Math.max(a,c),Math.max(b,d)]]};
  }
  const f=line.split(/[,，]/).map(v=>v.trim());
  if(f.length<3||!/^\d+$/.test(f[0]))return null; // 見出し・コメント・空行は無視
  const t=byName[f[2]];if(t===undefined){console.warn('未登録の種類:',line);return null}
  const x=+f[0],y=+f[1],m=(f[3]||'').match(/(\d+)\s*[×xX*＊]\s*(\d+)/);
  const w=m?+m[1]:1,h=m?+m[2]:1;
  const x1=x-Math.floor((w-1)/2),y1=y-Math.floor((h-1)/2);
  const rects=[[x1,y1,x1+w-1,y1+h-1]];
  if(f[2]==='山道'&&w===3&&h===3)rects.push([x-4,y-4,x-1,y-1],[x+1,y+1,x+4,y+4]);
  return{t,rects,name:f[2],center:[x,y],noArea:(f[4]||'').includes('エリアなし')};
 }
 const TF={
  id:(x,y)=>[x,y],
  lr:(x,y)=>[y,x],              // 左右：x と y を入れ替え
  ud:(x,y)=>[440-y,440-x],      // 上下：画面で上下に折り返し
  both:(x,y)=>[440-x,440-y]     // 左右＋上下
 };
 function stamp(sh,tf){
  if(sh.poly){poly(sh.poly.map(([x,y])=>TF[tf](x,y)),sh.t);return}
  sh.rects.forEach(r=>{
   const p=TF[tf](r[0],r[1]),q=TF[tf](r[2],r[3]);
   rect(Math.min(p[0],q[0]),Math.min(p[1],q[1]),Math.max(p[0],q[0]),Math.max(p[1],q[1]),sh.t);
  });
  if(sh.center&&AREAS[sh.name]&&!sh.noArea){ // エリアを持つ建物は、あとで攻撃判定に使うので記録しておく
   const c=TF[tf](sh.center[0],sh.center[1]),bx=c[0]-O,by=c[1]-O;
   if(!buildings.some(b=>b.name===sh.name&&b.x===bx&&b.y===by))buildings.push({name:sh.name,x:bx,y:by});
  }
 }
 MARKS.split('\n').forEach(line=>{const sh=parse(line);if(sh)stamp(sh,'id')});
 let tfs=['id'];
 MARKS_SYM.split('\n').forEach(line=>{
  if(line.trim().startsWith('@')){
   const lr=line.includes('左右'),ud=line.includes('上下');
   tfs=['id'].concat(lr?['lr']:[],ud?['ud']:[],lr&&ud?['both']:[]);
   return;
  }
  const sh=parse(line);if(sh)tfs.forEach(tf=>stamp(sh,tf));
 });
})();
// ----------------------------

// 積分画像（範囲内の合計をO(1)で求める）
function ii(a){const W=N+1,I=new Int32Array(W*W);for(let y=0;y<N;y++){let r=0;for(let x=0;x<N;x++){r+=a[y*N+x];I[(y+1)*W+x+1]=I[y*W+x+1]+r}}return I}
function box(I,x1,y1,x2,y2){const W=N+1;return I[(y2+1)*W+x2+1]-I[y1*W+x2+1]-I[(y2+1)*W+x1]+I[y1*W+x1]}

function rebuild(){
 owner.fill(-1);cm.fill(0);aligned=[];snapT=[];
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
 // 吸着先：既存の砦から11マス先（辺で接する4か所＋角で接する4か所）のうち、置ける場所
 forts.forEach(f=>[[S,0],[-S,0],[0,S],[0,-S],[S,S],[S,-S],[-S,S],[-S,-S]].forEach(([dx,dy])=>{
  const x=f[0]+dx,y=f[1]+dy;if(canPlace(x,y))snapT.push([x,y])}));
 // 攻撃できる建物：砦の範囲(11×11)が、建物のエリアに隣接する、または重なる
 attack=buildings.map(b=>forts.some(f=>reaches(f[0],f[1],b)));
 document.getElementById('atk').textContent=attack.filter(Boolean).length;
 document.getElementById('atkall').textContent=buildings.length;
 document.getElementById('cnt').textContent=forts.length;
 persist();
}
// 砦(x,y)の範囲が建物bのエリアに届くか。砦の範囲の半径H＋隣接の1＋エリアの半径。
function reaches(x,y,b){return Math.max(Math.abs(x-b.x),Math.abs(y-b.y))<=H+1+(AREAS[b.name]-1)/2}
function atkText(){
 const by={};buildings.forEach((b,i)=>{const e=by[b.name]||(by[b.name]=[0,0]);e[1]++;if(attack[i])e[0]++});
 return '攻撃できる建物 '+attack.filter(Boolean).length+'/'+buildings.length+'（'+Object.keys(by).map(k=>k+' '+by[k][0]+'/'+by[k][1]).join('・')+'）';
}

// 地図を描く本体。c=描く先、W×Hh=その大きさ、k=1マスの大きさ。
// opt.cand=置ける場所（薄緑）などの案内を描く／opt.numbers=砦に置いた順の番号を描く（投稿用画像）
function paintMap(c,W,Hh,k,opt){
 // セル座標(gx,gy) → 画面: x=(gx-gy)*k+W/2, y=Hh-(gx+gy)*k/2
 // （上の頂点が(339,339)、下の頂点が(100,100)、左の頂点が x100・y339、右の頂点が x339・y100）
 c.setTransform(k,-k/2,-k,-k/2,W/2,Hh);
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=y*N+x;
  c.fillStyle=(opt.cand&&cm[i])?'#86efac':TYPES[terrain[i]].color;c.fillRect(x,y,1.05,1.05);
  if(owner[i]>=0){c.fillStyle='rgba(79,124,240,.55)';c.fillRect(x,y,1.05,1.05)}}
 if(opt.cand){c.fillStyle='#16a34a';aligned.forEach(a=>c.fillRect(a[0]+.15,a[1]+.15,.7,.7))}
 if(opt.areas){ // 建物のエリア（攻撃できるものは赤）
  buildings.forEach((b,i)=>{
   const sz=AREAS[b.name],h=(sz-1)/2,hit=attack[i];
   c.fillStyle=hit?'rgba(239,68,68,.30)':'rgba(251,191,36,.22)';c.fillRect(b.x-h,b.y-h,sz,sz);
   c.strokeStyle=hit?'#b91c1c':'#d97706';c.lineWidth=hit?.3:.2;c.strokeRect(b.x-h,b.y-h,sz,sz);
  });
 }
 c.strokeStyle='#1e3a8a';c.lineWidth=.25;
 forts.forEach(f=>c.strokeRect(f[0]-H,f[1]-H,S,S));
 c.fillStyle='#1e3a8a';c.strokeStyle='#fff';c.lineWidth=.15;
 forts.forEach(f=>{c.fillRect(f[0],f[1],1,1);c.strokeRect(f[0],f[1],1,1)});
 c.strokeStyle='rgba(0,0,0,.18)';c.lineWidth=.08;c.beginPath();
 for(let g=0;g<=N;g+=20){c.moveTo(g,0);c.lineTo(g,N);c.moveTo(0,g);c.lineTo(N,g)}
 c.stroke();
 if(opt.numbers){
  c.setTransform(1,0,0,1,0,0);
  const fs=Math.max(11,Math.round(k*3));
  c.font='bold '+fs+'px sans-serif';c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
  forts.forEach((f,n)=>{
   const sx=(f[0]-f[1])*k+W/2,sy=Hh-(f[0]+f[1]+1)*k/2;
   c.lineWidth=Math.max(3,fs/4);c.strokeStyle='#fff';c.strokeText(String(n+1),sx,sy);
   c.fillStyle='#1e3a8a';c.fillText(String(n+1),sx,sy);
  });
 }
}

function draw(){
 const W=Math.round(2*N*cs),Hh=Math.round(N*cs);cv.width=W;cv.height=Hh;ov.width=W;ov.height=Hh;
 paintMap(ctx,W,Hh,cs,{cand:true,areas:showArea});
 drawGhost();
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
 }
 rebuild();draw();
}

// ===== 仮の砦（置く前のプレビュー）=====
function inMap(x,y){return x>=0&&y>=0&&x<N&&y<N}
// 砦の中心として置けるか：置ける地形で、既存の範囲と重ならず、（2つ目からは）既存の範囲と隣接している
function canPlace(x,y){
 if(!inMap(x,y))return false;const i=y*N+x;
 return TYPES[terrain[i]].build&&owner[i]<0&&(forts.length===0||cm[i]===1);
}
function reason(x,y){
 if(!inMap(x,y))return 'マップの外です';
 const i=y*N+x;
 if(!TYPES[terrain[i]].build)return TYPES[terrain[i]].name+'には置けません';
 if(owner[i]>=0)return '砦の範囲の中です';
 for(let yy=Math.max(0,y-H);yy<=Math.min(N-1,y+H);yy++)for(let xx=Math.max(0,x-H);xx<=Math.min(N-1,x+H);xx++)
  if(owner[yy*N+xx]>=0)return '他の砦の範囲と重なります';
 return '砦の範囲に隣接していません';
}
// ぴったり接続する位置の近くなら、そこに吸い付ける（指の位置のズレを補う）
function snap(x,y){
 const r=Math.max(2,Math.round(16/cs));let best=null,bd=1e9;
 for(const t of snapT){const d=Math.max(Math.abs(t[0]-x),Math.abs(t[1]-y));if(d<=r&&d<bd){bd=d;best=t}}
 return best||[x,y];
}
function drawGhost(){
 octx.setTransform(1,0,0,1,0,0);octx.clearRect(0,0,ov.width,ov.height);
 if(!ghost||mode!=='fort')return;
 const ok=canPlace(ghost.x,ghost.y);
 octx.setTransform(cs,-cs/2,-cs,-cs/2,ov.width/2,ov.height);
 octx.fillStyle=ok?'rgba(34,197,94,.30)':'rgba(220,38,38,.30)';octx.fillRect(ghost.x-H,ghost.y-H,S,S);
 octx.strokeStyle=ok?'#15803d':'#b91c1c';octx.lineWidth=.3;octx.strokeRect(ghost.x-H,ghost.y-H,S,S);
 octx.fillStyle=ok?'#1e3a8a':'#b91c1c';octx.fillRect(ghost.x,ghost.y,1,1);
 octx.strokeStyle='#fff';octx.lineWidth=.15;octx.strokeRect(ghost.x,ghost.y,1,1);
}
const ghostbar=document.getElementById('ghostbar'),ghostinfo=document.getElementById('ghostinfo'),gplace=document.getElementById('gplace');
function updateBar(){
 if(!ghost||mode!=='fort'||!touchUI){ghostbar.hidden=true;return}
 const ok=canPlace(ghost.x,ghost.y);
 let gain=0;
 if(ok)buildings.forEach((b,i)=>{if(!attack[i]&&reaches(ghost.x,ghost.y,b))gain++});
 ghostinfo.textContent=(ghost.x+O)+','+(ghost.y+O)+'　'+(ok?'置けます（新たに攻撃できる建物 +'+gain+'）':reason(ghost.x,ghost.y));
 ghostinfo.style.color=ok?'':'#c0392b';
 gplace.disabled=!ok;
 ghostbar.hidden=false;
}
function clearGhost(){ghost=null;drawGhost();updateBar()}
function commitGhost(){
 if(!ghost)return;
 if(!canPlace(ghost.x,ghost.y)){updateBar();return}
 forts.push([ghost.x,ghost.y]);ghost=null;rebuild();draw();updateBar();
}
// スマホのタップ：砦モードなら仮の砦を出す（砦の範囲内をタップすると解除）。ほかのモードはそのマスを塗る。
function tapAt(gx,gy){
 if(!inMap(gx,gy))return;
 const i=gy*N+gx;
 if(owner[i]>=0){forts.splice(owner[i],1);ghost=null;rebuild();draw();updateBar();return}
 const sp=snapOn?snap(gx,gy):[gx,gy];
 ghost={x:sp[0],y:sp[1]};drawGhost();updateBar();
}

// 凡例を TYPES から自動生成（同じ色の種類は1つにまとめる）
const colorGroups=new Map();
TYPES.forEach(t=>colorGroups.set(t.color,(colorGroups.get(t.color)||[]).concat(t.name)));
const legendItems=[...colorGroups].map(([c,names])=>[names.join('・'),c]).concat([['砦の範囲','#4f7cf0'],['砦（中央）','#1e3a8a'],['攻撃エリア','#fbbf24'],['攻撃できるエリア','#ef4444'],['置ける場所','#86efac'],['ぴったり接続（11マス先）','#16a34a']]);
document.getElementById('legend').innerHTML=legendItems.map(([n,c])=>'<span><i style="background:'+c+'"></i>'+n+'</span>').join('');

// ===== 操作 =====
// マウス：クリックで置く／解除（動かすと仮の砦がついてくる）。
// スマホ：タップで仮の砦を出す → ドラッグで位置を調整 → 仮の砦をもう一度タップ（または「ここに置く」）で確定。
//        砦以外の場所をドラッグすると、地図がスクロールする。
let down=false,gs=null;
cv.addEventListener('pointerdown',e=>{
 const[gx,gy]=cellOf(e);
 if(e.pointerType==='mouse'){down=true;touchUI=false;act(gx,gy,false);return}
 cv.setPointerCapture(e.pointerId);touchUI=true;
 gs={x0:e.clientX,y0:e.clientY,sl:wrap.scrollLeft,st:wrap.scrollTop,moved:false,
  onGhost:!!ghost&&mode==='fort'&&Math.abs(gx-ghost.x)<=H&&Math.abs(gy-ghost.y)<=H,
  grab:ghost?[gx-ghost.x,gy-ghost.y]:[0,0]};
});
cv.addEventListener('pointermove',e=>{
 const[gx,gy]=cellOf(e);
 if(e.pointerType==='mouse'){
  document.getElementById('pos').textContent=inMap(gx,gy)?(gx+O)+','+(gy+O):'-';
  if(!down){ghost=inMap(gx,gy)?{x:gx,y:gy}:null;drawGhost()}
  return;
 }
 if(!gs)return;
 if(!gs.moved&&Math.hypot(e.clientX-gs.x0,e.clientY-gs.y0)>8)gs.moved=true;
 if(!gs.moved)return;
 if(gs.onGhost){ // 仮の砦をつかんで動かす（最初につかんだ位置を保つ）
  const t=[gx-gs.grab[0],gy-gs.grab[1]],sp=snapOn?snap(t[0],t[1]):t;
  ghost={x:sp[0],y:sp[1]};drawGhost();updateBar();
 }else{ // 地図をスクロール
  wrap.scrollLeft=gs.sl-(e.clientX-gs.x0);wrap.scrollTop=gs.st-(e.clientY-gs.y0);
 }
});
cv.addEventListener('pointerup',e=>{
 down=false;
 if(e.pointerType==='mouse'||!gs)return;
 const t=gs;gs=null;
 if(t.moved)return;
 if(t.onGhost){commitGhost();return}
 const[gx,gy]=cellOf(e);tapAt(gx,gy);
});
cv.addEventListener('pointercancel',()=>{gs=null;down=false});
cv.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&mode==='fort'){ghost=null;drawGhost()}});
window.addEventListener('pointerup',()=>down=false);
gplace.onclick=commitGhost;
document.getElementById('gcancel').onclick=clearGhost;
document.getElementById('snap').onchange=e=>{snapOn=e.target.checked};
document.getElementById('showarea').onchange=e=>{showArea=e.target.checked;draw()};
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
document.getElementById('clear').onclick=()=>{if(forts.length&&!confirm('すべての砦を解除しますか？'))return;forts=[];ghost=null;rebuild();draw();updateBar()};
// ===== 保存 =====
// 置いた砦は、変えるたびにこのブラウザへ自動で保存され、次に開いたとき続きから始まる。
// 「保存・読み込み」では名前をつけて残せる。コードをコピーすれば、同盟員に配置を渡せる。
// 保存するのは砦の座標（ゲームの座標）だけ。地形は app.js のデータから作られる。
const KEY_CUR='fortsim.v1.current',KEY_SAVES='fortsim.v1.saves';
function lsGet(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}
function fortsToGame(){return forts.map(f=>[f[0]+O,f[1]+O])}
function setFortsFromGame(list){
 forts=(list||[]).filter(p=>Array.isArray(p)&&p.length===2&&Number.isInteger(p[0])&&Number.isInteger(p[1])&&inMap(p[0]-O,p[1]-O)).map(p=>[p[0]-O,p[1]-O]);
}
function persist(){lsSet(KEY_CUR,fortsToGame())}
function codeOf(){return 'FORT1: '+fortsToGame().map(p=>p[0]+','+p[1]).join(' ')}
function parseCode(text){
 if(!/FORT1/.test(text))return null;
 // 新しい形式（219,290 208,299 …）も、前の形式（219.290;208.299 …）も読める
 return [...text.split('FORT1')[1].matchAll(/(\d+)\s*[,，.]\s*(\d+)/g)].map(m=>[+m[1],+m[2]]);
}
const pad2=n=>String(n).padStart(2,'0');
function stampText(){const d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+' '+pad2(d.getHours())+':'+pad2(d.getMinutes())}
function flash(btn,msg){const t=btn.textContent;btn.textContent=msg;setTimeout(()=>{btn.textContent=t},1500)}
function loadLayout(list){
 if(forts.length&&!confirm('いまの配置は置き換えられます。読み込みますか？'))return false;
 setFortsFromGame(list);ghost=null;rebuild();draw();updateBar();return true;
}
const savesdlg=document.getElementById('saves'),savelist=document.getElementById('savelist');
function renderSaves(){
 const arr=lsGet(KEY_SAVES)||[];
 savelist.textContent='';
 if(!arr.length){const li=document.createElement('li');li.textContent='保存した配置はまだありません';savelist.appendChild(li)}
 arr.forEach((it,idx)=>{
  const li=document.createElement('li'),sp=document.createElement('span');
  sp.textContent=it.name+'（'+it.forts.length+'基）';
  const b1=document.createElement('button');b1.textContent='読み込む';
  b1.onclick=()=>{if(loadLayout(it.forts))savesdlg.hidden=true};
  const b2=document.createElement('button');b2.textContent='削除';
  b2.onclick=()=>{if(!confirm('「'+it.name+'」を削除しますか？'))return;arr.splice(idx,1);lsSet(KEY_SAVES,arr);renderSaves()};
  li.append(sp,b1,b2);savelist.appendChild(li);
 });
}
document.getElementById('open-saves').onclick=()=>{renderSaves();savesdlg.hidden=false};
document.getElementById('savesclose').onclick=()=>{savesdlg.hidden=true};
document.getElementById('savedo').onclick=()=>{
 const inp=document.getElementById('savename'),arr=lsGet(KEY_SAVES)||[];
 arr.push({name:inp.value.trim()||('配置 '+stampText()),t:Date.now(),forts:fortsToGame()});
 if(!lsSet(KEY_SAVES,arr)){alert('保存できませんでした（ブラウザの保存が使えない状態です）');return}
 inp.value='';renderSaves();
};
document.getElementById('codecopy').onclick=async e=>{
 try{await navigator.clipboard.writeText(codeOf());flash(e.target,'コピーしました')}
 catch(err){prompt('コピーして使ってください',codeOf())}
};
document.getElementById('codeload').onclick=()=>{
 const inp=document.getElementById('codein'),list=parseCode(inp.value);
 if(!list||!list.length){alert('コードが読み取れませんでした（FORT1 から始まるコードを貼ってください）');return}
 if(loadLayout(list)){inp.value='';savesdlg.hidden=true}
};

// ===== 投稿用画像（Discordなどに貼る用）=====
// 地図全体＋砦（置いた順の番号つき）＋凡例の画像を作る。スマホは「共有」、パソコンは「コピー」「保存」が使える。
const shotdlg=document.getElementById('shot'),shotimg=document.getElementById('shotimg');
const shotshare=document.getElementById('shotshare'),shotcopy=document.getElementById('shotcopy');
let shotBlob=null,shotUrl=null;
function shotName(){return 'fort-'+stampText().replace(/[^0-9]/g,'')+'.png'}
function coordText(){return '砦配置（'+forts.length+'基）\n'+atkText()+'\n'+forts.map((f,i)=>(i+1)+': '+(f[0]+O)+','+(f[1]+O)).join('\n')}
function makeShot(){
 const k=4,mw=2*N*k,mh=N*k,pad=24,head=132,W=mw+pad*2;
 const font='"Hiragino Sans","Yu Gothic",Meiryo,sans-serif';
 const items=[...colorGroups].map(([c,names])=>[names.join('・'),c]).concat([['砦の範囲','#4f7cf0'],['砦（中央）','#1e3a8a'],['攻撃エリア','#fbbf24'],['攻撃できるエリア','#ef4444']]);
 // 凡例を折り返して並べる
 const m=document.createElement('canvas').getContext('2d');m.font='22px '+font;
 const rows=[[]];let rx=0;
 items.forEach(it=>{
  const w=34+m.measureText(it[0]).width+22;
  if(rx+w>W-pad*2&&rows[rows.length-1].length){rows.push([]);rx=0}
  rows[rows.length-1].push([it,rx]);rx+=w;
 });
 const c=document.createElement('canvas');c.width=W;c.height=head+mh+rows.length*38+44;
 const g=c.getContext('2d');
 g.fillStyle='#ffffff';g.fillRect(0,0,c.width,c.height);
 g.textBaseline='middle';g.textAlign='left';
 g.fillStyle='#1f2933';g.font='bold 40px '+font;g.fillText('砦配置シミュレーション',pad,46);
 g.fillStyle='#52606d';g.font='24px '+font;g.fillText('砦 '+forts.length+' 基　'+stampText(),pad,80);
 g.fillText(atkText(),pad,114);
 const mc=document.createElement('canvas');mc.width=mw;mc.height=mh;
 const mg=mc.getContext('2d');mg.fillStyle='#e6e8e4';mg.fillRect(0,0,mw,mh);
 paintMap(mg,mw,mh,k,{numbers:true,areas:true});
 g.drawImage(mc,pad,head);
 g.font='22px '+font;
 rows.forEach((row,r)=>row.forEach(([it,x])=>{
  const y=head+mh+28+r*38;
  g.fillStyle=it[1];g.fillRect(pad+x,y-12,24,24);
  g.strokeStyle='rgba(0,0,0,.35)';g.lineWidth=1;g.strokeRect(pad+x,y-12,24,24);
  g.fillStyle='#1f2933';g.fillText(it[0],pad+x+34,y);
 }));
 return c;
}
function showShot(){
 makeShot().toBlob(b=>{
  if(!b){alert('画像を作れませんでした');return}
  if(shotUrl)URL.revokeObjectURL(shotUrl);
  shotBlob=b;shotUrl=URL.createObjectURL(b);shotimg.src=shotUrl;shotdlg.hidden=false;
 },'image/png');
}
function canShareFile(){
 try{return !!(navigator.canShare&&navigator.canShare({files:[new File(['x'],'a.png',{type:'image/png'})]}))}catch(e){return false}
}
shotshare.hidden=!canShareFile();
shotcopy.hidden=!(window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write);
document.getElementById('open-shot').onclick=showShot;
document.getElementById('shotclose').onclick=()=>{shotdlg.hidden=true};
document.getElementById('shotdl').onclick=()=>{
 const a=document.createElement('a');a.href=shotUrl;a.download=shotName();document.body.appendChild(a);a.click();a.remove();
};
shotshare.onclick=async()=>{
 try{await navigator.share({files:[new File([shotBlob],shotName(),{type:'image/png'})],text:coordText()})}catch(e){}
};
shotcopy.onclick=async()=>{
 try{await navigator.clipboard.write([new ClipboardItem({'image/png':shotBlob})]);flash(shotcopy,'コピーしました')}
 catch(e){flash(shotcopy,'コピーできませんでした')}
};
document.getElementById('shotcoords').onclick=async e=>{
 try{await navigator.clipboard.writeText(coordText());flash(e.target,'コピーしました')}
 catch(err){flash(e.target,'コピーできませんでした')}
};
[shotdlg,savesdlg].forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.hidden=true}));
window.addEventListener('keydown',e=>{if(e.key==='Escape'){shotdlg.hidden=true;savesdlg.hidden=true}});

// 前回の続きから始める
setFortsFromGame(lsGet(KEY_CUR));
rebuild();draw();
wrap.scrollLeft=(cv.width-wrap.clientWidth)/2;
