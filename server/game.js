// Lógica de la partida (copiada del juego del cliente, sin dibujo ni sonido). Se ejecuta en el servidor.
// Generado a partir de index.html: si cambia la física o las reglas, hay que volver a generar este fichero.
const GOAL_MS=8300;
const CX=360,CY=510,FX0=90,FX1=630,FY0=90,FY1=930,R=21,RB=15,OMEGA=.012;   // copia de las constantes para la IA
export function createGame(opts){
const goalWait=(opts&&opts.goalMs)||(()=>GOAL_MS);
const W=720,H=1020,VM=30,CX=360,CY=510,FX0=90,FX1=630,FY0=90,FY1=930,GX0=270,GX1=450,GD=39,SAX0=300,SAX1=420,SAD=57;   // campo 1,5 veces mayor (las monedas conservan su tamaño); el margen exterior sirve para los saques de banda
// Masas reales: 1 € = 7,5 g, 5 céntimos = 3,92 g. Se divide el empuje del balón por esa diferencia (x1,91), y otra vez por la que ya aplica la física.
const MASS_COIN=7.5,MASS_BALL=3.92,BALL_SOFT=Math.pow(MASS_BALL/MASS_COIN,2);
const STICK_L=120,STICK_W=18,PIVOT_D=STICK_L/2+30,TIP_LOSS=.3,EFF_RANGE=196,POW_RANGE=288,OMEGA=.012;
const fFromE=e=>.5+e*.38;   // e = -1..1 (izquierda..derecha de la pantalla); f = punto de la traba que golpea, del agarre (0) a la punta (1)
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const R=21,RB=15,MAXD=110,POWER=2.25,MAXV=10*POWER,MINV=1.4*POWER,SUB=4,FRIC=0.98,WIN=3,STRIKE_F=5;
const posts=[[GX0,FY0],[GX1,FY0],[GX0,FY1],[GX1,FY1]];

const tick=()=>{},ui=()=>{},refreshAim=()=>{};
let coins,turn=0,phase='aim',step=1,sel={},drag=null,strike=null,fx=null,settle=0,msg=null,msgT=0,over=false,concede=0,score=[0,0],movesLeft=1,dbl=false,touched=false,oppFoul=false,lastTouch=-1,chain=null,pm={m:null},foulBen=0,place=null,bhN=0,bhV=0,goalEnd=0;
const mk=(x,y,r,m,t)=>({x,y,vx:0,vy:0,spin:0,r,m,t});
function reset(t){
  coins=[mk(CX,CY+240,R,MASS_COIN,0),mk(CX,CY-240,R,MASS_COIN,1),mk(CX,CY,RB,MASS_BALL,2)];
  turn=t;movesLeft=1;dbl=false;strike=null;fx=null;settle=0;msg=null;msgT=0;lastTouch=-1;chain=null;pm={m:null};beginAim();
}
function returnOut(){                       // una moneda de jugador que se ha quedado fuera de las líneas vuelve al borde del campo
  for(let i=0;i<2;i++){
    const c=coins[i];c.out=0;
    if(c.x>=FX0&&c.x<=FX1&&c.y>=FY0&&c.y<=FY1)continue;
    c.x=clamp(c.x,FX0+c.r,FX1-c.r);c.y=clamp(c.y,FY0+c.r,FY1-c.r);
    for(let n=0;n<40&&!placeOK({x:c.x,y:c.y},c,null);n++){c.x+=(CX-c.x)*.04;c.y+=(CY-c.y)*.04;}
    c.vx=c.vy=c.spin=0;tick(3,400);
  }
}
function gkLim(gy){return gy<CY?FY0+.25*(FY1-FY0):FY1-.25*(FY1-FY0);}   // límite de 3/4 de campo contado desde la portería que saca
function donePlace(){                     // encadena colocaciones (córner y saque de puerta: primero el rival, luego el que saca)
  if(chain){const q=chain;chain=null;turn=q.t;movesLeft=q.mv;dbl=q.mv===2;pm={m:q.m,s:q.s,y:q.y};beginPlace();}
  else{pm={m:null};beginAim();}
}
function beginAim(){phase='aim';step=1;drag=null;sel={ux:0,uy:turn===0?-1:1,ok:false,e:0,p:0};ui();}
function initPlace(c){
  const b=coins[2];
  if(pm.m==='side')return{x:pm.s<0?FX0-32:FX1+32,y:b.y};
  if(pm.m==='line')return{x:CX,y:pm.y};
  if(pm.m==='gkdef')return{x:CX,y:gkLim(pm.y)};
  return{x:c.x,y:c.y};
}
function beginPlace(){phase='place';drag=null;place=initPlace(coins[turn]);ui();}
function snapPlace(p){if(pm.m==='line'){p.y=pm.y;p.x=clamp(p.x,SAX0,SAX1);}return p;}
function placeOK(p,c,mode){
  const m=mode===undefined?pm.m:mode;let ok;
  if(m==='any')ok=p.x>=VM+c.r&&p.x<=W-VM-c.r&&p.y>=VM+c.r&&p.y<=H-VM-c.r;
  else if(m==='side')ok=(pm.s<0?p.x<=FX0-4&&p.x>=c.r:p.x>=FX1+4&&p.x<=W-c.r)&&p.y>=FY0&&p.y<=FY1;
  else if(m==='line')ok=Math.abs(p.y-pm.y)<1&&p.x>=SAX0-.5&&p.x<=SAX1+.5;
  else if(m==='gkdef')ok=!(p.x<FX0+c.r||p.x>FX1-c.r||p.y<FY0+c.r||p.y>FY1-c.r)&&(pm.y<CY?p.y>=gkLim(pm.y):p.y<=gkLim(pm.y));   // saque de puerta: el rival no pasa de 3/4 del campo
  else ok=!(p.x<FX0+c.r||p.x>FX1-c.r||p.y<FY0+c.r||p.y>FY1-c.r);
  if(!ok)return false;
  for(const k of coins){if(k!==c&&Math.hypot(p.x-k.x,p.y-k.y)<c.r+k.r+3)return false;}
  return true;
}
function callFoul(reason){
  foulBen=1-turn;strike=null;phase='foul';msgT=110;for(const c of coins){c.vx=0;c.vy=0;c.spin=0;}
  msg={t:'¡FALTA!',s:turn,foul:true,reason,sub:'Doble turno para el Jugador '+(foulBen+1)};
  ui();tick(5,300);
}
function newGame(){score=[0,0];over=false;reset(0);}
function startStrike(s){phase='strike';strike={t:0,p:s.p,ux:s.ux,uy:s.uy,o0:4+s.p*55,f:s.f,e:s.e,spin:s.spin};ui();}
function physics(dt){
  const FR=Math.pow(FRIC,dt);
  for(const c of coins){
    c.x+=c.vx*dt;c.y+=c.vy*dt;c.vx*=FR;c.vy*=FR;
    if(c.spin){const a=c.spin*dt,ca=Math.cos(a),sa=Math.sin(a),nx=c.vx*ca-c.vy*sa,ny=c.vx*sa+c.vy*ca;c.vx=nx;c.vy=ny;c.spin*=FR;}
    if(c.vx*c.vx+c.vy*c.vy<.0025){c.vx=0;c.vy=0;c.spin=0;}
    if(c.t!==2){                                  // las monedas de jugador pueden salirse del campo; solo las frena el borde del papel
      if(c.x<c.r){c.x=c.r;c.vx=0;}
      else if(c.x>W-c.r){c.x=W-c.r;c.vx=0;}
      if(c.y<c.r){c.y=c.r;c.vy=0;}
      else if(c.y>H-c.r){c.y=H-c.r;c.vy=0;}
    }
    for(const [px,py] of posts){
      const dx=c.x-px,dy=c.y-py,d=Math.hypot(dx,dy),m=c.r+4;
      if(d<m&&d>0){
        const nx=dx/d,ny=dy/d;c.x=px+nx*m;c.y=py+ny*m;
        const vn=c.vx*nx+c.vy*ny;
        if(vn<0){c.vx-=1.8*vn*nx;c.vy-=1.8*vn*ny;tick(-vn,1500);}
      }
    }
  }
  for(let i=0;i<coins.length;i++)for(let j=i+1;j<coins.length;j++){
    const a=coins[i],b=coins[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r;
    if(d<min&&d>0){
      const nx=dx/d,ny=dy/d,ov=min-d,ia=1/a.m,ib=1/b.m;
      a.x-=nx*ov*ia/(ia+ib);a.y-=ny*ov*ia/(ia+ib);
      b.x+=nx*ov*ib/(ia+ib);b.y+=ny*ov*ib/(ia+ib);
      const vn=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
      if(vn<0){
        a.spin=0;b.spin=0;if(j===2&&i===turn)touched=true;if(j===2&&i<2)lastTouch=i;if(i===0&&j===1&&phase==='roll'&&!touched)oppFoul=true;
        const j2=-(1.88)*vn/(ia+ib);
        // Si el balón llega más rápido que la moneda de 1 €, la moneda recibe todavía menos empuje que el que daría su masa.
        const soft=(j===2&&Math.hypot(b.vx,b.vy)>Math.hypot(a.vx,a.vy))?BALL_SOFT:1;
        a.vx-=j2*nx*ia*soft;a.vy-=j2*ny*ia*soft;b.vx+=j2*nx*ib;b.vy+=j2*ny*ib;
        if(j===2&&i<2){bhN++;bhV=-vn;}
      }
    }
  }
}
function outPlay(){
  const b=coins[2],lt=lastTouch>=0?lastTouch:turn;
  let taker,kind,bx,by;
  if(b.x<FX0||b.x>FX1){taker=1-lt;kind='SAQUE DE BANDA';bx=b.x<FX0?FX0:FX1;by=Math.max(FY0+110,Math.min(FY1-110,b.y));}
  else{
    const top=b.y<FY0,def=top?1:0;          // la portería de arriba es la del Jugador 2
    if(lt===def){taker=1-def;kind='CÓRNER';bx=b.x<CX?FX0+RB+3:FX1-RB-3;by=top?FY0+RB+3:FY1-RB-3;}
    else{taker=def;kind='SAQUE DE PUERTA';bx=CX;by=top?FY0+SAD:FY1-SAD;}
  }
  for(const c of coins){c.vx=0;c.vy=0;c.spin=0;}
  b.x=bx;b.y=by;strike=null;foulBen=taker;phase='foul';msgT=90;
  msg={t:kind,s:lt,foul:true,restart:true,k:kind==='SAQUE DE BANDA'?'b':kind==='CÓRNER'?'c':kind==='SAQUE DE PUERTA'?'g':'',side:bx<=FX0?-1:1,gy:b.y<CY?FY0:FY1,reason:'',sub:'Saca el Jugador '+(taker+1)};
  ui();tick(4,520);
}
function goal(s){
  score[s]++;for(const c of coins){c.vx=0;c.vy=0;}
  concede=1-s;over=score[s]>=WIN;phase='goal';
  msg={t:over?'¡Gana el Jugador '+(s+1)+'!':'¡GOL!',s};
  msgT=over?0:110;ui();tick(5,660);setTimeout(()=>tick(5,880),140);setTimeout(()=>tick(5,1100),280);goalEnd=over?0:Date.now()+goalWait();
}
function hostUpdate(){
  if(phase==='goal'){if(!over&&--msgT<=0&&Date.now()>=goalEnd)reset(concede);return;}   // no se reanuda hasta que acaba el audio de gol
  if(fx){fx.t++;if(fx.t>10)fx=null;}
  if(phase==='foul'){if(--msgT<=0){
    const m0=msg,rs=m0&&m0.restart;msg=null;turn=foulBen;movesLeft=rs?1:2;dbl=!rs;chain=null;pm={m:null};
    if(rs&&m0.k==='b'){chain={t:foulBen,m:'side',s:m0.side,mv:1};turn=1-foulBen;movesLeft=1;dbl=false;beginPlace();}   // saque de banda: primero coloca el rival; luego el que saca elige dónde colocarse, fuera de la banda
    else if(rs&&m0.k==='c'){chain={t:foulBen,m:'any',mv:2};turn=1-foulBen;movesLeft=1;dbl=false;beginPlace();}   // córner: primero coloca el defensor
    else if(rs&&m0.k==='g'){pm={m:'gkdef',y:m0.gy};chain={t:foulBen,m:'line',y:m0.gy,mv:1};turn=1-foulBen;movesLeft=1;dbl=false;beginPlace();}  // saque de puerta: primero coloca el rival
    else beginPlace();
  }return;}
  refreshAim();
  if(phase==='strike'){
    strike.t++;
    if(strike.t>=STRIKE_F){
      const c=coins[turn],sp=(MINV+strike.p*(MAXV-MINV))*effAt(strike.f);
      fx={cx:c.x,cy:c.y,ux:strike.ux,uy:strike.uy,t:0,f:strike.f};
      c.vx=strike.ux*sp;c.vy=strike.uy*sp;c.spin=strike.spin;
      tick(6,1200);strike=null;phase='roll';settle=0;touched=false;oppFoul=false;ui();
    }
  }
  for(let n=0;n<SUB;n++)physics(1/SUB);
  if(oppFoul&&phase==='roll'){oppFoul=false;callFoul('su moneda tocó a la contraria antes que el balón');return;}
  const b=coins[2];
  const inM=b.x>GX0&&b.x<GX1;
  if(phase==='roll'&&inM&&(b.y<FY0||b.y>FY1)){goal(b.y<FY0?0:1);return;}          // el centro del balón cruza la línea de gol dentro de la boca: gol
  if(phase==='roll'&&(b.x<FX0||b.x>FX1||(!inM&&(b.y<FY0||b.y>FY1)))){outPlay();return;}
  if(phase==='roll'){
    if(coins.some(c=>c.vx||c.vy))settle=0;
    else if(++settle>12){
      settle=0;
      returnOut();
      if(--movesLeft>0)beginAim();
      else{turn=1-turn;movesLeft=1;dbl=false;beginAim();}
    }
  }
}

function effAt(g){const h=g<.4?7:7-5*((g-.4)/.6);return 1-TIP_LOSS*(1-Math.min(1,(h-2)/5));}
const rd=(v,n)=>{const k=Math.pow(10,n);return Math.round(v*k)/k;};
const num=v=>typeof v==='number'&&isFinite(v);
function snapshot(team){
  return {t:'s',c:coins.map(c=>[rd(c.x,2),rd(c.y,2),rd(c.vx,3),rd(c.vy,3),rd(c.spin,5),c.out||0]),
    p:phase,tu:turn,ml:movesLeft,db:dbl,sc:score.slice(),ov:over,fb:foulBen,cn:chain,pm:pm,mt:msgT,ms:msg,st:strike,fx:fx,tc:touched,lt:lastTouch,tm:team,bh:[bhN,rd(bhV,2)]};
}
function shot(seat,m){
  if(phase==='aim'&&turn===seat&&!over&&num(m.ux)&&num(m.uy)&&num(m.p)&&num(m.f)&&num(m.e)&&num(m.spin)&&m.p>0&&m.p<=1&&m.f>=.1&&m.f<=.9&&Math.abs(Math.hypot(m.ux,m.uy)-1)<.01){
    startStrike({ux:m.ux,uy:m.uy,p:m.p,f:m.f,e:clamp(m.e,-1,1),spin:m.spin});return true;}
  return false;
}
function placeCoin(seat,m){
  if(phase==='place'&&turn===seat&&num(m.x)&&num(m.y)){
    const c=coins[turn];
    if(placeOK({x:m.x,y:m.y},c)){c.x=m.x;c.y=m.y;c.vx=c.vy=c.spin=0;donePlace();return true;}
  }
  return false;
}
function probe(seat,m){                     // simula un golpe entero y devuelve cómo acaba (se usa en una copia de la partida, nunca en la real)
  if(!shot(seat,m))return null;
  const sc0=score.slice();
  let n=0;
  while(n++<1400&&(phase==='strike'||phase==='roll'))hostUpdate();
  const b=coins[2];
  return {phase,goalFor:score[seat]-sc0[seat],goalAg:score[1-seat]-sc0[1-seat],bx:b.x,by:b.y,
    mx:coins[seat].x,my:coins[seat].y,ox:coins[1-seat].x,oy:coins[1-seat].y,touched,
    foul:phase==='foul'&&msg&&msg.foul&&!msg.restart,restart:phase==='foul'&&msg&&msg.restart?msg.k:'',taker:foulBen};
}
function placeInfo(){
  return {mode:pm.m,pm:{m:pm.m,s:pm.s,y:pm.y},defender:!!chain,turn,ok:(x,y)=>placeOK({x,y},coins[turn]),init:initPlace(coins[turn]),snap:snapPlace,
    ball:{x:coins[2].x,y:coins[2].y},me:{x:coins[turn].x,y:coins[turn].y}};
}
function restore(s){
  coins=[mk(0,0,R,MASS_COIN,0),mk(0,0,R,MASS_COIN,1),mk(0,0,RB,MASS_BALL,2)];
  s.c.forEach((a,i)=>{const c=coins[i];c.x=a[0];c.y=a[1];c.vx=a[2];c.vy=a[3];c.spin=a[4];c.out=a[5]||0;});
  phase=s.p;turn=s.tu;movesLeft=s.ml;dbl=s.db;score=s.sc.slice();over=s.ov;foulBen=s.fb;touched=!!s.tc;lastTouch=s.lt===undefined?-1:s.lt;
  chain=s.cn||null;pm=s.pm||{m:null};msgT=s.mt||0;msg=s.ms||null;strike=s.st||null;fx=s.fx||null;settle=0;concede=s.ov?0:(msg&&typeof msg.s==='number'?1-msg.s:0);
  if(s.bh){bhN=s.bh[0];bhV=s.bh[1];}
  if(phase==='goal'&&!over){goalEnd=Date.now()+2000;}
}
newGame();
return {
  restore, probe, placeInfo,
  step:hostUpdate, snapshot, shot, placeCoin, newGame,
  get phase(){return phase;}, get over(){return over;}, get score(){return score;}, get turn(){return turn;},
  get moving(){return phase==='strike'||phase==='roll'||!!fx;},
  get key(){return phase+'|'+turn+'|'+movesLeft+'|'+score+'|'+over+'|'+(msg?msg.t:'');},
  get idleWait(){return phase==='aim'||phase==='place';}
};
}

/* ---------- inteligencia artificial: prueba muchos golpes en una copia de la partida y elige el que deja mejor el balón ---------- */
const LEVELS={
  1:{off:[-40,-30,-20,-10,0,10,20,30,40],pw:[.4,.7,1],ef:[0],noise:9,top:5},
  2:{off:[-48,-40,-32,-24,-16,-8,0,8,16,24,32,40,48],pw:[.55,.8,1],ef:[0,-.45,.45],noise:3.5,top:3},
  3:{off:[-50,-42,-35,-28,-21,-14,-7,0,7,14,21,28,35,42,50],pw:[.5,.7,.85,1],ef:[0,-.5,-.25,.25,.5],noise:1.2,top:2}
};
let SIM=null;
const fE=e=>.5+e*.38;
function score_(o,seat,gy){                        // gy: y de la portería que ataca; valor alto = mejor resultado para 'seat'
  if(o.goalFor)return 10000;
  if(o.goalAg)return -10000;
  let v=0;
  const prog=gy<CY?(FY1-o.by)/(FY1-FY0):(o.by-FY0)/(FY1-FY0);      // 0 = junto a mi portería, 1 = junto a la del rival
  v+=120*prog;
  v+=50*prog*prog*(1-Math.min(1,Math.abs(o.bx-CX)/260));
  const ownY=gy<CY?FY1:FY0;
  const dOwn=Math.hypot(o.bx-CX,o.by-ownY);v-=180*Math.max(0,1-dOwn/230);
  const dOpp=Math.hypot(o.bx-CX,o.by-gy);v+=90*Math.max(0,1-dOpp/230);
  if(o.foul)v-=400;
  if(o.restart){
    const mine=o.taker===seat;
    v+=o.restart==='c'?(mine?70:-70):o.restart==='g'?(mine?-40:40):(mine?8:-8);
    if(o.restart==='g'&&o.taker!==seat)v-=30;
  }
  if(!o.touched)v-=30;
  v+=22*(1-Math.min(Math.hypot(o.mx-o.bx,o.my-o.by),420)/420);       // quedar cerca del balón para el siguiente golpe
  v-=22*(1-Math.min(Math.hypot(o.ox-o.bx,o.oy-o.by),420)/420);       // y que el rival quede lejos
  return v;
}
export function plan(main,seat,level,done){
  const L=LEVELS[level]||LEVELS[2];
  if(main.phase==='place'){done(planPlace(main.placeInfo(),seat));return;}
  const snap=main.snapshot(null),b=snap.c[2],c=snap.c[seat];
  const gy=seat===0?FY0:FY1;
  const a0=Math.atan2(b[1]-c[1],b[0]-c[0]);
  const cands=[];
  for(const off of L.off)for(const p of L.pw)for(const e of L.ef)cands.push({a:a0+off*Math.PI/180,p,e});
  if(level>=2)for(let k=0;k<8;k++)cands.push({a:k*Math.PI/4,p:.45,e:0});      // golpes sin contacto (colocarse)
  if(!SIM)SIM=createGame();
  const res=[];let i=0;
  const slice=()=>{
    const t0=Date.now();
    while(i<cands.length&&Date.now()-t0<6){
      const k=cands[i++];
      SIM.restore(snap);
      const m={ux:Math.cos(k.a),uy:Math.sin(k.a),p:k.p,f:fE(k.e),e:k.e,spin:k.e*OMEGA};
      const o=SIM.probe(seat,m);
      if(o)res.push({m,v:score_(o,seat,gy)+Math.random()*3});
    }
    if(i<cands.length){setTimeout(slice,0);return;}
    res.sort((x,y)=>y.v-x.v);
    const pick=res[Math.floor(Math.random()*Math.min(L.top,res.length))]||res[0];
    if(!pick){done({t:'shot',ux:0,uy:seat===0?-1:1,p:.6,f:.5,e:0,spin:0});return;}
    const ang=Math.atan2(pick.m.uy,pick.m.ux)+(Math.random()*2-1)*L.noise*Math.PI/180;
    done({t:'shot',ux:Math.cos(ang),uy:Math.sin(ang),p:Math.max(.12,Math.min(1,pick.m.p*(1+(Math.random()*2-1)*L.noise/60))),f:pick.m.f,e:pick.m.e,spin:pick.m.spin});
  };
  slice();
}
function planPlace(info,seat){
  const gy=seat===0?FY0:FY1,ownY=seat===0?FY1:FY0,b=info.ball;
  const place=(x,y)=>({t:'place',x,y});
  const fallback=place(info.init.x,info.init.y);
  const cand=[];
  if(info.mode==='line')cand.push([info.init.x,info.init.y]);
  if(info.mode==='side'){const sx=info.pm.s<0?FX0-42:FX1+42;for(const dy of [0,30,-30,60,-60])cand.push([sx,b.y+dy]);}
  if(info.mode==='side'||info.mode==='line'){for(const [x,y] of cand)if(info.ok(x,y))return place(x,y);}
  else{
  const gx=CX,dx=gx-b.x,dy=gy-b.y,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d;
  if(info.defender){                               // defensa: entre el balón y mi portería
    const ox=CX-b.x,oy=ownY-b.y,od=Math.hypot(ox,oy)||1;
    for(const dist of [80,110,140,60,170])for(const s of [0,.3,-.3])cand.push([b.x+(ox/od)*dist+s*dist*(oy/od),b.y+(oy/od)*dist-s*dist*(ox/od)]);
  }else{                                            // ataque: detrás del balón, mirando a la portería rival
    for(const dist of [R+RB+6,R+RB+14,R+RB+26,R+RB+40])for(const s of [0,.25,-.25,.5,-.5])cand.push([b.x-ux*dist+s*dist*uy,b.y-uy*dist-s*dist*ux]);
  }
  }
  for(const [x,y] of cand)if(info.ok(x,y))return place(x,y);
  for(const dist of [48,60,80,110,150])for(let k=0;k<24;k++){const a=k*Math.PI/12,x=b.x+Math.cos(a)*dist,y=b.y+Math.sin(a)*dist;if(info.ok(x,y))return place(x,y);}
  return fallback;
}
