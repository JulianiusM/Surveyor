# Deine Übersicht
<!--
documentation-metadata
audience: neue Nutzer; Organisatoren; Teilnehmer
owner: dashboard feature maintainers
status: current
last-verified: 2026-10-20
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Migrated controls and exact localized labels source-reconciled with current component/catalog owners; settings save/discard, refresh and notice wording corrected where applicable. Native business reference, declared anchors and image bytes retained; no new browser execution claimed.
source-anchors: src/views/users/dashboard.pug; src/views/modules/module_unified_entity_cards.pug; src/locales/de.json; src/frontend/features/identity/IdentityPage.vue; src/frontend/features/overview/OverviewPage.vue; src/frontend/features/overview/; src/locales/
heading-anchors: 1:your-overview; 2:open-your-overview; 2:check-the-active-profile; 2:understand-the-two-collections; 2:find-an-item; 3:search; 3:filter-by-type; 2:read-and-open-a-card; 2:open-an-event-s-linked-entities; 2:find-archived-and-hidden-items; 2:hide-or-show-an-item-only-for-yourself; 2:archive-or-restore-for-everyone; 2:use-owner-actions; 2:create-a-new-item; 2:navigation-at-a-glance; 2:troubleshooting; 3:an-expected-item-is-missing; 3:an-overview-page-could-not-load; 3:duplicate-or-delete-is-missing; 3:both-collections-are-empty; 2:related-guides
next-review: overview-or-navigation-visible-UI-change
production-reference: 2dfa257 native business comparator with current German migrated controls and approved exceptions; not an installed production commit
-->

**Deine Übersicht** führt dich zu Einträgen zurück, die mit dem aktiven Profil verbunden sind. Dazu gehören dessen Teilnahmen sowie Einträge, die es besitzt oder verwalten darf. Die Seite ist auf das aktive Profil zugeschnitten und nicht auf selbst erstellte Inhalte beschränkt.

## Deine Übersicht öffnen

1. Melde dich mit einem vollständigen Konto oder Gastkonto an.
2. Öffne oben **Übersicht**.
3. Wähle **Deine Übersicht**.
4. Öffne einen Eintrag über Bild oder Titel. Wähle bei einem Plan oder einer Liste innerhalb einer Veranstaltung zuerst **Verknüpfte Einträge anzeigen** auf der Veranstaltungskarte.

Auch im Benutzermenü mit dem aktiven Profilnamen findest du **Deine Übersicht**. Öffne auf schmalen Bildschirmen zuerst das Navigationsmenü.

## Das aktive Profil prüfen

Deine Übersicht gehört zum **aktiven Profil**, nicht zum gesamten Konto.

- Begrüßung und Benutzermenü zeigen den aktiven Profilnamen.
- Bei einem vollständigen Konto wechselst du unter **Deine Profile**. Die Übersicht ändert sich mit dem aktiven Profil.
- Ein Gastkonto hat ein Profil und kann dieselbe Übersichtsseite verwenden.
- Ein Eintrag kann bei einem Profil sichtbar sein, bei einem anderen desselben vollständigen Kontos jedoch fehlen.

Prüfe vor dem Erstellen, Anmelden, Abstimmen oder Übernehmen einer Aufgabe den Profilnamen, damit die Aktion der beabsichtigten Person zugeordnet wird.

## Die beiden Sammlungen verstehen

Deine Übersicht enthält zwei getrennte Sammlungen. Beide können Umfragen, Aktivitätenpläne, Packlisten, Fahrtenlisten und Veranstaltungen enthalten.

| Sammlung | Inhalt |
|---|---|
| **Deine Teilnahmen** | Einträge, an denen das aktive Profil teilnimmt. Wie eine Teilnahme entsteht, hängt von der Funktion ab, etwa durch Abstimmen, Anmeldung oder Übernahme einer Zuweisung. |
| **Verwaltbare Einträge** | Einträge, die dem aktiven Profil gehören oder denen es als Administrator hinzugefügt wurde. Aktionen richten sich nach seinen Berechtigungen; ein Administrator wird dadurch nicht zum Eigentümer. |

Ein Eintrag kann in beiden Sammlungen erscheinen, wenn das aktive Profil sowohl teilnimmt als auch verwaltet.

