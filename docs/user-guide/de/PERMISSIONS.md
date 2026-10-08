# Berechtigungen und Freigaben
<!--
documentation-metadata
audience: Organisatoren; erfahrene Administratoren
owner: permission-system maintainers
status: current
last-verified: 2026-10-07
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: vollständige eigenständige deutsche Anleitung mit unveränderter Abschnittsstruktur; additive Freigaben, Zielgruppen, Voreinstellungen und getrennte Ansichts- und Aktionsberechtigungen; Abgleich übersetzter Konto-, Übersichts- und Packlistenbeschriftungen mit dem zentralen Katalog, englische E-Mail- und bestehende Formularbezeichnungen erhalten
source-anchors: src/modules/lib/permissions.ts; src/modules/permissionEngine.ts; src/locales/de.json; src/frontend/features/identity/IdentityPage.vue; src/frontend/features/overview/OverviewPage.vue
heading-anchors: 1:permissions-and-sharing; 2:choose-a-common-setup; 2:four-rules-to-remember; 3:example-of-cumulative-grants; 2:who-receives-each-grant; 2:open-the-permission-controls; 3:while-creating-an-item; 3:after-creation; 2:configure-group-permissions; 2:add-or-change-a-named-administrator; 2:sharing-recipes; 3:normal-open-collaboration; 3:full-account-profiles-only; 3:registered-event-participants-only; 3:read-only-participation; 3:let-participants-add-entries-without-managing-everybody; 3:delegate-a-limited-organizer; 3:delegate-property-or-event-link-editing; 3:delegate-complete-control; 2:permission-label-reference; 2:preset-reference; 3:initial-selections; 2:parent-and-child-permissions; 2:page-access-is-not-the-same-as-an-action-permission; 2:troubleshooting; 3:a-permission-remains-after-i-cleared-it; 3:a-full-account-user-receives-a-guest-permission; 3:a-participant-cannot-use-an-action-on-a-linked-list-or-plan; 3:an-event-organizer-cannot-open-the-administration-dashboard; 3:an-administrator-appears-but-cannot-do-anything; 3:i-cannot-find-a-guest-in-add-administrator
next-review: permission-or-entity-settings-behavior-change
-->

Mit Berechtigungen legst du fest, welche Aktionen Personen in einer **Veranstaltung**, einem **Aktivitätenplan**, einer **Packliste** oder einer **Fahrtenliste** ausführen dürfen. Beginne mit einer typischen Freigabe, teste sie mit einem Profil ohne Eigentümerrechte und nutze die Referenzabschnitte für feinere Einstellungen. Die Referenztabelle nennt auch die englischen Beschriftungen bisheriger Ansichten.

> **Umfragen sind anders.** Sie verwenden dieses Berechtigungssystem absichtlich nicht. Einladung, Gastzugang, Abstimmung und zusätzliche Kombinationen beschreibt [Umfragen](SURVEYS.md).

## Eine übliche Einstellung wählen

| Ziel | Empfohlene Einstellung |
|---|---|
| Den gewöhnlichen offenen Ausgangspunkt behalten | **Öffentlich** auf **Standardfreigabe** lassen. Nur zusätzlich benötigte Teilnehmeraktionen freigeben. |
| Eine Aktion nur vollständigen Kontoprofilen erlauben | Diese Aktion bei **Öffentlich** und **Gast** entfernen, dann bei **Angemeldet** auswählen. |
| Einen verknüpften Plan oder eine Liste auf angemeldete Veranstaltungsteilnehmer begrenzen | Mit der Veranstaltung verknüpfen. Die Aktion bei **Öffentlich**, **Gast** und **Angemeldet** entfernen; bei **Teilnehmer** **Zugriff auf Ansicht** und die nötigen Aktionen auswählen. |
| Einer Person begrenzte Organisatorrechte geben | Sie unter **Administratoren** hinzufügen und nur die für ihre Aufgabe benötigten Rechte wählen. |
| Einer Person vollständige Kontrolle geben | Sie unter **Administratoren** hinzufügen und **Administrator** wählen. Bei Veranstaltungen enthält dies den Zugang zur Verwaltungsübersicht. |
| Jemandem eine Fähigkeit entziehen | Sie aus jeder passenden Zielgruppen- und Einzelzuweisung entfernen. Es gibt keine Verweigerungsregel, die andere Freigaben aufhebt. |

