# Veranstaltungen
<!--
documentation-metadata
audience: Veranstaltungsteilnehmer; Veranstaltungsorganisatoren
owner: event feature maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Reviewed pilot-language content at its fixed release-owned source; article bodies, declared anchors and image bytes preserved during promotion.
source-anchors: src/controller/eventController.ts; src/views/event/; src/views/modules/module_entity_select.pug
heading-anchors: 1:events-guide; 2:choose-your-task; 2:join-and-register-for-an-event; 3:1-open-the-invitation; 3:2-review-the-event-information; 3:3-complete-register-for-this-event; 3:dietary-information; 2:change-or-cancel-your-registration; 3:what-the-binding-deadline-changes; 2:what-appears-after-registration; 2:create-an-event; 3:creation-fields; 3:deadline-and-dietary-switches; 2:review-permissions-before-sharing; 2:share-the-event; 2:change-event-properties; 2:open-the-administration-dashboard; 2:manage-registrations; 3:view-and-filter-participants; 3:adjust-or-remove-a-registration; 2:create-a-late-registration-link; 2:link-plans-and-lists-to-the-event; 3:choose-an-event; 2:export-the-participant-list; 2:header-image-duplication-and-deletion; 2:archive-or-restore-the-event; 2:troubleshooting; 3:i-cannot-see-the-registration-form; 3:i-cannot-update-or-cancel-after-the-deadline; 3:a-related-plan-or-list-is-missing; 3:i-cannot-open-or-use-the-administration-dashboard; 3:participant-information-is-visible-to-more-people-than-expected
next-review: event-visible-UI-or-behavior-change
production-reference: 2dfa257 native frontend documentation; not an installed production commit
-->

Mit einer Veranstaltung sammelst du Anwesenheitstage, optionale Ernährungsangaben sowie zugehörige Pack-, Aktivitäten- und Fahrtenpläne. Englische Bezeichnungen sind für noch englische Ansichten zur Wiedererkennung angegeben.

## Deine Aufgabe wählen

