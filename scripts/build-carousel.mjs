import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/dashboard-carousel.jsx'],
  outfile: 'assets/dashboard-carousel.js',
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  target: ['es2020'],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'linked',
  logLevel: 'info'
});
await copyFile(
  new URL('../src/components/CircularCarousel.LICENSE.md', import.meta.url),
  new URL('../assets/CircularCarousel.LICENSE.md', import.meta.url)
);
