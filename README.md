# Movie Manager (Angular + Supabase)

PHP-sovelluksen korvaava frontti. Käyttää Supabase Postgres -kantaa ja Supabase Authia.

## Käynnistys

1. Aseta **anon public** -avain: `src/environments/environment*.ts`
2. Linkitä Auth-käyttäjät (`supabase/002_link_auth_users.sql`)
3. `npm start` → http://localhost:4200

## Valmiit toiminnot

| Toiminto | Reitti / paikka |
|----------|-----------------|
| Kirjautuminen | `/login` |
| Haku (elokuva/henkilö) | `/` |
| Suodattimet: genre, maa, ääni | `/` |
| Listat: uusimmat, parhaat, arvostellut, omistetut, katsottavat | `/` |
| Elokuvan tiedot (aka, kuvaus, roolit, palkinnot, linkit, trivia) | `/movie/:id` |
| Oma arvio / tagi / kommentti | elokuvasivu |
| Henkilön tiedot (suhteet, palkinnot, palkkiot, filmografia) | `/person/:id` |
| Uusi / muokkaa / poista elokuva | superuser |
| Uusi / muokkaa / poista henkilö | superuser |

## Vielä PHP:stä puuttuvaa (seuraava kierros)

- Roolien / genrejen / aka-nimien / elokuvalinkkien muokkaus UI:ssa
- Henkilölinkkien ja palkkioiden muokkaus
- IMDb-tuonti
- Rekisteröityminen / salasanan vaihto (Supabase Auth UI)

## Hostaus

`npm run build` → julkaise `dist/angular/browser` (Vercel / Netlify / Cloudflare Pages).
