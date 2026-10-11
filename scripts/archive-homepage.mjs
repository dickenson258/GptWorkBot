import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

const date = process.argv[2];
const source = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !source) throw new Error('Usage: node scripts/archive-homepage.mjs YYYY-MM-DD source-homepage.zip');
const { version } = JSON.parse(await readFile('package.json','utf8'));
const directory = `docs/archive/${date}-homepage-v${version}`;
const repository = 'https://github.com/dickenson258/GptWorkBot';
// A snapshot is immutable. Use a new date/version rather than overwrite one.
await mkdir(directory);
await mkdir(join(directory,'assets'));
const files = ['README.md','README.en.md','PUBLISHING.md'];
for (const file of files) {
  let text = await readFile(file,'utf8');
  text = text.replace(/\]\((docs\/[^)]+|PUBLISHING\.md)\)/g, (_,path) => `](${repository}/blob/main/${path})`);
  await writeFile(join(directory,file),text);
}
for (const file of (await readdir('assets')).filter(name=>name.endsWith('.png')).sort()) {
  const path = `assets/${file}`;
  await copyFile(path,join(directory,path));files.push(path);
}
const sha256 = data => createHash('sha256').update(data).digest('hex');
const manifest = {
  product:'GptWorkBot',version,date,repository,protocolVersion:2,storageKey:'gptworkbot-state-v2',
  source:{name:basename(source),sha256:sha256(await readFile(source))},
  reviewed:true,containsRealConversations:false,
  files:await Promise.all(files.sort().map(async path=>({path,sha256:sha256(await readFile(join(directory,path)))})))
};
await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');files.push('manifest.json');
await writeFile(join(directory,'SHA256SUMS'),(await Promise.all(files.sort().map(async path=>`${sha256(await readFile(join(directory,path)))}  ${path}`))).join('\n')+'\n');
await mkdir('release',{recursive:true});
const output=resolve(`release/gptworkbot-homepage-v${version}-${date}.zip`);
const temporary=output.replace(/\.zip$/,'.tmp.zip');
execFileSync('/usr/bin/zip',['-qr',temporary,'.'],{cwd:directory});
await rename(temporary,output);
console.log(`Archived reviewed homepage: ${directory}; ${files.length+1} files; ${output}`);
