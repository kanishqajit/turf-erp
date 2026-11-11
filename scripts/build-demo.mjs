/* Fold the phone app into one file that needs nothing.

   Output is demo.html: the real mobile.css and the real mobile.js, with
   demo/backend.js wedged in front of them so fetch never leaves the page.
   No server, no certificate, no sign-in, no network after the fonts load.

     node scripts/build-demo.mjs

   Rebuild it whenever mobile.js or mobile.css changes — the demonstration
   should always be the current app, not a fork of it. */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(join(root, name), 'utf8');

const [css, js, backend] = await Promise.all([
  read('mobile.css'), read('mobile.js'), read('demo/backend.js'),
]);

/* The app ends with `render(); boot();`, and boot() asks the API who is signed
   in. The backend below answers that instantly, so nothing else has to change:
   this is the shipped app, not a copy with the awkward parts removed. */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1B1B1B">
<title>Futly Console — demonstration</title>

<!-- Its own manifest id, so Android installs this beside the real console
     rather than replacing it. Served from the site, it installs chrome-less;
     opened from a file it is still a working page, just not installable. -->
<link rel="manifest" href="/demo.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Futly Demo">
<meta name="mobile-web-app-capable" content="yes">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700&display=swap">

<style>
${css}
</style>
</head>
<body>

<div class="m-phone">
  <div class="m-app">
    <header id="mHeader"></header>
    <div id="mBody"></div>
    <div id="mDock"></div>
  </div>
  <div id="mSheet"></div>
</div>

<script>
${backend}
</script>

<script>
${js}
</script>

</body>
</html>
`;

await writeFile(join(root, 'demo.html'), html);

/* The same build without a document shell, for a host that supplies its own
   <head> — an Artifact, or any page embed. Assembled from the same pieces
   rather than unpicked out of the file above, so the two cannot drift. */
const fragment = `<title>Futly Console — demonstration</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700&display=swap">

<style>
${css}
/* The host page paints its own ground behind this one. */
html,body{height:100%;background:#1B1B1B}
</style>

<div class="m-phone">
  <div class="m-app">
    <header id="mHeader"></header>
    <div id="mBody"></div>
    <div id="mDock"></div>
  </div>
  <div id="mSheet"></div>
</div>

<script>
${backend}
</script>

<script>
${js}
</script>
`;
await writeFile(join(root, 'demo', 'artifact.html'), fragment);

const kb = n => (n / 1024).toFixed(1) + 'KB';
console.log(`\n  demo.html           ${kb(html.length)}  (css ${kb(css.length)} · app ${kb(js.length)} · backend ${kb(backend.length)})`);
console.log(`  demo/artifact.html  ${kb(fragment.length)}  same build, no document shell`);
console.log('  Offline after the fonts load. No server, no sign-in, no sync.\n');
