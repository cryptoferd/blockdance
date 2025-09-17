/* master.js — Ordinals master renderer
   - Adds Block Details + Info panels (collapsible)
   - Pan/Tilt/Zoom fixed: orbitControl always on; disabled when interacting with UI
   - No network calls; everything derives from locked TRAITS
*/
/* global p5 */
(function () {
  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  function el(tag, attrs={}, html=""){ const e=document.createElement(tag); Object.assign(e, attrs); if(html) e.innerHTML=html; return e; }
  function safeText(id, txt){ const n=document.getElementById(id); if(n) n.textContent = txt; }
  function safeHTML(id, html){ const n=document.getElementById(id); if(n) n.innerHTML = html; }

  // ---------- styles (injected) ----------
  const CSS = `
  :root { --panel-bg: rgba(10,14,18,0.90); --panel-border:#1e2a33; --text:#cfe4ff; --muted:#8fbfe6; --accent:#9fd2ff; }
  html,body{margin:0;height:100%;background:#000;color:var(--text);font-family: system-ui, Segoe UI, Roboto, Arial, sans-serif;}
  canvas{display:block;touch-action:none}
  .panel{position:fixed;z-index:11;font-size:12px;color:var(--muted);padding:8px 10px;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:12px;max-width:min(480px,calc(100vw - 20px));backdrop-filter:blur(6px)}
  #legend{left:10px;top:10px}
  details#blockPanel{right:10px;bottom:10px}
  details#blockPanel>summary{list-style:none;cursor:pointer;padding:10px 12px;color:#d7ecff;font-weight:700;display:flex;justify-content:space-between;gap:8px}
  details#blockPanel[open]>summary{border-bottom:1px solid var(--panel-border)}
  details#blockPanel summary::-webkit-details-marker{display:none}
  #blkBody{padding:10px 12px;color:#b7d2ea}
  #blkBody table{width:100%;border-collapse:collapse}
  #blkBody td{padding:4px 0;vertical-align:top}
  #blkBody td:first-child{color:#9cc9ee;width:36%}
  .chip{display:inline-block;padding:2px 6px;border:1px solid #2b3a44;border-radius:8px;margin:2px 2px 2px 0;color:#d7ecff;font-size:11px}
  .chip.warn{border-color:#ffae5a;color:#ffd9b0}
  details#infoPanel{left:10px;bottom:10px}
  details#infoPanel>summary{list-style:none;cursor:pointer;padding:10px 12px;color:#d7ecff;font-weight:700;display:flex;gap:8px;align-items:center}
  details#infoPanel[open]>summary{border-bottom:1px solid var(--panel-border)}
  details#infoPanel summary .badge{width:22px;height:22px;display:inline-grid;place-items:center;border-radius:999px;background:#1e2a33;color:#cfe4ff;border:1px solid #2b3a44;font-weight:800}
  #infoBody{padding:10px 12px;color:#b7d2ea}
  #infoBody h3{margin:8px 0 4px;color:#e3f1ff;font-size:13px}
  #infoBody p{margin:6px 0}
  #infoBody ul{margin:6px 0 6px 18px}
  #warn{position:fixed;left:10px;top:70px;color:#ffd26f;font-weight:600;display:none;z-index:12}
  `;
  function injectCSS(){ const s=el('style',{textContent:CSS}); document.head.appendChild(s); }

  // ---------- math & color utils ----------
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mod=(a,n)=>((a%n)+n)%n;
  function XS32(seed){let x=seed>>>0||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/0xFFFFFFFF;};}
  function hslToRgb(h,s,l){let r,g,b;if(s===0){r=g=b=l;}else{const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};const q=l<0.5?l*(1+s):l+s-l*s;const p=2*l-q;r=hue2rgb(p,q,h+1/3);g=hue2rgb(p,q,h);b=hue2rgb(p,q,h-1/3);}return [Math.round(r*255),Math.round(g*255),Math.round(b*255)];}
  function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b);let h,s,l=(max+min)/2;if(max===min){h=s=0;}else{const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;break;}h/=6;}return[h,s,l];}
  const shiftHue=(rgb,deg)=>{const[h,s,l]=rgbToHsl(rgb[0],rgb[1],rgb[2]);let hh=(h+(deg/360))%1; if(hh<0) hh+=1; return hslToRgb(hh,s,l);}
  const mixRGB=(a,b,t)=>[Math.round(a[0]*(1-t)+b[0]*t),Math.round(a[1]*(1-t)+b[1]*t),Math.round(a[2]*(1-t)+b[2]*t)];
  const lastByte = (hex)=>{ if(!hex) return 0; const c=hex.replace(/[^0-9a-fA-F]/g,''); if(c.length<2) return 0; return parseInt(c.slice(-2),16)||0; };
  const hexByteSum = (hex)=>{ if(!hex) return 0; const c=hex.replace(/[^0-9a-fA-F]/g,''); let s=0; for(let i=0;i<c.length;i+=2){ const b=parseInt(c.substr(i,2),16); if(!isNaN(b)) s+=b; } return s; };
  const byteAt=(hex,idx)=>{ if(!hex) return 0; const c=hex.replace(/[^0-9a-fA-F]/g,''); if(c.length<2) return 0; const i=(idx*2)%(c.length-1); const b=parseInt(c.substr(i,2),16); return isNaN(b)?0:b; };
  const fillShells=e=>{ let shells=[],rem=e,n=1; while(rem>0&&shells.length<8){ const cap=2*n*n; const take=Math.min(rem,cap); shells.push(take); rem-=take; n++; } if(rem>0) shells.push(rem); return shells; };
  const approxLog2Target=bits=>{const exp=(bits>>>24)&0xff, mant=bits&0x007fffff||1; return Math.log2(mant)+8*(exp-3);};
  const approxLog2Hash=hex=>{const c=(hex||'').replace(/[^0-9a-fA-F]/g,''); if(!c.length) return 0; let i=0; while(i<c.length && c[i]==='0') i++; const lead=parseInt(c.substr(i,2)||'01',16)||1; const bitsFromPos=(c.length-i)/2*8; return Math.log2(lead)+bitsFromPos-8;};
  const isHalving=h=>h>0 && (h%210000)===0;
  const shortHash=h=> h ? (String(h).slice(0,10)+'…'+String(h).slice(-8)) : 'n/a';

  // ---------- shader (metallic + animated marble) ----------
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

  // ---------- core build from locked traits ----------
  const NUCLEUS_R0=28, SHELL_STEP=22, ELECTRON_R=3.6, NUCLEON_R=2.7;
  function paletteFromHeight(height){
    const rng=XS32(height), golden=137.50776405003785; let baseHue=mod((height*golden)+rng()*45,360);
    let hP=baseHue, hN=mod(baseHue+(90+rng()*120),360), hE=mod(baseHue+(180+rng()*120),360), hS=mod(baseHue+(30+rng()*120),360);
    let sP=0.82+0.18*rng(), lP=0.48+0.12*rng(); let sN=0.72+0.25*rng(), lN=0.52+0.12*rng(); let sE=0.92+0.08*rng(), lE=0.58+0.12*rng(); let sS=0.82+0.18*rng(), lS=0.56+0.12*rng();
    return{ proton:hslToRgb(hP/360,sP,lP), neutron:hslToRgb(hN/360,sN,lN), electron:hslToRgb(hE/360,sE,lE), shell:hslToRgb(hS/360,sS,lS) };
  }
  function buildAtomFromTraits(b){
    const height=b.height, txCount=b.tx_count||b.txCount||1, timestamp=b.timestamp||0, mediantime=b.mediantime||timestamp;
    const bits=b.bits||0, nonce=b.nonce||0, merkleRoot=b.merkle_root||b.merkleRoot||"", weight=b.weight||0, size=b.size||0, version=b.version||0, hash=b.id||b.hash||"";
    const halving=isHalving(height);

    let colors=paletteFromHeight(height);
    if(((version>>1)&1)===1){ const t=colors.proton; colors.proton=colors.neutron; colors.neutron=t; }

    const Z=(height%118)+1, N=(hexByteSum(merkleRoot)%200), electrons=Z, shells=fillShells(electrons);

    const t2=approxLog2Target(bits), h2=approxLog2Hash(hash), luck=clamp((t2-h2)/24+1.0,0.7,1.5);
    const speedScale=clamp(((txCount-50)/(6000-50))*0.7+0.9,0.7,1.8)*luck;

    const weightOrSize=weight||size*4;
    const eSizeScale=(((weightOrSize-2.8e6)/(4.0e6-2.8e6))*(1.50-0.90)+0.90);

    const dens=clamp(weight/Math.max(1,size*4),0.6,1.4);
    const nonceNorm=(nonce>>>0)/4294967295;
    let nucleusScale=((1.10-0.65)*nonceNorm+0.65)*dens*(1.0/Math.sqrt(luck));

    const spreadTx=clamp((txCount-1)/(6000-1)*(1.35-0.9)+0.9,0.9,1.35);
    const spreadVer=1.0+((version&0xF)-7.5)*0.01;
    const orbitSpread=spreadTx*spreadVer;
    const radii=shells.map((_,i)=>(NUCLEUS_R0*1.3 + SHELL_STEP*(i+1))*orbitSpread);

    const shellTilt=shells.map((_,s)=> (0.7-0.05)* (byteAt(merkleRoot,s*3)/255) + 0.05);
    const eccA=[], eccB=[]; for(let i=0;i<shells.length;i++){ const r=XS32(nonce^(i*0x9e3779b1))(); eccA.push(1.0+0.08*r); eccB.push(1.0-0.08*r); }

    const jitterAmp=clamp(((txCount-50)/(6000-50))*0.45,0.0,0.45);
    const electronAngles=[], eColorMix=[], eTiltJitter=[];
    for(let i=0;i<shells.length;i++){
      electronAngles[i]=[]; eColorMix[i]=[]; eTiltJitter[i]=[];
      for(let j=0;j<shells[i];j++){
        const seedByte=byteAt(merkleRoot,(i*31+j)%Math.max(1,merkleRoot.length));
        let ang=(seedByte/255)*Math.PI*2;
        const jit=((byteAt(merkleRoot,i*97+j*11)/255)-0.5)*jitterAmp; ang+=jit; electronAngles[i][j]=ang;
        eColorMix[i][j]=clamp((byteAt(merkleRoot,i*53+j*7)/255)*0.35,0.0,0.35);
        eTiltJitter[i][j]=((byteAt(merkleRoot,i*19+j*5)/255)*(0.16))-0.08;
      }
    }

    const nucleusPoints=[];
    const nucleusCount=Math.min(900,Z+N);
    for(let i=0;i<nucleusCount;i++){
      const r=NUCLEUS_R0*nucleusScale*(0.55+Math.random()*0.45), th=Math.random()*Math.PI*2, ph=Math.acos(2*Math.random()-1);
      nucleusPoints.push({x:r*Math.sin(ph)*Math.cos(th),y:r*Math.sin(ph)*Math.sin(th),z:r*Math.cos(ph),isProton:i<Z});
    }

    const hashLast=lastByte(hash);
    const ringThickBase=0.8+(hashLast/255)*2.0;
    const ringThick=ringThickBase*(((version>>0)&1)?1.8:1.0);
    const ringAlpha=clamp(140+(luck-1.0)*120,80,255);
    const hueShiftDeg=(hashLast/255 - 0.5)*36;
    const ringColor=shiftHue(colors.shell, hueShiftDeg);

    const base=(timestamp%600)/600, noiseSeed=(nonce%997)/997;
    const speeds=shells.map((_, i)=> (0.005 + 0.018*((Math.sin((base + i*0.137 + noiseSeed)*43758.5453123)*0.5+0.5))) * speedScale);

    const timeSkew=clamp((timestamp-mediantime)/600,-1,1);
    const wobbleAmp=((1.03-0.97)*(timeSkew+1)/2+0.97);
    const wobbleFreq=0.5+Math.abs(timeSkew)*0.8;

    const mode=height%4; let MARBLE_INT=0.88, MARBLE_SCALE=3.6;
    if(mode===1){ MARBLE_INT=0.72; MARBLE_SCALE=4.4; }
    else if(mode===2){ MARBLE_INT=0.62; MARBLE_SCALE=2.6; }
    else if(mode===3){ MARBLE_INT=0.40; MARBLE_SCALE=2.0; }

    const animAmp=clamp(0.12 + (txCount/6000)*0.35 + ((version&0xF)/15)*0.08, 0.12, 0.60);
    const animSpeed=clamp(0.35 + ((height%12)/12)*0.9 + ((nonce&0xFF)/255)*0.6, 0.35, 1.85);
    const blockPhase=(byteAt(merkleRoot,7)/255)*Math.PI*2;

    const halvingStyle= halving ? {
      halving:true,
      nucleusScale,
      bgPulseSpeed:0.9, ePulseSpeed:2.6,
      metalnessGold:0.92, roughGold:3.2,
      metalnessSilver:0.88, roughSilver:3.6,
      colors:{ gold:[255,215,64], silver:[200,210,225], orange:[255,136,0] }
    } : { halving:false };

    return {
      block: { height, hash, timestamp, mediantime, bits, tx_count: txCount, weight, size, nonce, version, merkle_root: merkleRoot },
      height, Z, N, electrons, shells, radii, speeds, electronAngles, nucleusPoints, colors,
      shellTilt, eccA, eccB, eColorMix, eTiltJitter,
      shader:{ MARBLE_INT, MARBLE_SCALE, animAmp, animSpeed, blockPhase },
      style:{ eSizeScale, orbitSpread, ringThick, ringAlpha, ringColor, wobbleAmp, wobbleFreq, nucleusScale, ...halvingStyle }
    };
  }

  // ---------- UI (panels + guards) ----------
  let uiPointerDown=false;
  function attachGuards(nodes){
    const down=()=>{ uiPointerDown=true; };
    const up=()=>{ uiPointerDown=false; };
    nodes.forEach(n=>{
      n.addEventListener('pointerdown', down);
      n.addEventListener('pointerup', up);
      n.addEventListener('pointerleave', up);
      n.addEventListener('pointercancel', up);
      n.addEventListener('wheel', (e)=>{ e.stopPropagation(); e.preventDefault(); }, {passive:false});
    });
    document.addEventListener('pointerup', up);
  }
  function buildPanels(atom){
    // legend (controls)
    const legend = el('div', { id:'legend', className:'panel' }, `
      <div><b>Controls</b></div>
      <div>• <b>Rotate/Tilt</b>: drag</div>
      <div>• <b>Pan</b>: right-drag / two-finger</div>
      <div>• <b>Zoom</b>: wheel / pinch</div>
    `);
    document.body.appendChild(legend);

    // block details
    const blk = atom.block;
    const blockPanel = el('details', { id:'blockPanel', open:false });
    const hdr = `<span>▼ Block Details</span><span id="blkTitle" style="color:#d7dfff;font-weight:500;">#${blk.height} — ${shortHash(blk.hash)}</span>`;
    blockPanel.appendChild(el('summary',{},hdr));
    const date = blk.timestamp ? new Date(blk.timestamp*1000).toLocaleString() : 'n/a';
    const mdate = blk.mediantime ? new Date(blk.mediantime*1000).toLocaleString() : 'n/a';
    const chips = [
      `<span class="chip">${atom.style.halving?'Halving Mode':'Mode: metallic/marble'}</span>`,
      `<span class="chip">Z=${atom.Z}</span>`,
      `<span class="chip">N≈${atom.N}</span>`,
      `<span class="chip">e⁻=${atom.electrons}</span>`,
      `<span class="chip">shells=[${atom.shells.join(', ')}]</span>`
    ].join(' ');
    const body = `
      <div id="blkBody">
        <div style="margin-bottom:6px;">${chips}</div>
        <table>
          <tr><td>Height</td><td>${blk.height}</td></tr>
          <tr><td>Hash</td><td><code>${shortHash(blk.hash)}</code></td></tr>
          <tr><td>Time</td><td>${date} (median: ${mdate})</td></tr>
          <tr><td>Tx count</td><td>${blk.tx_count ?? 'n/a'}</td></tr>
          <tr><td>Bits</td><td>${blk.bits ?? 'n/a'}</td></tr>
          <tr><td>Nonce</td><td>${blk.nonce ?? 'n/a'}</td></tr>
          <tr><td>Version</td><td>${blk.version ?? 'n/a'}</td></tr>
          <tr><td>Size (bytes)</td><td>${blk.size ?? 'n/a'}</td></tr>
          <tr><td>Weight (WU)</td><td>${blk.weight ?? 'n/a'}</td></tr>
          <tr><td>Merkle root</td><td><code>${shortHash(blk.merkle_root)}</code></td></tr>
        </table>
      </div>`;
    blockPanel.appendChild(el('div', {innerHTML:body}));
    document.body.appendChild(blockPanel);

    // info / how it works
    const info = el('details', { id:'infoPanel', className:'panel', open:false });
    info.appendChild(el('summary', {}, `<span class="badge">?</span> Info / How it works`));
    info.appendChild(el('div', { id:'infoBody', innerHTML: `
      <h3>What am I seeing?</h3>
      <p>A 3D “atom” whose structure and appearance are <b>deterministically</b> derived from this block’s data (height, hash, tx count, bits, nonce, version, etc.). No network calls.</p>
      <h3>Trait mapping (locked per item)</h3>
      <ul>
        <li><b>Electrons / shells</b>: Z = (height mod 118) + 1; shells fill by 2n².</li>
        <li><b>Palette</b>: wide HSL palette seeded by height.</li>
        <li><b>Electron size</b>: scales with weight/size.</li>
        <li><b>Orbit speeds</b>: tx_count + “luck” from bits vs hash.</li>
        <li><b>Nucleus density</b>: weight:size ratio + nonce.</li>
        <li><b>Rings</b>: shell hue shifted by hash tail.</li>
        <li><b>Halving blocks</b>: Special gold/silver theme + pulsing orange/black background.</li>
      </ul>
      <h3>Controls</h3>
      <ul>
        <li><b>Rotate/Tilt</b>: drag</li>
        <li><b>Pan</b>: right-drag (desktop) or two-finger drag (touch)</li>
        <li><b>Zoom</b>: mouse wheel or pinch</li>
      </ul>
    `}));
    document.body.appendChild(info);

    // shader fallback warning
    document.body.appendChild(el('div',{id:'warn',textContent:'Shader fallback active (simplified lighting).'}));

    attachGuards([legend, blockPanel, info]);
  }

  // ---------- p5 sketch ----------
  const ELEC_R=ELECTRON_R, NUCL_R=NUCLEON_R;
  function makeSketch(traits){
    const atom = buildAtomFromTraits(traits);
    let orbShader, SHADER_OK=true;

    const sketch = (p)=>{
      p.setup = function(){
        p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
        p.setAttributes('antialias', true);
        injectCSS();
        buildPanels(atom);
        orbShader = p.createShader(VERT, FRAG);
      };
      p.windowResized = ()=> p.resizeCanvas(p.windowWidth, p.windowHeight);

      function drawOrbFixed(colorA, colorB, radius, t, metal, rough){
        p.noStroke();
        if (SHADER_OK){
          try{
            p.shader(orbShader);
            orbShader.setUniform('uColorA', colorA.map(v=>v/255));
            orbShader.setUniform('uColorB', colorB.map(v=>v/255));
            orbShader.setUniform('uMarbleInt', metal);
            orbShader.setUniform('uMarbleScale', rough);
            orbShader.setUniform('uTime', t);
            orbShader.setUniform('uAnimAmp', 0.0);
            orbShader.setUniform('uAnimSpeed', 0.0);
            orbShader.setUniform('uBlockPhase', 0.0);
            p.sphere(radius);
            p.resetShader(); return;
          }catch(e){ SHADER_OK=false; $('#warn').style.display='block'; p.resetShader(); }
        }
        p.ambientMaterial(...colorA); p.sphere(radius);
      }
      function drawOrb(colorA, colorB, radius, t){
        p.noStroke();
        if (SHADER_OK){
          try{
            p.shader(orbShader);
            orbShader.setUniform('uColorA', colorA.map(v=>v/255));
            orbShader.setUniform('uColorB', colorB.map(v=>v/255));
            orbShader.setUniform('uMarbleInt', atom.shader.MARBLE_INT);
            orbShader.setUniform('uMarbleScale', atom.shader.MARBLE_SCALE);
            orbShader.setUniform('uTime', t);
            orbShader.setUniform('uAnimAmp', atom.shader.animAmp || 0.25);
            orbShader.setUniform('uAnimSpeed', atom.shader.animSpeed || 0.8);
            orbShader.setUniform('uBlockPhase', atom.shader.blockPhase || 0.0);
            p.sphere(radius);
            p.resetShader(); return;
          }catch(e){ SHADER_OK=false; $('#warn').style.display='block'; p.resetShader(); }
        }
        p.ambientMaterial(...colorA); p.sphere(radius);
      }

      function drawNucleusGlowOverlay(){
        const gl = p._renderer.GL;
        p.push(); p.resetShader(); p.noStroke();
        gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
        p.blendMode(p.ADD);
        const baseR = NUCLEUS_R0 * (atom.style.nucleusScale || 1.0);
        const glowR = baseR * 2.8;
        for (let i=0;i<5;i++){
          const t=i/4; const alpha=Math.round(28*(1.0-t));
          p.fill(255,160,0,alpha); p.push(); p.sphere(glowR*(1.0+t*0.55)); p.pop();
        }
        p.blendMode(p.BLEND);
        gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
        p.pop();
      }

      p.draw = function(){
        // Always enable orbitControl; disable rotation/pan when pointer is over UI
        const s = uiPointerDown ? 0 : 1;          // rotation & pan sensitivity
        p.orbitControl(s, s, 1.5);                // zoom always active

        // background
        if (atom.style.halving){
          const tt=p.millis()*0.001; const pr=0.5+0.5*Math.sin(tt*atom.style.bgPulseSpeed*Math.PI*2);
          const o=atom.style.colors.orange; const r=(1-pr)*11 + pr*o[0], g=(1-pr)*14 + pr*o[1], b=(1-pr)*18 + pr*o[2];
          p.background(r,g,b);
        } else { p.background(9,12,15); }

        const t=p.millis()*0.001;
        p.rotateY(t*0.07 + Math.sin(t*atom.style.wobbleFreq)*0.02);
        p.rotateX(Math.sin(t*0.23)*0.05);

        // Nucleus
        p.push();
        const breath = 1.0 + (Math.sin(t * atom.style.wobbleFreq*2.0)*0.02) * (atom.style.wobbleAmp-1.0);
        p.scale(breath, 1.0, 1.0);
        const gold=atom.style.colors?.gold;
        for(const q of atom.nucleusPoints){
          p.push(); p.translate(q.x,q.y,q.z);
          if (atom.style.halving) drawOrbFixed(gold,gold,NUCL_R,t,atom.style.metalnessGold,atom.style.roughGold);
          else drawOrb(q.isProton? atom.colors.proton : atom.colors.neutron,
                       q.isProton? atom.colors.neutron : atom.colors.proton, NUCL_R, t);
          p.pop();
        }
        p.pop();

        // Rings
        for(let i=0;i<atom.shells.length;i++){
          const r=atom.radii[i];
          p.push(); p.noFill();
          if (atom.style.halving){ p.stroke(255,136,0,160); p.strokeWeight(atom.style.ringThick*1.1); }
          else { p.stroke(...atom.style.ringColor, atom.style.ringAlpha); p.strokeWeight(atom.style.ringThick); }
          p.beginShape(); const steps=160; for(let k=0;k<steps;k++){ const ang=(k/steps)*Math.PI*2; p.vertex(r*Math.cos(ang), r*Math.sin(ang), 0); }
          p.endShape(p.CLOSE); p.pop();
        }

        // Electrons
        for(let i=0;i<atom.shells.length;i++){
          const r=atom.radii[i], aMul=atom.eccA[i], bMul=atom.eccB[i];
          for(let j=0;j<atom.shells[i];j++){
            const ang=atom.electronAngles[i][j], tilt=atom.shellTilt[i]+atom.eTiltJitter[i][j];
            const ex=(r*aMul)*Math.cos(ang), ey=(r*bMul)*Math.sin(ang)*Math.cos(tilt), ez=(r*bMul)*Math.sin(ang)*Math.sin(tilt);
            p.push(); p.translate(ex,ey,ez);
            if (atom.style.halving){
              const silver=atom.style.colors.silver;
              const spd = atom.style.ePulseSpeed || 2.6;
              const phase=(i*0.7 + j*1.13), pulse=1.0+0.22*Math.sin(t*spd+phase);
              drawOrbFixed(silver, silver, ELECTRON_R*atom.style.eSizeScale*pulse, t, atom.style.metalnessSilver, atom.style.roughSilver);
            } else {
              const mixT=atom.eColorMix[i][j], eCol=mixRGB(atom.colors.electron, atom.style.ringColor, mixT);
              drawOrb(eCol, atom.style.ringColor, ELECTRON_R*atom.style.eSizeScale, t);
            }
            p.pop();
          }
        }

        // Halving glow drawn last as overlay (no depth test/writes)
        if (atom.style.halving) drawNucleusGlowOverlay();

        // Advance electron phases
        for(let i=0;i<atom.shells.length;i++)
          for(let j=0;j<atom.shells[i];j++)
            atom.electronAngles[i][j]+=atom.speeds[i];
      };
    };
    return sketch;
  }

  // ---------- exposed entry ----------
  window.__start = function(TRAITS){
    const wrap = el('div'); wrap.style.position='fixed'; wrap.style.inset='0'; document.body.appendChild(wrap);
    new p5(makeSketch(TRAITS), wrap);
  };
})();
