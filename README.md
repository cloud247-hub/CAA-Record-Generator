## Funksjoner

- Auto-analyse av domene
- Leser eksisterende CAA via Cloudflare DNS-over-HTTPS
- Søker etter u-utløpte sertifikatutstedelser i Certificate Transparency
- Bruker utstederens kjente CAA-identifikator når den er tilgjengelig
- Fallback til crt.sh dersom primær CT-kilde ikke svarer
- Oppdager observerte wildcard-sertifikater
- Genererer `issue` og `issuewild`
- Valgfri `iodef`
- Manuell overstyring før publisering
- Kopiering av enkeltposter og zone file-format
- Lenke tilbake til https://cloud247.no/

## Viktig om automatisk analyse

Certificate Transparency viser sertifikater som er utstedt og ikke utløpt. Det er ikke det samme som å bekrefte hvilket sertifikat en webserver serverer akkurat nå. Bruk auto-forslaget som et utgangspunkt og kontroller kritiske tjenester før CAA strammes inn.

Cert Spotter kan begrense anonyme API-kall. Appen har derfor en reserveforespørsel mot crt.sh. For høy trafikk eller kommersiell produksjonsbruk bør du vurdere en egen backend eller en autentisert sertifikatdatakilde.
