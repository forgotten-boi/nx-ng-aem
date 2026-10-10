#!/usr/bin/env node
/** Renders apps/edale-kinder/icons/icon.svg to the PNG sizes the web manifest needs. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir = fileURLToPath(new URL('../apps/edale-kinder/icons/', import.meta.url));
const svg = await readFile(`${dir}icon.svg`, 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `${dir}icon-${size}.png` });
  await page.close();
}
await browser.close();
console.log('Wrote icon-192.png and icon-512.png');