Veranstaltungen stehen zusammen mit unabhängigen Umfragen, Plänen und Listen in einem Kartenraster. Gehört ein verknüpfter Plan oder eine Liste zur selben Sammlung und zum selben Haupt- oder ausgeblendeten Bereich wie seine Veranstaltung, findest du ihn über **Verknüpfte Einträge anzeigen** dieser Veranstaltung. Jede Sammlung enthält nur deine relevanten verknüpften Einträge: Eine Veranstaltungsanmeldung fügt nicht automatisch alle zugehörigen Pläne und Listen zu **Deine Teilnahmen** hinzu.

Enthält eine Sammlung keine Karten, zeigt Surveyor eine dieser Meldungen:

- **Du nimmst derzeit nirgendwo teil** — Du nimmst noch nirgends teil.
- **Du hast noch keine verwaltbaren Einträge** — Du hast noch keine verwaltbaren Einträge.

In der Übersicht gibt es keine eigenen Schaltflächen zum Erstellen einzelner Funktionen. Verwende dafür das globale Menü **Neu**.

## Einen Eintrag finden

Jede Sammlung ist ein aufklappbarer Abschnitt mit einem Zähler für die Gesamtzahl. Hauptkarten und **Archiviert und ausgeblendet** haben jeweils eigene Suchfelder und **Filter**. Mit **Vorherige** und **Nächste** unter den Karten blätterst du. Karten sind alphabetisch nach Titel geordnet.

### Suchen

Verwende **Deine Teilnahmen durchsuchen** oder **Verwaltbare Einträge durchsuchen**. Die Suche unterscheidet nicht zwischen Groß- und Kleinschreibung und durchsucht:

- den Titel;
- die Beschreibung;
- den Eintragstyp.

Die Karten aktualisieren sich beim Tippen; alternativ wählst du **Suchen**. Die Suche umfasst spätere Seiten und verknüpfte Einträge noch nicht geöffneter Veranstaltungen.

### Nach Typ filtern

1. Wähle **Filter** in der betreffenden Sammlung.
2. Wähle einen dort vorhandenen Typ oder **Alle Typen**, um den Typfilter aufzuheben.

Die Typen heißen **Umfrage**, **Aktivitätsplan**, **Packliste**, **Fahrerliste** und **Veranstaltung**. Das Menü enthält die Typen des jeweiligen Haupt- oder ausgeblendeten Bereichs, einschließlich anderer Seiten und Einträge innerhalb von Veranstaltungskarten.

Suche und Typfilter wirken gemeinsam. **passende Einträge** zählt einzelne passende Einträge; **Karten 1–24 von …** zählt Karten im Raster. Eine Veranstaltungskarte kann zu mehreren passenden verknüpften Einträgen führen. Der Sammlungszähler zählt alle zugeordneten Einträge einschließlich **Archiviert und ausgeblendet**. Leere das Suchfeld und wähle **Alle Typen**, um wieder alle Ergebnisse eines Bereichs zu sehen.

Eine Veranstaltungskarte kann erscheinen, weil einer ihrer verknüpften Einträge passt, obwohl der Veranstaltungstitel nicht passt. Beim Filter **Packliste** kann **Verknüpfte Einträge anzeigen** etwa **3 von 8 passen** anzeigen. Öffne die Karte, um diese drei passenden Packlisten zu sehen. Die Suche nach dem Veranstaltungstitel macht nicht automatisch alle zugehörigen Einträge zu Treffern.

## Eine Karte lesen und öffnen

Eine Karte kann Folgendes zeigen:

- ein Kopfzeilenbild, sofern vorhanden;
- den Titel;
- eine verkürzte Beschreibung;
- ein Typabzeichen;
- **Archiviert**, unabhängig davon, ob die Karte im Hauptbereich steht;
- **Für mich ausgeblendet** oder **Für mich eingeblendet**, wenn du eine persönliche Sichtbarkeit gespeichert hast.

Wähle das Bild oder den Hauptbereich der Karte, um den Eintrag zu öffnen. Die Funktionsseite zeigt die für das aktive Profil verfügbaren Aktionen.

Auf Funktionsseiten sammeln **Entitätseinstellungen** die erlaubten Eigenschaften, Bild-, Freigabe-, Veranstaltungs-, Archivierungs- und weiteren Aktionen. Es erscheinen nur Aktionen des aktiven Profils. Gewöhnliche archivierte Ansichten zeigen **Dieser Eintrag ist archiviert.**; Erläuterungen für Organisatoren stehen im Dialog.

