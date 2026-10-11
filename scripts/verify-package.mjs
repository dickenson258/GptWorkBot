import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const readJson = async path => JSON.parse(await readFile(path,'utf8'));
const [pkg,lock,manifest,built] = await Promise.all(['package.json','package-lock.json','manifest.json','dist/manifest.json'].map(readJson));
assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
for (const version of [lock.version,lock.packages[''].version,manifest.version,built.version]) assert.equal(version,pkg.version);
assert.equal(built.manifest_version,3);assert.equal(built.name,'GptWorkBot');
assert.deepEqual(built.host_permissions,['https://chatgpt.com/*']);
const background = await readFile('dist/background.js','utf8');
assert.ok(background.includes('gptworkbot-state-v2'));assert.ok(!background.includes('work-team-state-v1'));
async function filesAt(directory,prefix='') {
  const entries=await readdir(directory,{withFileTypes:true});
  const files=await Promise.all(entries.map(entry=>entry.isDirectory()?filesAt(join(directory,entry.name),prefix+entry.name+'/'):[prefix+entry.name]));
  return files.flat();
}
const files=(await filesAt('dist')).sort();
const archive=resolve(`release/gptworkbot-${pkg.version}.zip`);
execFileSync('/usr/bin/unzip',['-tq',archive]);
const names=execFileSync('/usr/bin/unzip',['-Z1',archive],{encoding:'utf8'}).trim().split('\n').filter(name=>!name.endsWith('/')).sort();
assert.deepEqual(names,files);
for (const name of files) {
  assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
  const archived=execFileSync('/usr/bin/unzip',['-p',archive,name],{maxBuffer:10*1024*1024});
  assert.ok(archived.equals(await readFile(join('dist',name))),`ZIP differs from dist: ${name}`);
}
for (const locale of ['en','zh_CN']) {
  const messages=await readJson(`dist/_locales/${locale}/messages.json`);
  assert.ok(messages.extensionDescription.message);assert.ok(messages.actionTitle.message);
}
console.log(`Verified GptWorkBot ${pkg.version}: ${files.length} files match dist; MV3, locales, v2 storage, and ZIP integrity passed.`);
