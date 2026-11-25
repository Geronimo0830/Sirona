import './build.mjs';
import { spawn } from 'node:child_process';
import electron from 'electron';
// The development command opens an interactive desktop window.
const child = spawn(electron, ['.'], { stdio: 'inherit' });
child.on('error', error => {
  console.error('无法启动 Sirona：', error.message);
  process.exitCode = 1;
});
child.on('exit', code => process.exit(code ?? 1));
process.on('SIGINT', () => child.kill());
