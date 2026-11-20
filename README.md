# ZI CAB

Taxi platform plus the ZI CAB marketing site, in one repo.

```
Backend/                    Express + MongoDB + Socket.IO API (also serves the CMS settings)
frontend/                   React 19 + Vite + Tailwind 4 single-page app
  src/modules/landing/      the ZI CAB marketing site
  src/modules/{user,driver,admin,shared}/   the taxi product
```

## Running it

Mongo first — anything reachable works, this is just the quickest:

```bash
docker run -d --name zicab-mongo -p 27017:27017 mongo:7
```

Backend:

```bash
cp Backend/.env.example Backend/.env
```

```bash
npm install --prefix Backend && npm run dev --prefix Backend
```

Only `MONGODB_URI` and `JWT_SECRET` are required to boot. The rest degrade
gracefully: Redis falls back to in-memory rate limiting, and unconfigured
integrations (Cloudinary, Firebase, Razorpay, PhonePe, SMTP) stay off.

Keep `PORT=5000` — the frontend defaults its API base to
`http://localhost:5000/api/v1`, overridable with `VITE_API_BASE_URL`.

After any deploy that changes a schema index, build the indexes:

```bash
node scripts/ensureIndexes.js
```

`config/database.js` connects with `autoIndex: false` in production, so Mongoose
never creates indexes there. Nothing else in the repo did it either, which left
every declared index missing — dispatch failed with "unable to find index for
$geoNear query". The script uses `createIndexes()` (adds what is missing) rather
than `syncIndexes()` (drops anything not in the schema).

Frontend:

```bash
cp frontend/.env.production.example frontend/.env.production
```

```bash
npm install --prefix frontend && npm run dev --prefix frontend
```

Vite compiles every `VITE_*` value into the browser bundle, so only public values
belong in that file. Web push needs all seven `VITE_FIREBASE_*` vars set at
**build** time — miss any one and `registerBrowserFcmToken()` returns
`firebase-web-config-missing` and push silently does nothing. `VITE_FIREBASE_VAPID_KEY`
is the *public* half of the Web Push key pair; the private half is server-side only
and the client SDK never needs it.

`VITE_GOOGLE_MAPS_API_KEY` drives the admin panel maps. Beyond setting it, the
Google Cloud project needs **billing enabled** and the **Maps JavaScript API**
turned on — without billing the map still renders but greyed out, stamped "For
development purposes only", with a "This page can't load Google Maps correctly"
dialog. Restrict the key by HTTP referrer, since it ships in the bundle.

It runs standalone too. Without the backend the CMS-driven values (app name,
logo, favicon) fall back to their defaults.

## Branding

Lives in the CMS, under `taxiadminbusinesssettings.general`. `app_name` drives
the document title.

`logo` and `favicon` there are resolved against the **backend** origin, because
the CMS serves uploaded assets — pointing them at a frontend-bundled path such as
`/zicab-logo.jpg` produces a 404. Leave them empty to use the static favicon in
`frontend/index.html`, or upload through the CMS.

## Routes

| Path | Owner |
|---|---|
| `/`, `/services`, `/franchise`, `/drive-with-us`, `/about`, `/contact` | MIKROMEK public site (`frontend/src/modules/landing`) |
| `/partner`, `/corporate`, `/advertise`, `/zi-bus` | redirect to the closest page above |
| `/faq`, `/support`, `/blog`, `/careers`, `/links`, `/terms`, `/privacy` | static pages |
| `/login`, `/signup`, `/ride/*`, `/cab/*`, `/bus/*`, `/parcel/*`, `/rental/*` | customer app |
| `/taxi/driver/*`, `/taxi/owner/*`, `/admin/*` | driver, owner and admin apps |

Public site routes live in `frontend/src/modules/landing/landingTabs.js`; the router builds from it.

## The public site

**Brand** comes from the MIKROMEK logo: signal red `#e1251b`, ink and steel grey, Barlow Condensed
capitals, the lightning bolt and the red return arrow (`components/BrandArt.jsx`).

**Its CSS is scoped.** `site.css` is nested under `.mk-site`, applied by `LandingShell`, so it can never
restyle the Tailwind apps or the admin panel. Base element rules use `:where()` so component classes always win.

**Copy** is in `siteContent.js` (services, FAQ, nav). **Contact details and the logo** come from
Admin → Website Content / General Settings; a blank field is simply not shown.

**Entrance motion never hides content**: `.mk-rise` only slides, it never fades in from invisible,
because a throttled background tab can freeze an animation on its first frame.

**Forms**: Contact and Drive post to `/users/enquiry` (Admin → Website Enquiries); Franchise posts to
`/franchise/apply`, which creates a pending franchise for approval in Admin → Franchises.

## Client-supplied values still outstanding

`frontend/src/modules/landing/siteConfig.js` — official email, WhatsApp number
and toll-free number.

Photos: `frontend/public/drivers/` and `frontend/public/founders/` (see the
README in each). `frontend/public/vehicles/` currently holds Creative Commons
photos that require attribution (`ATTRIBUTION.md`) until they are replaced with
ZI CAB's own fleet shots.