Die folgenden Abschnitte erklären Wirkung und Anwendung dieser Einstellungen.

## Vier wichtige Regeln

1. **Freigaben werden addiert.** Öffentlich, Gast, Angemeldet, Teilnehmer und individuelle Administratorrechte wirken gemeinsam. Eine speziellere Freigabe ersetzt keine allgemeinere.
2. **Ein Profil kann mehreren Gruppen entsprechen.** Ein für eine Veranstaltung angemeldetes Profil eines vollständigen Kontos kann gleichzeitig Öffentlich, Gast, Angemeldet, Teilnehmer und eine individuelle Freigabe erhalten.
3. **Der Eigentümer hat immer alle Rechte.** Gruppen- und Einzelzuweisungen können seinen Zugriff nicht einschränken.
4. **Eine Voreinstellung ersetzt die aktuelle Auswahl einer Gruppe oder eines Administrators.** Wähle zuerst die Voreinstellung und passe danach einzelne Kontrollkästchen an. **Alle** (Hinweis **Alle auswählen**, englisch **All**) wählt jedes Recht; **Keine** (Hinweis **Auswahl aufheben**, englisch **None**) entfernt alle Rechte dieses Abschnitts.

### Beispiel addierter Freigaben

Angenommen, **Öffentlich** hat **Zugriff auf Ansicht**, **Angemeldet** hat **Gegenstände hinzufügen**, und Alex erhält individuell **Gegenstände löschen**. Verwendet Alex ein Profil eines vollständigen Kontos, gelten alle drei Rechte: Ansicht, Hinzufügen und Löschen.

Das Entfernen des Löschrechts aus Alex’ individueller Zuweisung reicht nicht, wenn er es außerdem über Öffentlich, Gast, Angemeldet oder Teilnehmer erhält. Prüfe bei scheinbar fortbestehenden Rechten jede passende Quelle.

## Wer welche Freigabe erhält

| Quelle | Empfänger |
|---|---|
| **Öffentlich** | Alle, einschließlich Gäste, vollständiger Kontoprofile, Teilnehmer und individueller Administratoren. Diese Rechte gelten zusätzlich zu deren anderen Rechten. |
| **Gast** | Jedes aktive Profil, sowohl Gastprofile **als auch Profile vollständiger Konten**. Gemeint ist eine breite Freigabe für „mit einem Profil eingetreten“, keine reine Gast-Abgrenzung. |
| **Angemeldet** | Ein aktives Profil eines vollständigen Kontos. Ein reines Gastprofil erhält diese Freigabe nicht. |
| **Teilnehmer** | Ein für die betreffende Veranstaltung angemeldetes aktives Profil. Bei verknüpften Aktivitätenplänen, Pack- und Fahrtenlisten zählt die Anmeldung zur verknüpften Veranstaltung. |
| **Individueller Administrator** | Das gewählte Profil erhält seine gespeicherten Einzelrechte zusätzlich zu allen passenden Zielgruppenrechten. Die Auswahl sucht Profile vollständiger Konten. |
| **Eigentümer** | Das aktive Eigentümerprofil erhält automatisch alle Rechte. |

Entscheidend ist das **aktive Profil**. Nach einem Profilwechsel können sich die Rechte eines vollständigen Kontos ändern, weil Eigentümerschaft, Veranstaltungsanmeldung und Einzelzuweisungen zu Profilen gehören, nicht zum Konto insgesamt.

