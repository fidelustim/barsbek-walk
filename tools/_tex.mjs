import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';
for (const f of process.argv.slice(2)) {
  const doc = await new NodeIO().read(f);
  for (const t of doc.getRoot().listTextures()) {
    const out = '/tmp/bw_' + f.split('/').slice(-2).join('_').replace(/\W/g,'_') + '.' + (t.getMimeType().split('/')[1]);
    fs.writeFileSync(out, Buffer.from(t.getImage()));
    console.log(f, t.getMimeType(), t.getSize(), (t.getImage().byteLength/1024|0)+'KB', '->', out);
  }
  const m = doc.getRoot().listMaterials()[0]; console.log(' material', m.getName(), 'rough', m.getRoughnessFactor(), 'metal', m.getMetallicFactor(), 'normalTex', !!m.getNormalTexture());
}