- [Einer Veranstaltung beitreten und dich anmelden](#join-and-register-for-an-event)
- [Deine Anmeldung ändern oder stornieren](#change-or-cancel-your-registration)
- [Eine Veranstaltung erstellen](#create-an-event)
- [Veranstaltungseigenschaften ändern](#change-event-properties)
- [Anmeldungen verwalten](#manage-registrations)
- [Einen Nachmeldelink erstellen](#create-a-late-registration-link)
- [Kostenpools und gemeinsame Zahlungen verwenden](INVOICE_POOLS.md)
- [Pack-, Aktivitäten- und Fahrtenlisten verknüpfen](#link-plans-and-lists-to-the-event)
- [Die Teilnehmerliste exportieren](#export-the-participant-list)
- [Die Veranstaltung archivieren oder wiederherstellen](#archive-or-restore-the-event)

## Einer Veranstaltung beitreten und dich anmelden

### 1. Die Einladung öffnen

Öffne den Veranstaltungslink des Organisators. Ohne aktives Profil bittet Surveyor dich, ein bestehendes Konto zu verwenden, ein vollständiges Konto anzulegen oder **Continue as guest** zu wählen.

Gib als Gast möglichst eine E-Mail-Adresse an und bewahre den privaten Gastlink auf. Adresse und Link ermöglichen die spätere Rückkehr zur selben Anmeldung. Den vollständigen Gast- und Wiederherstellungsablauf beschreibt [Erste Schritte](GETTING_STARTED.md#join-an-invitation-as-a-guest).

### 2. Die Veranstaltungsinformationen prüfen

Oben auf der Veranstaltungsseite können stehen:

- Datum und Ort;
- **Max. / registered participants**, wenn eine Höchstzahl festgelegt wurde;
- **Binding deadline**, sowohl in der Veranstaltungszeitzone als auch in deiner Zeitzone;
- eine laufende Rückwärtszählung bis zur Frist;
- Beschreibung und Kopfzeilenbild.

Der Eigentümer wird nicht automatisch Teilnehmer. Möchte er teilnehmen, muss er sich gewöhnlich anmelden, damit Anwesenheit, Ernährungsangaben und Kapazitätsplatz berücksichtigt werden.

### 3. **Register for this event** ausfüllen

Trage ein:

1. **Arrival date** — deinen ersten Anwesenheitstag.
2. **Departure date** — deinen letzten Anwesenheitstag.
3. Ernährungsangaben, falls der Organisator sie verlangt.
4. Wähle **Save registration**.

An- und Abreise sind Pflichtfelder. Beide müssen innerhalb des Veranstaltungszeitraums liegen; Anreise darf nicht nach Abreise liegen.

Ist **Max Participants** erreicht, zeigt Surveyor **This event is full.** Neue Anmeldungen sind gesperrt. Bestehende Teilnehmer können ihre Anmeldung weiterhin öffnen und im Rahmen der unten beschriebenen Fristregeln aktualisieren. Eine Warteliste gibt es nicht.

### Ernährungsangaben

Wenn **Require dietary info during registration** aktiviert ist, wähle mindestens eine Ernährungsform:

- **Meat** — Fleisch;
- **Fish** — Fisch;
- **Vegetarian** — vegetarisch;
- **Vegan** — vegan.

Fleisch und Fisch dürfen gemeinsam gewählt werden. Vegetarisch kann nicht mit Fleisch, Fisch oder vegan kombiniert werden. Vegan kann nicht mit Fleisch, Fisch oder vegetarisch kombiniert werden.

Zusätzlich kannst du **Halal**, **Kosher** oder **Allergies** wählen. Bei Allergien sind die Einzelheiten unter **Allergies (if selected)** einzutragen. Dafür stehen bis zu 4.000 Zeichen zur Verfügung.

Hat der Organisator Ernährungskommentare aktiviert, kannst du bei **Additional diet comments (optional)** **Comment** auswählen und die Erläuterung unter **Comment (if selected)** eingeben. Auch hier sind bis zu 4.000 Zeichen möglich.

Behandle Allergie- und Ernährungskommentare als sensible personenbezogene Daten. Der Organisator bestimmt, wer **Zugriff auf Teilnehmer** erhält und damit diese Angaben zusammen mit Namen, E-Mail-Adressen und Anwesenheitstagen sehen darf.

## Deine Anmeldung ändern oder stornieren

Nach der Anmeldung zeigt die Seite **Your registration**.

Zum Ändern:

1. Bearbeite **Change arrival** und **Change departure**.
2. Aktualisiere gegebenenfalls angezeigte Ernährungsfelder.
3. Wähle **Update**.

Zum Zurückziehen wählst du **Cancel registration** und bestätigst.

### Was die verbindliche Frist ändert

Vor der verbindlichen Frist sind Anmeldung, Änderung und Stornierung im Rahmen der Zugriffsregeln möglich.

Nach der Frist:

- Neue Teilnehmer benötigen einen aktiven Nachmeldelink eines Organisators.
- Anwesenheitstage lassen sich nur mit aktiviertem **Allow registration date update after deadline expired** ändern.
- Ernährungswahl und Notizen lassen sich nur mit aktiviertem **Allow diet update after deadline expired** ändern.
- Stornieren geht nur mit aktiviertem **Allow cancelling registration after deadline expired**.

Ohne verbindliche Frist schränken diese Schalter gewöhnliche eigene Änderungen nicht ein.

Ein Nachmeldelink umgeht ausschließlich die verbindliche Frist. Er umgeht weder Kapazität, Pflichtfelder, Berechtigungen, Ablauf, Widerruf noch seine erlaubte Nutzungszahl.

## Was nach der Anmeldung erscheint

Ein angemeldeter Teilnehmer kann sehen:

- **Participants**, wenn seine effektiven Rechte **Zugriff auf Teilnehmer** enthalten;
- **Things to do**, wenn die Veranstaltung **Zugriff auf Gegenstände** gewährt und Pack-, Aktivitäten- oder Fahrtenlisten verknüpft sind;
- **Invoice pools & payments**, wenn Kostenpools verwendet werden.

[Kostenpools und Zahlungen](INVOICE_POOLS.md) erklärt Belegeinreichung mit Fortschrittsanzeige, Teilnehmerfaktoren, Übernahmen und Zuschläge/Rabatte, Berechnungsvorschauen, Übernahme bereits gebuchter Zahlungen, Rücknahme unberechneter Änderungen, Abrechnungs-E-Mails und Belegaufbewahrung.

## Eine Veranstaltung erstellen

Du brauchst ein angemeldetes vollständiges Konto. Das aktive Profil wird Eigentümer; Gastprofile können keine Veranstaltung erstellen.

1. Öffne oben **Neu**.
2. Wähle unter **Planen und entscheiden** **Veranstaltung**.
3. Fülle das Erstellungsformular aus.
4. Prüfe **Group Permissions**, insbesondere die Sichtbarkeit von Teilnehmerdaten.
5. Wähle **Create event**.

### Felder bei der Erstellung

| Feld | Eingabe |
|---|---|
| **Title** | Pflichtname, höchstens 255 Zeichen. |
| **Start date** | Erster Veranstaltungstag, erforderlich. |
| **End date** | Letzter Tag, erforderlich und nicht vor dem Startdatum. |
| **Location (optional)** | Ortsangabe bis 255 Zeichen. |
| **Max Participants (optional)** | Positive ganze Höchstzahl. Leer bedeutet keine Kapazitätsgrenze. |
| **Binding deadline (optional)** | Datum und Uhrzeit, nach denen gewöhnliche eigene Neuanmeldungen schließen. |
| **Time zone** | Erforderliche Zeitzone zur Interpretation und Anzeige der Frist. Surveyor zeigt Teilnehmern zusätzlich die entsprechende Zeit ihrer eigenen Zeitzone. |
| **Description (optional)** | Veranstaltungsdetails bis 16.000 Zeichen. |
| **Header image (optional)** | JPEG, PNG oder GIF bis 10 MiB. |
| **Group Permissions** | Anfängliche Rechte für Teilnehmer, Gast, Angemeldet und Öffentlich. |

### Frist- und Ernährungsschalter

| Schalter | Wirkung |
|---|---|
| **Allow registration date update after deadline expired** | Bestehende Teilnehmer dürfen An- und Abreise nach der Frist ändern. |
| **Allow cancelling registration after deadline expired** | Bestehende Teilnehmer dürfen nach der Frist stornieren. |
| **Require dietary info during registration** | Die Anmeldung zeigt Ernährungsformen und Anforderungen. |
| **Allow diet comments during registration** | Die Anmeldung bietet zusätzlich eine optionale Kommentarauswahl und ein Textfeld. |
| **Allow diet update after deadline expired** | Bestehende Teilnehmer dürfen Ernährungswahl und Notizen nach der Frist ändern. |

Eine übliche strenge Einstellung setzt eine Frist und lässt alle drei Schalter für Änderungen nach der Frist aus. Bei einer flexibleren Einstellung aktivierst du nur Änderungen, die organisatorisch nach Festlegung endgültiger Zahlen noch möglich sind.

## Berechtigungen vor dem Teilen prüfen

Veranstaltungen verwenden das allgemeine System aus [Berechtigungen und Freigaben](PERMISSIONS.md). Rechte addieren sich. **Zugriff auf Verwaltung** öffnet nur die Verwaltungsseite und gewährt nicht automatisch jede dortige Aktion.

Anfangs gelten:

- Öffentlich: Zugriff auf Anmeldung, Ansicht, Erstellung und Gegenstände.
- Teilnehmer: Zugriff auf Teilnehmer.

Diese Teilnehmervorgabe bedeutet, dass angemeldete Personen zunächst die Teilnehmerliste mit Namen, vorhandenen E-Mail-Adressen, Anwesenheitstagen, Ernährungswahl, Allergien und Kommentaren sehen können. Entscheide vor dem Teilen, ob dies für die Gruppe angemessen ist.

Für eine datenschutzorientierte Veranstaltung:

1. Entferne **Zugriff auf Teilnehmer** aus der Zielgruppe Teilnehmer.
2. Gib dieses Recht nur vertrauenswürdigen Organisatoren über Einzelzuweisungen.
3. Ergänze **Anmeldungen verwalten** nur, wenn sie Nachmeldelinks erstellen, Anwesenheit ändern oder Anmeldungen löschen sollen.
4. Ergänze **Daten exportieren** zusätzlich zum Teilnehmerzugriff nur, wenn sie Teilnehmer-PDFs erstellen sollen.

[Berechtigungen und Freigaben](PERMISSIONS.md#delegate-a-limited-organizer) enthält Delegationsbeispiele und erklärt addierte Freigaben.

## Die Veranstaltung teilen

Teile die normale Veranstaltungs-URL. Empfänger können sich anmelden, ein Konto erstellen oder als Gast fortfahren, bevor sie **Register for this event** ausfüllen.

Vor der Frist ist die normale URL die passende Einladung. Verwende einen Nachmeldelink nur für Personen, die sich nach der Frist anmelden müssen.

## Veranstaltungseigenschaften ändern

1. Öffne die Veranstaltung und **Entitätseinstellungen** in der Kopfzeile.
2. Klappe unter **Allgemein** die Gruppen **Details**, **Dates and time**, **Registration** oder **Dietary requirements** auf und bearbeite erlaubte Felder.
3. Wähle **Eigenschaften speichern**.

Der Dialog zeigt nur erlaubte Felder und Aktionen. Ein reiner Titelbearbeiter sieht den Titel; ein Verwalter von Ernährungsanforderungen deren Schalter. **Zugriff auf Verwaltung** ist für diese Einstellungen auf der normalen Seite nicht nötig. Derselbe Dialog ist auch in der Verwaltungsübersicht verfügbar.

**Allgemein** enthält Eigenschaftsgruppen und Kopfzeilenbild. **Zugriff** enthält Gruppenberechtigungen und Administratoren. **Aktionen** enthält Archivierung und weitere erlaubte Befehle. Ein Reiter erscheint nur, wenn du etwas darin verwenden darfst. Reiterwechsel erhalten Entwürfe; das Öffnen zeigt nicht sofort sämtliche Bedienelemente.

Unter **Dates and time** kannst du über **Time zone** Zeitzonennamen suchen oder **Common time zones** öffnen. Jeder Treffer zeigt seine UTC-Abweichung. **Use my time zone** wählt die Browserzeitzone. Die Auswahl öffnet sich innerhalb des Einstellungsdialogs und besitzt dieselben Funktionen bei der Veranstaltungserstellung.

Daten, Ort, Frist, Zeitzone, Regeln nach der Frist, **Maximum participants** und Ernährungsschalter verwenden die unten genannten getrennten Rechte. Jeder Abschnitt speichert separat. Fehler erhalten den Entwurf; Schließen verwirft ungespeicherte Änderungen. Vor einem Befehl mit Seitenaktualisierung fordert Surveyor eine Entscheidung über Entwürfe anderer Abschnitte.

Freigaben und Delegation änderst du unter **Entitätseinstellungen** → **Zugriff**. Siehe [Berechtigungen und Freigaben](PERMISSIONS.md#after-creation).

## Die Verwaltungsübersicht öffnen

Profile mit **Zugriff auf Verwaltung** sehen auf der Veranstaltungsseite **Event administration dashboard**.

Die Übersicht enthält Arbeitsbereiche für Teilnehmer, Anmeldungen, verknüpfte Ressourcen und Kosten. Eigenschaften und Freigaben stehen in **Entitätseinstellungen**. Jede Aktion prüft ihr eigenes Recht:

| Recht | Hauptfunktion in der Veranstaltungsverwaltung |
|---|---|
| **Titel bearbeiten** | Titel ändern. |
| **Beschreibung bearbeiten** | Beschreibung ändern. |
| **Metadaten bearbeiten** | Daten, Ort, Frist, Zeitzone, Regeln für Datumsänderung/Stornierung nach der Frist und Bild ändern; archivieren, wiederherstellen und Automatik pausieren/fortsetzen. |
| **Kapazität bearbeiten** | **Maximum participants** in den Entitätseinstellungen ändern. |
| **Anforderungen verwalten** | Erforderliche Ernährungsangaben sowie Kommentar- und Änderungsregeln ändern. |
| **Berechtigungen verwalten** | Zielgruppenrechte und Administratorrechte bearbeiten. |
| **Zugriff auf Teilnehmer** | Teilnehmerdetails, Anwesenheits- und Ernährungszahlen, Allergien und Kommentare sehen. |
| **Anmeldungen verwalten** | Nachmeldelinks erstellen/widerrufen, Anwesenheitstage ändern und Anmeldungen löschen. |
| **Zuweisungen verwalten** | Verknüpfte Pläne/Listen erstellen und Kostenpools verwalten. Den vollständigen Kostenablauf und Datenschutz erläutert [Kostenpools und Zahlungen](INVOICE_POOLS.md#organizer-tasks). |
| **Daten exportieren** | Zusammen mit Teilnehmerzugriff das Teilnehmer-PDF erstellen. |

Der Eigentümer hat alle Fähigkeiten. Individuelle Administratoren erhalten nur ausdrücklich erteilte Rechte plus alle für ihr Profil passenden Zielgruppenrechte.

## Anmeldungen verwalten

### Teilnehmer ansehen und filtern

Öffne mit Teilnehmerzugriff **Participants** in der Verwaltungsübersicht. Der Abschnitt enthält:

- Anwesenheitszahlen je Veranstaltungstag;
- Ernährungszahlen;
- **Allergy / Comment Details**;
- einen Filter für Namen, E-Mail oder Ernährungsangaben;
- eine Tabelle mit **Name**, **Email**, **Dates**, **Dietary** und **Actions**.

Derselbe Abschnitt kann für angemeldete Teilnehmer mit Teilnehmerzugriff auf der normalen Veranstaltungsseite erscheinen.

### Eine Anmeldung anpassen oder entfernen

Mit **Anmeldungen verwalten**:

- Öffne über die Datumsaktion **Adjust attendance window**, halte beide Daten im Veranstaltungszeitraum und wähle **Save dates**.
- Entferne eine Anmeldung über die Löschaktion. Die Teilnehmertabelle kann die Löschung nicht rückgängig machen.

Organisatoren ändern dort An- und Abreise. Teilnehmer bearbeiten ihre Ernährungswahl selbst über **Your registration**.

Das Entfernen einer Anmeldung entfernt auch den veranstaltungsbezogenen Teilnehmerstatus. Dies kann verknüpfte Ressourcen sowie Poolzuordnungen, Einreichungen, Übernahmen und Anteilseinträge betreffen. Lies [Kostenpools und Zahlungen](INVOICE_POOLS.md), bevor du eine Anmeldung mit gemeinsamen Kosten löschst.

## Einen Nachmeldelink erstellen

Mit **Anmeldungen verwalten** kannst du unter **Registration links** in der Verwaltungsübersicht Links zur Fristumgehung erstellen.

1. Wähle **Create link**.
2. Setze **Uses** auf `1` für eine einzelne erfolgreiche Nachmeldung oder eine größere positive ganze Zahl für mehrfache Nutzung.
3. Setze optional **Expires (optional, local time)**. Leer bedeutet kein automatisches Ablaufdatum.
4. Wähle **Create**.
5. Gib den kopierten Link nur der gewünschten Person oder Gruppe.

Die Liste zeigt Token, Erstellungszeit, Ablauf und Status. Ein Link kann sein:

- `active` — verwendbar;
- `consumed` — erlaubte Zahl an Anmeldungen erreicht;
- `expired` — Ablaufzeit überschritten;
- `revoked` — durch einen Organisator deaktiviert.

Mit **Copy** kopierst du einen aktiven Link erneut. **Revoke** beendet seine Verwendbarkeit sofort.

Eine erfolgreiche neue Anmeldung verbraucht eine Nutzung. Die Aktualisierung einer vorhandenen Anmeldung erzeugt keinen zusätzlichen Teilnehmerplatz. Halte diese Links geheim: Ihr Besitz ermöglicht die Fristumgehung für diese Veranstaltung, alle weiteren Anmelderegeln gelten weiterhin.

## Pläne und Listen mit der Veranstaltung verknüpfen

Die Veranstaltungsverwaltung bietet drei verknüpfte Ressourcentypen:

- **Event packing lists** → **Create new packing list**;
- **Event activity plans** → **Create new activity plan**;
- **Event drivers lists** → **Create new drivers list**.

Diese Aktionen wählen die aktuelle Veranstaltung vor. Dafür benötigt das Profil **Zuweisungen verwalten** auf der Veranstaltung.

Du kannst dieselben Ressourcen auch über **Neu** erstellen und im Formular **Veranstaltung zuordnen (optional)** wählen.

Bei bestehenden Ressourcen öffnest du deren **Entitätseinstellungen** → **Verknüpfte Veranstaltung**, wählst das Ziel und **Veranstaltungsverknüpfung speichern** mit Bestätigung. Der Wechsel verlangt Metadatenbearbeitung auf dem Plan beziehungsweise der Liste und Zuweisungsverwaltung auf dem Ziel. **Keine Veranstaltung** hebt die Verknüpfung auf und erhält Ressource, Datensätze, Zuweisungen, Dateien und eigenständige Archivierung.

Ein Wechsel ändert die Veranstaltung für Teilnehmerzugriff und geerbte Archivierung. Bisher zugeordnete Personen werden nicht automatisch beim Ziel angemeldet. Aktivitätenpläne derselben Veranstaltung prüfen automatisch Zuweisungen und aktive Empfehlungen planübergreifend. Jeder Plan behält seine eigenen Anforderungen; Überschneidungen bleiben für organisatorische Prüfung und Bestätigung sichtbar. Aktivitätenpläne prüfen zusätzlich die Eignung von Empfehlungen neu und entfernen veraltete generierte offene Vorschläge. Siehe [Aktivitätenpläne](ACTIVITY_PLANS.md#link-change-or-remove-an-event).

Angemeldete Teilnehmer erreichen verknüpfte Ressourcen über ihre Veranstaltungsteilnahme. **Things to do** erscheint nur, wenn die Veranstaltung zusätzlich **Zugriff auf Gegenstände** gewährt. Nicht angemeldete Personen benötigen passenden direkten Zugriff auf die Ressource.

Die Veranstaltungsverwaltung bietet derzeit weder **Event surveys** noch **Create new survey**. Erstelle und teile Umfragen separat; sie erscheinen nicht neben den verknüpften Pack-, Aktivitäten- und Fahrtenlisten.

### Eine Veranstaltung auswählen

Die Auswahl arbeitet beim Erstellen und unter **Entitätseinstellungen** → **Verknüpfte Veranstaltung** gleich. Sie enthält alle Veranstaltungen, mit denen das aktive Profil verknüpfen darf, einschließlich vergangener, nach Anmeldeschluss liegender und archivierter Veranstaltungen. Du brauchst auf dem Ziel **Zuweisungen verwalten**; eine bloße Administratorzuweisung garantiert das nicht.

1. Suche unter **Veranstaltungen suchen** nach Titel oder Beschreibung.
2. Wähle ein Ergebnis; verwende bei Bedarf die nächste Seite.
3. Schließe bei der Erstellung das Formular ab. Unter **Verknüpfte Veranstaltung** speicherst und bestätigst du die Verknüpfung.

Die Auswahl zeigt jeweils eine Seite. Mit nächster und vorheriger Seite blätterst du, während die Auswahl erhalten bleibt. Öffne bei langen Listen die Datums- und Zustandsfilter:

| Filter | Bedeutung |
|---|---|
| **Von** / **Bis** | Veranstaltungen, deren Zeitraum die gewählten Daten überlappt. Jede Grenze darf leer bleiben. |
| **Zeitraum** | Alle, Bevorstehend, Laufend oder Beendet. |
| **Archivierung** | Alle, Aktiv oder Archiviert. |
| **Anmeldeschluss** | Alle, noch nicht abgelaufen/keine Frist oder Abgelaufen. |

Alle Zustandsfilter starten auf Alle. Abgelaufener Anmeldeschluss und Archivierung sind verschiedene Bedingungen; keine verhindert für sich das Verknüpfen. Die Auswahl eines archivierten Ziels zeigt die geerbte Archivierung innerhalb der Auswahl an.

**Filter zurücksetzen** löscht Suche und Filter, ohne die Auswahl zu ändern. **Keine Veranstaltung** hebt die Auswahl ausdrücklich auf. Filtern, Blättern und leere Ergebnisse ändern niemals die gewählte Veranstaltung; die aktuelle Auswahl bleibt sichtbar. **Current event** kann erscheinen, wenn die Beziehung erhalten bleibt, ihre Details dem aktiven Profil aber nicht zugänglich sind.

Verwende bei Ladefehlern **Erneut versuchen**. Fehlt eine erwartete Veranstaltung weiter, setze Filter zurück und prüfe das Zuweisungsverwaltungsrecht des aktiven Profils für dieses Ziel.

## Die Teilnehmerliste exportieren

Ein Profil braucht sowohl **Daten exportieren** als auch **Zugriff auf Teilnehmer**.

1. Öffne Veranstaltung und **Entitätseinstellungen**.
2. Wähle unter **Aktionen** **Export participants**.

Die Verwaltungsübersicht bietet für dort zugelassene Profile außerdem **Exports** → **Participants (PDF)**.

Das PDF enthält Veranstaltungsinformationen, Anwesenheits- und Ernährungszahlen sowie Teilnehmerzeilen mit Namen, vorhandenen E-Mail-Adressen, Daten, Ernährungswahl, Allergien und Kommentaren. Behandle Speicherung und Weitergabe als sensible personenbezogene Daten und lösche lokale Kopien, wenn sie nicht mehr benötigt werden.

## Kopfzeilenbild, Duplizieren und Löschen

Mit **Metadaten bearbeiten** öffnest du **Entitätseinstellungen** → **Allgemein** → **Kopfzeilenbild**, wählst über **Bild auswählen** eine Datei und **Hochladen**. Erlaubt sind JPEG, PNG und GIF bis 10 MiB. Zum Entfernen wählst du **Bild entfernen** und bestätigst.

Unter **Aktionen** öffnet **Duplizieren** ein vorausgefülltes Formular für eine neue Veranstaltung. Es verlangt ein vollständiges Konto und **Daten duplizieren**. **Endgültig löschen** ist dem Eigentümer vorbehalten; prüfe Veranstaltung und verknüpfte Inhalte vor der Bestätigung. Eigentümer können auch in **Deine Übersicht** duplizieren oder löschen.

## Die Veranstaltung archivieren oder wiederherstellen

Unter **Entitätseinstellungen** → **Aktionen** → **Archivierung** können Eigentümer oder Organisatoren mit Metadatenbearbeitung **Für alle archivieren** wählen und bestätigen. Veranstaltung, verknüpfte Pläne und Listen, Anmeldungen und Kostenpools werden gemeinsam archiviert. Bisheriger Zugriff und Aktionen bleiben verfügbar; alle Daten und Dateien bleiben erhalten. **Things to do** und Kostenbereiche sind weiter nutzbar. Die gewöhnliche Ansicht zeigt gegebenenfalls nur **Dieser Eintrag ist archiviert.**

Veranstaltungen können nach ihrem einschließlich geltenden Enddatum und der konfigurierten Verzögerung automatisch archiviert werden. **Pause automatic archival** hält eine Veranstaltung aktiv. **Für alle wiederherstellen** stellt sie wieder her und pausiert die Automatik, bis **Resume automatic archival** gewählt wird. Separat archivierte Untereinträge bleiben nach Wiederherstellung ihrer Veranstaltung archiviert.

Archivierte Karten wandern standardmäßig nach **Archived and hidden**. Für die eigene Kartenposition verwendest du **Hide for me**, **Show for me** oder **Use default visibility** in [Deine Übersicht](DASHBOARD.md#hide-or-show-an-item-only-for-yourself). Belegaufbewahrung läuft unabhängig weiter; Archivierung löscht weder Belege noch Kopfzeilenbilder.

## Probleme lösen

### Ich sehe das Anmeldeformular nicht

Prüfe:

- Du bist angemeldet oder über den Gasteinstieg eingetreten und hast ein aktives Profil.
- Die Veranstaltung ist nicht voll.
- Deine effektiven Rechte enthalten **Zugriff auf Anmeldung**.
- Nach Ablauf der Frist hast du einen aktiven Nachmeldelink geöffnet.

### Nach der Frist kann ich nicht ändern oder stornieren

Der Organisator steuert Datumsänderung, Ernährungsänderung und Stornierung mit drei getrennten Schaltern. Frage, welche Aktion weiterhin erlaubt ist. Ein Nachmeldelink gilt für neue späte Anmeldungen und ändert nicht die Änderungsregeln bestehender Anmeldungen.

### Ein verknüpfter Plan oder eine Liste fehlt

Prüfe:

- Du verwendest das für die Veranstaltung angemeldete Profil.
- Die Ressource ist dieser Veranstaltung zugeordnet.
- Die Veranstaltung gibt dir **Zugriff auf Gegenstände**, wenn du sie unter **Things to do** erwartest.
- Der Organisator hat deine Anmeldung nicht entfernt.

### Ich kann die Verwaltungsübersicht nicht öffnen oder verwenden

Zum Öffnen ist **Zugriff auf Verwaltung** nötig. Danach braucht jeder Abschnitt sein eigenes Recht. Bitte den Eigentümer um die konkrete Aktion, nicht nur um den Eingang zur Verwaltung.

Eigenschaften, Bilder, Freigaben und Archivierung können auf der gewöhnlichen Veranstaltungsseite unter **Entitätseinstellungen** ohne Verwaltungszugang verfügbar sein. Fehlt die Schaltfläche oder ein Feld, fehlt dem aktiven Profil das zugehörige Aktionsrecht.

### Teilnehmerinformationen sind für mehr Personen sichtbar als erwartet

Berechtigungen addieren sich. Entferne **Zugriff auf Teilnehmer** aus jeder für diese Profile passenden Zielgruppen- und Einzelzuweisung und gib es nur den gewünschten Organisatoren. Die Problemlösungen unter [Berechtigungen und Freigaben](PERMISSIONS.md#troubleshooting) helfen beim Finden überlappender Freigaben.

---

**Zurück zu:** [Benutzerhandbuch](README.md)
