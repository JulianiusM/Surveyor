# Aktivitätspläne
<!--
documentation-metadata
audience: Aktivitätsteilnehmer; Aktivitätsorganisatoren
owner: activity-plan maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Reviewed pilot-language content at its fixed release-owned source; article bodies, declared anchors and image bytes preserved during promotion.
source-anchors: docs/user-guide/en/ACTIVITY_PLANS.md
heading-anchors: 1:activity-plans; 2:choose-your-task; 3:i-am-participating; 3:i-am-organizing; 2:before-you-begin; 2:participate-in-an-activity-plan; 3:find-a-slot; 3:join-a-whole-slot; 3:take-a-named-role; 3:leave-a-slot-or-role; 3:understand-assignment-warnings; 3:use-shared-text-fields; 2:organize-an-activity-plan; 3:create-an-activity-plan; 3:understand-the-tabs; 3:change-plan-properties; 3:link-change-or-remove-an-event; 3:add-and-edit-slots; 4:add-a-slot-after-creation; 4:edit-a-slot; 3:add-named-roles-to-a-slot; 3:manage-role-assignments; 3:review-participants; 3:configure-basic-assignment-rules; 3:change-permissions-and-administrators; 3:export-the-schedule; 2:advanced-requirements-and-assignment-recommendations; 3:set-participant-requirements; 4:understand-which-requirement-wins; 3:check-requirement-coverage; 3:generate-assignment-suggestions; 3:review-generated-suggestions; 3:stage-a-manual-assignment-change; 3:save-and-apply-the-review; 3:advanced-limitations; 2:archive-or-restore-a-plan; 2:troubleshooting; 3:i-see-registration-required; 3:join-or-take-is-unavailable; 3:a-slot-does-not-appear-under-open-slots; 3:i-joined-the-wrong-profile; 3:i-cannot-edit-slots-roles-participants-rules-settings-or-exports; 3:my-changes-in-rules-and-auto-assign-were-lost; 3:auto-generate-is-disabled; 3:requirement-coverage-says-the-configuration-is-incomplete; 3:recommendation-generation-became-stale-or-failed; 3:a-participant-still-needs-shifts-after-generation; 3:an-approved-change-was-not-applied; 2:related-guides
next-review: activity-plan-visible-UI-or-behavior-change
production-reference: 2dfa257 native frontend documentation; not an installed production commit
-->

Aktivitätspläne stellen Zeitfenster in einem datierten Ablaufplan bereit. Teilnehmer können einem vollständigen Zeitfenster beitreten oder eine benannte Rolle übernehmen. Organisatoren können Zeitfenster erstellen, Zuweisungen verwalten und den Plan mit einer Veranstaltung verknüpfen.

## Wählen Sie Ihre Aufgabe

### Ich nehme teil

