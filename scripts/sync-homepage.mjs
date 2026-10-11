import { readFile, writeFile } from 'node:fs/promises';

const start = '<!-- BEGIN ENGLISH HOMEPAGE -->';
const end = '<!-- END ENGLISH HOMEPAGE -->';
const chinese = await readFile('README.md', 'utf8');
const english = await readFile('README.en.md', 'utf8');
// Keep the standalone English README as the source; reuse its body on the main
// homepage so switching languages does not request GitHub's file-preview page.
// Preserve the English banner when copying the body below the English anchor.
const body = english.replace(/^(!\[[^\]]*\]\([^\n]*\))\n\n# GptWorkBot\n\n/, '$1\n\n');
if (body === english) throw new Error('Standalone English homepage header was not found.');
const inline = body
  .replace('[简体中文](https://github.com/dickenson258/GptWorkBot#readme)', '[简体中文](#gptworkbot)')
  .replace('[English section on the repository homepage](https://github.com/dickenson258/GptWorkBot#english)', '[English section on this page](#english)');
const expected = `${chinese.split(start)[0].trimEnd()}\n\n${start}\n\n## English\n\n${inline.trimEnd()}\n\n${end}\n`;
if (process.argv.includes('--check')) {
  if (chinese !== expected) throw new Error('English homepage section is stale. Run npm run docs:sync-homepage.');
  console.log('Bilingual homepage section is synchronized.');
} else {
  await writeFile('README.md', expected);
  console.log('Bilingual homepage section updated.');
}
