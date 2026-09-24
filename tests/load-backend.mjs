/* The backend under test, loaded straight from src/ — never a copy.
   `teamhub.web.js` imports three Wix modules that only exist inside Wix, so the
   three import lines are rewritten to point at the stand-in and the result is
   imported from a temp file. Nothing is written into src/, and there is no
   second copy of the code to drift out of date. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.join(here, '..', 'src');

/* `backend/sportsnow.js` is a Wix specifier Node cannot resolve, and the file
   imports Wix modules of its own — so it gets the same treatment as the web
   module: rewritten once into a temp file the web module can import. */
function snMod() {
  const mocks = pathToFileURL(path.join(here, 'wix-mocks.mjs')).href;
  const code = fs.readFileSync(path.join(SRC, 'backend', 'sportsnow.js'), 'utf8')
    .replace(/^import wixData from 'wix-data';$/m, `import wixData from '${mocks}';`)
    .replace(/^import \{ fetch \} from 'wix-fetch';$/m, `import { fetch } from '${mocks}';`);
  if (/from '(wix-|@wix\/|backend\/)/.test(code)) {
    throw new Error('sportsnow.js imports something this harness does not stub');
  }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'teamhub-sn-')), 'sportsnow.mjs');
  fs.writeFileSync(tmp, code);
  return pathToFileURL(tmp).href;
}

export async function loadBackend() {
  const file = path.join(SRC, 'backend', 'teamhub.web.js');
  const mocks = pathToFileURL(path.join(here, 'wix-mocks.mjs')).href;
  const code = fs.readFileSync(file, 'utf8')
    .replace(/^import \{ Permissions, webMethod \} from 'wix-web-module';$/m,
      `import { Permissions, webMethod } from '${mocks}';`)
    .replace(/^import \{ currentMember, authentication \} from 'wix-members-backend';$/m,
      `import { currentMember, authentication } from '${mocks}';`)
    .replace(/^import wixData from 'wix-data';$/m,
      `import wixData from '${mocks}';`)
    /* Whatever the web module happens to pull out of sportsnow.js — the list
       changes as the SportsNow side grows, and the harness should not have to
       be edited every time it does. */
    .replace(/^import (\{[^}]*\})\s*\n?\s*from 'backend\/sportsnow\.js';$/m,
      (_m, names) => `import ${names} from '${snMod()}';`);

  if (/from '(wix-|@wix\/|backend\/)/.test(code)) {
    throw new Error('teamhub.web.js imports a Wix module this harness does not stub — ' +
      'add it to wix-mocks.mjs and to the rewrites above.');
  }

  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'teamhub-')), 'backend.mjs');
  fs.writeFileSync(tmp, code);
  return import(pathToFileURL(tmp).href);
}

export const ELEMENT = path.join(SRC, 'public', 'custom-elements', 'blg-teamhub-month.js');

/* Playwright needs to be told where Chromium is on some machines. */
export function browserOpts() {
  const p = process.env.CHROMIUM_PATH;
  return p ? { executablePath: p, args: ['--no-sandbox'] } : {};
}
