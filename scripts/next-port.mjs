// Runs `next <command>` on the PORT from .env (default 8000); next's CLI reads .env too late to pick up PORT itself.
import 'dotenv/config';
import { spawn } from 'node:child_process';

const command = process.argv[2] || 'dev';
const port = process.env.PORT || '8000';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', command, '-p', port], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