## Verknüpfte Einträge einer Veranstaltung öffnen

1. Suche die Veranstaltungskarte in der betreffenden Sammlung.
2. Wähle **Verknüpfte Einträge anzeigen**. Die Zahl zählt deine verknüpften Einträge in dieser Sammlung und diesem Haupt- oder ausgeblendeten Bereich.
3. Öffne eine verknüpfte Karte. Mit **Vorherige** und **Nächste** wechselst du bei mehreren Seiten.
4. Wähle **Zurück zur Übersicht**, um zum gemischten Kartenraster zurückzukehren.

Die Veranstaltung bildet nun die umschließende Karte und behält Bild, Titel und übliche Bedienelemente. Bild und Titel öffnen weiterhin die normale Veranstaltungsseite. Verknüpfte Karten behalten ihre eigenen Aktionen und Sichtbarkeitseinstellungen.

Suche und Typfilter gelten auch innerhalb der Veranstaltung. **Alle meine verknüpften Einträge anzeigen** löscht beide Filter, während die Veranstaltung geöffnet bleibt. Passt nur die Veranstaltung selbst zur Suche, kann ihre verknüpfte Ansicht zunächst leer sein; diese Aktion zeigt die anderen verknüpften Einträge. **Zurück zur Übersicht** behält die aktuellen Filter. Eine Filteränderung beginnt auf der ersten Seite; andernfalls wird die vorherige Übersichtsseite wiederhergestellt. Zurück und Vorwärts im Browser folgen deinem Navigationsverlauf.

Wenn du an einem untergeordneten Eintrag teilnimmst oder ihn verwaltest, seine Veranstaltung aber in dieser Sammlung oder diesem Bereich fehlt, bleibt er eine gewöhnliche Karte im gemischten Raster. Darfst du die Veranstaltung öffnen, liefert ein kleiner Veranstaltungslink den Zusammenhang. Allein wegen eines verknüpften Eintrags wird keine Ersatz-Veranstaltungskarte angelegt.

## Archivierte und ausgeblendete Einträge finden

1. Öffne **Deine Teilnahmen** oder **Verwaltbare Einträge**.
2. Klappe unter den Hauptkarten **Archiviert und ausgeblendet** auf.
3. Suche oder filtere dort und öffne den Eintrag wie gewohnt.

Bei einem normalen Besuch ist dieser Bereich geschlossen. Ein gespeicherter Übersichtslink kann ihn mit Suche, Filtern und ausgewählter Veranstaltung wieder öffnen. Er bleibt verfügbar, wenn alle Einträge archiviert oder ausgeblendet sind; der Hauptbereich erklärt dann, wo sie liegen. Archivierung erhält deinen bisherigen Zugriff und deine Aktionen. Der Verlust einer Teilnahme oder Verwaltungszuordnung kann einen Eintrag weiterhin aus der Übersicht entfernen.

## Einen Eintrag nur für dich aus- oder einblenden

Öffne das **Archivierung**-Menü einer Karte und verwende die Aktionen unter **Nur meine Übersicht**:

| Aktion | Ergebnis für das aktive Profil |
|---|---|
| **Für mich ausblenden** | Die Karte landet in **Archiviert und ausgeblendet**, unabhängig von der gemeinsamen Archivierung. |
| **Für mich einblenden** | Die Karte bleibt im Hauptbereich, auch wenn ein Organisator oder die Automatik sie archiviert. Das Archivabzeichen bleibt sichtbar. |
| **Standardsichtbarkeit verwenden** | Die persönliche Entscheidung wird entfernt: Aktive Einträge stehen im Hauptbereich, archivierte unter **Archiviert und ausgeblendet**. |

Deine Wahl gilt für beide Sammlungen und wird für das aktive Profil gespeichert, auch für Gäste. Andere Profile und Nutzer behalten ihre eigenen Einstellungen. Das Ausblenden einer Veranstaltung betrifft nur ihre Karte: Ihre sichtbaren Pläne und Listen werden gewöhnliche Karten im Hauptbereich. Ein ausgeblendeter Untereintrag erscheint nur dann innerhalb seiner Veranstaltung, wenn auch diese unter **Archiviert und ausgeblendet** steht; andernfalls bleibt er eine eigene ausgeblendete Karte. Ein mit **Für mich einblenden** sichtbar gehaltener Untereintrag bleibt auffindbar, während seine Veranstaltung archiviert oder ausgeblendet ist. **Aktivitäten und Listen** auf der Veranstaltungsseite zeigt weiterhin deren verknüpfte Einträge.

