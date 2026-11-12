// Pages fallback + absolute share-image URLs (link previews ignore relative og:image).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
const idx = new URL('../dist/index.html', import.meta.url);
const repo = process.env.GITHUB_REPOSITORY; // owner/name
const site = (process.env.VITE_SITE_URL || (repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/` : '')).replace(/\/?$/, '/');
if (process.env.VITE_SITE_URL || repo) {
  const html = readFileSync(idx, 'utf8').replace(/(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(")/g, `$1${site}og.png$2`);
  writeFileSync(idx, html);
  console.log(`share image -> ${site}og.png`);
} else console.log('no VITE_SITE_URL / GITHUB_REPOSITORY: og:image stays relative');
copyFileSync(idx, new URL('../dist/404.html', import.meta.url));
console.log('dist/404.html written');
