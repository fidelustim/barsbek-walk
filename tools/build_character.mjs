// Сборка barsbek.glb: модель со скелетом + клипы Idle/Walk/Run/Jump из отдельных файлов Meshy,
// текстура пережимается в JPEG 2048 (из 3.4 МБ), лишнее удаляется.
// Запуск: node tools/build_character.mjs
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import { execFileSync } from 'child_process';
import fs from 'fs';

const D = 'source-art/meshy/';
const io = new NodeIO();
const base = await io.read(D + 'rigged.glb');
const root = base.getRoot();
// Удаляем исходный клип rigged.glb (это T/A-поза), берём клипы из файлов анимаций.
for (const a of root.listAnimations()) a.dispose();

const nodeByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const clips = [['anim_0.glb', 'Idle'], ['walking.glb', 'Walk'], ['running.glb', 'Run'], ['anim_466.glb', 'Jump']];
for (const [file, name] of clips) {
  const src = await io.read(D + file);
  for (const sa of src.getRoot().listAnimations()) {
    const anim = base.createAnimation(name);
    const buf = root.listBuffers()[0];
    for (const ch of sa.listChannels()) {
      const tgt = nodeByName.get(ch.getTargetNode().getName());
      if (!tgt) continue;
      const ss = ch.getSampler();
      const inp = base.createAccessor().setArray(ss.getInput().getArray().slice()).setType('SCALAR').setBuffer(buf);
      let arr = ss.getOutput().getArray().slice();
      // В прыжке подъём делает физика игры, поэтому из клипа убираем подъём таза вверх
      // (оставляем присед перед прыжком и при приземлении).
      if (name === 'Jump' && tgt.getName() === 'Hips' && ch.getTargetPath() === 'translation') {
        const restY = arr[1];
        for (let i = 1; i < arr.length; i += 3) arr[i] = Math.min(arr[i], restY);
      }
      const out = base.createAccessor().setArray(arr).setType(ss.getOutput().getType()).setBuffer(buf);
      const s = base.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation(ss.getInterpolation());
      anim.addSampler(s);
      anim.addChannel(base.createAnimationChannel().setTargetNode(tgt).setTargetPath(ch.getTargetPath()).setSampler(s));
    }
    console.log('clip', name, sa.listChannels().length, 'channels');
  }
}

// Текстура: JPEG 2048, quality 85 (через Pillow).
for (const tex of root.listTextures()) {
  fs.writeFileSync('/tmp/bw_tex_in', Buffer.from(tex.getImage()));
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open('/tmp/bw_tex_in').convert('RGB')
if max(im.size) > 2048: im = im.resize((2048, 2048), Image.LANCZOS)
im.save('/tmp/bw_tex_out.jpg', quality=85, optimize=True)
`]);
  tex.setImage(fs.readFileSync('/tmp/bw_tex_out.jpg')).setMimeType('image/jpeg');
}

await base.transform(dedup(), prune());
fs.mkdirSync('assets/models', { recursive: true });
await io.write('assets/models/barsbek.glb', base);
console.log('written', (fs.statSync('assets/models/barsbek.glb').size / 1024 / 1024).toFixed(2), 'MB');
