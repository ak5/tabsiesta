import net from 'node:net';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Do not take a port from an existing development server.
const server = net.createServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const { port } = server.address();
await new Promise((resolve) => server.close(resolve));
await writeFile('.env.dev-slot', `DEV_PORT=${port}\nDEV_URL=http://127.0.0.1:${port}\n`);
const child = spawn('pnpm', ['exec', 'wxt', '-b', 'chrome', '--port', String(port)], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
