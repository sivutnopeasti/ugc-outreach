# UGC Suomi Outreach

Mailchimp-tyylinen nettisovellus: lataa yritysten CSV, arvioi Instagram ja lähetä kutsu heikoille tileille.

Viesti ohjaa lomakkeelle: https://ugcsuomi.fi/ilmoita-kampanjasta-sisallontuottajille/

## Käyttö selaimessa

1. Avaa sovellus
2. Luo salasana + lähettäjän tiedot
3. **Asetukset** → Gmail-sovellussalasana
4. **Kampanjat** → lataa CSV → Analysoi → Esikatselu → Lähetä valitut

CSV:

```csv
nimi;y_tunnus;verkkosivu
Esimerkki Oy;1234567-8;https://esimerkki.fi
```

## Paikallinen ajo

```bash
npm install
npm run dev
```

Avaa http://localhost:3100

## Deploy Verceliin (maalaussovellus-repo)

Sovellus elää kansiossa `outreach/` haarassa `cursor/ugc-email-outreach-900b`.

1. [vercel.com](https://vercel.com) → **Add New Project** → valitse `sivutnopeasti/maalaussovellus`
2. **Root Directory** → `outreach` (Important: muuten Vercel yrittää rakentaa maalaussovelluksen)
3. Production Branch (tai Preview): `cursor/ugc-email-outreach-900b` — tai mergeaa `master`iin ja deployaa sieltä
4. Lisää **Upstash Redis** (Vercel Marketplace, ilmainen) → Environment Variables:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. Deploy

Ilman Redistä Vercelissä data ei säily funktioiden välillä. Paikallisesti käytetään `data/`-kansiota.

### Gmail Vercelissä

Asetukset-sivulla (deployauksen jälkeen):

- Palvelu: Gmail
- SMTP-käyttäjä: oma Gmail
- SMTP-salasana: [sovellussalasana](https://myaccount.google.com/apppasswords)
- Lähettäjän postiosoite (pakollinen markkinointiviestiin)

## Kulut

| Osa | Hinta |
|---|---|
| Vercel Hobby | 0 € |
| Upstash Redis | 0 € (ilmaisraja) |
| Gmail-lähetys | 0 € |
| PRH + Instagram | 0 € |
| Tekoäly | vain jos lisäät API-avaimen |

## Komennot

```bash
npm run dev
npm run build
npm start
npm test
```