## Für alle archivieren oder wiederherstellen

Ein Eigentümer oder Organisator mit **Metadaten bearbeiten** kann im **Archivierung**-Menü unter **Für alle** **Für alle archivieren** oder **Für alle wiederherstellen** wählen. Alternativ öffnet er auf der Funktionsseite **Entitätseinstellungen** → **Aktionen** → **Archivierung**. Bei Umfragen hat nur der Eigentümer diese Bedienelemente. Bestätige die Aktion, wenn du dazu aufgefordert wirst.

Eine Veranstaltungsarchivierung archiviert sämtliche angehängten Einträge und Inhalte mit. Ihre Wiederherstellung hebt die geerbte Archivierung auf; eigenständig archivierte Untereinträge bleiben archiviert, bis sie separat wiederhergestellt werden. **Archivierung** in **Entitätseinstellungen** erläutert geerbte Archivierung und bietet gegebenenfalls **Veranstaltung öffnen**, wenn zuerst die Veranstaltung wiederhergestellt werden muss. Die Verwaltung eines Untereintrags erlaubt nicht automatisch die Wiederherstellung seiner Veranstaltung.

Du kannst einen bereits zusammen mit seiner Veranstaltung archivierten Untereintrag mit **Für alle archivieren** zusätzlich eigenständig archivieren. Er bleibt dann auch nach der Veranstaltungswiederherstellung archiviert. Die Bestätigung erklärt diese Wirkung.

Veranstaltungen und eigenständige Aktivitätenpläne können nach ihrem Enddatum und der konfigurierten Verzögerung automatisch archiviert werden. Ein verknüpfter Aktivitätenplan folgt dem Zeitplan seiner Veranstaltung. Die Wiederherstellung einer Veranstaltung oder eines eigenständigen Plans pausiert die Automatik, bis ein Organisator **Automatische Archivierung fortsetzen** wählt. Mit **Automatische Archivierung pausieren** kann er auch aktive Einträge vor automatischer Archivierung schützen. Nach dem Fortsetzen kann ein bereits beendeter Eintrag beim nächsten Durchlauf archiviert werden.

Archivierung erhält Anmeldungen, Antworten, Zuweisungen, Rechnungsdaten, Bilder, Belege und bestehende Berechtigungen. Sie löscht keine Dateien und verhindert keine gewöhnliche berechtigte Nutzung. Für Belegaufbewahrung und bewusstes Löschen gelten weiterhin die jeweiligen Regeln. Persönliche Sichtbarkeitseinstellungen überstehen gemeinsame Archivierung und Wiederherstellung.

## Eigentümeraktionen verwenden

In **Verwaltbare Einträge** können Karten diese Schaltflächen zeigen:

- **Duplizieren** öffnet ein Erstellungsformular auf Grundlage des Eintrags. Prüfe die kopierten Werte vor dem Anlegen; das Original bleibt unverändert.
- **Löschen** fragt **Diesen Gegenstand löschen?** und entfernt den Eintrag nach Bestätigung endgültig.

Diese Kartenschaltflächen erscheinen nur, wenn das aktive Profil Eigentümer ist. Ein Administrator ohne Eigentümerschaft kann die Karte öffnen, erhält dort aber kein **Duplizieren** oder **Löschen**. Weitere Verwaltungsaktionen hängen von der Funktion und ihren Zugriffsregeln ab.

Auf der Funktionsseite bietet **Entitätseinstellungen** → **Aktionen** zusätzlich **Duplizieren**, wenn das aktive Profil eines vollständigen Kontos **Daten duplizieren** besitzt, und **Endgültig löschen** für den Eigentümer. Dadurch kann ein delegiertes Profil duplizieren, ohne die Eigentümer-Schaltfläche auf der Karte zu sehen. Derselbe Dialog enthält erlaubte Exporte, soweit die Funktion sie unterstützt.

Ein Duplikat startet ohne eigenständige Archivierung, Automatikpause oder persönliche Sichtbarkeit des Originals. Unter einer archivierten Veranstaltung erbt es deren Archivierung. Alte Datumsangaben in einem neuen eigenständigen Plan oder einer Veranstaltung können die automatische Archivierung auslösen.

