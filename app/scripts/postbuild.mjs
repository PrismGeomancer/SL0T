// GitHub Pages fallback: serve the app for unknown paths too (we use hash routing, this is belt and braces).
import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../dist/index.html', import.meta.url), new URL('../dist/404.html', import.meta.url));
console.log('dist/404.html written');
