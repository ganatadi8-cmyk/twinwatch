import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const packageRoot=dirname(require.resolve('@mediapipe/tasks-vision'));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const assets=resolve(root,'public/mediapipe');
await mkdir(resolve(assets,'wasm'),{recursive:true});
await copyFile(resolve(packageRoot,'vision_bundle.js'),resolve(assets,'vision_bundle.js'));
for(const name of ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm']) await copyFile(resolve(packageRoot,'wasm',name),resolve(assets,'wasm',name));
const model=resolve(root,'public/models/pose_landmarker_lite.task');
const expected='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const matches=buffer=>createHash('sha256').update(buffer).digest('hex')===expected;
let present=false;
try{present=matches(await readFile(model));}catch{}
if(!present){
 const response=await fetch('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`Pose model download failed (${response.status}).`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(!matches(bytes))throw new Error('Pose model integrity check failed.');
 await mkdir(dirname(model),{recursive:true});await writeFile(model,bytes);
}
console.log('Pose model and WebAssembly assets are ready.');