## Berechtigungssteuerung öffnen

**Metadaten bearbeiten** erlaubt auch **Für alle archivieren**, **Für alle wiederherstellen** und die Archivierungsautomatik von Veranstaltungen und eigenständigen Aktivitätenplänen. Dasselbe Recht erlaubt manuelle Archivierung und Wiederherstellung von Aktivitätenplänen, Pack- und Fahrtenlisten. **Zugriff auf Verwaltung** oder eine Administratorzuweisung allein reichen nicht. Wer nur einen Untereintrag organisiert, kann eine archivierte Veranstaltung nicht überstimmen oder ohne Veranstaltungsrechte wiederherstellen. Bei Umfragen bleibt gemeinsame Archivierung dem Eigentümer vorbehalten.

Persönliches **Für mich ausblenden** (englisch **Hide for me**), **Für mich einblenden** (englisch **Show for me**) und **Standardsichtbarkeit verwenden** (englisch **Use default visibility**) setzt Teilnahme oder Verwaltungszuordnung in der Übersicht des aktiven Profils voraus. Es ändert keine Rechte und keinen fremden Archivierungszustand. Siehe [Deine Übersicht](DASHBOARD.md#hide-or-show-an-item-only-for-yourself).

### Beim Erstellen eines Eintrags

Erstellungsformulare für Veranstaltungen, Aktivitätenpläne, Pack- und Fahrtenlisten enthalten **Gruppenberechtigungen**. Wähle die **Zielgruppe der Berechtigungen**, verwende **Voreinstellungen** oder einzelne Kontrollkästchen und sende anschließend das Erstellungsformular ab.

Umfragen zeigen diese Matrix nicht.

### Nach dem Erstellen

Zum Anzeigen und Verwenden brauchst du **Berechtigungen verwalten**. Öffne den Eintrag, wähle in der Kopfzeile **Entitätseinstellungen** und anschließend **Zugriff**.

Bei Veranstaltungen stehen diese Bedienelemente auf der normalen Veranstaltungsseite ohne **Zugriff auf Verwaltung** bereit. Die Verwaltungsübersicht bietet denselben Dialog, benötigt zum Betreten jedoch weiterhin dieses Zugriffsrecht. Regeln für Aktivitätenzuweisungen bleiben unter **Rules & auto-assign**.

Unter **Zugriff**:

- **Gruppenberechtigungen** ändert Rechte für Teilnehmer, Gast, Angemeldet und Öffentlich.
- **Administratoren** ändert Rechte namentlich ausgewählter Profile vollständiger Konten.

Wähle nach Gruppenänderungen **Berechtigungen aktualisieren** und nach Änderungen eines Administrators **Speichern**.

## Gruppenberechtigungen einstellen

1. Öffne **Entitätseinstellungen** → **Zugriff** → **Gruppenberechtigungen**.
2. Wähle bei **Zielgruppe der Berechtigungen** Teilnehmer, Gast, Angemeldet oder Öffentlich. Nur deren Bearbeitung wird angezeigt.
3. Wähle eine Voreinstellung, **Alle**, **Keine** oder einzelne Rechte.
4. Wähle **Berechtigungen aktualisieren**.
5. Teste mit einem Profil der beabsichtigten Art.

Beim Zielgruppenwechsel bleibt jede ungespeicherte Auswahl erhalten. **Berechtigungen aktualisieren** speichert alle vier Zielgruppen gemeinsam, einschließlich vollständig geleerter Gruppen. Die Rechte sind nach Zweck gruppiert; unter **Voreinstellungen** findest du Ausgangskombinationen. Da Freigaben addiert werden, zieht die Änderung einer Zielgruppe niemals Rechte anderer Zielgruppen ab.

## Einen Administrator hinzufügen oder ändern

1. Öffne **Entitätseinstellungen** → **Zugriff** → **Administratoren** und wähle **Hinzufügen**.
2. Suche im Dialogbereich **Administrator hinzufügen** unter **Nutzer (Name oder E-Mail)** und wähle das gewünschte Profil.
3. Wähle eine **Anfängliche Voreinstellung** oder belasse **Keine**.
4. Wähle **Hinzufügen**.
5. Klappe den neuen Administrator auf, ändere die Kontrollkästchen und wähle **Speichern**.

**Entfernen** löscht die individuelle Administratorzuweisung. Rechte aus Öffentlich, Gast, Angemeldet oder Teilnehmer bleiben bestehen.

Die anfängliche Einstellung **Keine** erzeugt eine Administratorzuweisung ohne eigene Fähigkeiten. Der Eintrag kann trotzdem unter **Verwaltbare Einträge** (englisch **Administrable entities**) dieses Profils erscheinen, weil die Zuordnung existiert. Aktionen bleiben gesperrt, bis eine andere passende Freigabe sie erlaubt.

## Beispiele für Freigaben

### Gewöhnliche offene Zusammenarbeit

Verwende anfänglich **Öffentlich: Standardfreigabe**. Sie enthält **Zugriff auf Anmeldung**, **Zugriff auf Ansicht**, **Zugriff auf Erstellung** und **Zugriff auf Gegenstände**.

Damit werden **keine** Bearbeitung, Gegenstandserstellung, Zuweisungsverwaltung, Berechtigungsverwaltung, Exporte oder Duplikate erlaubt. Ergänze nur tatsächlich benötigte Aktionsrechte.

**Zugriff auf Erstellung** ersetzt die üblichen Erstellungsvoraussetzungen nicht. Ein neuer übergeordneter Eintrag verlangt weiterhin ein angemeldetes vollständiges Konto und gegebenenfalls funktionsspezifische Voraussetzungen.

### Nur Profile vollständiger Konten

So erlaubst du eine Aktion nur vollständigen Konten:

1. Entferne das Recht unter **Öffentlich**.
2. Entferne es auch unter **Gast**, weil vollständige Kontoprofile diese Freigabe ebenfalls erhalten.
3. Wähle es unter **Angemeldet**.
4. Prüfe Teilnehmer und Einzelzuweisungen auf ungewollte weitere Freigaben desselben Rechts.

### Nur angemeldete Veranstaltungsteilnehmer

Für einen verknüpften Aktivitätenplan, eine Pack- oder Fahrtenliste:

1. Entferne die betreffenden Rechte aus Öffentlich, Gast und Angemeldet.
2. Wähle unter **Teilnehmer** **Zugriff auf Ansicht** und benötigte Aktionen.
3. Ergänze **Zugriff auf Teilnehmer** nur, wenn Namen oder Teilnehmer- beziehungsweise Zusagelisten sichtbar sein sollen.

Ein angemeldeter Teilnehmer kann die verknüpfte Ressource über die Veranstaltungsbeziehung betreten. **Zugriff auf Ansicht** bleibt wichtig, weil mehrere Selbstbedienungsaktionen dieses Recht prüfen.

Nichtteilnehmer können die verknüpfte Ressource nur mit effektivem **Zugriff auf Ansicht** betreten.

### Teilnahme mit Lesezugriff

Gib der Zielgruppe **Zugriff auf Ansicht**, ohne Bearbeitungs-, Gegenstands-, Verwaltungs-, Daten- oder Administrationsrechte hinzuzufügen. Ergänze **Zugriff auf Teilnehmer** oder **Zugriff auf Gegenstände** nur, wenn diese Listen sichtbar sein sollen.

Bei einem unverknüpften Aktivitätenplan oder einer unverknüpften Pack- oder Fahrtenliste sind Berechtigungen vor allem Aktionsfreigaben, kein allgemeiner Datenschutzschalter für die Seite. Jemand mit der URL kann möglicherweise ein aktives Profil erhalten und die Seite öffnen, obwohl alle Gruppenrechte leer sind; geschützte Aktionen bleiben gesperrt. Behandle den Link vertraulich, wenn bereits der Seiteninhalt eingeschränkt werden muss.

### Teilnehmer Einträge hinzufügen lassen, ohne alle zu verwalten

Erteile der gewünschten Zielgruppe:

- **Zugriff auf Ansicht** für die gemeinsame Seite und eigene Teilnahmeaktionen.
- **Gegenstände hinzufügen** für Aktivitätenzeitfenster, Packgegenstände oder Fahrerzeilen.

Vergib **Zuweisungen verwalten** nicht allein für das Beitreten oder Verlassen eigener Zuweisungen. Dieses Recht erlaubt mächtigere Zuweisungs- und Rollenverwaltung.

### Einen eingeschränkten Organisator benennen

Füge ihn unter **Administratoren** hinzu und wähle nur benötigte Rechte. Übliche Kombinationen sind:

- **Alle Bearbeitungsrechte** für übergeordnete Details.
- **Alle Gegenstandsrechte** zum Hinzufügen, Bearbeiten, Sortieren und Löschen untergeordneter Einträge.
- **Zuweisungen verwalten** für fremde Zusagen oder Rollen.
- **Anmeldungen verwalten** für Veranstaltungsanmeldungen.
- **Berechtigungen verwalten** für Freigaben und Administratoren.
- **Zugriff auf Verwaltung** zum Betreten der Veranstaltungsverwaltung.

Ein Berechtigungsverwalter einer Veranstaltung braucht **Berechtigungen verwalten**. Das öffnet die Berechtigungssteuerung in **Entitätseinstellungen** auf der Veranstaltungsseite. Ergänze **Zugriff auf Verwaltung** nur, wenn er auch die Verwaltungsübersicht betreten muss.

### Eigenschaften oder Veranstaltungsverknüpfungen delegieren

**Entitätseinstellungen** zeigt nur erlaubte Felder und Aktionen. Gib einem reinen Titelbearbeiter **Titel bearbeiten**, einem Beschreibungsbearbeiter **Beschreibung bearbeiten**. Ein Veranstaltungsbearbeiter mit ausschließlich **Anforderungen verwalten** sieht die Ernährungseinstellungen. Diese Profile brauchen für den Dialog allein kein **Zugriff auf Verwaltung**.

Das Ändern oder Entfernen der Veranstaltung eines Aktivitätenplans, einer Pack- oder Fahrtenliste verlangt **Metadaten bearbeiten** auf dieser Ressource. Für ein neues Ziel brauchst du zusätzlich **Zuweisungen verwalten** auf der Zielveranstaltung. Vergangene, nach Anmeldeschluss liegende und archivierte Veranstaltungen bleiben unter denselben Rechten auswählbar. Eine bloße Administratorzuweisung ohne benötigtes Recht reicht nicht.

Nach einem Verknüpfungswechsel richten sich Teilnehmerrechte nach der neuen Veranstaltung. Bestehende Datensätze und Einzelrechte bleiben, aber ein Profil mit Zugriff ausschließlich über die alte Veranstaltung kann ihn verlieren. Prüfe die neue Freigabegrenze vor **Veranstaltungsverknüpfung speichern**. Auswahl und Filter erklärt [Eine Veranstaltung auswählen](EVENTS.md#choose-an-event).

### Vollständige Kontrolle delegieren

Wähle für den benannten Administrator **Administrator**. Dies gewährt alle verfügbaren Berechtigungen, überträgt aber nicht das Eigentum. Dem Eigentümer vorbehaltene Aktionen, etwa das endgültige Löschen des Eintrags, bleiben ihm vorbehalten.

## Referenz der Berechtigungsbezeichnungen

Wähle mit diesen Beschriftungen die Aktionen aus, die eine Person ausführen darf. Die Funktionsanleitungen zeigen, wo die Aktionen erscheinen. Englische Bezeichnungen in Klammern helfen in bisherigen Ansichten.

| Beschriftung | Erlaubt |
|---|---|
| **Titel bearbeiten** (Edit Title) | Titel einer Veranstaltung, eines Plans oder einer Liste ändern. |
| **Beschreibung bearbeiten** (Edit Desc) | Beschreibung einer Veranstaltung, eines Plans oder einer Liste ändern. |
| **Kapazität bearbeiten** (Edit Capacity) | Veranstaltungskapazität oder unterstützte Gegenstandskapazität ändern. |
| **Metadaten bearbeiten** (Edit Meta) | Weitere Einstellungen wie Daten, Ort, Kopfzeilenbild oder Veranstaltungsverknüpfung ändern. Die Zielauswahl verlangt dort zusätzlich Zuweisungen verwalten. |
| **Gegenstände hinzufügen** (Item Add) | Aktivitätenzeitfenster, Packgegenstände oder Fahrerzeilen hinzufügen. |
| **Gegenstände bearbeiten** (Item Edit) | Zeitfenster oder Listeneinträge sortieren und deren unterstützte Bearbeitungen erlauben. |
| **Gegenstandsbeschreibung bearbeiten** (Item Edit Desc) | Beschreibungen von Zeitfenstern oder Listeneinträgen ohne umfassendes Bearbeitungsrecht ändern. |
| **Gegenstandsmetadaten bearbeiten** (Item Edit Meta) | Unterstützte Einstellungen einzelner Einträge, derzeit Aktivitätenzeitfenster, ohne umfassendes Bearbeitungsrecht ändern. |
| **Gegenstände löschen** (Item Delete) | Zeitfenster oder Listeneinträge löschen. |
| **Zuweisungen verwalten** (Manage Assignments) | Fremde Zuweisungen oder Rollen verwalten. Eigene Teilnahmeaktionen benötigen gegebenenfalls nur Zugriff auf Ansicht. |
| **Anforderungen verwalten** (Manage Requirements) | Veranstaltungsanforderungen sowie Anforderungen, Regeln und gemeinsame Felddefinitionen von Aktivitätenplänen verwalten. |
| **Anmeldungen verwalten** (Manage Registrations) | Veranstaltungsanmeldelinks und Teilnehmeranmeldungen verwalten. |
| **Berechtigungen verwalten** (Manage Permissions) | Gruppenberechtigungen und Administratoren öffnen und ändern. |
| **Daten exportieren** (Data Export) | Unterstützte Daten exportieren. Teilnehmerexport von Veranstaltungen verlangt zusätzlich Zugriff auf Teilnehmer. |
| **Daten duplizieren** (Data Duplicate) | Das Duplizierungsformular öffnen. Die Erstellung abzuschließen erfordert weiterhin ein vollständiges Konto. |
| **Zugriff auf Anmeldung** (Access Registration) | Für eine Veranstaltung anmelden. |
| **Zugriff auf Ansicht** (Access View) | Als Nichtteilnehmer einen verknüpften Plan oder eine Liste betreten und die durch deren Freigaben erlaubten gemeinsamen Aktionen verwenden. |
| **Zugriff auf Erstellung** (Access Create) | Bestandteil der Standard-Zugriffsvoreinstellungen. Neue Veranstaltungen, Pläne oder Listen erfordern weiterhin ein vollständiges Konto und die in ihrer Anleitung genannten Rechte. |
| **Zugriff auf Verwaltung** (Access Admin) | Die Verwaltungsübersicht einer Veranstaltung öffnen. Gewährt nicht alle Verwaltungsrechte. |
| **Zugriff auf Teilnehmer** (Access Participants) | Teilnehmer- oder Zusagennamen und Listen sehen, soweit verfügbar. |
| **Zugriff auf Gegenstände** (Access Items) | Die verknüpften Aktivitätenpläne, Pack- und Fahrtenlisten einer Veranstaltung sehen. |

## Referenz der Voreinstellungen

Eine Voreinstellung ersetzt die aktuellen Kontrollkästchen genau dieser Zielgruppe oder dieses Administrators.

| Voreinstellung | Ausgewählte Rechte |
|---|---|
| **Alle Bearbeitungsrechte** (Full Edit) | Titel, Beschreibung, Kapazität und Metadaten bearbeiten |
| **Alle Gegenstandsrechte** (Full Item) | Gegenstände hinzufügen, bearbeiten, beschreiben, Metadaten bearbeiten und löschen |
| **Alle Verwaltungsrechte** (Full Manage) | Zuweisungen, Anforderungen, Anmeldungen und Berechtigungen verwalten |
| **Alle Datenrechte** (Full Data) | Daten exportieren und duplizieren |
| **Alle Zugriffsrechte** (Full Access) | Zugriff auf Anmeldung, Erstellung, Ansicht, Verwaltung, Teilnehmer und Gegenstände |
| **Administrator** (Admin) | Titel, Beschreibung, Kapazität und Metadaten bearbeiten; Gegenstände hinzufügen, bearbeiten, beschreiben, Metadaten bearbeiten und löschen; Zuweisungen, Anforderungen, Anmeldungen und Berechtigungen verwalten; Daten exportieren und duplizieren; Zugriff auf Anmeldung, Erstellung, Ansicht, Verwaltung, Teilnehmer und Gegenstände |
| **Standardfreigabe** (Default Entity) | Zugriff auf Anmeldung, Ansicht, Erstellung und Gegenstände |

### Anfängliche Auswahl

| Eintragstyp | Anfängliche Gruppenrechte |
|---|---|
| Veranstaltung | **Öffentlich: Standardfreigabe**; **Teilnehmer: Zugriff auf Teilnehmer**; Gast und Angemeldet ohne zusätzliche Auswahl. |
| Aktivitätenplan | **Öffentlich: Standardfreigabe**; alle anderen Zielgruppen ohne zusätzliche Auswahl. |
| Packliste | **Öffentlich: Standardfreigabe**; alle anderen Zielgruppen ohne zusätzliche Auswahl. |
| Fahrtenliste | **Öffentlich: Standardfreigabe**; alle anderen Zielgruppen ohne zusätzliche Auswahl. |
| Umfrage | Keine allgemeine Berechtigungsmatrix; eigenes Teilnahmemodell. |

**Standardfreigabe** enthält **Zugriff auf Gegenstände** ebenso wie **Zugriff auf Anmeldung**, **Zugriff auf Ansicht** und **Zugriff auf Erstellung**.

## Rechte übergeordneter und untergeordneter Einträge

Aktivitätenzeitfenster, Packgegenstände und Fahrerzeilen gehören zu einem Plan oder einer Liste. Rechte auf dem Plan oder der Liste können Aktionen auf deren Einträgen erlauben. Einzelne Einträge können zusätzliche Rechte haben.

Typische Rechte des übergeordneten Eintrags:

- **Gegenstände bearbeiten** erlaubt mehrere unterstützte Bearbeitungen und das Sortieren.
- **Gegenstandsbeschreibung bearbeiten** erlaubt die Bearbeitung von Beschreibungen.
- **Gegenstandsmetadaten bearbeiten** erlaubt unterstützte Einstellungen, derzeit von Aktivitätenzeitfenstern.
- **Gegenstände löschen** kann das Löschen von Untereinträgen erlauben.
- **Zuweisungen verwalten** kann deren Zuweisungsverwaltung erlauben.

Die verfügbaren Aktionen hängen von der Funktion und den Rechten des Eintrags ab. Ein Recht auf dem Plan oder der Liste erlaubt nicht immer dieselbe Aktion auf jedem Eintrag. Prüfe die Wirkung eng delegierter Rollen anhand der Funktionsanleitung und sichtbarer Bedienelemente.

## Seitenzugang und Aktionsrecht sind verschieden

Die meisten gemeinsamen Funktionsseiten stellen zunächst ein aktives Profil sicher. Besucher ohne Profil gelangen zur Gasteinstiegsseite.

Für einen veranstaltungsgebundenen Aktivitätenplan, eine Pack- oder Fahrtenliste gilt:

- Angemeldete Veranstaltungsteilnehmer dürfen eintreten.
- Nichtteilnehmer brauchen effektiv **Zugriff auf Ansicht**.
- Andernfalls meldet Surveyor, dass eine Veranstaltungsanmeldung erforderlich ist.

Bei unverknüpften Plänen oder Listen kann ein aktives Profil die Seite im Allgemeinen auch ohne ausgewähltes Ansichtsrecht öffnen. Einzelne Aktionen erfordern weiterhin ihre jeweiligen Rechte. **Keine** garantiert deshalb nicht, dass die Seite unzugänglich ist.

## Probleme lösen

### Ein entferntes Recht bleibt wirksam

Das aktive Profil erhält dasselbe Recht vermutlich aus einer anderen Quelle. Prüfe zuerst Öffentlich, dann Gast, Angemeldet, Teilnehmer und die individuelle Administratorzuweisung. Prüfe auch, ob das Profil Eigentümer ist.

### Ein vollständiges Konto erhält ein Gastrecht

So funktioniert das aktuelle Zielgruppenmodell: Gast gilt für jedes aktive Gast- oder vollständige Kontoprofil. Entferne das Recht aus Gast, wenn ausschließlich angemeldete vollständige Kontoprofile es erhalten sollen.

### Ein Teilnehmer kann eine Aktion auf einer verknüpften Liste oder einem Plan nicht verwenden

Prüfe alle Punkte:

- Das richtige Profil ist aktiv.
- Dieses Profil ist für die verknüpfte Veranstaltung angemeldet.
- Teilnehmer hat **Zugriff auf Ansicht**.
- Teilnehmer hat das benötigte Aktionsrecht.
- Keine weitere Regel wie Kapazität oder Frist verhindert die Aktion.

### Ein Veranstaltungsorganisator kann die Verwaltungsübersicht nicht öffnen

Erteile **Zugriff auf Verwaltung**. Ergänze die innerhalb der Verwaltung benötigten Rechte, etwa Berechtigungen verwalten, Anmeldungen verwalten oder Zugriff auf Teilnehmer.

Eigenschaften und Rechte können stattdessen mit den jeweiligen Aktionsrechten über **Entitätseinstellungen** auf der normalen Veranstaltungsseite geändert werden. Fehlt der Dialog oder ein Feld, prüfe das entsprechende Recht des aktiven Profils, statt nur Zugang zur Verwaltungsübersicht zu gewähren.

### Ein Administrator erscheint, kann aber nichts tun

Die Zuordnung wurde möglicherweise mit **Keine** angelegt, oder ihre Rechte decken die Aktion nicht ab. Klappe den Administrator auf, wähle die nötigen Rechte und speichere.

### Ein Gast fehlt bei Administrator hinzufügen

Die Auswahl sucht nur Profile vollständiger Konten. Verwende für Gastprofile Zielgruppenrechte.

---

**Weitere Anleitungen**

- [Erste Schritte](GETTING_STARTED.md)
- [Deine Übersicht](DASHBOARD.md)
- [Veranstaltungen](EVENTS.md)
- [Aktivitätenpläne](ACTIVITY_PLANS.md)
- [Packlisten](PACKING_LISTS.md)
- [Fahrtenlisten](DRIVERS_LISTS.md)
- [Umfragen](SURVEYS.md) — eigenes Zugangs- und Teilnahmemodell
