// Downloads the free DB-IP "IP to City Lite" GeoIP file to server/geo/dbip-city.mmdb (or the path given).
// Run at Docker build time, so every deploy gets the current month's file. Never fails the build: if the download
// does not work, it says so and the site runs with empty locations.
//   node server/geo-fetch.js [output-file]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'geo', 'dbip-city.mmdb'));
const month = (back) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 7); };

try {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let done = false;
  // A new month's file appears a little after the month starts: fall back to last month's.
  for (const m of [month(0), month(1)]) {
    const url = `https://download.db-ip.com/free/dbip-city-lite-${m}.mmdb.gz`;
    try {
      const res = await fetch(url);
      if (!res.ok) { console.log(`GeoIP: ${url} -> HTTP ${res.status}`); continue; }
      const data = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
      fs.writeFileSync(out, data);
      console.log(`GeoIP: saved ${m} (${(data.length / 1e6).toFixed(0)} MB) to ${out}`);
      done = true;
      break;
    } catch (e) { console.log(`GeoIP: ${url} failed: ${e.message}`); }
  }
  if (!done) console.log('GeoIP: no file downloaded. The site still runs; visitor locations will be empty.');
} catch (e) {
  console.log(`GeoIP: ${e.message}. The site still runs; visitor locations will be empty.`);
}
