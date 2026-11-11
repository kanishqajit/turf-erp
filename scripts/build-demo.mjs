/* The phone app with nothing behind it.

   Two shapes come out of here, because they are read in two different places.

   demo.html — for the site. The deployment sends
   `Content-Security-Policy: script-src 'self'`, so an inline <script> is
   refused and the page comes up blank. This one is a shell that loads the
   site's own /mobile.css and /mobile.js, with /demo.backend.js in front of
   them. That constraint turns out to be the better design: the demonstration
   loads the identical files the real console loads, so it cannot quietly
   drift into being a replica of the app instead of the app.

   demo-standalone.html — everything inlined, for opening from a file or
   sending to somebody. No CSP applies to file://, and nothing is fetched.

   demo/artifact.html — the inlined build without a document shell, for a host
   that supplies its own <head>.

   In all three, demo/backend.js replaces fetch with an in-memory ledger, so
   no request ever leaves the page after the fonts load.

     node scripts/build-demo.mjs */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(join(root, name), 'utf8');

const [css, js, backend] = await Promise.all([
  read('mobile.css'), read('mobile.js'), read('demo/backend.js'),
]);

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1B1B1B">
<title>Futly Console — demonstration</title>

<!-- Its own manifest id, so Android installs this beside the real console
     rather than over it. -->
<link rel="manifest" href="/demo.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Futly Demo">
<meta name="mobile-web-app-capable" content="yes">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700&display=swap">`;

const SHELL = `<div class="m-phone">
  <div class="m-app">
    <header id="mHeader"></header>
    <div id="mBody"></div>
    <div id="mDock"></div>
  </div>
  <div id="mSheet"></div>
</div>`;

/* ── for the site ─────────────────────────────────────── */
const hosted = `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<link rel="stylesheet" href="/mobile.css">
</head>
<body>

${SHELL}

<!-- The backend goes first: it replaces fetch before the app can call it. -->
<script src="/demo.backend.js"></script>
<script src="/mobile.js"></script>

</body>
</html>
`;
await writeFile(join(root, 'demo.html'), hosted);
await writeFile(join(root, 'demo.backend.js'), backend);

/* ── for a file, or for sending ───────────────────────── */
const standalone = `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<style>
${css}
</style>
</head>
<body>

${SHELL}

<script>
${backend}
</script>

<script>
${js}
</script>

</body>
</html>
`;
await writeFile(join(root, 'demo-standalone.html'), standalone);

/* ── for an artifact ──────────────────────────────────── */
const fragment = `<title>Futly Console — demonstration</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700&display=swap">

<style>
${css}
html,body{height:100%;background:#1B1B1B}
</style>

${SHELL}

<script>
${backend}
</script>

<script>
${js}
</script>
`;
await writeFile(join(root, 'demo', 'artifact.html'), fragment);

const kb = n => (n / 1024).toFixed(1) + 'KB';
console.log(`\n  demo.html              ${kb(hosted.length)}  shell — loads /mobile.css and /mobile.js from the site`);
console.log(`  demo.backend.js        ${kb(backend.length)}  the in-memory ledger, served alongside`);
console.log(`  demo-standalone.html   ${kb(standalone.length)}  everything inlined, for a file`);
console.log(`  demo/artifact.html     ${kb(fragment.length)}  inlined, no document shell`);
console.log('  No request leaves the page after the fonts load.\n');
