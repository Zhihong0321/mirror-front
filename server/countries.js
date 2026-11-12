// The countries we have researched prompts for: each has its own catalog of registers, directories and local-search
// prompts for five industries in the report factory (company-diver: agy-lab/src/v21/catalog.ts COUNTRY_MAP and
// catalog-data/<CC>-<industry>/). `layer: true` = also has a country layer (rules that apply to any industry there).
// Add a country here when the factory gets a catalog for it. Any other country is still accepted: it is researched
// with the general checklist (no country-specific registers).
// The homepage reads this list from GET /api/countries (site/index.html keeps the same four as its fallback).

export const RESEARCHED_COUNTRIES = [
  { name: 'Malaysia', code: 'MY', layer: true },
  { name: 'Singapore', code: 'SG', layer: false },
  { name: 'Australia', code: 'AU', layer: false },
  { name: 'South Korea', code: 'KR', layer: true },
];

export const isResearched = (name) => RESEARCHED_COUNTRIES.some((c) => c.name.toLowerCase() === String(name ?? '').trim().toLowerCase());
