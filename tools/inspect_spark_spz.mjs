// Что Spark реально видит в .spz: границы и первый «сплат-центр» через forEachSplat (без WebGL).
// node tools/inspect_spark_spz.mjs <file.spz>
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const file = process.argv[2];
const bytes = new Uint8Array(fs.readFileSync(file));

// spark.module.js импортирует 'three' — подсовываем локальную копию через import-map-подобный шим
const dir = path.resolve('.tmp-spark-test');
fs.mkdirSync(dir, { recursive: true });
const sparkSrc = fs.readFileSync(path.resolve('.cache-spark/spark.module.js'), 'utf8')
  .replace(/from\s+"three"/g, `from "${path.resolve('node_modules/three/build/three.module.js')}"`)
  .replace(/from\s+'three'/g, `from "${path.resolve('node_modules/three/build/three.module.js')}"`);
fs.writeFileSync(path.join(dir, 'spark.module.js'), sparkSrc);
const { SplatMesh } = await import(path.join(dir, 'spark.module.js'));

const mesh = new SplatMesh({ fileBytes: bytes, fileName: path.basename(file) });
await mesh.initialized;
console.log('numSplats', mesh.packedSplats?.numSplats ?? mesh.splats?.getNumSplats?.());
let n = 0, first = null;
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
mesh.forEachSplat((i, c, s, q, o) => {
  n++;
  if (!first) first = { c: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], o: +o.toFixed(2), s: [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)] };
  if (o >= 0.25) for (let k = 0; k < 3; k++) { const v = [c.x, c.y, c.z][k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
});
console.log('forEachSplat прошёл', n, 'сплатов; первый:', JSON.stringify(first));
console.log('границы (alpha>=0.25):', min.map((v) => v.toFixed(2)).join(' .. '), '|', max.map((v) => v.toFixed(2)).join(' .. '));
console.log('позиция/кватернион меша:', mesh.position.toArray(), mesh.quaternion.toArray().map((v) => +v.toFixed(3)));
