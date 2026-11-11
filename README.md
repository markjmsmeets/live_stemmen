# Live stemmen (eigen Sendsteps-alternatief)

Studenten gaan naar je site, voeren een 5-cijferige code in en stemmen op hun telefoon.
Jij ziet de resultaten live op je scherm of op de beamer. Geen accounts, geen dependencies (alleen Node 18+).

## Wat kan het
- **Meerkeuze en quiz**: kies een goed antwoord, dan krijgen studenten punten (500–1000, sneller = meer) en komt er een ranglijst.
- **Schaalvraag 1–5** met eigen labels en gemiddelde.
- **Open vraag / woordenwolk**: max. 3 antwoorden per student, gelijke woorden worden samengevoegd, jij kunt woorden wegklikken.
- Live resultaten aan/uit voor studenten, stemmen sluiten en heropenen, springen naar een andere vraag.
- Beamerscherm (`/screen.html?c=CODE`), resultaten downloaden als CSV, vragen exporteren/importeren als JSON.
- Anoniem bij peilingen; naam verplicht zodra de sessie een quizvraag bevat.

## Lokaal draaien
    node server.js
    # docent:   http://localhost:3000/host
    # studenten: http://localhost:3000/

## Online zetten (nodig zodat studenten erbij kunnen)
Dit is een gewone Node-server, dus hij moet ergens draaien met een openbaar adres.
1. Zet de map in een (privé) GitHub-repo.
2. Maak bij Render, Railway, Fly.io of een andere host een *Web Service* van de repo (Node, startcommando `npm start`, of gebruik de meegeleverde `Dockerfile`).
3. Stel de omgevingsvariabele `HOST_PASSWORD` in, anders kan iedereen met de link een sessie starten.
4. Open `https://jouw-adres/host`, vul het wachtwoord in en start een sessie.

Let op: de server houdt sessies in het geheugen. Bij een herstart zijn lopende sessies weg (gratis hosts slapen vaak na inactiviteit; open de site vlak voor de les). Sessies verlopen na 8 uur. Download de CSV als je de resultaten wilt bewaren. Draai één instantie (geen meerdere servers naast elkaar).

## Privacy
Er worden geen accounts of cookies gebruikt. Namen en antwoorden staan alleen in het geheugen van de server tot de sessie verloopt. Laat studenten bij voorkeur een bijnaam gebruiken. Stem af met de privacy-afspraken van je instelling voordat je het met echte studenten inzet.

## Aanpassen
- Huisstijl: `public/style.css` (kleurvariabelen bovenin). Er staat nog geen logo in; zet dat in de headers van de drie HTML-bestanden.
- Test: `npm start` en daarna `npm test` (simuleert 40 studenten).
