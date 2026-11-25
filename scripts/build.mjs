import { build as bundle } from 'esbuild';
import { build as frontend } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
await frontend();
await bundle({ entryPoints: ['src/main/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/main.cjs', external: ['electron'] });
await bundle({ entryPoints: ['src/preload/index.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/preload.cjs', external: ['electron'] });
const seen=new Set(),licenses=[];
async function collect(name){if(seen.has(name))return;seen.add(name);const dir=path.join('node_modules',name);const pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));let license='';for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','license']){try{license=await fs.readFile(path.join(dir,file),'utf8');break;}catch{}}
licenses.push(`\n===== ${name} ${pkg.version} (${pkg.license??'see package'}) =====\n${license}`);for(const dep of Object.keys(pkg.dependencies??{}))await collect(dep);}
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));for(const name of Object.keys(pkg.dependencies))await collect(name);
await fs.writeFile('dist/THIRD_PARTY_LICENSES.txt',licenses.join('\n'));
