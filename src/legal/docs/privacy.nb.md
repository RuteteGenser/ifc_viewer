# Personvernerklæring for {{facts.product}}

> **UTKAST / DRAFT: ikke juridisk vurdert.** Denne teksten er et utkast og skal gjennomgås av en norsk advokat før lansering. Verdier i [HAKEPARENTES] er ikke fylt inn ennå.

Versjon 2026-10-19.

Her forklarer vi hvilke personopplysninger vi behandler når du bruker {{facts.product}}, hvorfor, og hvilke rettigheter du har etter personvernforordningen (GDPR) og personopplysningsloven.

## 1. Behandlingsansvarlig

{{seller.name}}, org.nr. {{seller.orgNr}}, {{seller.address}}, er behandlingsansvarlig. Spørsmål om personvern sender du til {{seller.email}}.

## 2. Det viktigste kort fortalt

- IFC-filer du åpner, blir på enheten din. De sendes ikke til oss, med mindre du selv lagrer dem i "Mine modeller".
- Saker og merknader (Cases) lagres bare på enheten din.
- Vi bruker bare nødvendige informasjonskapsler. Ingen analyse, ingen reklame, ingen sporing på tvers av nettsteder.
- Vi selger aldri opplysninger om deg.

## 3. Hvilke opplysninger vi behandler, hvorfor og med hvilket grunnlag

| Opplysninger | Formål | Rettslig grunnlag |
| --- | --- | --- |
| E-post, passord (lagret som sikker hash), språk, tidspunkt for opprettelse og innlogging | Opprette og drive kontoen din, logge deg inn, sende lenker for innlogging og nytt passord | Avtale (GDPR art. 6 nr. 1 b) |
| Enhets-ID i informasjonskapsel, prøveperiode, tilgangskoder du har brukt | Gi deg gratis prøve og tilgang uten konto, hindre misbruk av prøver | Avtale (art. 6 nr. 1 b) og berettiget interesse i å hindre misbruk (art. 6 nr. 1 f) |
| Modeller du lagrer i "Mine modeller" (filer, filnavn, mapper, størrelse) | Lagre og vise modellene dine på tvers av enheter | Avtale (art. 6 nr. 1 b) |
| Abonnement, plan, betalingsstatus, kvitteringer, beløp og mva. Fra Vipps og Stripe: en referanse til kunden og betalingen, betalingsmåte (for eksempel korttype og siste fire siffer) | Ta betalt, fornye, sende kvittering, håndtere feilet betaling og refusjon | Avtale (art. 6 nr. 1 b) og rettslig forpliktelse etter bokføringsloven (art. 6 nr. 1 c) |
| Hvilken versjon av vilkårene du har godtatt, når, og samtykket til levering i angrefristen | Dokumentere avtalen og angrerettsvalget | Rettslig forpliktelse og berettiget interesse i å kunne dokumentere avtalen (art. 6 nr. 1 c og f) |
| IP-adresse (lagres hos oss bare som en nøkkelbasert hash), nettlesertype i kort form, tekniske logger | Sikkerhet, hindre misbruk og angrep, feilsøking | Berettiget interesse i en sikker og stabil tjeneste (art. 6 nr. 1 f) |
| E-poster vi sender deg (adresse, emne, tidspunkt, om den ble levert) | Sende nødvendige e-poster om konto, betaling og endringer | Avtale (art. 6 nr. 1 b) |
| Henvendelser til oss | Svare deg | Avtale eller berettiget interesse (art. 6 nr. 1 b eller f) |

Vi sender ikke markedsføring uten at du har samtykket til det.

Bygningsmodeller kan inneholde personopplysninger, for eksempel navn på personer i prosjektet. For bedriftskunder er det kunden som er behandlingsansvarlig for slike opplysninger i modellene, og vi er databehandler. Se [databehandleravtalen](doc:dpa).

## 4. Hvor lenge vi lagrer opplysningene

- **Konto:** til du sletter den. Sletter du kontoen, slettes kontoen og modellene dine med en gang fra systemet vårt. Sikkerhetskopier overskrives innen [ANTALL DAGER FOR BACKUP].
- **Prøve uten konto:** slettes etter {{facts.anonInactiveDays}} dager uten bruk hvis du ikke har lagret modeller.
- **Lagrede modeller etter at tilgangen er slutt:** du kan laste dem ned i leseperioden og i {{facts.retentionDays}} dager etterpå. Så slettes de. Vi varsler deg minst {{facts.purgeNoticeDays}} dager før.
- **Betaling og kvitteringer:** så lenge bokføringsloven krever, normalt 5 år etter utgangen av regnskapsåret.
- **Tekniske data fra betalingsleverandørene (webhooks):** innholdet fjernes etter {{facts.paymentPayloadDays}} dager. Bare ID og type beholdes.
- **Godkjenning av vilkår:** så lenge kontoen finnes, og deretter så lenge vi trenger det for å dokumentere avtalen.
- **Webserverlogger:** {{seller.logDays}} dager.

