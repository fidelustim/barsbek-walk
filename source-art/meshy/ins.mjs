import fs from 'fs';
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f); const len = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + len).toString());
  const bin = b.length - 20 - len;
  console.log('==', f, 'json', len, 'bin', bin);
  console.log(' meshes', j.meshes?.length, 'prims', j.meshes?.map(m=>m.primitives.length), 'skins', j.skins?.length, 'joints', j.skins?.[0]?.joints.length);
  console.log(' anims', (j.animations||[]).map(a => a.name + ':' + a.channels.length));
  console.log(' images', (j.images||[]).map(i => i.mimeType + ' ' + (j.bufferViews[i.bufferView]?.byteLength/1024|0) + 'KB'));
  console.log(' textures', j.textures?.length, 'materials', JSON.stringify(j.materials).slice(0,300));
  const acc = j.accessors[j.meshes[0].primitives[0].attributes.POSITION]; console.log(' verts', acc.count, 'min', acc.min, 'max', acc.max);
  if (j.skins) console.log(' bones', j.skins[0].joints.map(i => j.nodes[i].name).join(','));
  console.log(' ext', j.extensionsUsed);
}
