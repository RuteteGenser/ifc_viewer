# Databehandleravtale

> **UTKAST / DRAFT: ikke juridisk vurdert.** Mal for bedriftskunder etter personvernforordningen (GDPR) artikkel 28. Skal gjennomgås av en norsk advokat før bruk.

Versjon 2026-10-19.

## 1. Partene

- **Behandlingsansvarlig:** [KUNDENS FIRMANAVN], org.nr. [KUNDENS ORG.NR] ("Kunden").
- **Databehandler:** {{seller.name}}, org.nr. {{seller.orgNr}}, {{seller.address}} ("Leverandøren").

Avtalen er et tillegg til [Brukervilkårene](doc:terms) for {{facts.product}}. Ved motstrid går denne avtalen foran for behandling av personopplysninger.

## 2. Hva behandlingen gjelder

| | |
| --- | --- |
| Formål | Lagre og vise Kundens IFC-modeller i "Mine modeller" og levere tjenesten {{facts.product}} |
| Art | Lagring, sikkerhetskopi, overføring til Kundens brukere, sletting |
| Typer opplysninger | Personopplysninger som Kunden lagrer i modellene, for eksempel navn, roller, e-post og telefonnummer til personer i prosjektet, og eventuelt opplysninger om beboere eller eiere. Kontoopplysninger for Kundens brukere (e-post) |
| Registrerte | Kundens ansatte og brukere, og personer som er nevnt i Kundens modeller |
| Varighet | Så lenge Kunden bruker tjenesten, og til opplysningene er slettet etter punkt 9 |

Kunden skal ikke lagre særlige kategorier av personopplysninger (GDPR art. 9) i modellene uten skriftlig avtale med Leverandøren.

## 3. Instrukser

Leverandøren behandler opplysningene bare etter dokumenterte instrukser fra Kunden. Denne avtalen, Brukervilkårene og Kundens bruk av funksjonene i tjenesten (lagre, flytte, slette, laste ned) er Kundens instrukser. Leverandøren sier fra straks hvis en instruks etter Leverandørens mening er i strid med personvernreglene.

## 4. Taushetsplikt

Alle som behandler opplysningene for Leverandøren, har taushetsplikt. Leverandøren åpner ikke innholdet i modellene, med mindre Kunden ber om hjelp, eller loven krever det.

## 5. Sikkerhet

Leverandøren har tiltak etter GDPR art. 32 som passer risikoen, blant annet kryptert overføring (HTTPS), tilgangsstyring, passord lagret som sikker hash, sikkerhetskopier, oppdatering av systemer og logging av viktige hendelser. Leverandøren vurderer tiltakene jevnlig.

## 6. Underleverandører

Kunden gir generell godkjenning til at Leverandøren bruker underleverandører. Disse brukes i dag:

| Underleverandør | Oppgave | Plassering |
| --- | --- | --- |
| {{seller.hostingProvider}} | Servere og lagring | {{seller.hostingLocation}} |
| {{seller.emailProvider}} | Sende e-post til brukere | [LAND] |

Leverandøren varsler Kunden minst 30 dager før en ny underleverandør tas i bruk. Kunden kan protestere av saklig grunn og si opp tjenesten før endringen gjelder. Leverandøren pålegger underleverandørene de samme pliktene som i denne avtalen, og er ansvarlig for dem.

Betalingsleverandørene (Stripe og Vipps MobilePay) behandler ikke innholdet i modellene og er ikke underleverandører for denne avtalen.

## 7. Overføring ut av EØS

Opplysningene overføres ikke ut av EØS uten gyldig grunnlag etter GDPR kapittel V, for eksempel EU-kommisjonens standard personvernbestemmelser (SCC).

## 8. Bistand og avvik

- Leverandøren hjelper Kunden, så langt det er mulig, med å svare på krav fra de registrerte (innsyn, retting, sletting og lignende), med sikkerhet, konsekvensvurderinger (DPIA) og forhåndsdrøftinger med Datatilsynet.
- Leverandøren varsler Kunden uten ugrunnet opphold, og senest innen {{facts.breachNoticeHours}} timer etter at Leverandøren ble klar over det, om brudd på personopplysningssikkerheten som gjelder Kundens opplysninger. Varselet beskriver det som er kjent om bruddet, følgene og tiltakene.

## 9. Når avtalen slutter

Når Kunden slutter å bruke tjenesten, kan Kunden laste ned modellene sine (se punkt 8 i Brukervilkårene). Deretter sletter Leverandøren opplysningene, også fra sikkerhetskopier innen [ANTALL DAGER FOR BACKUP], med mindre loven krever at de lagres. Leverandøren bekrefter slettingen skriftlig hvis Kunden ber om det.

## 10. Revisjon

Leverandøren gir Kunden den informasjonen som trengs for å vise at avtalen følges. Kunden kan gjennomføre revisjon, selv eller med en uavhengig revisor med taushetsplikt, med rimelig varsel (minst 30 dager) og høyst én gang per år, med mindre et avvik gir grunn til mer. Kunden dekker egne kostnader.

## 11. Lov og verneting

Avtalen følger norsk lov. Verneting er {{seller.venue}}.

## 12. Underskrift

| | Kunden | Leverandøren |
| --- | --- | --- |
| Sted og dato | | |
| Navn | | |
| Underskrift | | |