## 5. Hvem vi deler opplysninger med

Vi bruker disse leverandørene. De som er databehandlere, behandler opplysningene bare etter våre instrukser og har avtale med oss etter GDPR art. 28.

| Leverandør | Hva de gjør | Rolle | Hvor |
| --- | --- | --- | --- |
| {{seller.hostingProvider}} | Servere (drift og lagring) | Databehandler | {{seller.hostingLocation}} |
| Stripe Payments Europe, Ltd. | Kortbetaling | Databehandler for betalingen, og selvstendig behandlingsansvarlig for egne lovpålagte formål (for eksempel hvitvaskingsregler) | Irland, med mulig overføring til USA |
| Vipps MobilePay AS | Betaling med Vipps MobilePay | Selvstendig behandlingsansvarlig for Vipps-brukerforholdet, databehandler for betalingen | Norge og EØS |
| {{seller.emailProvider}} | Sende e-post (kvitteringer, innloggingslenker, varsler) | Databehandler | [LAND] |

Vi gir også ut opplysninger hvis loven pålegger oss det, for eksempel etter pålegg fra politiet eller domstolene.

## 6. Overføring ut av EØS

Vi prøver å holde opplysningene i EØS. Hvis en leverandør overfører opplysninger til et land utenfor EØS (for eksempel Stripe til USA), skjer det bare med gyldig grunnlag etter GDPR kapittel V: EU-kommisjonens beslutning om tilstrekkelig beskyttelse (for USA: EU-U.S. Data Privacy Framework for sertifiserte selskaper) eller EU-kommisjonens standard personvernbestemmelser (SCC) med nødvendige tilleggstiltak. Du kan be oss om en kopi av grunnlaget.

## 7. Informasjonskapsler (cookies)

Vi bruker bare informasjonskapsler som er strengt nødvendige for at tjenesten skal virke. Slike trenger ikke samtykke etter ekomloven. Vi bruker ikke analyse- eller markedsføringskapsler. Se [oversikten over informasjonskapsler](doc:cookies).

| Navn | Formål | Varighet |
| --- | --- | --- |
| `argus_dev` | Kjenner igjen enheten din, så prøveperioden og modeller lagret uten konto følger enheten | {{facts.deviceCookieDays}} dager |
| `argus_sid` | Holder deg innlogget | {{facts.sessionCookieDays}} dager, eller til du logger ut |

Appen lagrer også data lokalt i nettleseren (for eksempel saker, merknader og innstillinger, og en hurtigbuffer så appen virker uten nett). Det blir på enheten din og sendes ikke til oss.

## 8. Sikkerhet

- All trafikk går kryptert over HTTPS.
- Passord lagres bare som en sikker hash. Vi kan ikke se passordet ditt.
- IP-adresser lagres hos oss bare som en nøkkelbasert hash.
- Informasjonskapslene er merket HttpOnly, Secure og SameSite.
- Tilgang til servere og data er begrenset til de som trenger det.
- Vi tar sikkerhetskopier og oppdaterer systemene.
- Kortdata håndteres bare av Stripe, og Vipps-data av Vipps MobilePay.

Ved et sikkerhetsbrudd som kan gi høy risiko for deg, sier vi fra uten ugrunnet opphold, og vi melder fra til Datatilsynet når loven krever det.

## 9. Dine rettigheter

Du har rett til å:

- **få innsyn** i opplysningene vi har om deg,
- **få rettet** feil opplysninger,
- **få slettet** opplysninger (du kan selv slette kontoen under Konto),
- **få dataportabilitet**, det vil si få opplysningene dine i et maskinlesbart format (under Konto finner du "Last ned kontodataene mine" og "Last ned alle modellene mine"),
- **protestere** mot behandling som bygger på berettiget interesse,
- **be om begrensning** av behandlingen.

Send e-post til {{seller.email}}. Vi svarer innen 30 dager. Vi kan be deg bekrefte hvem du er.

Du kan klage til Datatilsynet hvis du mener vi behandler opplysninger i strid med reglene: [datatilsynet.no](https://www.datatilsynet.no), Postboks 458 Sentrum, 0105 Oslo.

## 10. Barn

Du må være minst 13 år for å bruke {{facts.product}}. Du må være minst 18 år for å kjøpe et abonnement. Vi ber ikke bevisst om opplysninger om barn under 13 år. Får vi vite at vi har slike opplysninger, sletter vi dem.

## 11. Endringer

Vi oppdaterer erklæringen når vi endrer hvordan vi behandler opplysninger. Ved vesentlige endringer sier vi fra i appen eller på e-post før endringen gjelder.

## 12. Kontakt

- {{seller.name}}, org.nr. {{seller.orgNr}}
- Adresse: {{seller.address}}
- E-post: {{seller.email}}