## Einen neuen Eintrag erstellen

Die Erstellung verlangt ein angemeldetes **vollständiges Konto** mit aktivem Profil. Gastkonten können an geteilten Einträgen teilnehmen, aber keine neuen anlegen. Das aktive Profil wird Eigentümer.

1. Prüfe das aktive Profil im Benutzermenü.
2. Öffne oben **Neu**.
3. Wähle den gewünschten Typ:

| Menügruppe | Eintrag |
|---|---|
| **Planen & entscheiden** | **Umfrage** |
| **Planen & entscheiden** | **Aktivitätsplan** |
| **Planen & entscheiden** | **Veranstaltung** |
| **Organisieren & teilen** | **Packliste** |
| **Organisieren & teilen** | **Fahrerliste** |

Surveyor öffnet das jeweilige Erstellungsformular. Nach erfolgreichem Absenden öffnet es den neuen Eintrag. Ohne Anmeldung mit einem vollständigen Konto führt der Aufruf zunächst zu **Anmelden**.

## Navigation auf einen Blick

| Beschriftung oben | Zweck |
|---|---|
| **Startseite** | Anwendungsstartseite öffnen. |
| **Neu** | Umfrage, Aktivitätenplan, Veranstaltung, Packliste oder Fahrtenliste beginnen. |
| **Übersicht** → **Deine Übersicht** | Zu Teilnahmen und verwaltbaren Einträgen des aktiven Profils zurückkehren. |
| **Hilfe** | Diese Anleitungen öffnen. |
| Aktiver Profilname | **Deine Übersicht**, **Profileinstellungen**, Profilverwaltung für vollständige Konten, Abmeldung und Kontolöschung öffnen. |

## Probleme lösen

### Ein erwarteter Eintrag fehlt

1. Prüfe den aktiven Profilnamen.
2. Leere in beiden Sammlungen das Suchfeld und wähle **Filter** → **Alle Typen**.
3. Prüfe **Deine Teilnahmen** und **Verwaltbare Einträge**.
4. Öffne **Verknüpfte Einträge anzeigen** auf der Veranstaltungskarte und prüfe weitere Seiten mit **Nächste**. Eine Suche nach dem fehlenden Titel findet ihn auch innerhalb einer Veranstaltung.
5. Klappe in jeder Sammlung **Archiviert und ausgeblendet** auf und entferne dort ebenfalls Filter.
6. Prüfe, ob das aktive Profil tatsächlich beigetreten ist, eine Zuweisung übernommen hat, angemeldet wurde oder Verwaltungszugriff erhalten hat.
7. Verwende als Gast den privaten Link der teilnehmenden Gastidentität oder stelle das richtige Gastkonto per E-Mail wieder her.

### Eine Übersichtsseite konnte nicht geladen werden

Wähle **Erneut versuchen** neben dem Fehler. Bist du nicht mehr angemeldet, melde dich erneut an und öffne **Deine Übersicht**. Hat sich während des Browsens eine Veranstaltung oder deine Mitgliedschaft geändert, kehrt Surveyor zur gültigen Übersicht zurück; verbleibende berechtigte Einträge bleiben verfügbar.

### Duplizieren oder Löschen fehlt

Diese Schaltflächen stehen auf **Verwaltbare Einträge**-Karten nur dem aktiven Eigentümerprofil zur Verfügung. Administratorrechte ohne Eigentümerschaft fügen sie nicht hinzu. Prüfe das Profil und öffne dann den Eintrag für seine funktionsspezifischen Verwaltungsaktionen.

### Beide Sammlungen sind leer

Mit einem vollständigen Konto kannst du über **Neu** einen Eintrag anlegen. Für eine Teilnahme öffnest du den Link des Organisators und führst die jeweilige Teilnahmeaktion aus. Gäste benötigen eine Einladung oder einen privaten Gastlink und können nichts neu erstellen.

## Weitere Anleitungen

- [Erste Schritte](GETTING_STARTED.md) — Konten, Gastwiederherstellung und Profilwechsel
- [Umfragen](SURVEYS.md)
- [Veranstaltungen](EVENTS.md)
- [Packlisten](PACKING_LISTS.md)
- [Aktivitätenpläne](ACTIVITY_PLANS.md)
- [Fahrtenlisten](DRIVERS_LISTS.md)
