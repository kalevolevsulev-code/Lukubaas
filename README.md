# ABUS SFA 777 — V1.0.4 Security Fix Stable

Staatiline sarjastamise generaator. Baseline on taastatud kasutaja antud V1.0.4 Security Fix RC1 Netlify juurutusest:

https://6abd37260522f0d8f60fc1eb--sarjastuskoodidemov2.netlify.app/

## Päritolu ja muudatused

- Algallikas: juurutuse index.html, app.js ja style.css (2026-11-09).
- RC1 generaatoriloogika on säilitatud. Muudetud on ainult HTML-i pealkirja ning JavaScripti versioonikommentaari ja valmisolekuteadet.
- style.css on algallikaga identne.
- Stable tähistab säilitatud RC1 baasversiooni; see ei tähenda uut sõltumatut turvaauditit.
- V1.1 mini-serverit ega serverimuudatusi ei ole lisatud.

## Käivitamine ja Netlify

Kõik failid asuvad juurkaustas. Ava index.html brauseris või avalda kaust staatilise saidina. Netlify publish-kaust on "."; build-käsku pole vaja. Repo ühendamine Netlifyga toimub Netlify seadetes eraldi.

Exceli lugemiseks kasutab rakendus CDN-ist SheetJS xlsx@0.18.5 teeki; selle laadimine vajab internetiühendust. Laadi Excel, genereeri süsteem, kontrolli tulemust ja kinnita projekt printimiseks.

## Kontrollimine

JavaScripti süntaks, HTML-i kohalikud viited ning RC1 ja Stable generaatoriloogika samasus on kontrollitud. Täielik Exceli importimise, genereerimise ja printimise kasutajaliidese läbimäng vajab esinduslikku Exceli sisendfaili.

## V1.0.4 Stable sisaldab

- projektikood
- tellimuse number
- Exceli avamismaatriksi import
- ühtne koguste struktuur B2 = `kogus`
- võtmete koguste import
- südamike koguste import
- reservkogus 0
- puuduva aktiivse koguse valideerimine
- valideerimine ja hoiatused
- võtmete hierarhia kuvamine tegelike avamisõiguste järgi
- subset-põhine hierarhia kontroll
- lubatud tavamuukide valik
- lubatud sarjamuukide valik
- võtmekoodide genereerimine
- südamike pinningu genereerimine
- MACS ja muud kvaliteedireeglid
- ristiavamise kontroll
- `NO_UPCUT_TO_HIGHER_LEVEL` turvareegel
- kogu süsteemi lõplik turvakontroll
- projekti kinnitamine ja lukustamine
- kinnitatud projekti trükk / PDF-i salvestamine brauseri kaudu

## V1.0.4 Stable ei sisalda

- Rekey
- Add Key
- auditlogi
- serveripõhine andmebaas
- JSON projekti import/eksport
- ABUS V14
- Capacity režiim suurtele süsteemidele

## Edasine arendus

### V1.1
- projekti snapshot
- mini-server
- kinnitatud projektide salvestamine
- projektide nimekiri ja avamine
- versioonihaldus

### V1.2
- auditlogi
- JSON import/eksport

### V1.3
- Rekey
- Add Key

### V2
- ABUS V14
- Quality / Balanced / Capacity režiimid
- suurte süsteemide hierarhiline generaator

