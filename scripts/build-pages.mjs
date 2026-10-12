import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const output = resolve('pages-dist');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'assets'), { recursive: true });
const html = (await readFile('website/index.html', 'utf8'))
  .replace(/\/releases\/tag\/v\d+\.\d+\.\d+/g, `/releases/tag/v${version}`)
  .replace(/(<span data-version>)[^<]+/, `$1${version}`)
  .replace(/\d+\.\d+\.\d+ explains/g, `${version} explains`);
await writeFile(join(output, 'index.html'), html);
for (const file of ['style.css', 'language.js', 'content.js']) await copyFile(`website/${file}`, join(output, file));
for (const file of ['gptworkbot-hero.png', 'gptworkbot-sidepanel-en-400.png', 'gptworkbot-sidepanel-zh-400.png', 'gptworkbot-dependencies-en-400.png', 'gptworkbot-dependencies-zh-400.png']) await copyFile(`assets/${file}`, join(output, 'assets', file));
for (const locale of ['en', 'zh']) {
  const file = `gptworkbot-plan-recovery-${locale}-400.jpg`;
  await copyFile(`docs/evidence/${file}`, join(output, 'assets', file));
}
await copyFile('website/hero-en.svg', join(output, 'assets/gptworkbot-hero-en.svg'));
await writeFile(join(output, '.nojekyll'), '');
console.log(`Built GitHub Pages ${version}: ${output}`);
