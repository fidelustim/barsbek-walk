import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read('source-art/meshy_v2/rigged.glb');
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray(), I = prim.getIndices().getArray(), nV = P.length/3;
const key=(i)=>`${P[i*3].toFixed(4)},${P[i*3+1].toFixed(4)},${P[i*3+2].toFixed(4)}`;
const weld=new Map(), rep=new Int32Array(nV); for(let i=0;i<nV;i++){const k=key(i); if(!weld.has(k)) weld.set(k,i); rep[i]=weld.get(k);}
const adj=new Map(); const link=(a,b)=>{a=rep[a];b=rep[b]; if(a===b) return; if(!adj.has(a)) adj.set(a,new Set()); adj.get(a).add(b);};
for(let t=0;t<I.length;t+=3) for(let k=0;k<3;k++){link(I[t+k],I[t+(k+1)%3]);link(I[t+(k+1)%3],I[t+k]);}
// tip = most backward vertex
let tip=0; for(let i=0;i<nV;i++) if(rep[i]===i && P[i*3+2]<P[tip*3+2]) tip=i;
console.log('tip', [0,1,2].map(k=>P[tip*3+k].toFixed(3)));
const D=new Float64Array(nV).fill(Infinity); D[tip]=0;
// simple Dijkstra with binary heap
const h=[[0,tip]]; const push=(e)=>{h.push(e);let i=h.length-1;while(i>0){const p=(i-1)>>1;if(h[p][0]<=h[i][0])break;[h[p],h[i]]=[h[i],h[p]];i=p;}};
const pop=()=>{const top=h[0],last=h.pop();if(h.length){h[0]=last;let i=0;for(;;){let l=2*i+1,r=l+1,m=i;if(l<h.length&&h[l][0]<h[m][0])m=l;if(r<h.length&&h[r][0]<h[m][0])m=r;if(m===i)break;[h[m],h[i]]=[h[i],h[m]];i=m;}}return top;};
while(h.length){const [d,v]=pop(); if(d>D[v]) continue; if (d>1.4) break; for(const u of adj.get(v)||[]){const w=d+Math.hypot(P[u*3]-P[v*3],P[u*3+1]-P[v*3+1],P[u*3+2]-P[v*3+2]); if(w<D[u]){D[u]=w;push([w,u]);}}}
const S=0.03;
for (let s=0; s<1.3; s+=S){ const sel=[]; for(let i=0;i<nV;i++) if(rep[i]===i&&D[i]>=s&&D[i]<s+S) sel.push(i); if(!sel.length) continue;
  const c=[0,1,2].map(k=>sel.reduce((a,i)=>a+P[i*3+k],0)/sel.length); let r=0; for(const i of sel) r=Math.max(r,Math.hypot(P[i*3]-c[0],P[i*3+1]-c[1],P[i*3+2]-c[2]));
  console.log(s.toFixed(2),'n',sel.length,'c',c.map(v=>v.toFixed(2)).join(','),'r',r.toFixed(3)); }
