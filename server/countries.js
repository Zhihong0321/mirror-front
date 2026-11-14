// The countries we have researched prompts for. Source: company-diver agy-lab/src/v21/catalog-data/<CC>-country-layer/
// (the country layer: rules that apply to any industry there) and, for the first four, <CC>-<industry>/ (industry prompts
// too). Every country here has a country layer. Add a country here when the factory gets a catalog for it. Any other
// country is still accepted: it is researched with the general checklist (no country-specific registers).
// The homepage reads this list from GET /api/countries (site/index.html keeps the same list as its fallback).

export const RESEARCHED_COUNTRIES = [
  // Countries with industry prompts as well as the country layer.
  { name: 'Malaysia', code: 'MY', layer: true, industries: true },
  { name: 'Singapore', code: 'SG', layer: true, industries: true },
  { name: 'Australia', code: 'AU', layer: true, industries: true },
  { name: 'South Korea', code: 'KR', layer: true, industries: true },
  // Country layer only.
  { name: 'Argentina', code: 'AR', layer: true, industries: false },
  { name: 'Brazil', code: 'BR', layer: true, industries: false },
  { name: 'Canada', code: 'CA', layer: true, industries: false },
  { name: 'France', code: 'FR', layer: true, industries: false },
  { name: 'Germany', code: 'DE', layer: true, industries: false },
  { name: 'India', code: 'IN', layer: true, industries: false },
  { name: 'Indonesia', code: 'ID', layer: true, industries: false },
  { name: 'Ireland', code: 'IE', layer: true, industries: false },
  { name: 'Japan', code: 'JP', layer: true, industries: false },
  { name: 'Netherlands', code: 'NL', layer: true, industries: false },
  { name: 'New Zealand', code: 'NZ', layer: true, industries: false },
  { name: 'Philippines', code: 'PH', layer: true, industries: false },
  { name: 'Russia', code: 'RU', layer: true, industries: false },
  { name: 'Spain', code: 'ES', layer: true, industries: false },
  { name: 'Switzerland', code: 'CH', layer: true, industries: false },
  { name: 'Taiwan', code: 'TW', layer: true, industries: false },
  { name: 'Thailand', code: 'TH', layer: true, industries: false },
  { name: 'United Arab Emirates', code: 'AE', layer: true, industries: false },
  { name: 'United Kingdom', code: 'GB', layer: true, industries: false },
  { name: 'United States', code: 'US', layer: true, industries: false },
  { name: 'Vietnam', code: 'VN', layer: true, industries: false },
];

export const isResearched = (name) => RESEARCHED_COUNTRIES.some((c) => c.name.toLowerCase() === String(name ?? '').trim().toLowerCase());
