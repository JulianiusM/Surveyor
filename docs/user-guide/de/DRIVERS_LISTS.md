# Fahrgemeinschaftslisten
<!--
documentation-metadata
audience: Fahrer; Mitfahrer; Transportorganisatoren
owner: drivers-list feature maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Reviewed pilot-language content at its fixed release-owned source; article bodies, declared anchors and image bytes preserved during promotion.
source-anchors: docs/user-guide/en/DRIVERS_LISTS.md
heading-anchors: 1:drivers-lists; 2:choose-your-task; 2:understand-drivers-rides-and-assignments; 2:open-and-read-a-drivers-list; 3:read-the-driver-table; 2:take-a-passenger-place; 3:remove-yourself-from-a-ride; 2:offer-a-ride; 3:correct-the-displayed-driver-name; 2:open-a-list-as-a-guest; 2:understand-the-counters; 3:counter-examples; 2:create-a-drivers-list; 3:1-open-the-creation-form; 3:2-enter-the-list-details; 3:3-review-sharing-before-creation; 3:4-create-and-test-the-list; 2:manage-list-content; 3:edit-the-list-title-or-description; 2:manage-ride-offers; 3:edit-a-ride-description; 3:change-passenger-capacity; 3:reorder-rides; 3:remove-another-passenger; 3:delete-a-ride-offer; 2:manage-the-header-image; 2:link-a-drivers-list-to-an-event; 2:configure-sharing-and-permissions; 3:privacy-before-sharing; 2:duplicate-or-delete-a-drivers-list; 3:duplicate-a-list; 3:delete-a-complete-list; 2:capabilities-and-limits; 2:practical-examples; 3:separate-outbound-and-return-journeys; 3:several-departure-times; 3:event-transport; 2:archive-or-restore-a-list; 2:troubleshooting; 3:add-new-item-is-missing; 3:the-wrong-driver-name-appears; 3:take-is-missing-or-does-not-work; 3:an-event-linked-list-says-registration-is-required; 3:the-participant-number-seems-too-low; 3:the-list-is-missing-from-your-overview; 3:i-cannot-edit-or-remove-another-person-s-row-or-assignment; 3:a-capacity-change-would-leave-too-many-passengers; 2:related-guides
next-review: drivers-visible-UI-or-behavior-change
production-reference: 2dfa257 native frontend documentation; not an installed production commit
-->

Fahrgemeinschaftslisten koordinieren Fahrtangebote und Mitfahrplätze. Jede Zeile ist ein Fahrtangebot des aktiven Profils, das sie erstellt hat. Andere Teilnehmer können einen freien Mitfahrplatz übernehmen.

> **Fahrernamen stammen aus Profilen.** Unter **Driver** steht der Name des Profils, das die Zeile hinzugefügt hat. Dieses Feld lässt sich in der Fahrgemeinschaftsliste nicht bearbeiten. Ist der angezeigte Name falsch, ändern Sie den Profilnamen unter **Profile settings**.

> **Beschreibungen und Namen sind gemeinsam sichtbar.** Alle Personen mit Zugang zur Liste sehen Fahrernamen, Mitfahrernamen und Fahrtbeschreibungen. Tragen Sie private Telefonnummern, E-Mail-Adressen, Wohnadressen oder andere sensible Angaben nur dann in eine Beschreibung ein, wenn alle zugelassenen Betrachter sie sehen dürfen.

## Wählen Sie Ihre Aufgabe

