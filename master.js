/* master.js — Atom renderer with: precessing electron orbits, distinct proton/neutron styles,
   speed from tx_count*size, treemap background, halving override, and richer trait mapping. */
/* global p5 */
(function () {
  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  function el(tag, attrs={}, html=""){ const e=document.createElement(tag); Object.assign(e, attrs); if(html) e.innerHTML=html; return e; }
  const shortHash=h=> h ? (String(h).slice(0,10)+'…'+String(h).slice(-8)) : 'n/a';

  // ---------- styles ----------
  const CSS = `
  :root { --panel-bg: rgba(10,14,18,0.90); --panel-border:#1e2a33; --text:#cfe4ff; --muted:#8fbfe6; }
  html,body{margin:0;height:100%;background:#000;color:var(--text);font-family: system-ui, Segoe UI, Roboto, Arial, sans-serif;}
  canvas{display:block;touch-action:none}
  .panel{position:fixed;z-index:11;font-size:12px;color:var(--muted);padding:8px 10px;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:12px;max-width:min(480px,calc(100vw - 20px));backdrop-filter:blur(6px)}
  #legend{left:10px;top:10px}
  details#blockPanel{right:10px;bottom:10px}
  details#blockPanel>summary{list-style:none;cursor:pointer;padding:10px 12px;color:#d7ecff;font-weight:700;display:flex;justify-content:space-between;gap:8px}
  details#blockPanel[open]>summary{border-bottom:1px solid var(--panel-border)}
  details#blockPanel summary::-webkit-details-marker{display:none}
  #blkBody{padding:10px 12px;color:#b7d2ea}
  #blkBody td{padding:4px 0;vertical-align:top}
  #blkBody td:first-child{color:#9cc9ee;width:36%}
  details#infoPanel{left:10px;bottom:10px}
  details#infoPanel>summary{list-style:none;cursor:pointer;padding:10px 12px;color:#d7ecff;font-weight:700;display:flex;gap:8px;align-items:center}
  details#infoPanel[open]>summary{border-bottom:1px solid var(--panel-border)}
  details#infoPanel summary .badge{width:22px;height:22px;display:inline-grid;place-items:center;border-radius:999px;background:#1e2a33;color:#cfe4ff;border:1px solid #2b3a44;font-weight:800}
  #warn{position:fixed;left:10px;top:70px;color:#ffd26f;font-weight:600;display:none;z-index:12}
  `;
  function injectCSS(){ const s=el('style',{textContent:CSS}); document.head.appendChild(s); }

  // ---------- math & color utils ----------
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mod=(a,n)=>((a%n)+n)%n;
  function XS32(seed){let x=seed>>>0||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/0xFFFFFFFF;};}
  function hslToRgb(h,s,l){let r,g,b;if(s===0){r=g=b=l;}else{const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};const q=l<0.5?l*(1+s):l+s-l*s;const p=2*l-q;r=hue2rgb(p,q,h+1/3);g=hue2rgb(p,q,h);b=hue2rgb(p,q,h-1/3);}return [Math.round(r*255),Math.round(g*255),Math.round(b*255)];}
  function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b);let h,s,l=(max+min)/2;if(max===min){h=s=0;}else{const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;break;}h/=6;}return[h,s,l];}
  const shiftHue=(rgb,deg)=>{const[h,s,l]=rgbToHsl(rgb[0],rgb[1],rgb[2]);let hh=(h+(deg/360))%1; if(hh<0)hh+=1; return hslToRgb(hh,s,l);}
  const mixRGB=(a,b,t)=>[Math.round(a[0]*(1-t)+b[0]*t),Math.round(a[1]*(1-t)+b[1]*t),Math.round(a[2]*(1-t)+b[2]*t)];
  const lastByte = (hex)=>{ if(!hex) return 0; const c=hex.replace(/[^0-9a-fA-F]/g,''); if(c.length<2) return 0; return parseInt(c.slice(-2),16)||0; };
  const hexByteSum = (hex)=>{ if(!hex) return 0; const c=hex.replace(/[^0-9a-fA-F]/g,''); let s=0; for(let i=0;i<c.length;i+=2){ const b=parseInt(c.substr(i,2),16); if(!isNaN(b)) s+=b; } return s; };
  const byteAt=(hex,idx)=>{ if(!hex) return 0; const c=hex.replace(/[^0-9a-fA-F]/g,''); if(c.length<2) return 0; const i=(idx*2)%(c.length-1); const b=parseInt(c.substr(i,2),16); return isNaN(b)?0:b; };
  const fillShells=e=>{ let shells=[],rem=e,n=1; while(rem>0&&shells.length<8){ const cap=2*n*n; const take=Math.min(rem,cap); shells.push(take); rem-=take; n++; } if(rem>0) shells.push(rem); return shells; };
  const approxLog2Target=bits=>{const exp=(bits>>>24)&0xff, mant=bits&0x007fffff||1; return Math.log2(mant)+8*(exp-3);};
  const approxLog2Hash=hex=>{const c=(hex||'').replace(/[^0-9a-fA-F]/g,''); if(!c.length) return 0; let i=0; while(i<c.length && c[i]==='0') i++; const lead=parseInt(c.substr(i,2)||'01',16)||1; const bitsFromPos=(c.length-i)/2*8; return Math.log2(lead)+bitsFromPos-8;};
  const isHalving=h=>h>0 && (h%210000)===0;

  // simple vec3 helpers for orbits
  const v3=(x,y,z)=>[x,y,z], vadd=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const vmul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s], vdot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const vcross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const vlen=a=>Math.hypot(a[0],a[1],a[2]); const vnorm=a=>{const l=vlen(a)||1; return [a[0]/l,a[1]/l,a[2]/l];};
  function rotateAroundAxis(p,u,ang){ // Rodrigues
    const c=Math.cos(ang), s=Math.sin(ang), dot=vdot(u,p), cross=vcross(u,p);
    return vadd(vadd(vmul(p,c), vmul(cross,s)), vmul(u,(1-c)*dot));
  }

  // ---------- shaders ----------
  const VERT = `
  precision mediump float;
  attribute vec3 aPosition;
  uniform mat4 uModelViewMatrix,uProjectionMatrix;
  varying vec3 vObjPos;
  void main(){ vObjPos=aPosition; gl_Position=uProjectionMatrix*(uModelViewMatrix*vec4(aPosition,1.0)); }`;
  const FRAG = `
  precision mediump float; varying vec3 vObjPos;
  uniform vec3 uColorA,uColorB; uniform float uMarbleInt,uMarbleScale,uTime,uAnimAmp,uAnimSpeed,uBlockPhase;
  float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
  float n3(vec3 p){vec3 i=floor(p),f=fract(p);float n000=h(i+vec3(0,0,0)),n100=h(i+vec3(1,0,0));
    float n010=h(i+vec3(0,1,0)),n110=h(i+vec3(1,1,0)); float n001=h(i+vec3(0,0,1)),n101=h(i+vec3(1,0,1));
    float n011=h(i+vec3(0,1,1)),n111=h(i+vec3(1,1,1)); vec3 u=f*f*(3.0-2.0*f); float n00=mix(n000,n100,u.x),n10=mix(n010,n110,u.x);
    float n01=mix(n001,n101,u.x),n11=mix(n011,n111,u.x); float n0=mix(n00,n10,u.y),n1=mix(n01,n11,u.y); return mix(n0,n1,u.z);}
  float stripe2D(vec2 uv,float ph,float f){float zm=1.0+uAnimAmp*0.35*sin(uTime*(0.7+uAnimSpeed)+ph+uBlockPhase); uv*=zm;
    vec2 w1=vec2(n3(vec3(uv*0.8*f,uTime*0.35+ph+uBlockPhase)), n3(vec3(uv*1.1*f+3.17,uTime*0.28+ph+1.7+uBlockPhase)));
    uv+=(w1-0.5)*(0.35+0.45*uAnimAmp); float s=sin((uv.x*6.2831*f*0.85)+(uv.y*6.2831*f*0.45)+3.2*w1.x+(uTime*(0.55+0.6*uAnimSpeed))+ph+uBlockPhase);
    return 0.5+0.5*s;}
  float blinn(vec3 n,vec3 l,vec3 v,float sh){vec3 hh=normalize(l+v);return pow(max(dot(n,hh),0.0),sh);}
  void main(){
    vec3 p=vObjPos; float r=length(p.xy); float sw=uAnimAmp*(0.5+0.5*sin(uTime*(0.6+0.7*uAnimSpeed)+uBlockPhase));
    float a=sw*r*1.8; float ca=cos(a),sa=sin(a); p.xz=mat2(ca,-sa,sa,ca)*p.xz;
    vec3 n=normalize(p); vec3 w=pow(abs(n),vec3(6.0)); w/=max(w.x+w.y+w.z,1e-4);
    float f=uMarbleScale; float sx=stripe2D(p.yz,0.0,f), sy=stripe2D(p.zx,2.1,f), sz=stripe2D(p.xy,4.2,f);
    float t = pow(smoothstep(0.10,0.90, sx*w.x+sy*w.y+sz*w.z),0.85); vec3 tint=mix(uColorA,uColorB,t);
    float roughK=clamp((uMarbleScale-0.8)/5.2,0.0,1.0); float freq=mix(40.0,140.0,roughK);
    float gx=stripe2D(p.yz,1.7,freq), gy=stripe2D(p.zx,3.8,freq), gz=stripe2D(p.xy,5.9,freq);
    vec3 base=tint*(0.83+0.17*(gx*w.x+gy*w.y+gz*w.z));
    vec3 L1=normalize(vec3(0.6,0.7,0.5)), L2=normalize(vec3(-0.4,0.65,-0.2)), V=normalize(vec3(0.0,0.0,1.0));
    float ndl1=max(dot(n,L1),0.0), ndl2=max(dot(n,L2),0.0);
    float rough=mix(0.55,0.12,roughK), shin=mix(36.0,200.0,1.0-rough);
    float m=clamp(uMarbleInt,0.0,1.0), mC=min(m,0.92); vec3 F0=mix(vec3(0.06),tint,mC);
    float VoH=max(dot(n,V),0.0); vec3 F=F0+(1.0-F0)*pow(1.0-VoH,5.0);
    float spec=(blinn(n,L1,V,shin)*0.95 + blinn(n,L2,V,shin)*0.75)*(0.95-0.5*rough);
    vec3 diff = base*max(0.12, mix(0.65,0.18,mC)*(0.35+(0.55*ndl1+0.45*ndl2)));
    float rim=pow(1.0-max(dot(n,V),0.0),2.2)*0.12;
    vec3 col=pow(diff + F*spec + tint*rim, vec3(0.96));
    gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
  }`;

  // ---------- constants ----------
  const NUCLEUS_R0=28, SHELL_STEP=22, ELECTRON_R=3.6, NUCLEON_R=2.7;

  // ---------- palette ----------
  function paletteFromHeight(height){
    const rng=XS32(height), golden=137.50776405003785; let baseHue=mod((height*golden)+rng()*45,360);
    let hP=baseHue, hN=mod(baseHue+(90+rng()*120),360), hE=mod(baseHue+(180+rng()*120),360), hS=mod(baseHue+(30+rng()*120),360);
    let sP=0.82+0.18*rng(), lP=0.48+0.12*rng(); let sN=0.72+0.25*rng(), lN=0.52+0.12*rng(); let sE=0.92+0.08*rng(), lE=0.58+0.12*rng(); let sS=0.82+0.18*rng(), lS=0.56+0.12*rng();
    return{ proton:hslToRgb(hP/360,sP,lP), neutron:hslToRgb(hN/360,sN,lN), electron:hslToRgb(hE/360,sE,lE), shell:hslToRgb(hS/360,sS,lS) };
  }

  // ---------- fee spread helper (for eccentricity / tightness) ----------
  function feeSpread(tx_map){
    if(!tx_map || !tx_map.fees || !tx_map.fees.length) return 0.25; // fallback
    const a = tx_map.fees, n=a.length;
    let sum=0; for (let i=0;i<n;i++) sum += a[i];
    const mean = sum / n;
    if (mean<=0) return 0.25;
    let varSum=0; for (let i=0;i<n;i++){ const d=a[i]-mean; varSum += d*d; }
    const std = Math.sqrt(varSum/n);
    return clamp(std/mean, 0.02, 1.2); // coefficient of variation
  }

  // ---------- atom builder ----------
  function buildAtomFromTraits(b){
    const height=b.height, txCount=b.tx_count||b.txCount||1, timestamp=b.timestamp||0, mediantime=b.mediantime||timestamp;
    const bits=b.bits||0, nonce=b.nonce||0, merkleRoot=b.merkle_root||b.merkleRoot||"", weight=b.weight||0, size=b.size||0, version=b.version||0, hash=b.id||b.hash||"";
    const halving=isHalving(height);
    const colors=paletteFromHeight(height);

    // electrons/protons/neutrons variety
    const baseE = (height%118)+1;
    const eJitter = (byteAt(hash,5)%64)-32; // -32..+31
    const electrons = clamp(baseE + eJitter, 6, 180);

    const protonBias = (byteAt(merkleRoot,9)%31)-15; // +/- 15
    const Z = clamp(baseE + protonBias, 6, 160);     // protons
    const neutronSkew = ((byteAt(hash,2)%101)-50)/180; // -0.28..+0.28
    const N = clamp(Math.round(Z*(1.0+neutronSkew)) + (hexByteSum(merkleRoot)%17)-8, 6, 220); // neutrons

    // shells & radii
    const shells = fillShells(electrons);

    // speed driven by tx_count * size (log-scaled)
    const prod = Math.max(1, txCount * Math.max(1,size));
    const lg = Math.log10(prod); // typical 8.5..10.7
    const speedScale = clamp( (lg - 8.6) / (10.7 - 8.6) * (2.2-0.55) + 0.55, 0.55, 2.2);

    // nucleus tightness (density + fee spread)
    const dens = clamp(weight/Math.max(1,size*4),0.6,1.4);
    const fSpread = feeSpread(b.tx_map || b.tx_map_b64 && decodeTxMapB64(b.tx_map_b64));
    const tightness = clamp( (dens*0.75) + (1.15 - 0.55*fSpread), 0.6, 1.4 );

    // orbit eccentricity (fee spread + version/nonce fallback)
    const eccGlobal = clamp( 0.08 + 0.7*fSpread + ((version&0xF)/60) + ((nonce&0x3f)/255)*0.2, 0.08, 0.88 );

    // ring aesthetics
    const t2=approxLog2Target(bits), h2=approxLog2Hash(hash), luck=clamp((t2-h2)/24+1.0,0.7,1.5);
    const hashLast=lastByte(hash);
    const ringThickBase=0.8+(hashLast/255)*2.0;
    const ringThick=ringThickBase*(((version>>0)&1)?1.8:1.0);
    const ringAlpha=clamp(140+(luck-1.0)*120,80,255);
    const hueShiftDeg=(hashLast/255 - 0.5)*36;
    const ringColor=shiftHue(colors.shell, hueShiftDeg);

    // per-shell base radius
    const orbitSpread = 1.0 + ((version&0xf)-7.5)*0.01;
    const radii = shells.map((_,i)=>(NUCLEUS_R0*1.3 + SHELL_STEP*(i+1))*orbitSpread);

    // electrons: precession axis, eccentricity, per-electron speed multiplier
    const electronAngles=[], eMeta=[];
    for(let i=0;i<shells.length;i++){
      electronAngles[i]=[];
      eMeta[i]=[];
      for(let j=0;j<shells[i];j++){
        const b0 = byteAt(merkleRoot, (i*31 + j*11 + 1));
        const b1 = byteAt(hash,       (i*17 + j*7  + 5));
        const b2 = byteAt(merkleRoot, (i*53 + j*13 + 9));
        const seed = (b0<<16) ^ (b1<<8) ^ b2;

        // axis
        let u = vnorm(v3((b0/255)-0.5, (b1/255)-0.5, (b2/255)-0.5));
        if (vlen(u)<1e-6) u = [0,0,1];

        // local basis (v,w) orthonormal to u
        const ref = Math.abs(u[2])<0.9 ? [0,0,1] : [1,0,0];
        let v = vnorm(vcross(u, ref));
        let w = vcross(u, v);

        // eccentricity & precession
        const e = clamp(eccGlobal*(0.6 + 0.8*(b1/255)), 0.05, 0.93);
        const pre = (0.05 + 0.45*(b2/255)) * speedScale; // rad/s precession
        const phase = (b0/255)*Math.PI*2;
        const rosK = 1 + (seed%3);                // rosette multiplier (1..3)
        const rosAmp = 0.03 + 0.05*(b1/255);      // radial wobble

        const spMul = 0.6 + 0.8*(b0/255);         // per-electron speed tweak
        electronAngles[i][j] = (b2/255)*Math.PI*2;
        eMeta[i][j] = { u, v, w, e, pre, phase, rosK, rosAmp, spMul };
      }
    }

    // shell speeds (base)
    const base=(timestamp%600)/600, noiseSeed=(nonce%997)/997;
    const speeds = shells.map((_,i)=> (0.004 + 0.015*((Math.sin((base + i*0.137 + noiseSeed)*43758.5453)*0.5+0.5))) * speedScale);

    // nucleus points
    const totalNuc = Math.min(900, Z+N);
    const nucleusPoints=[];
    for(let i=0;i<totalNuc;i++){
      // tighter/looser distribution via 'tightness'
      const rNorm = Math.pow(Math.random(), tightness); // tightness>1 packs to center
      const r=NUCLEUS_R0 * (0.35 + 0.65*rNorm);
      const th=Math.random()*Math.PI*2, ph=Math.acos(2*Math.random()-1);
      nucleusPoints.push({x:r*Math.sin(ph)*Math.cos(th),y:r*Math.sin(ph)*Math.sin(th),z:r*Math.cos(ph),isProton:i<Z});
    }

    // shader flavors
    const mode=height%4; let MARBLE_INT=0.78, MARBLE_SCALE=3.6;
    if(mode===1){ MARBLE_INT=0.65; MARBLE_SCALE=4.4; }
    else if(mode===2){ MARBLE_INT=0.58; MARBLE_SCALE=2.6; }
    else if(mode===3){ MARBLE_INT=0.42; MARBLE_SCALE=2.0; }

    const animAmp=clamp(0.18 + ((version&0xF)/15)*0.12, 0.18, 0.45);
    const animSpeed=clamp(0.35 + ((nonce&0xFF)/255)*0.9, 0.35, 1.85);
    const blockPhase=(byteAt(merkleRoot,7)/255)*Math.PI*2;

    const halvingStyle= isHalving(height) ? {
      halving:true, nucleusScale:1.0, bgPulseSpeed:0.9, ePulseSpeed:2.6,
      metalnessGold:0.92, roughGold:3.2, metalnessSilver:0.88, roughSilver:3.6,
      colors:{ gold:[255,215,64], silver:[200,210,225], orange:[255,136,0] }
    } : { halving:false };

    return {
      block:{...b, tx_count:txCount, size, weight, version, height, hash, merkle_root:merkleRoot},
      tx_map: b.tx_map || b.tx_map_b64 || null,
      electrons, Z, N, shells, radii, speeds, electronAngles, eMeta,
      nucleusPoints, colors,
      shader:{ MARBLE_INT, MARBLE_SCALE, animAmp, animSpeed, blockPhase },
      style:{
        eSizeScale: clamp((( (weight||size*4) - 2.8e6)/(4.0e6-2.8e6))*(1.50-0.90)+0.90, 0.7, 1.8),
        orbitSpread, ringThick, ringAlpha, ringColor,
        nucleusTight: tightness,
        ...halvingStyle
      }
    };
  }

  // ---------- tx treemap (same as before) ----------
  function normalize(values, area){ const sum = values.reduce((a,b)=>a+b,0) || 1; return values.map(v => v * area / sum); }
  function worst(row, w){ const s = row.reduce((a,b)=>a+b,0)||1; const max=Math.max(...row),min=Math.min(...row); return Math.max((w*w*max)/(s*s), (s*s)/(w*w*min)); }
  function layoutRow(row, rect, horiz, out){
    const sum=row.reduce((a,b)=>a+b,0);
    if(horiz){ const h=sum/rect.w; let x=rect.x; for(const v of row){ const w=v/h; out.push({x,y:rect.y,w,h}); x+=w; } rect.y+=h; rect.h-=h; }
    else { const w=sum/rect.h; let y=rect.y; for(const v of row){ const h=v/w; out.push({x:rect.x,y,w,h}); y+=h; } rect.x+=w; rect.w-=w; }
  }
  function squarify(values,W,H){
    const vals=normalize(values,W*H).slice().sort((a,b)=>b-a); const rect={x:0,y:0,w:W,h:H}; const result=[]; let row=[]; let horiz=(W>=H);
    while(vals.length){ const v=vals[0]; if(row.length===0){ row.push(vals.shift()); continue; } const wshort=Math.min(rect.w,rect.h)||1;
      if(worst(row,wshort)>=worst(row.concat([v]),wshort)) row.push(vals.shift()); else { layoutRow(row,rect,horiz,result); horiz=(rect.w>=rect.h); row=[]; } }
    if(row.length) layoutRow(row,rect,horiz,result); return result;
  }
  function colorForFee(f,fmin,fmax){
    const t=Math.max(0,Math.min(1,(f-fmin)/Math.max(1e-9,fmax-fmin)));
    const stops=[[0x35,0x5d,0x20],[0x9f,0xb1,0x3a],[0xb8,0x74,0x22]]; const t2=t*2, i=Math.min(1,Math.floor(t2)), tt=t2-i, a=stops[i], b=stops[i+1]||stops[i];
    return [Math.round(a[0]*(1-tt)+b[0]*tt),Math.round(a[1]*(1-tt)+b[1]*tt),Math.round(a[2]*(1-tt)+b[2]*tt)];
  }

  // packed tx_map decoding (optional)
  function b64ToBytes(b64){ const bin=atob(b64); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
  function decodeTxMapB64(m){
    if(!m) return null;
    const {n,sizes_b64,fees_b64,fee_scale=1}=m;
    const sBytes=b64ToBytes(sizes_b64), fBytes=b64ToBytes(fees_b64);
    const sizes=Array.from(new Uint32Array(sBytes.buffer,sBytes.byteOffset,n));
    const fees =Array.from(new Uint16Array(fBytes.buffer,fBytes.byteOffset,n),v=>v/fee_scale);
    return {sizes,fees};
  }

  // ---------- UI ----------
  let uiPointerDown=false;
  function attachGuards(nodes){
    const down=()=>{ uiPointerDown=true; }, up=()=>{ uiPointerDown=false; };
    nodes.forEach(n=>{
      n.addEventListener('pointerdown', down); n.addEventListener('pointerup', up);
      n.addEventListener('pointerleave', up); n.addEventListener('pointercancel', up);
      n.addEventListener('wheel',(e)=>{e.stopPropagation(); e.preventDefault();},{passive:false});
    });
    document.addEventListener('pointerup', up);
  }
  function buildPanels(atom){
    const legend = el('div', { id:'legend', className:'panel' }, `
      <div><b>Controls</b></div>
      <div>• <b>Rotate/Tilt</b>: drag</div>
      <div>• <b>Pan</b>: right-drag / two-finger</div>
      <div>• <b>Zoom</b>: wheel / pinch</div>
    `);
    document.body.appendChild(legend);

    const blk = atom.block;
    const blockPanel = el('details', { id:'blockPanel', open:false });
    blockPanel.appendChild(el('summary',{},`<span>▼ Block Details</span><span style="color:#d7dfff;font-weight:500;">#${blk.height} — ${shortHash(blk.hash)}</span>`));
    const date = blk.timestamp ? new Date(blk.timestamp*1000).toLocaleString() : 'n/a';
    const mdate = blk.mediantime ? new Date(blk.mediantime*1000).toLocaleString() : 'n/a';
    blockPanel.appendChild(el('div',{id:'blkBody',innerHTML:`
      <div style="margin-bottom:6px;">
        <span class="chip">Electrons: ${atom.electrons}</span>
        <span class="chip">Protons: ${atom.Z}</span>
        <span class="chip">Neutrons: ${atom.N}</span>
        <span class="chip">${atom.style.halving?'Halving Mode':'Metal/Marble'}</span>
      </div>
      <table>
        <tr><td>Tx count</td><td>${blk.tx_count??'n/a'}</td></tr>
        <tr><td>Size (bytes)</td><td>${blk.size??'n/a'}</td></tr>
        <tr><td>Weight (WU)</td><td>${blk.weight??'n/a'}</td></tr>
        <tr><td>Version</td><td>${blk.version??'n/a'}</td></tr>
        <tr><td>Bits</td><td>${blk.bits??'n/a'}</td></tr>
        <tr><td>Nonce</td><td>${blk.nonce??'n/a'}</td></tr>
        <tr><td>Time</td><td>${date} (median: ${mdate})</td></tr>
        <tr><td>Merkle root</td><td><code>${shortHash(blk.merkle_root)}</code></td></tr>
      </table>
    `}));
    document.body.appendChild(blockPanel);

    const info = el('details', { id:'infoPanel', className:'panel', open:false });
    info.appendChild(el('summary', {}, `<span class="badge">?</span> Info / How it works`));
    info.appendChild(el('div', { id:'infoBody', innerHTML: `
      <h3>Motion model</h3>
      <p>Each electron follows an elliptical path in a <b>tilted plane</b> that slowly <b>precesses</b> (rotates) around its own random axis. A subtle radial “rosette” wobble adds variation.</p>
      <ul>
        <li><b>Speed</b> ∝ log₁₀(<code>tx_count × size</code>)</li>
        <li><b>Eccentricity</b> from <b>fee-rate spread</b> (if provided via <code>tx_map</code>), with version/nonce fallback.</li>
        <li><b>Nucleus tightness</b> from weight:virtual-size density blended with fee spread.</li>
        <li><b>Counts</b>: electrons vary around height; protons/neutrons vary independently.</li>
      </ul>
      <h3>Background</h3>
      <p>Treemap shows all included TX sized by vsize and colored by feerate (green→yellow→orange). Embed as <code>TRAITS.tx_map</code> or packed <code>tx_map_b64</code>.</p>
    `}));
    document.body.appendChild(info);

    document.body.appendChild(el('div',{id:'warn',textContent:'Shader fallback active (simplified lighting).'}));
    attachGuards([legend, blockPanel, info]);
  }

  // ---------- p5 sketch ----------
  let orbShader, SHADER_OK=true, txTex=null;

  function makeSketch(traits){
    const atom = buildAtomFromTraits(traits);

    function buildPanelsOnce(){ injectCSS(); buildPanels(atom); }

    const sketch = (p)=>{
      p.setup = function(){
        p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
        p.setAttributes('antialias', true);
        buildPanelsOnce();
        orbShader = p.createShader(VERT, FRAG);

        // treemap texture
        let sizes=[], fees=[];
        if (atom.tx_map && Array.isArray(atom.tx_map.sizes)){ sizes=atom.tx_map.sizes; fees=atom.tx_map.fees||[]; }
        else if (atom.tx_map && atom.tx_map.sizes_b64){ const d=decodeTxMapB64(atom.tx_map); sizes=d.sizes; fees=d.fees; }
        if (sizes.length){
          const N=sizes.length, W=N>8000?2048:1024, H=W;
          txTex = p.createGraphics(W,H,p.P2D);
          txTex.background(11,14,18); txTex.noStroke();
          const rects=squarify(sizes, W-2, H-2), fmin=fees.length?Math.min(...fees):1, fmax=fees.length?Math.max(...fees):1;
          txTex.push(); txTex.translate(1,1);
          let dust=0;
          for(let i=0;i<rects.length;i++){
            const r=rects[i]; if(r.w<1||r.h<1){ dust+=r.w*r.h; continue; }
            const c=colorForFee(fees[i]??fmin,fmin,fmax);
            txTex.fill(c[0],c[1],c[2]); txTex.rect(Math.floor(r.x)+0.5,Math.floor(r.y)+0.5,Math.max(1,Math.floor(r.w)-1),Math.max(1,Math.floor(r.h)-1));
          }
          txTex.pop();
          if(dust>0){ txTex.noStroke(); txTex.fill(184,116,34,220); const dw=Math.max(1,Math.min(W-4,Math.sqrt(dust))); txTex.rect(2,H-6,dw,4); }
        }
      };

      p.windowResized = ()=> p.resizeCanvas(p.windowWidth, p.windowHeight);

      // draw helpers
      function drawOrbMat(colorA, colorB, radius, t, metal, rough, amp=atom.shader.animAmp, spd=atom.shader.animSpeed){
        p.noStroke();
        if (SHADER_OK){
          try{
            p.shader(orbShader);
            orbShader.setUniform('uColorA', colorA.map(v=>v/255));
            orbShader.setUniform('uColorB', colorB.map(v=>v/255));
            orbShader.setUniform('uMarbleInt', metal);
            orbShader.setUniform('uMarbleScale', rough);
            orbShader.setUniform('uTime', t);
            orbShader.setUniform('uAnimAmp', amp);
            orbShader.setUniform('uAnimSpeed', spd);
            orbShader.setUniform('uBlockPhase', atom.shader.blockPhase || 0.0);
            p.sphere(radius); p.resetShader(); return;
          }catch(e){ SHADER_OK=false; $('#warn').style.display='block'; p.resetShader(); }
        }
        p.ambientMaterial(...colorA); p.sphere(radius);
      }

      function drawNucleusGlowOverlay(){
        const gl = p._renderer.GL;
        p.push(); p.resetShader(); p.noStroke();
        gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
        p.blendMode(p.ADD);
        const baseR = NUCLEUS_R0 * (atom.style.nucleusTight || 1.0), glowR = baseR * 2.6;
        for (let i=0;i<5;i++){ const t=i/4; p.fill(255,160,0, Math.round(28*(1.0-t))); p.push(); p.sphere(glowR*(1.0+t*0.55)); p.pop(); }
        p.blendMode(p.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST); p.pop();
      }

      p.draw = function(){
        // treemap background in screen space
        p.resetShader(); p.push(); p.resetMatrix();
        if (txTex) p.image(txTex,0,0,p.width,p.height); else p.background(9,12,15);
        if (atom.style.halving){ const tt=p.millis()*0.001; const pr=0.5+0.5*Math.sin(tt*0.9*Math.PI*2); p.noStroke(); p.fill(255,136,0, 35+55*pr); p.rect(0,0,p.width,p.height); }
        p.pop();

        // controls
        const s = uiPointerDown?0:1; p.orbitControl(s,s,1.5);

        // time
        const t=p.millis()*0.001;

        // gentle scene drift
        p.rotateY(t*0.06); p.rotateX(Math.sin(t*0.23)*0.05);

        // nucleus (protons vs neutrons styled differently)
        p.push();
        for(const q of atom.nucleusPoints){
          p.push(); p.translate(q.x,q.y,q.z);
          if (atom.style.halving){
            drawOrbMat(atom.style.colors.gold, atom.style.colors.gold, NUCLEON_R, t, atom.style.metalnessGold, atom.style.roughGold, 0.0, 0.0);
          } else if (q.isProton){
            // protons = glossier/warmer
            drawOrbMat(atom.colors.proton, shiftHue(atom.colors.proton, 18), NUCLEON_R, t, 0.85, 3.1);
          } else {
            // neutrons = matte/cooler
            drawOrbMat(shiftHue(atom.colors.neutron, -22), atom.colors.neutron, NUCLEON_R, t, 0.30, 4.6, 0.12, 0.35);
          }
          p.pop();
        }
        p.pop();

        // rings
        for(let i=0;i<atom.shells.length;i++){
          const r=atom.radii[i];
          p.push(); p.noFill();
          if (atom.style.halving){ p.stroke(255,136,0,160); p.strokeWeight(atom.style.ringThick*1.1); }
          else { p.stroke(...atom.style.ringColor, atom.style.ringAlpha); p.strokeWeight(atom.style.ringThick); }
          p.beginShape(); const steps=160; for(let k=0;k<steps;k++){ const ang=(k/steps)*Math.PI*2; p.vertex(r*Math.cos(ang), r*Math.sin(ang), 0); }
          p.endShape(p.CLOSE); p.pop();
        }

        // electrons: precessing ellipses with rosette wobble
        for(let i=0;i<atom.shells.length;i++){
          const r=atom.radii[i], baseSpeed=atom.speeds[i];
          for(let j=0;j<atom.shells[i];j++){
            const meta=atom.eMeta[i][j]; let theta = atom.electronAngles[i][j];
            const a = r*(1 + meta.e*0.35), b = r*(1 - meta.e*0.35);

            // precess the orbit plane around its axis
            const preAng = t * meta.pre + meta.phase;
            const v = rotateAroundAxis(meta.v, meta.u, preAng);
            const w = rotateAroundAxis(meta.w, meta.u, preAng);

            // ellipse point + small rosette wobble
            const basePt = vadd( vmul(v, a*Math.cos(theta)), vmul(w, b*Math.sin(theta)) );
            const wobble = 1.0 + meta.rosAmp*Math.sin(theta*meta.rosK + meta.phase*0.7);
            const pt = vmul(basePt, wobble);

            p.push();
            p.translate(pt[0], pt[1], pt[2]);
            if (atom.style.halving){
              drawOrbMat(atom.style.colors.silver, atom.style.colors.silver, ELECTRON_R*atom.style.eSizeScale*(1.0+0.22*Math.sin(t*2.6 + i*0.7 + j*1.13)), t, atom.style.metalnessSilver, atom.style.roughSilver, 0.0, 0.0);
            } else {
              const mixT = ( (j%7)/7 )*0.35; // slight tint shift
              const eCol = mixRGB(atom.colors.electron, atom.style.ringColor, mixT);
              drawOrbMat(eCol, atom.style.ringColor, ELECTRON_R*atom.style.eSizeScale, t,  atom.shader.MARBLE_INT, atom.shader.MARBLE_SCALE, atom.shader.animAmp, atom.shader.animSpeed);
            }
            p.pop();

            // advance phase
            atom.electronAngles[i][j] += baseSpeed * meta.spMul;
          }
        }

        if (atom.style.halving) drawNucleusGlowOverlay();
      };
    };
    return sketch;
  }

  // ---------- entry ----------
  window.__start = function(TRAITS){
    const wrap = el('div'); wrap.style.position='fixed'; wrap.style.inset='0'; document.body.appendChild(wrap);
    new p5(makeSketch(TRAITS), wrap);
  };
})();