- [Ein Zeitfenster finden](#find-a-slot)
- [Einem Zeitfenster beitreten](#join-a-whole-slot)
- [Eine benannte Rolle übernehmen](#take-a-named-role)
- [Ein Zeitfenster oder eine Rolle verlassen](#leave-a-slot-or-role)
- [Zuweisungswarnungen verstehen](#understand-assignment-warnings)
- [Ein gemeinsames Textfeld bearbeiten](#use-shared-text-fields)

### Ich organisiere

- [Einen Aktivitätsplan erstellen](#create-an-activity-plan)
- [Planeigenschaften ändern](#change-plan-properties)
- [Eine Veranstaltung verknüpfen, ändern oder entfernen](#link-change-or-remove-an-event)
- [Zeitfenster hinzufügen oder bearbeiten](#add-and-edit-slots)
- [Benannte Rollen hinzufügen](#add-named-roles-to-a-slot)
- [Rollenzuweisungen korrigieren](#manage-role-assignments)
- [Teilnehmer prüfen](#review-participants)
- [Grundlegende Zuweisungsregeln festlegen](#configure-basic-assignment-rules)
- [Teilnahmeanforderungen festlegen](#set-participant-requirements)
- [Die Abdeckung der Anforderungen prüfen](#check-requirement-coverage)
- [Zuweisungsvorschläge erzeugen und prüfen](#generate-assignment-suggestions)
- [Manuelle Korrekturen vormerken](#stage-a-manual-assignment-change)
- [Den Ablaufplan exportieren](#export-the-schedule)

## Bevor Sie beginnen

Der Name im Benutzermenü bezeichnet Ihr aktives Profil. Teilnahme, Eigentümerschaft und Zuweisungen gehören zu diesem Profil. Unter [Erste Schritte](GETTING_STARTED.md#understand-accounts-and-profiles) erfahren Sie, wie Sie das Profil wechseln oder einen Gastzugang wiederherstellen.

Ein Plan kann unabhängig sein oder einer Veranstaltung zugeordnet werden. Bei einem verknüpften Plan benötigen Sie normalerweise eine Anmeldung zu dieser Veranstaltung, bevor Sie Zeitfenstern beitreten können. Ein Organisator kann stattdessen **Allow non-participants to take slots** aktivieren. Unter Umständen dürfen Sie einen verknüpften Plan ansehen, aber nicht beitreten. Dann zeigt der Ablaufplan **Registration required** und einen erklärenden Hinweis oberhalb der Filter.

Ihre sichtbaren Aktionen richten sich nach den Freigabeeinstellungen des Plans. [Berechtigungen und Freigaben](PERMISSIONS.md) erklärt Zielgruppenberechtigungen und den Zugriff beauftragter Organisatoren.

## An einem Aktivitätsplan teilnehmen

### Ein Zeitfenster finden

Öffnen Sie den Plan und bleiben Sie auf der Registerkarte **Schedule**. Der Ablaufplan ist nach Woche und Tag gegliedert. Jedes Zeitfenster kann Folgendes zeigen:

- Titel, optionale Anfangs- und Endzeit sowie optionale Beschreibung.
- Benannte Rollen, etwa Moderation oder Hilfe.
- Die Anzahl der zugewiesenen Personen im Verhältnis zu **Max participants**.
- Einen Statuspunkt: **Overbooked**, **No assignments yet** oder **OK**.
- Teilnehmernamen, wenn Sie sie sehen dürfen.

Verwenden Sie die Filter des Ablaufplans:

- **All slots** zeigt den vollständigen Ablaufplan.
- **My slots** zeigt Zeitfenster, die Ihrem aktiven Profil zugewiesen sind.
- **Open slots** zeigt Zeitfenster mit verbleibender regulärer Kapazität. Volle Zeitfenster erscheinen hier auch dann nicht, wenn der Organisator eine Teilnahme über die Kapazität hinaus erlaubt.

Die Zusammenfassung oberhalb des Kalenders zeigt **Participants**, **Slots**, offene und unbesetzte Zeitfenster. Ein unbesetztes Zeitfenster hat derzeit keine Teilnehmer; es ist deshalb nicht unbedingt gesperrt.

Bei vorgeschriebener Teilnahme zeigt eine Nachricht oberhalb der Filter Ihren Fortschritt, beispielsweise **You participate in 1 of 2 required slots. Take 1 more.** Im freien Modus gibt es keine Mindestanzahl.

### Einem vollständigen Zeitfenster beitreten

Verwenden Sie **Join**, wenn Sie am Zeitfenster teilnehmen möchten, ohne eine bestimmte benannte Position auszuwählen.

1. Suchen Sie das Zeitfenster unter **Schedule**.
2. Prüfen Sie Zeit, Beschreibung, Kapazität und gegebenenfalls benannte Rollen.
3. Wählen Sie **Join**.
4. Lesen Sie angezeigte **Assignment warnings**.
5. Wählen Sie **Continue anyway** nur, wenn Sie alle Warnungen verstanden haben und akzeptieren.

Ihr aktives Profil wird dem Zeitfenster hinzugefügt, und die Aktion wechselt zu **Leave**.

Ist ein Zeitfenster voll, ersetzt **Full** die normale Aktion. Hat der Organisator Zuweisungen über die Kapazität hinaus aktiviert, erscheint stattdessen **Full — join anyway**. Vor der Zuweisung müssen Sie dabei immer die Kapazitätswarnung bestätigen.

### Eine benannte Rolle übernehmen

Eine benannte Rolle ist eine Position innerhalb eines Zeitfensters. Jede angezeigte Rolle kann von einem zugewiesenen Teilnehmer besetzt werden.

1. Suchen Sie die Rolle unter dem Zeitfenster.
2. Wählen Sie neben der Rolle **Take**.
3. Lesen und bestätigen Sie gegebenenfalls **Assignment warnings**.

Wenn Sie noch nicht zugewiesen waren, treten Sie mit der Rollenübernahme auch dem Zeitfenster bei. Die Rolle zeigt danach Ihr Profil und bietet Ihnen **Leave** an.

Eine benannte Rolle erhöht die Gesamtkapazität des Zeitfensters nicht. Der Organisator legt diese über **Max participants** und die verfügbaren Positionen über **Roles for this slot** fest.

### Ein Zeitfenster oder eine Rolle verlassen

Es gibt zwei unterschiedliche Aktionen **Leave**:

- **Leave** im Fußbereich des Zeitfensters entfernt Ihre vollständige Zuweisung einschließlich aller dort übernommenen benannten Rollen.
- **Leave** neben einer benannten Rolle gibt nur diese Rolle frei. War die Rolle der einzige Grund für Ihre Zuweisung, wird auch die Zeitfensterzuweisung entfernt. Waren Sie dem Zeitfenster separat beigetreten, bleiben Sie ohne diese Rolle zugewiesen.

Nach der **Binding deadline** des Plans können Teilnehmer Zeitfenstern und Rollen nicht mehr selbst beitreten oder sie verlassen. Ein Organisator mit Berechtigung zur Zuweisungsverwaltung kann weiterhin notwendige Korrekturen vornehmen.

### Zuweisungswarnungen verstehen

Surveyor kann vor einem Beitritt oder einer Rollenübernahme warnen. Der Dialog **Assignment warnings** kann unter anderem auf Folgendes hinweisen:

- Das Zeitfenster liegt außerhalb Ihrer Anwesenheitstage bei der Veranstaltung oder des erlaubten Ankunfts- beziehungsweise Abreisezeitraums.
- Es überschneidet sich mit einer Ihrer Zuweisungen oder einem aktiven Vorschlag, auch in anderen Aktivitätsplänen derselben Veranstaltung.
- Sie würden über die Kapazität des Zeitfensters hinaus beitreten.

Pläne derselben Veranstaltung werden automatisch gemeinsam geprüft. Jeder Plan behält seine eigenen Anforderungen und Fortschrittswerte. Wenn Sie Einzelheiten des anderen Plans nicht sehen dürfen, kann die Warnung allgemein formuliert sein. Die Prüfung setzt vollständige, überlappende Zeitintervalle am selben Tag voraus. Zeitfenster, die sich nur an ihren Endpunkten berühren, überschneiden sich nicht.

Wählen Sie **Cancel**, um bestehende Zuweisungen unverändert zu lassen. Besprechen Sie einen Konflikt mit dem Organisator, bevor Sie bei beabsichtigter Überschneidung **Continue anyway** wählen. Ändern sich die betroffenen Zuweisungen während des geöffneten Dialogs, müssen Sie die aktualisierte Warnung erneut prüfen und bestätigen. Eine Warnung ist kein Fehler: Eine Bindungsfrist, eine erforderliche Veranstaltungsanmeldung oder deaktivierte Überbelegung können die Aktion vollständig blockieren.

### Gemeinsame Textfelder verwenden

**Shared text fields** stehen oberhalb der Registerkarten. Organisatoren können darin Hinweise für den gesamten Plan hinterlegen, etwa Treffpunkte, Ausrüstungsangaben oder kurzfristige Anweisungen. Der **Text** jedes Feldes darf bis zu 16.000 Zeichen enthalten.

Wenn eine Stiftschaltfläche verfügbar ist:

1. Wählen Sie den Stift oder doppelklicken Sie auf den Feldtext.
2. Bearbeiten Sie **Text**.
3. Wählen Sie **Save**.

Ein Benutzer mit Berechtigung zur Regelverwaltung kann außerdem **Add text field** wählen, **Title** und **Text** eingeben und das Feld später umbenennen oder löschen. Der Text wird gemeinsam bearbeitet. Tragen Sie dort deshalb keine Geheimnisse oder Informationen ein, die die Betrachter des Plans nicht bearbeiten dürfen sollen.

## Einen Aktivitätsplan organisieren

### Einen Aktivitätsplan erstellen

Das Erstellen setzt ein angemeldetes vollständiges Benutzerkonto voraus. Das aktive Profil wird Eigentümer. Gäste können an einem freigegebenen Plan teilnehmen, aber keinen erstellen.

1. Öffnen Sie **New** in der oberen Navigation.
2. Wählen Sie unter **Plan & decide** den Eintrag **Activity plan**.
3. Füllen Sie die Planfelder aus:
   - **Title \*** — der Name des Plans.
   - **Start date \*** und **End date \*** — der vollständige Kalenderzeitraum. Geben Sie nur das Anfangsdatum ein, verwendet Surveyor es zunächst auch als Enddatum. Das Enddatum darf nicht vor dem Anfangsdatum liegen.
   - **Description (optional)** — bis zu 16.000 Zeichen.
   - **Header image (optional)** — JPEG, PNG oder GIF, bis 10 MiB.
   - **Assign to event (optional)** — verbindet Anmeldung, Anwesenheit, Teilnehmer und erweiterte Zuweisungsfunktionen mit einer Veranstaltung.
4. Prüfen Sie **Group Permissions**. Diese regeln, wer den Plan ansehen, teilnehmen, bearbeiten, verwalten oder exportieren darf. Siehe [Berechtigungen und Freigaben](PERMISSIONS.md).
5. Fügen Sie nach Auswahl des Datumsbereichs mindestens ein anfängliches Zeitfenster im Kalender hinzu:
   - Wählen Sie beim richtigen Tag **+ Slot**.
   - Geben Sie den **Title** ein.
   - Geben Sie optional **Description**, **Start time** und **End time** ein.
   - Setzen Sie **Max participants** auf eine ganze Zahl von mindestens 1.
6. Wählen Sie **Create plan**.

Jedes Zeitfenster muss innerhalb des Datumsbereichs des Plans liegen. Sind beide Uhrzeiten gesetzt, muss die Endzeit nach der Anfangszeit liegen.

Anfängliche Zeitfenster haben noch keine benannten Rollen. Fügen Sie diese nach dem Erstellen im Zeitfenstereditor hinzu.

### Die Registerkarten verstehen

Registerkarten erscheinen nur, wenn sie für den Plan und Ihren Zugriff zutreffen:

| Registerkarte | Zweck | Wann sie erscheint |
|---|---|---|
| **Schedule** | Zeitfenster ansehen, beitreten oder verlassen sowie Zeitfenster verwalten. | Immer. |
| **Participants** | Angaben zu Zuweisungen, Anforderungen, Anwesenheit und Rollen prüfen. | Wenn Teilnehmerdaten vorliegen und Sie **Access Participants** haben. |
| **Rules & auto-assign** | Veranstaltungsbezogene Zuweisungsregeln festlegen und mit entsprechender Berechtigung Zuweisungsvorschläge bearbeiten. | Bei einem verknüpften Plan für Organisatoren mit Regel- oder Zuweisungsverwaltung. |

Die Planbeschreibung steht oberhalb von **Shared text fields**. Zum Ändern öffnen Sie **Entity settings** im Kopf. Der Dialog zeigt ausschließlich die für Ihr aktives Profil verfügbaren Einstellungen und Aktionen.

### Planeigenschaften ändern

1. Öffnen Sie den Plan und wählen Sie **Entity settings**.
2. Öffnen Sie unter **General** den Bereich **Details** für **Title** und **Description** oder **Dates and time** für **Start date** und **End date**. Es erscheinen nur erlaubte Felder.
3. Wählen Sie **Save properties**.

Titel, Beschreibung und Datumswerte haben getrennte Bearbeitungsrechte. Der Datumsbereich muss weiterhin alle vorhandenen Zeitfenster einschließen. Eine Datumsänderung verschiebt oder entfernt keine Zeitfenster oder Zuweisungen. Zeitfensterbearbeitung und **Rules & auto-assign** bleiben separate Aufgaben.

Jeder Dialogabschnitt wird separat gespeichert. Schließen verwirft einen ungespeicherten Entwurf. Ein Befehl, der die Seite neu laden würde, fordert zuerst eine Entscheidung über Entwürfe in anderen Abschnitten. Bei fehlgeschlagenem Speichern bleibt Ihre Eingabe für Korrekturen erhalten.

Öffnen Sie unter **General** den Bereich **Header image**, wählen Sie **Choose image** und dann **Upload**, um ein JPEG-, PNG- oder GIF-Bild bis 10 MiB hinzuzufügen oder zu ersetzen. **Remove image** löscht das aktuelle Bild nach Bestätigung. Unter **Actions** öffnet **Duplicate** das Erstellungsformular für einen neuen Plan. **Delete permanently** ist nur für den Eigentümer verfügbar und entfernt nach Bestätigung den Plan samt Inhalt. Archivieren Sie, wenn der Plan verfügbar bleiben soll.

### Eine Veranstaltung verknüpfen, ändern oder entfernen

Verwenden Sie beim Erstellen **Assign to event (optional)**. Für einen vorhandenen Plan:

1. Öffnen Sie **Entity settings** → **Linked event**.
2. Suchen und wählen Sie eine Veranstaltung, oder wählen Sie **No event** für einen eigenständigen Plan.
3. Prüfen Sie die Auswirkungen auf Zugang und Archivierung, wählen Sie **Save event link** und bestätigen Sie.

Eine Änderung erfordert **Edit Meta** auf dem Plan. Die Auswahl einer Veranstaltung verlangt zusätzlich **Manage Assignments** auf dieser Veranstaltung. Vergangene Veranstaltungen, solche mit abgelaufener Anmeldefrist und archivierte Veranstaltungen sind bei entsprechender Berechtigung auswählbar. [Eine Veranstaltung auswählen](EVENTS.md#choose-an-event) erklärt die gemeinsame Suche und ihre Filter.

Aktivitätspläne derselben Veranstaltung teilen automatisch ihre Überschneidungsprüfungen. Das Verknüpfen, Ändern oder Entfernen der Veranstaltung ändert sofort, welche Pläne gemeinsam geprüft werden. Archivierte oder persönlich ausgeblendete Pläne tragen weiterhin ihre gespeicherten Verpflichtungen bei.

Der Plan behält Zeitfenster, Rollen, Zuweisungen, Regeln, Bilder und seinen direkten Archivzustand. Von der Veranstaltung abgeleiteter Zugang und Teilnehmerberechtigungen folgen der neuen Veranstaltung. Prüfen Sie deshalb vor dem Wechsel die Zugangsregeln. Vorhandene Zuweisungen melden Personen nicht automatisch zur Zielveranstaltung an.

Erzeugte ausstehende Vorschläge aus dem alten Kontext werden entfernt. Manuelle Entwürfe und geprüfte Historie bleiben erhalten; geprüfte Änderungen werden vor der Anwendung gegen die neue Teilnehmerberechtigung geprüft. Kontrollieren Sie Anforderungen und erzeugen Sie neue Vorschläge für die neue Veranstaltung. Beim Aufheben der Verknüpfung sind veranstaltungsabhängige Werkzeuge nicht mehr verfügbar, und es gilt wieder die eigene automatische Archivierung des Plans. Ein bereits beendeter Plan kann dadurch zur Archivierung anstehen. Eine archivierte Zielveranstaltung fügt geerbte Archivierung hinzu. Ein unabhängig archivierter Plan bleibt beim Aufheben der Verknüpfung archiviert.

### Zeitfenster hinzufügen und bearbeiten

#### Nach dem Erstellen ein Zeitfenster hinzufügen

1. Öffnen Sie **Schedule**.
2. Wählen Sie beim gewünschten Datum **+ Slot**.
3. Füllen Sie unter **Create slot** Folgendes aus:
   - **Title**.
   - **Start time** und **End time**, wenn das Zeitfenster feste Uhrzeiten hat.
   - **Max participants**, mindestens 1.
   - **Description**, wenn Teilnehmer weitere Angaben benötigen.
   - **Roles for this slot**, wenn benannte Positionen benötigt werden.
4. Wählen Sie **Save**.

#### Ein Zeitfenster bearbeiten

Wählen Sie den Stift am Zeitfenster, um **Edit slot** zu öffnen. Ändern Sie dieselben Felder und wählen Sie **Save**. Abhängig von Ihren Elementberechtigungen können Sie Titel oder Beschreibung auch zur schnellen Bearbeitung doppelklicken.

Wenn **Drag slots to reorder** angezeigt wird, können Sie Zeitfenster innerhalb eines Tages durch Ziehen neu sortieren. Mit der Papierkorbschaltfläche löschen Sie ein Zeitfenster. Dabei werden auch dessen Zuweisungen entfernt; prüfen Sie vorher die betroffenen Teilnehmer.

### Benannte Rollen zu einem Zeitfenster hinzufügen

Unter **Create slot** oder **Edit slot**:

1. Wählen Sie das Suchfeld **Roles for this slot**.
2. Tippen Sie, um eine vorhandene Rolle des Plans zu finden.
3. Wählen Sie den Rollenvorschlag. Bei entsprechender Berechtigung können Sie mit **Create new role “…”** einen neuen Rollennamen hinzufügen.
4. Wiederholen Sie dies für jede unterschiedliche benötigte Position dieses Zeitfensters.
5. Entfernen Sie vor dem Speichern nicht benötigte Rollenmarkierungen.
6. Wählen Sie **Save**.

Der Rolleneditor enthält nur Rollennamen. Es gibt keine Felder für Fähigkeiten, Qualifikationen oder Stückzahlen je Rolle. Jede ausgewählte Rolle steht für genau eine benannte Position im Zeitfenster. Die Gesamtkapazität bestimmen Sie mit **Max participants**.

Verwenden Sie eindeutige Rollennamen, aus denen Teilnehmer ihre Aufgabe erkennen. Qualifikationen, Vorbereitung oder benötigte Ausrüstung gehören in **Description** des Zeitfensters oder in ein gemeinsames Textfeld.

### Rollenzuweisungen verwalten

Mit **Manage role assignments** kann ein Organisator korrigieren, wer eine benannte Position hält, ohne die gesamte Zeitfensterzuweisung zu ändern.

1. Stellen Sie sicher, dass der Teilnehmer dem Zeitfenster bereits zugewiesen ist. Verwenden Sie gegebenenfalls zuerst den normalen Beitritt oder eine Zuweisungsfunktion für Organisatoren.
2. Wählen Sie am Zeitfenster **Manage role assignments**.
3. Wählen Sie für jede **Role** einen **Participant**, oder lassen Sie die Position mit **-- None --** offen.
4. Wählen Sie **Save changes**.

Die Auswahllisten enthalten nur aktuell diesem Zeitfenster zugewiesene Teilnehmer. Um jemanden vollständig aus dem Zeitfenster zu entfernen, verwenden Sie die Entfernen-Funktion neben seinem Namen, statt nur seine benannte Rolle zu leeren.

### Teilnehmer prüfen

Öffnen Sie **Participants**, um eine Zeile je relevantem Profil zu sehen. Verknüpfte Pläne können angemeldete Veranstaltungsteilnehmer ohne bisherige Zuweisung einschließen. Eigenständige Pläne können Profile einschließen, die einem Zeitfenster beigetreten sind.

Verwenden Sie **Search participant…** oder die Filter:

- **All**
- **Assigned**
- **Unassigned**
- **Not started**
- **Needs slots**
- **Complete**
- **No minimum**

Die Spalten zeigen **Participant**, **Assignments**, **Requirement**, **Attendance** und **Roles**. Im freien Modus steht in der Anforderungsspalte **No minimum**. Im Pflichtmodus zeigt sie den Fortschritt zur aktuellen Mindestanforderung des Teilnehmers.

Anwesenheits- und Anforderungsangaben sind vor allem bei einem einer Veranstaltung zugeordneten Plan sinnvoll. Behandeln Sie diese Ansicht als Teilnehmerinformationen und geben Sie **Access Participants** nur Personen, die sie sehen sollen.

### Grundlegende Zuweisungsregeln festlegen

Bei einem verknüpften Plan können berechtigte Organisatoren **Rules & auto-assign** öffnen. D07 beschreibt die Einstellungen, die unmittelbar die tägliche Teilnahme betreffen:

- **Assignment mode** — **Free** bedeutet keine Mindestanzahl an Zeitfenstern; **Required** aktiviert Teilnahmeanforderungen.
- **Binding deadline** — nach diesem Zeitpunkt können Teilnehmer nicht mehr selbst beitreten oder verlassen.
- **Allow assignments beyond slot capacity** — stellt für die allgemeine Zeitfensterteilnahme **Full — join anyway** und die Kapazitätswarnung bereit.
- **Allow non-participants to take slots** — lässt Profile mit Planzugang ohne Veranstaltungsanmeldung beitreten.
- **Allow arrival-day evening assignments** und **Allow departure-day morning assignments** — erlauben gegebenenfalls diese Ausnahmen an Ankunfts- und Abreisegrenzen.

Wählen Sie vor dem Verlassen der Registerkarte **Save settings** oder **Save requirement settings**. Für einen Pflichtteilnahmeplan fahren Sie mit [Teilnahmeanforderungen festlegen](#set-participant-requirements), [Abdeckung prüfen](#check-requirement-coverage) und [Zuweisungsvorschläge erzeugen](#generate-assignment-suggestions) fort.

### Berechtigungen und Administratoren ändern

Öffnen Sie **Entity settings** und wählen Sie **Access**, um **Group Permissions** und beauftragte Administratoren zu bearbeiten. Dieser Bereich erscheint nur mit **Manage Permissions**. Die Zuweisungsregeln des Plans bleiben unter **Rules & auto-assign**.

Der Eigentümer behält immer vollständigen Zugriff. Ein beauftragter Organisator benötigt die konkreten Rechte für seine Aufgaben. Ein Eintrag als Administrator gewährt nicht automatisch jede Fähigkeit. Siehe [Berechtigungen und Freigaben](PERMISSIONS.md#delegate-a-limited-organizer).

### Den Ablaufplan exportieren

Mit **Data Export**:

1. Öffnen Sie **Entity settings**.
2. Wählen Sie **Export schedule**.
3. Eine druckfreundliche Seite öffnet sich in einer neuen Browserregisterkarte.
4. Wählen Sie **Print**, um sie zu drucken oder über den Druckdialog des Browsers als PDF zu speichern.

Der Export enthält Titel und Datumsbereich des Plans, gegebenenfalls verknüpfte Veranstaltung und Zeitzone, Summenzähler, Planbeschreibung, gemeinsame Notizen, Zeitfenster, Uhrzeiten, Beschreibungen, zugewiesene Teilnehmer und benannte Rollen. Er bildet die Daten zum Erstellungszeitpunkt ab. Erstellen Sie nach geänderten Zuweisungen einen neuen Export.

Teilnehmernamen und Zuweisungen können personenbezogene Informationen sein. Teilen Sie exportierte Kopien nur mit den vorgesehenen Empfängern und löschen Sie veraltete Kopien entsprechend den Regeln Ihrer Organisation.

## Fortgeschritten: Anforderungen und Zuweisungsvorschläge

Der erweiterte Ablauf ist nur für einen einer Veranstaltung zugeordneten Aktivitätsplan verfügbar. Unter **Rules & auto-assign** ist er in drei sichtbare Schritte gegliedert:

1. **Configure rules & defaults**.
2. **Check coverage**.
3. **Generate & apply suggestions**.

Ein beauftragter Organisator benötigt **Manage Requirements** für die ersten beiden und **Manage Assignments** für den dritten Schritt. Geben Sie zusätzlich **Access Participants**, wenn diese Person Teilnehmernamen und detaillierten Teilnehmerstatus sehen muss. Diese Berechtigungen addieren sich; siehe [Berechtigungen und Freigaben](PERMISSIONS.md).

Schließen Sie vor automatischen Vorschlägen die Veranstaltungsanmeldungen und Anwesenheitsdaten ab, fügen Sie Zeitfenster und Kapazitäten hinzu, setzen Sie verlässliche Uhrzeiten und ergänzen Sie benannte Rollen. Die automatische Erzeugung verwendet den gespeicherten Plan und die gespeicherten Anforderungen, keine ungespeicherten Entwurfswerte.

### Teilnahmeanforderungen festlegen

Öffnen Sie **Rules & auto-assign** und verwenden Sie **Step 1 — Configure rules & defaults**. Die Karte **Requirement settings** enthält gespeicherten Zuweisungsmodus, Frist, Ausnahmen an Anwesenheitsgrenzen und Anforderungstabellen.

1. Wählen Sie unter **Assignment mode** den Wert **Required**. **Free** lässt die Teilnahme freiwillig, zeigt **No minimum** und deaktiviert **Auto-generate**.
2. Setzen Sie **Binding deadline**, wenn Teilnehmer ihre eigenen Zuweisungen ab einem Zeitpunkt nicht mehr ändern sollen.
3. Prüfen Sie die Schalter für Überbelegung, Nichtteilnehmer und Ausnahmen an Ankunfts- und Abreisegrenzen.
4. Erstellen Sie die Tabelle **Stay duration requirements**:
   - Geben Sie unter **Baseline shift requirement** eine nicht negative ganze Zahl ein.
   - Wählen Sie unter **Rounding mode** **Ceil**, **Round** oder **Floor**. Bei **None** verwendet **Calculate** Aufrundung.
   - Wählen Sie **Calculate**, um für jede mögliche Anzahl von Anwesenheitstagen einen proportionalen Entwurf einzutragen.
   - Passen Sie Zeilen an, die eine andere genaue Anzahl erforderlicher Schichten verwenden sollen.
5. Geben Sie unter **Role requirements** für Rollen, die das normale aufenthaltsbezogene Ziel ändern sollen, ein genaues Schichtziel für den gesamten Teilnehmer ein.
6. Wählen Sie unter **Participant overrides** **Add override**, wenn ein angemeldeter Veranstaltungsteilnehmer ein anderes Ziel benötigt. Wählen Sie den Teilnehmer, beschränken Sie die Ausnahme optional auf eine derzeit von ihm gehaltene Rolle und geben Sie die genaue Anzahl erforderlicher Schichten ein.
7. Wählen Sie **Save requirement settings**. **Calculate** und die laufende Vorschau speichern den Entwurf nicht.

Der Pflichtmodus benötigt für jede Aufenthaltsdauer von einem Tag bis zur gesamten Planlänge eine gespeicherte nicht negative ganze Zahl. Überschneidet sich die Veranstaltungsanwesenheit eines Teilnehmers nicht mit dem Plan, erhält er ein Ziel von null.

#### Welche Anforderung Vorrang hat

Surveyor bestimmt für jeden Teilnehmer ein gesamtes Schichtziel. Es gilt die erste zutreffende Quelle in dieser Reihenfolge:

| Priorität | Quelle |
|---:|---|
| 1 | Eine rollenspezifische Teilnehmerausnahme für eine aktuell gehaltene Rolle. Treffen mehrere zu, gilt die niedrigste geforderte Schichtzahl. |
| 2 | Eine teilnehmerweite Ausnahme ohne Rolle. |
| 3 | Der niedrigste passende Wert unter **Role requirements** für eine aktuell gehaltene Rolle. |
| 4 | Der genaue gespeicherte Wert unter **Stay duration requirements** für die Anwesenheitsdauer des Teilnehmers. |

Null ist ein gültiges Ziel und führt nicht zur nächsten Quelle. Rollenanforderungen und Ausnahmen setzen das vollständige Teilnehmerziel. Sie werden weder zum Aufenthaltsziel addiert noch mit der Anzahl passender Rollen multipliziert.

**Reload** stellt die zuletzt gespeicherte Konfiguration wieder her. Beim Neuladen oder Verlassen der Seite fragt Surveyor nach, bevor es einen ungespeicherten Anforderungsentwurf verwirft.

### Die Abdeckung der Anforderungen prüfen

**Step 2 — Check coverage** aktualisiert sich während der Bearbeitung von Schritt 1, noch vor dem Speichern. Die Statuskarte kennzeichnet die Vorschau als **Saved** oder **Unsaved changes** und vergleicht **Required shifts** mit der gesamten **Slot capacity**.

Die wichtigsten Zustände bedeuten:

| Status | Bedeutung |
|---|---|
| **Free assignment mode** | Die Abdeckungsprüfung für Pflichtteilnahme ist inaktiv. |
| **Exact coverage** | Die Summe der Teilnehmerziele entspricht der gesamten Kapazität. |
| **Above slot capacity by _N_** | Anforderungen überschreiten die normale Kapazität, Überbelegung ist jedoch erlaubt. Das ist zulässig, eine genaue Abdeckung bleibt vorzuziehen. |
| **Short of slot capacity by _N_** | Bei erlaubter Überbelegung bleibt Kapazität durch Anforderungen ungedeckt. Erhöhen Sie Anforderungen, wenn jeder Platz abgedeckt sein soll. |
| **Hard slot capacity exceeded by _N_** | Anforderungen überschreiten die Kapazität, während Überbelegung deaktiviert ist. Senken Sie Anforderungen oder fügen Sie Kapazität hinzu. |
| **Below hard slot capacity by _N_** | Ein Teil der Kapazität bleibt außerhalb der Teilnehmerziele. Das ist zulässig, bedeutet aber, dass nicht jeder Platz verpflichtend ist. |
| **Invalid or incomplete requirements** | Eine erforderliche Aufenthaltszeile oder ein anderer Wert fehlt oder ist ungültig. Korrigieren Sie dies vor der Vorschlagserzeugung. |
| **Role quotas exceed slot capacity** | Die eingerichteten benannten Rollen passen nicht in die Kapazität eines oder mehrerer Zeitfenster. Erhöhen Sie die Kapazität oder reduzieren Sie die betroffenen Rollen. |

Bei offenen benannten Rollen kann die Karte außerdem **Open roles modeled** oder **Open roles unfillable** anzeigen. Das ist nur eine Abdeckungsschätzung. Zur Bewertung der Summen kann Surveyor einen ansonsten nicht zugewiesenen Teilnehmer hypothetisch einer offenen Rolle zuordnen. Dadurch wird weder diese Rolle besetzt noch der Ablaufplan geändert.

Die Abdeckung vergleicht die Zahl erforderlicher Schichten mit den verfügbaren Plätzen. Sie garantiert nicht, dass sich alle Personen zuweisen lassen. Auch bei passenden Summen können wegen Anwesenheitsdaten, überschneidender Zeitfenster, benannter Rollen oder abgelehnter Vorschläge Anforderungen offenbleiben. Prüfen Sie den vorgeschlagenen Zeitplan vor dem Anwenden.

### Zuweisungsvorschläge erzeugen

Nach dem Speichern einer vollständigen Konfiguration im Pflichtmodus verwenden Sie **Assignment recommendations**:

1. Öffnen Sie **Step 3 — Generate & apply suggestions**.
2. Wählen Sie **Auto-generate**.
3. Lassen Sie die Seite geöffnet, während **Generating recommendations...** und **Calculating recommendations...** angezeigt werden.
4. Ändert sich der Plan während der Berechnung, erzeugen Sie Vorschläge erneut aus dem neuen Zustand.
5. Prüfen Sie vor dem Speichern jede vorgeschlagene Zeile im Ablaufplan.

Automatische Vorschläge berücksichtigen Teilnahmeanforderungen, Veranstaltungsanwesenheit, Ankunfts- und Abreiseschalter, vorhandene Zuweisungen, aktive Vorschläge der Aktivitätspläne dieser Veranstaltung, zeitliche Überschneidungen, Kapazität und zuvor abgelehnte Teilnehmer-Zeitfenster-Paare. Surveyor versucht, den Fortschritt fair und die Zuweisungen über die verfügbaren Tage zu verteilen.

Automatische Erzeugung erstellt ausschließlich gewöhnliche Zeitfensterzuweisungen und besetzt keine benannten Rollen. Sie kann eine **REASSIGNMENT** für eine vorhandene Zuweisung ohne benannte Rolle vorschlagen, wenn der Wechsel dem Plan hilft und sich der freigewordene Platz ebenfalls ausgleichen lässt. Eine Zuweisung mit benannter Rolle wird niemals automatisch verschoben.

Ist **Allow assignments beyond slot capacity** aktiviert, versucht Surveyor zuerst, die Anforderungen innerhalb der normalen Kapazität zu erfüllen. Bleiben Anforderungen offen, können zusätzliche Zuweisungen über diese Kapazität hinaus vorgeschlagen werden. Diese Vorschläge beachten weiterhin Anwesenheitsgrenzen, Überschneidungen, benannte Rollen und zuvor abgelehnte Teilnehmer-Zeitfenster-Paare.

Wenn normale Kapazität und gegebenenfalls erlaubte überschneidungsfreie Überbelegung ein Pflichtziel nicht erfüllen können, darf ein Vorschlag Verpflichtungen in freien Plänen überschneiden. Die Zeile zeigt dauerhaft eine Warnung, dass Required Vorrang vor Free erhält. Besprechen Sie dies vor dem Anwenden mit dem betroffenen Teilnehmer. Surveyor lässt die Zuweisung im anderen Plan bestehen. Bei Konflikten mit Pflichtplänen verwendet die automatische Erzeugung diese Ausnahme nicht.

Auch wenn kein Vorschlag gefunden wird, kann eine funktionierende Anordnung existieren. Prüfen Sie offene Anforderungen und erwägen Sie manuelle Änderungen, statt von einem unmöglichen Zeitplan auszugehen.

### Erzeugte Vorschläge prüfen

Der Vorschlagsplan zeigt bestätigte Zuweisungen und vorgemerkte Änderungen. Die Zusammenfassung zählt Zeilen mit **Pending**, **Approved** und **Rejected**.

- **Pending** — ein erzeugter Vorschlag wartet auf eine Entscheidung. Wählen Sie **Approve** oder **Reject**.
- **Approved** — zur Anwendung vorgemerkt. Mit **Revert to Pending** nehmen Sie die Prüfentscheidung vor dem Speichern zurück.
- **Rejected** — abgelehnt. Mit **Approve** oder **Revert to Pending** können Sie die Entscheidung ändern.
- **Confirmed** — eine bereits im Ablaufplan vorhandene Zuweisung, kein ausstehender Vorschlag.

Die Ablehnung eines automatisch erzeugten Teilnehmer-Zeitfenster-Paars verhindert, dass eine spätere Erzeugung dasselbe Paar erneut vorschlägt. Wenn Sie es auf Pending zurücksetzen oder genehmigen, wird diese Ablehnungsentscheidung beim Speichern der Prüfung aufgehoben.

### Eine manuelle Zuweisungsänderung vormerken

Verwenden Sie den Vorschlagsplan, wenn eine Korrektur gemeinsam mit erzeugten Vorschlägen geprüft werden soll:

- Wählen Sie unter einem Zielzeitfenster **Add recommendation**.
- Wählen Sie die betroffene Person mit **Select participant**.
- Wählen Sie **New assignment**, um einen Teilnehmer hinzuzufügen.
- Wählen Sie **Reassign from another slot** und **Move from**, um einen Teilnehmer zu verschieben.
- Wählen Sie **Swap two assignments** und **Swap with participant in this slot**, um zwei Zuweisungen ohne Rollen zu tauschen.
- Wählen Sie **Stage as approved**, um den Vorgang in die Prüfung aufzunehmen.
- Wählen Sie neben einer bestätigten Zuweisung **Stage unassignment**, um ihre Entfernung vorzuschlagen.

Manuelle Zuweisungen und Verschiebungen mit Überschneidungen sind nach Bestätigung weiterhin möglich. Warnungen erscheinen im Hinzufügen-Dialog und bleiben neben der vorgemerkten Zeile sichtbar, damit Sie sie mit dem betroffenen Teilnehmer besprechen können. Eine Verschiebung oder ein Tausch kann nur eine Quellzuweisung ohne benannte Rolle in diesem Plan verwenden. Eine manuell vorgemerkte Zeile beginnt als Approved. Entfernen oder setzen Sie sie vor dem Speichern zurück, wenn sie nicht angewendet werden soll.

### Die Prüfung speichern und anwenden

1. Prüfen Sie den vollständigen vorgemerkten Stapel und seine dauerhaft angezeigten Zeilenwarnungen.
2. Besprechen Sie Überschneidungen vor der Anwendung mit den betroffenen Teilnehmern.
3. Wählen Sie **Save changes**.
4. Erscheint **Assignment warnings** für manuelle Überschneidungen oder Vorschläge mit Required-Vorrang vor Free, wählen Sie **Confirm overlapping changes** nur bei beabsichtigter Zustimmung. **Cancel** lässt den Entwurf und seine Warnungen sichtbar, ohne die Prüfung zu speichern oder anzuwenden.

Surveyor speichert die Prüfzustände und wendet jeden weiterhin gültigen Approved-Vorgang an. Pending und Rejected ändern den Ablaufplan nicht. Vor der Anwendung prüft Surveyor Plan und Teilnehmer erneut, einschließlich Quellzuweisungen, doppelter Ziele, Anwesenheit, Ankunfts- und Abreisegrenzen, Überschneidungen, benannter Rollen und Kapazität. Manuelle Überschneidungen und Required-vor-Free-Überschneidungen können bestätigt werden. Andere blockierende Warnungen überspringen den Vorgang weiterhin; beide Teile eines Tauschs bleiben zusammen. Eine veränderte Überschneidung erfordert eine neue Prüfung und Bestätigung, bevor irgendein Teil des Stapels gespeichert wird.

Kontrollieren Sie danach die gemeldeten Zahlen **Applied** und **skipped** sowie verbleibende Zeilenwarnungen. Die Seite lädt Ablaufplan und Teilnehmerfortschritt neu. Angewendete Zeilen verlassen die aktive Prüfung und bleiben als Historie erhalten. Nach Ablauf der Bindungsfrist berechnet Surveyor nach einer erfolgreichen Anwendung ersetzbare ausstehende Vorschläge erneut. Vor der Frist wählen Sie für eine neue Berechnung erneut **Auto-generate**.

### Grenzen der erweiterten Funktionen

Beachten Sie diese Grenzen:

- Die automatische Erzeugung wählt oder besetzt keine benannten Rollen.
- Die Anforderungsabdeckung vergleicht Summen und beweist keinen konfliktfreien Zeitplan.
- Vorhandene Zuweisungen mit benannten Rollen werden nicht automatisch verschoben.
- Eine Ablehnung verhindert erneute Vorschläge für denselben Teilnehmer im selben Zeitfenster. Ein Ablehnungsgrund oder Ablaufdatum wird nicht angezeigt.
- Automatische Vorschläge können Anforderungen offenlassen, auch wenn ein passender Zeitplan möglich ist.
- Optionale Überbelegung ist ein letzter Ausweg und umgeht niemals Anwesenheits- oder Überschneidungsregeln.
- Surveyor benachrichtigt Teilnehmer nicht, wenn ein Organisator Planänderungen anwendet. Kommunizieren Sie den endgültigen Zuweisungsplan separat.

## Einen Plan archivieren oder wiederherstellen

Eigentümer und Organisatoren mit **Edit Meta** können **Entity settings** → **Actions** → **Archival** öffnen und **Archive for everyone** oder **Restore for everyone** verwenden. Die Archivierung erhält Zeitfenster, Rollen, Zuweisungen, Anforderungen, Bilder und bestehende Berechtigungen. Normale erlaubte Aktionen bleiben verfügbar. Die gewöhnliche Planansicht zeigt gegebenenfalls nur **This entity is archived.**.

Ein eigenständiger Plan kann nach seinem einschließlich gerechneten Enddatum und der für die Website eingestellten Verzögerung automatisch archiviert werden. Die Wiederherstellung pausiert die automatische Archivierung, bis Sie **Resume automatic archival** wählen. **Pause automatic archival** ist auch schon vor der Archivierung verfügbar.

Ein verknüpfter Plan folgt dem Archivierungszeitplan seiner Veranstaltung, auch wenn seine eigenen Daten abweichen. Der Abschnitt **Archival** in **Entity settings** erklärt, wann zuerst die Veranstaltung wiederhergestellt werden muss, und bietet bei entsprechender Berechtigung **Open event**. Eine Wiederherstellung der Veranstaltung lässt unabhängig archivierte Pläne archiviert. Unter einer archivierten Veranstaltung erstellte Pläne erben diesen Zustand sofort.

Archivierte Pläne finden Sie unter **Archived and hidden** in [Ihrer Übersicht](DASHBOARD.md#find-archived-and-hidden-items). **Hide for me**, **Show for me** und **Use default visibility** ändern nur die Einordnung in der Übersicht des aktiven Profils.

## Problemlösung

### Ich sehe Registration required

Der Plan ist mit einer Veranstaltung verknüpft, und das aktive Profil ist nicht dafür angemeldet. Melden Sie dasselbe Profil an, wechseln Sie zum angemeldeten Profil oder fragen Sie den Organisator, ob externe Teilnahme freigegeben werden soll.

### Join oder Take ist nicht verfügbar

Prüfen Sie, ob:

- das Zeitfenster voll und Überbelegung deaktiviert ist;
- die Bindungsfrist des Plans abgelaufen ist;
- Ihrem aktiven Profil Planzugang oder die nötige Teilnahmeberechtigung fehlt;
- ein verknüpfter Plan eine Veranstaltungsanmeldung verlangt; oder
- die benannte Rolle bereits von einem anderen Teilnehmer besetzt ist.

### Ein Zeitfenster erscheint nicht unter Open slots

**Open slots** enthält nur Zeitfenster unterhalb ihrer normalen Kapazität. Ein volles Zeitfenster bleibt ausgeschlossen, selbst wenn unter **All slots** die Aktion **Full — join anyway** verfügbar ist.

### Ich bin mit dem falschen Profil beigetreten

Öffnen Sie das Benutzermenü und prüfen Sie das aktive Profil. Benutzer vollständiger Konten können über **Your profiles** wechseln. Zuweisungen bleiben mit dem Profil verbunden, das sie erstellt hat. Verlassen Sie das Zeitfenster mit diesem Profil oder bitten Sie einen Organisator um Korrektur.

### Ich kann Zeitfenster, Rollen, Teilnehmer, Regeln, Einstellungen oder Exporte nicht bearbeiten

Diese Funktionen hängen von unterschiedlichen Berechtigungen ab. Bitten Sie den Eigentümer, nur die für Ihre Organisatoraufgabe benötigten Fähigkeiten freizugeben. Siehe [Berechtigungen und Freigaben](PERMISSIONS.md#delegate-a-limited-organizer).

### Meine Änderungen unter Rules & auto-assign sind verloren gegangen

Verwenden Sie je nach Abschnitt **Save settings**, **Save requirement settings** oder **Save changes**. Die Seite warnt vor ungespeicherten Anforderungsänderungen. Verlassen Sie sich aber nicht darauf, dass Navigation sie automatisch speichert.

### Auto-generate ist deaktiviert

Der Plan muss mit einer Veranstaltung verknüpft sein, **Assignment mode** muss auf **Required** stehen und Ihr Profil benötigt **Manage Assignments**. Speichern Sie vor der Erzeugung eine vollständige Anforderungstabelle.

### Die Abdeckungsprüfung meldet eine unvollständige Konfiguration

Prüfen Sie jede Zeile unter **Stay duration requirements**. Der Pflichtmodus verlangt eine nicht negative ganze Zahl für jede mögliche Anwesenheitsdauer. Korrigieren Sie auch ungültige Rollenanforderungen und Teilnehmerausnahmen und wählen Sie danach **Save requirement settings**.

### Die Vorschlagsberechnung ist veraltet oder fehlgeschlagen

Eine veraltete Berechnung bedeutet, dass sich relevante Plandaten während der Berechnung geändert haben. Wählen Sie **Reload**, prüfen Sie gespeicherte Anforderungen und aktuelle Zuweisungen und wählen Sie erneut **Auto-generate**. Bei Fehlern oder Zeitüberschreitung bleibt der Ablaufplan unverändert.

### Ein Teilnehmer benötigt nach der Erzeugung weiterhin Schichten

Prüfen Sie, ob der Teilnehmer innerhalb seiner Anwesenheit geeignete, überschneidungsfreie Zeitfenster hat. Kontrollieren Sie Kapazität, Ankunfts- und Abreiseschalter, benannte Rollen sowie abgelehnte Teilnehmer-Zeitfenster-Paare. Eine manuelle Zuweisung, Verschiebung oder ein Tausch kann Anforderungen erfüllen, die automatische Vorschläge offenließen.

### Eine genehmigte Änderung wurde nicht angewendet

Eine genehmigte Änderung kann übersprungen werden, wenn sich der Zeitplan geändert hat oder die Zuweisung nicht mehr erlaubt ist. Laden Sie die Prüfung neu und kontrollieren Sie bestehende Zuweisungen, doppelte Zuweisungen, Anwesenheit, Überschneidungen, benannte Rollen und Kapazität. Korrigieren Sie den Ablaufplan oder merken Sie eine andere Änderung vor. Eine Genehmigung setzt diese Regeln nicht außer Kraft.

## Verwandte Anleitungen

- [Erste Schritte](GETTING_STARTED.md) — Konten, Gäste und Profile.
- [Veranstaltungen](EVENTS.md) — Anmeldung, Anwesenheitsdaten und Veranstaltungsverwaltung.
- [Berechtigungen und Freigaben](PERMISSIONS.md) — Ansicht, Teilnahme, Verwaltung, Export und Delegation.
- [Ihre Übersicht](DASHBOARD.md) — Mit dem aktiven Profil verbundene Pläne finden.
