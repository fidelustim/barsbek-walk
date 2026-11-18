import { NodeIO } from '@gltf-transform/core';
const f = process.argv[2];
const doc = await new NodeIO().read(f);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray();
let mn=[9,9,9], mx=[-9,-9,-9];
for (let i=0;i<P.length;i+=3) for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],P[i+k]);mx[k]=Math.max(mx[k],P[i+k]);}
console.log('bbox', mn.map(v=>v.toFixed(2)), mx.map(v=>v.toFixed(2)), 'verts', P.length/3);
const H=36, W=56, g=Array.from({length:H},()=>Array(W).fill(' '));
const zr=[mn[2],mx[2]], yr=[mn[1],mx[1]];
for (let i=0;i<P.length;i+=3){ const y=P[i+1], z=P[i+2]; const r=H-1-Math.floor((y-yr[0])/(yr[1]-yr[0]+1e-6)*H), c=Math.floor((z-zr[0])/(zr[1]-zr[0]+1e-6)*W); if(r>=0&&r<H&&c>=0&&c<W) g[r][c]='#'; }
console.log('side view (left = -z, right = +z)'); console.log(g.map(r=>r.join('')).join('\n'));
