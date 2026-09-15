# Desktop layout and rental publication

Housing navigation omits the two legacy entry points; their URLs still work. Apartment detail adds `tab=rent` with `rentType`, `rentPeriod`, `rentArea` query parameters. Grouped areas use `group:85`; table areas remain exact. Rent filters do not change the identity used for favorites, comments, or calculators.

`css/responsive.css` applies the 1600px desktop container, 32px gutters, 1200px desktop and 768px mobile boundaries. Shared shell rearranges existing calculator and account nodes while retaining IDs and event handlers.

## Rebuild

The data owner in 15_26 exports existing SQLite contract partitions read-only with housing_contracts.export. Then run `node tools/build-apartment-rent.mjs`. The producer release flow runs this after canonical apartment generation. The Cloudflare asset build verifies all partitions, row counts and deterministic generated output before deployment. No database schema change is required.

Only canonical lookup IDs are joined. Unmatched records remain available through the legacy contract browser; names are never used as a fallback join. Missing collection, missing identity, empty results and fetch failures remain distinct. New data lives in data/contracts/ and data/apartment-rent/.

## Verification

Node tests cover source identity isolation, precise area preservation, changed/missing partitions and year boundaries. Existing API and calculator tests cover private ownership, hearts, analytics and saved results. Browser checks exercise 390/768/1024/1440/1920 widths in light/dark mode, and the local ephemeral account exercises calculation saves and own activity. Public production tests must stay read-only.
