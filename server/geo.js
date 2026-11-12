// IP -> location, from a local GeoIP file (DB-IP "IP to City Lite", free, CC BY 4.0, https://db-ip.com).
// No outside calls: the file is downloaded at build time (geo-fetch.js) and read into memory once.
// No file, or a bad one: the site runs as before and every location is just empty.

import fs from 'node:fs';
import { Reader } from 'maxmind';

export function createGeo(file, log = console.log) {
  let reader = null;
  try {
    if (file && fs.existsSync(file)) reader = new Reader(fs.readFileSync(file));
    else log(`GeoIP file not found (${file || 'no path'}): visitor locations will be empty. Run: node server/geo-fetch.js`);
  } catch (e) {
    log(`GeoIP file could not be read (${file}): ${e.message}. Visitor locations will be empty.`);
  }
  return {
    configured: Boolean(reader),
    // Never throws. Unknown or private address: {}.
    lookup(ip) {
      if (!reader || !ip) return {};
      try {
        const r = reader.get(ip);
        if (!r) return {};
        return {
          country: r.country?.names?.en ?? null,
          countryCode: r.country?.iso_code ?? null,
          region: r.subdivisions?.[0]?.names?.en ?? null,
          city: r.city?.names?.en ?? null,
          lat: Number.isFinite(r.location?.latitude) ? r.location.latitude : null,
          lon: Number.isFinite(r.location?.longitude) ? r.location.longitude : null,
        };
      } catch { return {}; }
    },
  };
}
