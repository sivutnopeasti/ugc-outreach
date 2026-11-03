# UGC Suomi Outreach

Mailchimp-tyylinen nettisovellus: lataa yritysten CSV, arvioi Instagram ja lähetä kutsu heikoille tileille.

Viesti ohjaa lomakkeelle: https://ugcsuomi.fi/ilmoita-kampanjasta-sisallontuottajille/

## Käyttö selaimessa

1. Avaa sovellus
2. Luo salasana + lähettäjän tiedot
3. **Asetukset** → Gmail-sovellussalasana
4. **Kampanjat** → lataa CSV → Analysoi → Esikatselu → Lähetä valitut

### Isot CSV:t (esim. 35 000 riviä)

Koko listaa ei lähetetä Verceliin kerralla (pyyntökoko / Redis / timeout). Selain leikkaa **erän** (oletus 100, max 300 riviä) ja vain se ladataan. Aja seuraava erä siirtämällä “Aloita rivistä”.

### Testitila (oletus päällä)

CSV ja Instagram analysoidaan normaalisti, mutta “Lähetä” lähettää viestit **sinulle** (testiosoite / lähettäjän sähköposti), ei yrityksille. Aiheeseen tulee etuliite `[TEST]` ja viestiin merkintä alkuperäisestä vastaanottajasta. Poista testitila Asetuksista vasta kun olet valmis oikeaan lähetykseen.

Oletusrajat: **max 6 viestiä / päivä** (liukusäädin Asetuksissa) ja **max 2 / domain / päivä**. Päivä vaihtuu Suomen ajassa. Voit lisätä useita lähettäjätilejä (Gmail/Brevo); automaatio kierrättää niitä.

### Instagram-varmistus

Jos tiliä ei löydy verkkosivulta, sovellus kokeilee muutamaa käyttäjänimeä (ja AI-ehdotuksia jos `GROK_TOKEN` on asetettu). Osuma pisteytetään biosta, nimestä ja bio-linkeistä:

- **Vahvistettu** → käytetään automaattisesti
- **Epäselvä** → sinun pitää painaa **Vahvista** tai **Hylkää** kampanjassa (ei lähetystä ennen sitä)

Instagram rate-limitoi Vercelin IP:itä herkästi (`HTTP 429`). Pipeline hidastaa hakuja automaattisesti. Jos rivit jäävät tilaan *“julkisia lukuja ei saatu”*, lisää Asetuksiin Instagram-`sessionid` (tai Vercel-env `IG_SESSIONID`) omasta kirjautuneesta selaimesta.

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

## Deploy Verceliin

Tämä repo on valmis sellaisenaan (Root Directory = `.`, ei alikansiota).

1. [vercel.com](https://vercel.com) → **Add New Project** → `sivutnopeasti/ugc-outreach`
2. Framework: Next.js (automaattinen)
3. Lisää **Upstash Redis** (Vercel Marketplace, ilmainen) → Environment Variables:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Deploy

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
| Tekoäly (Grok) | Vercel Secret `GROK_TOKEN` |

## Komennot

```bash
npm run dev
npm run build
npm start
npm test
```
