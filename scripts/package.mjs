import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
// Keep packaging tools and staging on the project drive. Some Windows encrypted
// user caches reject cross-directory copyFile even when normal reads succeed.
const cache=path.resolve('.build-cache'),temp=path.resolve('.build-tmp');
await mkdir(cache,{recursive:true});await mkdir(temp,{recursive:true});
const child=spawn(process.execPath,['node_modules/electron-builder/out/cli/cli.js','--win','portable','--x64','--publish','never'],{stdio:'inherit',windowsHide:true,env:{...process.env,ELECTRON_BUILDER_CACHE:cache,TEMP:temp,TMP:temp}});
child.on('exit',code=>process.exit(code??1));