- [Einen Mitfahrplatz übernehmen](#take-a-passenger-place)
- [Sich aus einer Fahrt austragen](#remove-yourself-from-a-ride)
- [Eine Fahrt anbieten](#offer-a-ride)
- [Eine Liste als Gast öffnen](#open-a-list-as-a-guest)
- [Die Zähler verstehen](#understand-the-counters)
- [Eine Fahrgemeinschaftsliste erstellen](#create-a-drivers-list)
- [Fahrtangebote bearbeiten, sortieren oder löschen](#manage-ride-offers)
- [Eine Liste mit einer Veranstaltung verknüpfen](#link-a-drivers-list-to-an-event)
- [Berechtigungen einrichten](#configure-sharing-and-permissions)
- [Eine Liste duplizieren oder löschen](#duplicate-or-delete-a-drivers-list)
- [Probleme mit einer Fahrgemeinschaftsliste lösen](#troubleshooting)

## Fahrer, Fahrten und Zuweisungen verstehen

Eine Fahrgemeinschaftsliste enthält drei miteinander verbundene Arten von Informationen:

| Information | Bedeutung |
|---|---|
| Fahrgemeinschaftsliste | Gemeinsamer Titel, Beschreibung, optionale Veranstaltung, Bild und Berechtigungen. |
| Fahrerzeile | Ein von einem Profil erstelltes Fahrtangebot mit gemeinsamer Beschreibung und Mitfahrkapazität. |
| Zuweisung | Ein Profil übernimmt einen Mitfahrplatz in einer Fahrerzeile. |

Ein Fahrer kann mehrere Zeilen für unterschiedliche Abfahrtszeiten, Strecken, Teilstrecken oder Fahrzeuge hinzufügen. Derselbe Profilname erscheint dann in jeder dieser Zeilen. Ein Fahrer wird nicht automatisch als Mitfahrer seiner eigenen Zeile zugewiesen und belegt keinen der Mitfahrplätze.

Ein Mitfahrer kann mehrere Zeilen übernehmen. Das ist sinnvoll, wenn die Zeilen unterschiedliche Teilstrecken darstellen. Sind die Zeilen Alternativen für dieselbe Fahrt, entfernen Sie nach der Auswahl einer anderen Fahrt die bisherige Zuweisung.

## Eine Fahrgemeinschaftsliste öffnen und lesen

Öffnen Sie den vom Organisator bereitgestellten Link, wählen Sie die Liste in einer Veranstaltung aus oder öffnen Sie sie über [Ihre Übersicht](DASHBOARD.md).

- Mit einem aktiven Profil öffnet Surveyor eine eigenständige Liste direkt.
- Ohne aktives Profil führt eine eigenständige Liste zur Gastanmeldung.
- Eine mit einer Veranstaltung verknüpfte Liste setzt normalerweise eine Anmeldung zu dieser Veranstaltung voraus. Öffnen Sie zuerst die Veranstaltung und melden Sie sich dort an. Ein Nichtteilnehmer mit aktivem Profil erhält nur dann Zugang, wenn die Liste ihm die wirksame Berechtigung **Access View** gewährt.

Prüfen Sie das aktive Profil im Benutzermenü. Fahrtangebote und Mitfahrzuweisungen gehören diesem Profil, nicht dem vollständigen Benutzerkonto insgesamt.

### Die Fahrertabelle lesen

| Spalte | Bedeutung |
|---|---|
| **Driver** | Profilname der Person, die das Fahrtangebot erstellt hat. |
| **Description** | Gemeinsam sichtbare Angaben zu Fahrzeug, Strecke, Treffpunkt, Abfahrt, Gepäck oder Barrierefreiheit. |
| **Assignees** | Profilnamen der Mitfahrer, die **Take** gewählt haben. |
| **Assigned / Max** | Aktuelle Mitfahrzuweisungen und maximale Anzahl der Mitfahrplätze. |
| **Action** | **Take**, **Remove**, **Full** und die für das aktive Profil verfügbaren Organisatorfunktionen. |

**Max #** ist die Anzahl der Mitfahrplätze ohne Fahrer. Ein Auto für einen Fahrer und drei Mitfahrer erhält beispielsweise **Max #** `3`.

## Einen Mitfahrplatz übernehmen

Für eine Zeile mit einem freien Platz:

1. Prüfen Sie Fahrer, Beschreibung, Treffpunkt und Abfahrtsangaben.
2. Wählen Sie **Take**.
3. Prüfen Sie, ob der Name des aktiven Profils unter **Assignees** erscheint.
4. Prüfen Sie, ob sich **Assigned / Max** erhöht.

Sobald die maximale Anzahl erreicht ist, zeigt die Zeile **Full** und kein weiterer Teilnehmer kann sie übernehmen. Für das Übernehmen oder Entfernen Ihrer eigenen Zuweisung benötigen Sie die wirksame Berechtigung **Access View**.

### Sich aus einer Fahrt austragen

1. Suchen Sie die Zeile, der das aktive Profil zugewiesen ist.
2. Wählen Sie in der Spalte **Action** die Schaltfläche **Remove**.
3. Prüfen Sie, ob der Profilname verschwindet und der Zähler sinkt.

Das kleine **×** neben einem zugewiesenen Namen ist eine separate Funktion für Fahrer oder Organisatoren, um eine andere Person zu entfernen. Mitfahrer sollten normalerweise ihre eigene Schaltfläche **Remove** verwenden.

Fahrer oder Mitfahrer finden eine Liste unter **Your participation**, nachdem das aktive Profil eine Fahrt angeboten oder einen Mitfahrplatz übernommen hat. Eigentümer und beauftragte Administratoren finden sie außerdem unter **Administrable entities**.

## Eine Fahrt anbieten

Ein Profil benötigt die wirksame Berechtigung **Item Add**, damit **Add new item** angezeigt wird. Das Öffnen der Liste oder eine Anmeldung zur verknüpften Veranstaltung allein berechtigt noch nicht zum Hinzufügen einer Fahrerzeile.

1. Öffnen Sie die Fahrgemeinschaftsliste mit dem Profil, das als Fahrer erscheinen soll.
2. Suchen Sie unterhalb der Tabelle **Add new item**.
3. Prüfen Sie das schreibgeschützte Feld **Driver**. Es zeigt den Namen des aktiven Profils.
4. Tragen Sie unter **Description** die nicht vertraulichen organisatorischen Angaben ein, die Teilnehmer benötigen.
5. Setzen Sie **Max #** auf die Anzahl der Mitfahrplätze, als ganze Zahl von mindestens 1.
6. Wählen Sie **Add**.

Die neue Zeile erscheint mit diesem Profil als Eigentümer. Eine hilfreiche Beschreibung kann enthalten:

- Ausgangsort oder Treffpunkt;
- Ziel oder Teilstrecke;
- Abfahrtsdatum und -zeit;
- Fahrzeugbeschreibung;
- Einschränkungen bei Gepäck oder Barrierefreiheit; und
- einen öffentlich sichtbaren Koordinationshinweis.

Nutzen Sie für persönliche Kontaktdaten einen privaten Kommunikationskanal. Surveyor bietet kein privates Kontaktfeld und keine Direktnachrichten zwischen Fahrer und Mitfahrern.

### Den angezeigten Fahrernamen korrigieren

Die Spalte **Driver** lässt sich nicht in der Liste bearbeiten, weil sie das Profil bezeichnet, dem die Zeile gehört.

- Um den angezeigten Namen dieses Profils überall zu ändern, öffnen Sie das Profilmenü und wählen **Profile settings**.
- Hat das falsche Profil die Zeile erstellt, löschen Sie die Zeile, wechseln zum gewünschten Profil und legen das Fahrtangebot erneut an.

Eine Änderung des Profilnamens wirkt überall, wo Surveyor dieses Profil anzeigt. Es handelt sich nicht um einen Spitznamen nur für diese Liste.

## Eine Liste als Gast öffnen

Gastfunktionen richten sich nach Zugang und Berechtigungen, nicht allein nach dem Gaststatus.

Für eine eigenständige Liste:

1. Öffnen Sie die Einladung zur Fahrgemeinschaftsliste.
2. Wählen Sie **Continue as guest**, wenn kein Profil aktiv ist.
3. Geben Sie einen Anzeigenamen und möglichst eine E-Mail-Adresse ein.
4. Bewahren Sie den von Surveyor gesendeten oder angezeigten privaten Gastlink auf.
5. Nutzen Sie die für dieses Gastprofil freigegebenen Funktionen.

Öffnen Sie bei einer mit einer Veranstaltung verknüpften Liste zuerst die Veranstaltungseinladung und melden Sie das Gastprofil zur Veranstaltung an. Öffnen Sie anschließend die Fahrgemeinschaftsliste aus der Veranstaltung. Eine gezielte Berechtigung **Access View** für die Liste kann einem bereits aktiven Nichtteilnehmerprofil bewusst Zugang geben.

Ein Gast mit **Access View** kann seinen eigenen Mitfahrplatz übernehmen oder entfernen. Eine Fahrt anbieten darf ein Gast nur, wenn seine wirksamen Berechtigungen zusätzlich **Item Add** enthalten. Der Eigentümer einer Fahrerzeile kann nach ihrer Erstellung die eigene Zeile verwalten. Siehe [Erste Schritte — Gastzugang per E-Mail wiederherstellen](GETTING_STARTED.md#recover-guest-access-by-email), [Veranstaltungen](EVENTS.md) und [Berechtigungen und Freigaben](PERMISSIONS.md).

## Die Zähler verstehen

Oben auf der Seite stehen vier unterschiedliche Kennzahlen:

- **Participants** — unterschiedliche Profile, die mindestens einer Fahrerzeile zugewiesen sind. Ein Fahrer, der ausschließlich eine Fahrt anbietet, zählt nicht mit. Derselbe Mitfahrer wird auch bei mehreren zugewiesenen Zeilen nur einmal gezählt.
- **Drivers** — Anzahl der Fahrerzeilen, nicht der unterschiedlichen Personen. Ein Profil mit drei Fahrtangeboten trägt drei Zeilen bei.
- **open** — Fahrerzeilen mit mindestens einem verbleibenden Mitfahrplatz.
- **empty** — Fahrerzeilen ohne Mitfahrzuweisungen.

Diese Werte beantworten unterschiedliche Fragen. **Participants** ist weder die Anzahl der Fahrerzeilen noch die Anzahl aller einzelnen Zuweisungen oder die gesamte Mitfahrkapazität.

### Beispiele für die Zähler

| Zustand der Liste | Participants | Drivers | Erklärung |
|---|---:|---:|---|
| Drei Fahrtangebote ohne Mitfahrer | 0 | 3 | Reine Fahrerzeilen erhöhen die Teilnehmerzahl nicht. |
| Eine Person übernimmt zwei unterschiedliche Zeilen | 1 | 2 | Die zugewiesene Person wird über die gesamte Liste nur einmal gezählt. |
| Zwei verschiedene Personen übernehmen jeweils eine Zeile | 2 | 2 | Jede unterschiedliche zugewiesene Person zählt einmal. |
| Ein Fahrer übernimmt zusätzlich einen Platz in einer Zeile | 1 | Mindestens 1 | Das Profil zählt wegen seiner Mitfahrzuweisung, nicht wegen seiner Rolle als Fahrer. |

## Eine Fahrgemeinschaftsliste erstellen

Das Erstellen setzt ein angemeldetes vollständiges Benutzerkonto voraus. Ein Gast darf bei entsprechender Berechtigung teilnehmen, aber keine Liste erstellen. Das aktive Profil wird Eigentümer.

### 1. Das Erstellungsformular öffnen

1. Öffnen Sie **New** in der oberen Navigation.
2. Wählen Sie unter **Organize & share** den Eintrag **Drivers list**.

Ein Veranstaltungsorganisator mit **Manage Assignments** für die Veranstaltung kann stattdessen das **Event administration dashboard** öffnen, **Event drivers lists** aufklappen und **Create new drivers list** wählen. Die Veranstaltung ist dann vorausgewählt.

### 2. Die Listendetails eingeben

| Feld | Eingabe |
|---|---|
| **Title \*** | Ein erforderlicher Name, den Teilnehmer wiedererkennen. |
| **Description (optional)** | Gemeinsam sichtbare allgemeine Hinweise, gemeinsame Treffpunktangaben oder der Umfang des Transports. |
| **Header image (optional)** | Optionales JPEG-, PNG- oder GIF-Bild bis 10 MiB. |
| **Assign to event (optional)** | Eine Veranstaltung, mit der das aktuelle Profil die Liste verknüpfen darf, einschließlich vergangener oder archivierter Veranstaltungen; für eine eigenständige Liste **No event** wählen. |
| **Group Permissions** | Anfängliche Zielgruppenberechtigungen der neuen Liste. |

Das Erstellungsformular legt keine Fahrerzeilen an. Erstellen Sie zuerst die Liste, geben Sie der gewünschten Zielgruppe **Item Add** und lassen Sie jeden Fahrer sein Fahrtangebot unter dem richtigen aktiven Profil hinzufügen.

### 3. Die Freigaben vor dem Erstellen prüfen

Fahrgemeinschaftslisten verwenden das allgemeine kumulative Berechtigungssystem. Die normale Voreinstellung ohne Veranstaltung gewährt der Zielgruppe Public grundlegenden Zugriff, enthält aber kein **Item Add**. Legen Sie vor dem Teilen des Links fest, wer Fahrten anbieten darf.

Bei einer mit einer Veranstaltung verknüpften Liste ist **Item Add** für die Zielgruppe Participant eine übliche Möglichkeit, Fahrtangebote auf angemeldete Veranstaltungsteilnehmer zu beschränken. Andere Regeln sind möglich; siehe [Berechtigungen und Freigaben](PERMISSIONS.md).

### 4. Die Liste erstellen und prüfen

1. Wählen Sie **Create list**.
2. Fügen Sie mit dem vorgesehenen Fahrerprofil ein Testangebot hinzu.
3. Öffnen Sie den Link mit einem Teilnehmer- oder Testprofil.
4. Prüfen Sie, ob Seitenzugang, **Take**, **Remove** und **Add new item** den gewählten Berechtigungen entsprechen.
5. Entfernen Sie die Testdaten, sobald sie nicht mehr gebraucht werden.

## Den Listeninhalt verwalten

### Den Listentitel oder die Beschreibung bearbeiten

Ein berechtigter Bearbeiter sieht im Listenkopf **Entity settings**. Der Dialog enthält nur die Felder und Aktionen, die das aktive Profil verwenden darf.

1. Öffnen Sie **Entity settings**.
2. Ändern Sie unter **General** → **Details** die verfügbaren Felder **Title** oder **Description**.
3. Wählen Sie **Save properties**.

Die Titelbearbeitung erfordert **Edit Title**, die Beschreibung **Edit Desc**. Die Beschreibung auf der normalen Seite ist schreibgeschützt. Bei einem fehlgeschlagenen Speichern bleibt Ihr Entwurf erhalten; Schließen verwirft ungespeicherte Änderungen. Jeder Abschnitt wird separat gespeichert. Befehle, die die Seite neu laden, verlangen zunächst eine Entscheidung über Entwürfe in anderen Abschnitten.

## Fahrtangebote verwalten

### Eine Fahrtbeschreibung bearbeiten

Der Zeileneigentümer oder ein anderes Profil mit der erforderlichen Elementberechtigung kann auf **Description** doppelklicken, die gemeinsam sichtbaren Angaben ändern und mit **Enter** oder einem Klick außerhalb speichern. **Escape** bricht die Änderung ab.

### Die Mitfahrkapazität ändern

Der Zeileneigentümer oder ein berechtigter Bearbeiter kann den Maximalwert unter **Assigned / Max** doppelklicken, eine ganze Zahl von mindestens 1 eingeben und mit **Enter** oder einem Klick außerhalb speichern. **Escape** bricht die Änderung ab.

Senken Sie die Höchstzahl nicht unter die sichtbare Anzahl zugewiesener Mitfahrer. Entfernen oder verschieben Sie zuerst Mitfahrer und reduzieren Sie danach die Kapazität.

### Fahrten neu sortieren

Ein Profil mit **Item Edit** kann Zeilen in eine neue Reihenfolge ziehen. So lassen sich Fahrten nach Teilstrecke, Abfahrtszeit, Ausgangsort oder Ziel gruppieren.

### Einen anderen Mitfahrer entfernen

Der Eigentümer einer Fahrerzeile oder ein Profil mit **Manage Assignments** sieht neben jedem Mitfahrernamen ein kleines **×**. Wählen Sie es, um diese Zuweisung zu entfernen. Das Mitfahrerprofil und seine Veranstaltungsanmeldung werden dadurch nicht gelöscht.

### Ein Fahrtangebot löschen

Der Zeileneigentümer oder ein Profil mit **Item Delete** sieht eine Papierkorbschaltfläche.

1. Wählen Sie die Papierkorbschaltfläche.
2. Bestätigen Sie **Delete this driver permanently?**.

Das Löschen entfernt dieses Fahrtangebot und alle zugehörigen Mitfahrzuweisungen dauerhaft. Die Profile von Fahrer und Mitfahrern bleiben erhalten.

## Das Titelbild verwalten

Ein Profil mit **Edit Meta** kann **Entity settings** → **General** → **Header image** öffnen. Wählen Sie **Choose image**, eine Datei und anschließend **Upload**, um das Bild hinzuzufügen oder zu ersetzen. Zum Löschen wählen Sie **Remove image** und bestätigen.

Der Upload akzeptiert JPEG-, PNG- und GIF-Bilder bis 10 MiB. Beim Ersetzen oder Entfernen wird das bisherige Bild dauerhaft gelöscht.

## Eine Fahrgemeinschaftsliste mit einer Veranstaltung verknüpfen

Verwenden Sie beim Erstellen **Assign to event (optional)**, wenn der Transport zu einer Veranstaltung gehört.

Eine verknüpfte Liste:

- erscheint unter **Event drivers lists**;
- zeigt im Kopf **Go to event**;
- lässt normalerweise für diese Veranstaltung angemeldete Profile zu;
- verlangt von Nichtteilnehmern die wirksame listenbezogene Berechtigung **Access View**; und
- wird zusammen mit der Veranstaltung gelöscht, weil sie zu deren gespeicherten Daten gehört.

Beim Erstellen aus der Veranstaltungsverwaltung ist diese Veranstaltung vorausgewählt. Die Auswahl enthält berechtigte vergangene Veranstaltungen sowie solche nach Ablauf der Frist oder im Archiv. Verwenden Sie die Text-, Datums- und Zustandsfilter oder **No event**; [Eine Veranstaltung auswählen](EVENTS.md#choose-an-event) erklärt die gemeinsamen Bedienelemente. Bei der Auswahl einer archivierten Veranstaltung zeigt der Auswahldialog die Auswirkung auf die Archivierung.

Nach dem Erstellen öffnen Sie **Entity settings** → **Linked event**, wählen eine andere Veranstaltung oder **No event** und anschließend **Save event link**; bestätigen Sie die Änderung. Dafür benötigen Sie **Edit Meta** auf der Liste und **Manage Assignments** auf einer ausgewählten Zielveranstaltung. Zum Aufheben der Verknüpfung ist keine Berechtigung für eine Zielveranstaltung erforderlich.

Eine geänderte Verknüpfung erhält Fahrten, Mitfahrzuweisungen, Bild, persönliche Übersichtseinstellungen und die unabhängige Archivierung. Der von der Veranstaltung abgeleitete Zugang folgt der neuen Beziehung. Die Verknüpfung mit einer archivierten Veranstaltung fügt geerbte Archivierung hinzu; beim Aufheben entfällt diese Vererbung, eine unabhängig archivierte Liste wird dadurch aber nicht wiederhergestellt. Vorhandene Mitfahrer werden nicht automatisch zur Zielveranstaltung angemeldet.

Die Veranstaltungsanmeldung regelt den Zugang zur verknüpften Seite. Die Berechtigungen der Fahrgemeinschaftsliste steuern davon getrennt Aktionen wie Platzübernahme, Fahrtangebote, Inhaltsbearbeitung, Entfernen von Zuweisungen und Berechtigungsverwaltung.

## Freigaben und Berechtigungen einrichten

Ein Profil mit **Manage Permissions** kann **Entity settings** öffnen, **Access** wählen und **Group Permissions** oder benannte **Administrators** bearbeiten. Berechtigungen addieren sich; der Eigentümer hat immer vollständigen Zugriff.

Häufige Aktionen auf Fahrgemeinschaftslisten verwenden diese Berechtigungen:

| Ziel | Erforderliche Berechtigung oder Eigentümerschaft |
|---|---|
| Eine verknüpfte Liste ohne Veranstaltungsanmeldung öffnen | **Access View** |
| Den eigenen Mitfahrplatz übernehmen oder entfernen | **Access View** |
| Den Listentitel bearbeiten | **Edit Title** |
| Die gemeinsame Listenbeschreibung bearbeiten | **Edit Desc** |
| Das Titelbild hinzufügen, ersetzen oder entfernen | **Edit Meta** |
| Die Veranstaltungsverknüpfung ändern oder aufheben | **Edit Meta**, zusätzlich **Manage Assignments** auf einer ausgewählten Zielveranstaltung |
| Ein Fahrtangebot hinzufügen | **Item Add** |
| Zeilen sortieren und untergeordnete Zeilen umfassend bearbeiten | **Item Edit** |
| Nur eine Fahrtbeschreibung bearbeiten | **Item Edit Desc** |
| Eine Fahrerzeile löschen | Zeileneigentümer oder **Item Delete** |
| Einen anderen Mitfahrer entfernen | Zeileneigentümer oder **Manage Assignments** |
| Zielgruppen- oder Administratorrechte ändern | **Manage Permissions** |
| Den Duplizierungsablauf öffnen | **Data Duplicate** |

Wer eine Fahrt erstellt, macht das aktive Profil zum Eigentümer dieser Zeile. Der Fahrer kann deshalb seine eigene Zeile verwalten, auch wenn er nicht die ganze Liste administriert.

Siehe [Berechtigungen und Freigaben](PERMISSIONS.md) zu überlappenden Zielgruppen, individuellen Rechten, Voreinstellungen, Berechtigungsweitergabe vom übergeordneten Element, benannten Administratoren und dem Unterschied zwischen Seitenzugang und Aktionsberechtigungen.

### Datenschutz vor dem Teilen

Alle Personen mit Zugang zur Seite sehen:

- Titel und Beschreibung der Fahrgemeinschaftsliste;
- jeden Fahrerprofilnamen;
- jede Fahrtbeschreibung;
- jeden zugewiesenen Mitfahrerprofilnamen; und
- die sichtbare Kapazität und Anzahl der Zuweisungen.

Es gibt keine nur für Organisatoren sichtbare Mitfahrerspalte, keine anonymen Zuweisungen, privaten Fahrtangaben oder Direktnachrichten. Nutzen Sie für Telefonnummern, genaue Wohnadressen, Gesundheitsinformationen und andere sensible Absprachen einen externen privaten Kanal.

## Eine Fahrgemeinschaftsliste duplizieren oder löschen

### Eine Liste duplizieren

Das Duplizieren erfordert ein vollständiges Benutzerkonto und **Data Duplicate**. Beginnen Sie bei **Entity settings** der Liste:

1. Öffnen Sie die Fahrgemeinschaftsliste und wählen Sie **Entity settings**.
2. Wählen Sie unter **Actions** die Aktion **Duplicate**.
3. Prüfen Sie den vorausgefüllten Titel, die Beschreibung und **Group Permissions**.
4. Wählen Sie bei Bedarf **Assign to event (optional)** für die neue Liste.
5. Wählen Sie **Create list**.
6. Bitten Sie die Fahrer, passende Fahrtangebote unter ihren eigenen aktiven Profilen erneut anzulegen.

Die Kopie ist eine eigenständige Liste. Fahrerzeilen, Mitfahrzuweisungen, die bisherige Veranstaltungsverknüpfung und das Titelbild werden nicht kopiert. Prüfen Sie vor dem Erstellen alle Felder, statt davon auszugehen, dass die Kopie die alte Veranstaltung oder Freigabegrenze übernimmt.

Eigentümer können auch **Duplicate** auf ihrer Übersichtskarte unter **Administrable entities** verwenden.

### Eine vollständige Liste löschen

Nur der Listeneigentümer kann die vollständige Fahrgemeinschaftsliste löschen.

1. Öffnen Sie die Fahrgemeinschaftsliste und wählen Sie **Entity settings**.
2. Wählen Sie unter **Actions** die Aktion **Delete permanently**.
3. Bestätigen Sie die Löschung.

Die Übersichtskarte des Eigentümers bietet weiterhin **Delete**.

Das Löschen entfernt die Liste, sämtliche Fahrerzeilen und Mitfahrzuweisungen sowie das gespeicherte Titelbild dauerhaft. Eine Wiederherstellung aus dem Archiv kann eine Löschung nicht rückgängig machen. Archivieren Sie, wenn die Liste erhalten bleiben soll. Eine verknüpfte Liste wird auch beim Löschen ihrer Veranstaltung entfernt.

## Funktionen und Grenzen

| Unterstützt | Nicht angeboten |
|---|---|
| Mehrere Fahrtangebote pro Fahrerprofil | Automatische Zuordnung von Fahrern und Mitfahrern |
| Gemeinsame Angaben zu Strecke, Zeit, Treffpunkt, Fahrzeug, Gepäck und Barrierefreiheit | Karten, Navigation oder Entfernungsberechnung |
| Selbstständige Mitfahrzuweisungen mit Kapazitätsgrenze | Wartelisten oder automatische Neuzuweisungen |
| Veranstaltungsbezogene und eigenständige Listen | Wiederkehrende Fahrerrotation oder Zeitplanerstellung |
| Funktionen für Zeileneigentümer und beauftragte Organisatoren | Private Kontaktfelder oder Direktnachrichten |
| Titelbilder, Duplizieren, Archivieren, Wiederherstellen und endgültiges Löschen | Berechnung von Fahrtkosten oder Export |

## Praktische Beispiele

### Getrennte Hin- und Rückfahrten

Ein Fahrer kann **Freitag — Bahnhof zum Camp** und **Sonntag — Camp zum Bahnhof** als zwei Zeilen hinzufügen. Mitfahrer übernehmen jede benötigte Teilstrecke. Derselbe Mitfahrer in beiden Zeilen zählt unter **Participants** einmal und erzeugt zwei einzelne Zuweisungen.

### Mehrere Abfahrtszeiten

Fügen Sie für jedes Fahrzeug und jede Abfahrtszeit eine Zeile hinzu. Beginnen Sie jede Beschreibung mit Ausgangsort, Ziel und Uhrzeit und sortieren Sie die Zeilen anschließend chronologisch.

### Veranstaltungstransport

Erstellen Sie die Liste über **Event drivers lists**, geben Sie angemeldeten Teilnehmern die benötigten Aktionen frei und halten Sie persönliche Kontaktdaten in einem vereinbarten privaten Kanal. Die Veranstaltungsanmeldung lässt Teilnehmer zur verknüpften Liste zu; deren Berechtigungen steuern das Erstellen von Fahrten und die Zuweisungen.

## Eine Liste archivieren oder wiederherstellen

Ein Eigentümer oder Organisator mit **Edit Meta** kann **Entity settings** → **Actions** → **Archival** öffnen und **Archive for everyone** oder **Restore for everyone** verwenden. Die Archivierung erhält Fahrten, Mitfahrzuweisungen, Bilder sowie bestehende Zugänge und Aktionen. Fahrgemeinschaftslisten haben kein eigenes Datum für automatische Archivierung; eine verknüpfte Liste erbt die Archivierung ihrer Veranstaltung. Die gewöhnliche Ansicht zeigt gegebenenfalls nur **This entity is archived.**.

Wird die Archivierung von der Veranstaltung geerbt, erklärt der Dialog, dass diese zuerst wiederhergestellt werden muss, und bietet bei entsprechender Berechtigung **Open event** an. Eine separat archivierte Liste bleibt archiviert, wenn ihre Veranstaltung wiederhergestellt wird. Archivierte Listen finden Sie unter **Archived and hidden** in [Ihrer Übersicht](DASHBOARD.md#find-archived-and-hidden-items). **Hide for me**, **Show for me** und **Use default visibility** ändern nur die Einordnung in der Übersicht des aktiven Profils.

## Problemlösung

### **Add new item** fehlt

Dem aktiven Profil fehlt die wirksame Berechtigung **Item Add**. Veranstaltungsanmeldung und Seitenzugang allein gewähren sie nicht. Bitten Sie den Listeneigentümer oder ein Profil mit **Manage Permissions**, die Einstellungen unter **Access** zu prüfen.

### Der falsche Fahrername erscheint

Prüfen Sie das aktive Profil im Benutzermenü. Der Name stammt aus dem Profil, das die Zeile erstellt hat. Ändern Sie den Anzeigenamen dieses Profils unter **Profile settings**, oder löschen Sie die Zeile und legen Sie sie mit dem gewünschten Profil erneut an.

### **Take** fehlt oder funktioniert nicht

Prüfen Sie, ob:

- die Zeile bereits **Full** ist;
- das aktive Profil bereits zugewiesen ist und **Remove** verwenden sollte;
- die veranstaltungsbezogene Liste eine Anmeldung voraussetzt; oder
- das Profil die wirksame Berechtigung **Access View** hat.

### Eine verknüpfte Liste verlangt eine Veranstaltungsanmeldung

Melden Sie das aktive Profil zur Veranstaltung an, oder bitten Sie einen Organisator um listenbezogenes **Access View**, wenn Nichtteilnehmer bewusst Zugang erhalten sollen. Ein Profilwechsel kann sowohl die Veranstaltungsanmeldung als auch Berechtigungen ändern.

### Die Teilnehmerzahl erscheint zu niedrig

**Participants** zählt ausschließlich unterschiedliche zugewiesene Mitfahrer. Ein Fahrer zählt nicht allein wegen seines Fahrtangebots mit; ein Mitfahrer in mehreren Zeilen wird nur einmal gezählt. **Drivers** zeigt die Anzahl der Fahrtzeilen, und der jeweilige Wert **Assigned / Max** zeigt deren Kapazität.

### Die Liste fehlt in **Your overview**

Prüfen Sie das aktive Profil.

Klappen Sie **Archived and hidden** in beiden Übersichtsbereichen auf und entfernen Sie dort gesetzte Filter.

- Eigentümer und beauftragte Administratoren finden die Liste unter **Administrable entities**.
- Fahrer oder Mitfahrer finden sie unter **Your participation**, nachdem sie eine Fahrt angeboten oder einen Platz übernommen haben.
- Das bloße Öffnen des Links erzeugt keine Teilnahme.

### Ich kann die Zeile oder Zuweisung einer anderen Person nicht bearbeiten oder entfernen

Eine Fahrtzeile gehört dem Profil, das sie erstellt hat. Das Verwalten einer anderen Zeile erfordert die entsprechende Listen- oder Elementberechtigung. Bitten Sie den Eigentümer oder ein Profil mit **Manage Permissions**, nur die benötigten Fähigkeiten freizugeben.

### Eine Kapazitätsänderung würde zu viele Mitfahrer zurücklassen

Entfernen oder verschieben Sie zuerst genügend Mitfahrer. Setzen Sie **Max #** danach auf eine ganze Zahl von mindestens 1, die nicht unter der sichtbaren Anzahl von Zuweisungen liegt.

## Verwandte Anleitungen

- [Erste Schritte](GETTING_STARTED.md) — Konten, Gäste, Wiederherstellung und aktive Profile.
- [Ihre Übersicht](DASHBOARD.md) — Listen mit eigener Beteiligung und Verwaltungszugriff finden.
- [Berechtigungen und Freigaben](PERMISSIONS.md) — Vollständige Freigabebeispiele und Berechtigungsreferenz.
- [Veranstaltungen](EVENTS.md) — Veranstaltungsanmeldung und verknüpfte Ressourcen.
- [Startseite der Benutzerhilfe](README.md) — Alle Funktionsanleitungen.
