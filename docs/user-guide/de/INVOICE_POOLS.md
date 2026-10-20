# Rechnungspools und Zahlungen
<!--
documentation-metadata
audience: Veranstaltungsteilnehmer; Veranstaltungsorganisatoren
owner: event invoice-pool maintainers
status: current
last-verified: 2026-10-20
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Native-reference provenance retained; bounded P8 creation/settings, allocation, expense and invoice-review tasks aligned with the current German interface and catalogs. Untouched submission/history, calculation and settlement material retains its earlier reference scope.
current-task-sources: src/frontend/features/finance/FinanceSection.vue; src/frontend/features/finance/FinancePoolEditor.vue; src/frontend/features/finance/FinanceAssignments.vue; src/frontend/features/finance/FinanceAdjustments.vue; src/frontend/features/finance/FinanceTakeovers.vue; src/frontend/features/finance/FinanceOrganizerInvoice.vue; src/frontend/features/finance/FinanceInvoiceReview.vue; src/locales/de.json
source-anchors: docs/user-guide/en/INVOICE_POOLS.md
heading-anchors: 1:invoice-pools-and-payments; 2:choose-your-task; 3:participant; 3:organizer; 2:first-understand-the-two-kinds-of-status; 3:pool-status; 3:invoice-status; 2:who-can-use-invoice-pool-controls; 3:participants; 3:organizers; 2:participant-tasks; 3:submit-an-invoice; 4:no-open-pool-is-available; 3:check-your-invoice-history; 4:what-to-do-for-each-status; 3:retract-an-invoice-awaiting-review; 3:choose-whose-share-you-will-cover; 3:understand-your-final-share; 2:organizer-tasks; 3:create-an-invoice-pool; 4:creation-fields; 4:distribution-modes; 3:stop-or-resume-participant-submissions; 3:understand-the-pool-totals; 3:choose-participants-and-exemptions; 3:manage-takeovers-for-the-group; 3:add-a-surcharge; 3:add-an-organizer-expense; 3:review-submitted-invoices; 4:accept-without-correction; 4:accept-with-a-correction; 4:reject; 4:close-an-accepted-invoice; 4:correct-or-reject-an-accepted-or-closed-invoice; 4:notifications-and-late-review; 3:preview-a-calculation; 4:reconcile-costs-and-reimbursements; 3:close-the-pool-and-calculate-shares; 3:recalculate-a-closed-pool; 3:roll-back-pool-changes; 3:send-settlement-emails; 3:record-whether-a-share-is-settled; 3:export-saved-shares-as-a-pdf; 2:privacy-proof-access-storage-and-retention; 2:troubleshooting; 3:i-cannot-see-invoice-pools-and-payments; 3:i-can-see-invoice-history-but-cannot-submit; 3:my-invoice-is-not-included-in-the-total; 3:my-accepted-amount-or-description-changed; 3:i-cannot-select-somebody-in-manage-takeovers; 3:a-share-is-different-from-the-simple-equal-split; 3:the-pool-changed-but-the-shares-did-not; 3:a-recalculated-share-requires-payment-although-i-already-paid; 3:an-expected-email-did-not-arrive; 3:a-proof-is-unavailable
next-review: invoice-pool-visible-UI-or-behavior-change
production-reference: 2dfa257 native frontend documentation; not an installed production commit
-->

Rechnungspools helfen einer Veranstaltungsgruppe, Belege zu sammeln, anrechenbare Kosten festzulegen und zu berechnen, wer Geld zahlen oder erhalten soll. Surveyor speichert Berechnung und Abwicklungsstatus; es zieht kein Geld ein und veranlasst keine Banküberweisungen.

## Wählen Sie Ihre Aufgabe

### Teilnehmer

- [Eine Rechnung einreichen](#submit-an-invoice)
- [Eine Rechnung prüfen oder eine akzeptierte Rechnung abschließen](#check-your-invoice-history)
- [Eine noch ungeprüfte Rechnung zurückziehen](#retract-an-invoice-awaiting-review)
- [Für einen anderen Teilnehmer bezahlen](#choose-whose-share-you-will-cover)
- [Ihren endgültigen Anteil verstehen](#understand-your-final-share)

### Organisator

- [Einen Rechnungspool erstellen](#create-an-invoice-pool)
- [Teilnehmer, Faktoren und Befreiungen auswählen](#choose-participants-and-exemptions)
- [Übernahmen verwalten](#manage-takeovers-for-the-group)
- [Einen persönlichen Zuschlag oder Rabatt hinzufügen](#add-a-surcharge)
- [Eine Organisatorausgabe zu den gemeinsamen Kosten hinzufügen](#add-an-organizer-expense)
- [Rechnungen prüfen, korrigieren, akzeptieren oder ablehnen](#review-submitted-invoices)
- [Teilnehmereinreichungen stoppen oder wieder zulassen](#stop-or-resume-participant-submissions)
- [Eine akzeptierte oder abgeschlossene Rechnung korrigieren oder ablehnen](#correct-or-reject-an-accepted-or-closed-invoice)
- [Eine Berechnung vorab ansehen](#preview-a-calculation)
- [Einen Pool schließen und Anteile berechnen](#close-the-pool-and-calculate-shares)
- [Einen geschlossenen Pool korrigieren](#recalculate-a-closed-pool)
- [Ausstehende Pooländerungen zurücknehmen](#roll-back-pool-changes)
- [Abrechnungs-E-Mails senden](#send-settlement-emails)
- [Zahlungen und Erstattungen erfassen](#record-whether-a-share-is-settled)
- [Gespeicherte Anteile als PDF exportieren](#export-saved-shares-as-a-pdf)

## Zuerst die beiden Statusarten unterscheiden

Eine Rechnung und ihr Pool haben getrennte Lebenszyklen. **Abgeschlossene Rechnung** und **geschlossener Pool** bedeuten nicht dasselbe.

### Poolstatus

| Poolstatus | Bedeutung | Verfügbare Aufgaben |
|---|---|---|
| **Open for invoices** | Kosten und Verteilungsregeln werden noch gesammelt. Es sind keine endgültigen Anteile festgeschrieben. | Zugeordnete Teilnehmer können Rechnungen einreichen und ihre eigenen Übernahmen verwalten. Organisatoren können Einstellungen, Zuordnungen, Faktoren, Befreiungen, Übernahmen, Zuschläge und Rabatte ändern, Teilnehmerrechnungen prüfen und Organisatorausgaben hinzufügen. |
| **Organizer invoices only** | Teilnehmereinreichungen und das Bearbeiten eigener Übernahmen sind nicht verfügbar. Endgültige Anteile wurden noch nicht berechnet. | Organisatoren können Kosten hinzufügen und prüfen, Verteilungsgrundlagen bearbeiten, mit **Open participant invoices** Teilnehmereinreichungen zulassen oder Anteile vorab ansehen und berechnen. |
| **Closed** | Surveyor hat aus akzeptierten Kosten und den bei der letzten Berechnung gespeicherten Verteilungsregeln einen endgültigen Anteil je Zahler erzeugt. | Teilnehmer sehen ihre Anteile, können aber keine neuen Rechnungen einreichen. Organisatoren können Zahlungen erfassen, Einstellungen korrigieren und Organisatorausgaben hinzufügen. Gespeicherte Kosten- oder Verteilungsänderungen wirken erst nach **Recalculate pool** auf die Anteile. |

Das Schließen löscht den Pool nicht. Es gibt keine gewöhnliche Funktion **Reopen pool** oder **Delete pool**. **Recalculate pool** ersetzt die Anteile, während der Pool geschlossen bleibt.
**Open for invoices** und **Organizer invoices only** sind unabhängige Auswahlmöglichkeiten beim Erstellen. Beide können direkt mit **Close pool & calculate** geschlossen werden; vorher ist kein weiterer Poolzustand nötig.
**Close participant invoices** ist eine eigene Aktion vor der Berechnung: Sie stoppt Teilnehmereinreichungen ohne Anteilsberechnung und kann mit **Open participant invoices** rückgängig gemacht werden. Ein finanziell geschlossener Pool kann Teilnehmereinreichungen nicht wieder öffnen.

**Recalculation required** bedeutet, dass gespeicherte Berechnungsgrundlagen seit der letzten Berechnung geändert wurden. Bisherige Anteile bleiben sichtbar, und Organisatoren können weiterhin Zahlungen auf diese Beträge erfassen. Prüfen Sie die neue Berechnung und wenden Sie sie an oder nehmen Sie ausstehende Pooländerungen zurück. Erfasste Zahlungen werden bei einer Neuberechnung übernommen.

### Rechnungsstatus

| Sichtbarer Status | Wie er entsteht | Nächster Schritt | In den Poolkosten enthalten? |
|---|---|---|---|
| **Awaiting review** | Ein zugeordneter Teilnehmer reicht Rechnung und Beleg in einem offenen Pool ein. | Ein Organisator kann **Accept** oder **Reject** wählen. Der Einreicher kann sie vor der Prüfung mit **Retract** zurückziehen. | Nein. |
| **Accepted** | Ein Organisator akzeptiert eine ungeprüfte Teilnehmerrechnung oder fügt eine Organisatorausgabe hinzu. | Der zugeordnete Teilnehmer oder ein Organisator kann die Rechnung mit **Close** abschließen. Organisatoren können außerdem nach Bestätigung **Correct** oder **Reject from pool** verwenden. | Ja, gegebenenfalls mit dem akzeptierten korrigierten Betrag. |
| **Rejected** | Ein Organisator lehnt eine ungeprüfte Rechnung ab oder entfernt eine akzeptierte beziehungsweise abgeschlossene Rechnung aus dem Pool. | Datensatz und Beleg bleiben in der Historie. Bei Bedarf kann während des offenen Pools eine Ersatzrechnung eingereicht werden. | Nein. |
| **Closed** | Der zugeordnete Teilnehmer oder ein Organisator schließt eine akzeptierte Rechnung ab. | Der Datensatz bleibt in der Historie. Organisatoren können weiterhin nach Bestätigung **Correct** oder **Reject from pool** verwenden. | Ja. |
| **Retracted** | Der Einreicher zieht eine noch ungeprüfte Rechnung zurück. | Angaben und Beleg bleiben ohne weitere Prüfaktion in der Historie. Bei Bedarf kann während des offenen Pools Ersatz eingereicht werden. | Nein. |

Der Abschluss einer akzeptierten Rechnung vermerkt das Ende ihrer gewöhnlichen Prüfung. Organisatoren können später weiterhin eine Korrektur oder Ablehnung bestätigen. Der Abschluss entfernt **keine** Kosten, markiert keinen Anteil als bezahlt und schließt nicht den Pool. Sowohl Accepted als auch Closed bleiben in den Poolkosten enthalten.

## Wer Rechnungspool-Funktionen verwenden darf

### Teilnehmer

Sie können Rechnungen einreichen oder Ihre Übernahmen ändern, wenn alle folgenden Voraussetzungen erfüllt sind:

1. Das aktive Profil ist zur Veranstaltung angemeldet.
2. Der Organisator hat Ihre Anmeldung dem Pool zugeordnet, oder der Pool gilt für alle Teilnehmer.
3. Der Pool ist für Einreichungen beziehungsweise Übernahmeänderungen offen.

Ein Teilnehmer darf nur eigene Rechnungen einreichen, nur eigene ungeprüfte Rechnungen zurückziehen, nur Übernahmen mit sich selbst als Zahler ändern, nur die eigene Rechnungshistorie und eigene Belege ansehen, nur eigene akzeptierte Rechnungen abschließen und nur den eigenen endgültigen Anteil sehen.

### Organisatoren

Der Veranstaltungseigentümer erhält alle Veranstaltungsberechtigungen. Ein anderer Organisator benötigt:

- **Access Admin**, um das **Event administration dashboard** zu öffnen.
- **Manage Assignments**, um **Invoice pools** einschließlich aller Rechnungen, Belege, Zuordnungen, Übernahmen, Zuschläge, Anteile und Zahlungsfunktionen zu sehen und zu bedienen.

Ein Organisator mit diesen Rechten kann gemeinsame Poolausgaben hinzufügen, ohne als Veranstaltungsteilnehmer angemeldet zu sein.

Geben Sie **Manage Assignments** nur vertrauenswürdigen Organisatoren. Rechnungsbeschreibungen und Belege können Namen, Adressen, Kontodaten, Kaufangaben und andere sensible Informationen enthalten. Lesen Sie vor der Delegation [Berechtigungen und Freigaben](PERMISSIONS.md#delegate-a-limited-organizer).

## Aufgaben für Teilnehmer

### Eine Rechnung einreichen

Verwenden Sie diesen Ablauf, wenn Sie eine Ausgabe bezahlt haben, die in einem Veranstaltungskostenpool berücksichtigt werden soll.

1. Öffnen Sie die Veranstaltung mit dem dafür angemeldeten Profil.
2. Öffnen Sie **Invoice pools & payments**.
3. Öffnen Sie **Submit an invoice & history**.
4. Wählen Sie unter **Choose pool** den offenen Pool für diese Ausgabe.
5. Geben Sie einen positiven **Amount** ein. Der kleinste vom Formular akzeptierte Wert ist `0.01`.
6. Geben Sie optional eine **Description** ein, mit der der Organisator die Ausgabe zuordnen kann.
7. Wählen Sie unter **Proof (image or PDF)** eine Belegdatei.
8. Wählen Sie **Submit invoice**.

Das Formular zeigt sofort den Übermittlungsstatus und verhindert eine weitere Einreichung während des laufenden Vorgangs. Wenn Uploadfortschritt verfügbar ist, bezeichnet die Prozentzahl die Belegübertragung. Sie bedeutet noch nicht, dass die Rechnung gespeichert wurde. Warten Sie nach der Übertragung auf die Speicherbestätigung. Bei längeren Anfragen erscheinen weitere Statusmeldungen.

Lassen Sie die Seite geöffnet, bis der Erfolg bestätigt ist. Bricht die Verbindung ab und kann Surveyor das Ergebnis nicht bestätigen, verwenden Sie vor einem erneuten Versuch **Check invoice history**. Ihre Rechnung könnte bereits gespeichert sein. Ist ein Feld ungültig, korrigieren Sie das Formular und senden Sie es erneut ab. Die Uploadbestätigung kann eintreffen, bevor die E-Mail ankommt.

Ein Beleg ist erforderlich. Surveyor akzeptiert JPEG-, PNG-, GIF- und PDF-Dateien bis 10 MiB. Verwenden Sie einen gut lesbaren Kassenbon, eine Rechnung oder einen Zahlungsnachweis, der nur die für die Prüfung erforderlichen persönlichen und finanziellen Angaben enthält.

Nach **Invoice submitted successfully** zeigt Surveyor kurz den Erfolg und lädt die Seite automatisch neu. **Invoice pools & payments** und **Submit an invoice & history** öffnen sich wieder mit der gespeicherten Rechnung in der Historie. Im nächsten Einreichungsformular sind Betrag, Beschreibung und Beleg leer. Der gewählte Pool bleibt ausgewählt, sofern er noch verfügbar ist. Warten Sie mit der nächsten Rechnung auf das Neuladen. **View invoice history** öffnet die aktualisierte Historie früher.

Nach einer erfolgreichen Einreichung:

- Die gespeicherte Rechnung erscheint in der aktualisierten **Your invoice history** als **Awaiting review**.
- Surveyor weist ihr eine Rechnungsnummer zu.
- Der Organisator sieht eingereichten Betrag, Beschreibung und Beleg.
- Surveyor sendet **Invoice submitted** an die E-Mail-Adresse Ihres Kontos oder Gastprofils, sofern eine Adresse vorhanden und E-Mail-Versand eingerichtet ist.

Surveyor benachrichtigt Organisatoren nicht über jede neue Einreichung per E-Mail. Sie prüfen neue Einträge unter **Invoice administration**.

#### Es steht kein offener Pool zur Verfügung

**No open pools for submissions right now.** bedeutet, dass Sie keinem offenen Pool zugeordnet sind. Prüfen Sie, ob Sie das angemeldete Profil verwenden. Fragen Sie dann einen Organisator, ob Teilnehmereinreichungen gestoppt wurden, der Pool bereits berechnet und geschlossen wurde oder Ihre Anmeldung noch zugeordnet werden muss.

### Ihre Rechnungshistorie prüfen

Öffnen Sie **Invoice pools & payments** → **Submit an invoice & history**. **Your invoice history** zeigt alle von der aktiven Anmeldung eingereichten Rechnungen, auch aus inzwischen geschlossenen Pools.

Bei jeder Rechnung sehen Sie:

- Rechnungsnummer und Einreichungsdatum.
- Poolname.
- Aktuellen oder korrigierten Betrag.
- Aktuelle oder korrigierte Beschreibung.
- Status und gegebenenfalls Ablehnungsgrund.
- **View proof**.
- **Close**, nur bei Accepted.
- **Retract**, nur bei Awaiting review.

Ursprünglicher Betrag und ursprüngliche Beschreibung bleiben nach einer Organisatorkorrektur sichtbar, auch bei einer späteren Korrektur einer Accepted- oder Closed-Rechnung.

Mit **Search invoices** suchen Sie nach Rechnungsnummer, Pool, Betrag, Beschreibung, Korrektur oder Ablehnungsgrund. **All statuses** filtert Awaiting review, Accepted, Rejected, Closed und Retracted. Wählen Sie 25, 50 oder 100 Zeilen pro Seite und verwenden Sie bei längerer Historie **Previous** oder **Next**.

#### Was bei welchem Status zu tun ist

- **Awaiting review:** Warten Sie auf einen Organisator, oder wählen Sie bei falscher Einreichung **Retract**. Die ursprünglichen Angaben und die Historie können Sie nicht bearbeiten oder löschen.
- **Accepted:** Prüfen Sie mögliche Korrekturen. Wählen Sie **Close**, wenn keine weitere Besprechung zur Prüfung nötig ist.
- **Rejected:** Lesen Sie den Grund. Fragen Sie bei Unklarheiten einen Organisator und reichen Sie während des offenen Pools Ersatz ein. Abgelehnter Datensatz und Beleg bleiben in der Historie.
- **Closed:** Es ist keine weitere Rechnungsaktion nötig. Die Kosten bleiben in den Poolsummen enthalten.
- **Retracted:** Die Rechnung ist von Prüfung und Kosten ausgeschlossen. Reichen Sie bei Bedarf eine neue Rechnung ein, sofern der Pool noch offen ist.

Hat Ihr Profil eine E-Mail-Adresse, sendet Surveyor nach Annahme, Korrektur, Ablehnung, Abschluss oder eigener Rücknahme eine Nachricht. Die Annahme-E-Mail nennt den wirksamen akzeptierten Betrag und eventuelle Organisatorkorrekturen. Die Ablehnungs-E-Mail enthält den Grund.

### Eine noch ungeprüfte Rechnung zurückziehen

1. Suchen Sie Ihre Rechnung in **Your invoice history**.
2. Wählen Sie bei einer Rechnung mit **Awaiting review** die Aktion **Retract**.
3. Prüfen Sie die Rechnung unter **Retract invoice** und wählen Sie **Confirm retraction**.

Die Rechnung erhält **Retracted** und behält Angaben und Beleg in der Historie. Sie wartet nicht mehr auf eine Organisatorentscheidung. Sie können eine eigene ungeprüfte Rechnung auch nach Schließung des Pools zurückziehen. Sie war nie in berechneten Kosten enthalten; die Rücknahme ändert daher gespeicherte Anteile und Zahlungen nicht. Sie öffnet den Pool nicht für einen Ersatz-Upload.

Hat ein Organisator die Rechnung bereits geprüft oder änderte sich der Pool während des Dialogs, laden Sie die Seite neu und prüfen Sie den aktuellen Status. Accepted- und Closed-Rechnungen benötigen stattdessen eine Korrektur oder Ablehnung durch einen Organisator.

### Festlegen, wessen Anteil Sie übernehmen

Bei einer Übernahme akzeptiert ein Teilnehmer, der **Zahler**, den endgültigen Anteil eines anderen Teilnehmers, des **Begünstigten**. Grundbetrag, Zuschläge, Rabatte und Rechnungsgutschrift des Begünstigten fließen in das Ergebnis des Zahlers ein. Bereits vom Begünstigten abgewickelte Beträge bleiben bei ihm und können nach Neuberechnung eine separate Erstattung oder Restforderung ergeben.

So richten Sie eigene Übernahmen vor Schließung des Pools ein:

1. Öffnen Sie **Rechnungspools und Zahlungen**.
2. Suchen Sie **Übernahmen** und den offenen Pool.
3. Wählen Sie **Übernahmen verwalten**.
4. Suchen oder wählen Sie jede Person, deren Anteil Sie übernehmen.
5. Wählen Sie **Änderungen speichern**.

Regeln:

- Sie können nicht sich selbst übernehmen.
- Ein Begünstigter kann nur einen Zahler haben.
- Wer bereits übernommen wird, kann nicht zusätzlich jemand anderen übernehmen.
- Sie können die vorhandene Übernahme eines anderen Zahlers nicht selbst ersetzen. Bitten Sie einen Organisator um die Änderung.
- Nur Personen desselben Pools sind auswählbar.
- Teilnehmer können Übernahmen nur im offenen Pool bearbeiten.

Jeder Zahler hat eine Zeile mit Namensmarkierungen seiner Begünstigten. Mit **Übernahmen suchen** finden Sie beide Namen. Passende Begünstigte erscheinen auch dann, wenn ihre Markierung zuvor in einer längeren Liste verborgen war. Die Schaltfläche zum Aufklappen nennt die Gruppengröße: **Alle 8 anzeigen** zeigt beispielsweise alle acht Begünstigten. **Weniger anzeigen** kehrt zur kompakten Ansicht zurück. Mit **Zurück** und **Weiter** blättern Sie durch weitere Zahler. Wenn E-Mail-Adressen vorliegen, informiert Surveyor Zahler und Begünstigten über hinzugefügte oder entfernte Übernahmen und nennt die Person, die die Änderung vorgenommen hat.

Eine Übernahme ist eine Berechnungsanweisung, keine Zahlung. Sie wird wirksam, wenn der Organisator den Pool schließt oder neu berechnet.

### Ihren endgültigen Anteil verstehen

Nachdem der Organisator einen Pool geschlossen hat, zeigt **Your pool shares** Ihre gespeicherten Anteile über alle Pools. Jede Zeile zeigt Pool, vorzeichenbehafteten **Calculated balance** und Zahlungsstatus. Auf Telefonen und Tablets erscheinen dieselben Angaben als Karten. Der Betrag bleibt nach Zahlung oder Erstattung sichtbar. Der Status zeigt Ihren Handlungsbedarf:

- **Payment due:** Sie müssen den positiven berechneten Saldo zahlen.
- **Refund due:** Sie sollen den negativen berechneten Saldo als Erstattung erhalten.
- **Paid:** Der Organisator hat Ihre Zahlung erfasst.
- **Refunded:** Der Organisator hat Ihre Erstattung erfasst; der Betrag bleibt negativ.
- **No payment:** Der berechnete Saldo beträgt null.

Mit **Search pools or calculation notes**, **Filter share status**, **Sort pools**, **Shares per page**, **Previous** und **Next** finden Sie auch bei vielen Pools den gesuchten Anteil. **View breakdown** in einer Zeile öffnet einen schreibgeschützten Dialog. Er zeigt zutreffende Bestandteile, Ihre tatsächliche **Calculation explanation** und getrennt die ursprünglichen **Saved calculation notes**. Nicht verwendete Anpassungen oder Gutschriften und wiederholte abgeleitete Beträge werden weggelassen.

| Feld | Bedeutung |
|---|---|
| **Base share** | Ihr automatisch nach Anwesenheit und poolspezifischem Faktor gewichteter Anteil an der Verteilungsbasis, zuzüglich der Anteile übernommener Personen. |
| **Adjustments** | Vorzeichenbehaftete Zuschläge oder Rabatte für Sie oder übernommene Personen. Negative Beträge senken den Anteil. |
| **Invoice credit** | Angerechnete Rechnungen für Sie oder übernommene Personen, wenn **Deduct submitter invoices from their share** aktiviert ist, einschließlich Organisatorrechnungen mit Zuordnung zum zahlenden Teilnehmer. |
| **Previously settled** | Übernommene Transfers früherer Berechnungen: positiv für empfangene Zahlungen des Zahlers, negativ für ausgezahlte Erstattungen an ihn. |
| **Calculated balance** | Grundanteil plus zutreffende Anpassungen minus Rechnungsgutschrift und bereits abgewickelte Beträge. Dies ist der Hauptbetrag und bleibt nach Abwicklung sichtbar. |
| **Calculation explanation** | Formatierte Rechnung für Ihren eigenen Anteil und jede übernommene Person mit benannten Eingaben und endgültigem gespeichertem Saldo. |
| **Saved calculation notes** | Bei der Berechnung gespeicherte tatsächliche Anwesenheit, Faktoren, Befreiungen, Übernahmen, Anpassungen und Rechnungsgutschriften. Diese Fakten sind von der Rechenerklärung getrennt. |

Ein berechneter Saldo von `-25.00` zeigt beispielsweise vor Erfassung **Refund due** und danach **Refunded**. Der Hauptbetrag bleibt `-25.00`.

Ihre **Calculation explanation** verwendet Ihren Namen und die Namen übernommener Teilnehmer. Bei Übernahmen erscheinen zuerst deren Anzahl und Namen, danach die einzelnen Rechnungen. Die Erklärung zeigt jeden tatsächlichen Grundanteil und benennt Anwesenheit in Nächten, einschließlich gerechneten Tagen oder Teilnehmern sowie den jeweiligen **Share factor** ausdrücklich. Anschließend kombiniert sie übernommene Grundanteile und berücksichtigt zutreffende Anpassungen, Rechnungsgutschriften und bereits abgewickelte Beträge. Das Ergebnis ist Ihr gespeicherter berechneter Saldo. Begünstigte behalten ihren eigenen Faktor und ihre eigene Rundung, bevor ihre Anteile zusammengeführt werden. Berechnungen unbeteiligter Zahler erscheinen nicht.

Sind Sie befreit oder haben Sie kein automatisches Verteilungsgewicht und hat auch niemand, den Sie übernehmen, positives automatisches Gewicht, bleibt die Erklärung kurz: Sie zeigt Befreiung oder Nullgewicht, feste Anpassungen und Gutschriften sowie Ihren gespeicherten Saldo. Gemeinsame Kosten und Divisor bleiben enthalten, wenn sie einen berechtigten übernommenen Teilnehmer erklären.

Die Erklärung enthält nur Funktionen, die dieser Pool verwendet. Umverteilte Zuschläge senken die Verteilungsbasis, umverteilte Rabatte erhöhen sie. Aufgeschlagene Zuschläge oder Rabatte lassen die Basis unverändert und ändern Gesamtsumme sowie Ergebnis des betroffenen Zahlers. Verwendete Zuschlags- und Rabattsummen bleiben getrennt, selbst wenn sie einander aufheben. Diese Angaben gehören zur gespeicherten Berechnung, auch wenn aktuelle Einstellungen oder Anwesenheiten später geändert wurden. Ältere Berechnungen behalten Beträge und Notizen. Fehlende gespeicherte Eingaben werden kenntlich gemacht und nicht aus aktuellen Änderungen rekonstruiert.

**Record payment** und **Record refund** erfassen Transfers, die bereits außerhalb von Surveyor stattgefunden haben. Surveyor belastet keine Karte, sendet keine Überweisung und beweist keinen Geldfluss. Organisatoren prüfen den vorzeichenbehafteten berechneten Saldo und bestätigen. Abbrechen oder Schließen der Prüfung lässt den gespeicherten Zustand unverändert.

Berechnungs-E-Mails und PDFs verwenden dieselben Bezeichnungen, denselben vorzeichenbehafteten berechneten Saldo und den ausdrücklichen Zahlungs- beziehungsweise Erstattungsstatus. Das Erfassen oder Rückgängigmachen eines Transfers erzeugt bei vorhandener Adresse ebenfalls eine Status-E-Mail. E-Mails nennen den Empfänger in Anrede und Empfängerfeld mit Namen.

## Aufgaben für Organisatoren

Unter **Rechnungspools und Zahlungen** in der Veranstaltungsverwaltung können Sie Pools erstellen, ihre Eingaben ändern, Ausgaben erfassen und Rechnungen prüfen. Jeder Bearbeitungsdialog hat eine eigene Speicheraktion. Speichern aktualisiert die gespeicherten Angaben, ohne die Seite neu zu laden; warten Sie vor dem Verlassen auf die Bestätigung. **Schließen** fragt vor dem Verwerfen ungespeicherter Änderungen nach. **Änderungen verwerfen** stellt die gespeicherten Werte dieses Formulars wieder her.

Für Berechnungsvorschauen, Schließen oder Neuberechnen eines Pools, Rücknahme von Pooländerungen, Abrechnungs-E-Mails und das Erfassen von Zahlungen oder Erstattungen wählen Sie **Berechnung und Zahlungen**. Dies öffnet die Verwaltungsseite mit diesen Funktionen. Die folgenden Berechnungs- und Zahlungsanleitungen beschreiben dieses Ziel; die dort genannten englischen Schaltflächenbezeichnungen gelten für diese Seite.

### Einen Rechnungspool erstellen

1. Öffnen Sie die Veranstaltung.
2. Wählen Sie **Veranstaltungsverwaltung**.
3. Öffnen Sie **Rechnungspools und Zahlungen**.
4. Wählen Sie **Pool erstellen**.
5. Füllen Sie **Neuen Pool erstellen** aus.
   Wählen Sie bei **Rechnungseinreichungen** **Offen für Rechnungen** oder **Nur Rechnungen der Organisation**.
6. Wählen Sie **Pool hinzufügen**.

#### Felder beim Erstellen

| Feld | Zweck |
|---|---|
| **Poolname** | Erforderlicher Name bis 255 Zeichen. Wählen Sie einen Namen, den Teilnehmer in der Einreichungsliste erkennen. |
| **Rechnungseinreichungen** | **Offen für Rechnungen** erlaubt zugeordneten Teilnehmern Rechnungseinreichungen und eigene Übernahmen; dies ist die Voreinstellung. **Nur Rechnungen der Organisation** beginnt direkt mit Organisatorausgaben und Organisatorkontrolle der Übernahmen. Beide Varianten erlauben Prüfung durch Organisatoren und direkte Berechnung. |
| **Verteilungsart** | Bestimmt, wie die verteilbare Summe beim Schließen des Pools aufgeteilt wird. |
| **Grundanteile aufrunden** | Rundet jeden Teilnehmergrundbetrag auf den nächsten Cent auf. Deaktivieren zum Abrunden. Gleiche gewichtete Anteile erhalten immer denselben Grundbetrag. Einen kleinen Gesamtüberschuss oder Fehlbetrag zeigt die Vorschau. Anfänglich aktiviert. |
| **Beschreibung** | Optionale Erklärung, welche Ausgaben in den Pool gehören. |
| **Allen Teilnehmenden zuordnen** | Schließt alle aktuellen und zukünftigen Veranstaltungsanmeldungen ein. Anfänglich ausgewählt. |
| **Diesen Pool als Standard verwenden** | Ordnet jede zukünftige Veranstaltungsanmeldung automatisch zu; aktuelle Teilnehmer können separat gewählt werden. |
| **Eingereichte Rechnungen vom eigenen Anteil abziehen** | Rechnet akzeptierte Rechnungen eines Teilnehmers gegen seinen endgültigen Anteil oder den seines übernehmenden Zahlers an. Anfänglich ausgewählt. |
| **Auf Teilnehmende begrenzen (bei Zuordnung zu allen deaktiviert)** | Wählt aktuelle Anmeldungen aus, wenn **Allen Teilnehmenden zuordnen** ausgeschaltet ist. |

Der Pool beginnt mit dem gewählten Zustand für **Rechnungseinreichungen**; **Offen für Rechnungen** ist voreingestellt. Wählen Sie den Namen sorgfältig: Im Einstellungsdialog werden Beschreibung und Verteilungsmodus bearbeitet. Klappen Sie den Pool auf, um Zusammenfassung und Rechnungsübersicht zu sehen. **Pooleinstellungen**, **Teilnehmende und Faktoren**, **Zuschläge und Rabatte** und **Übernahmen verwalten** öffnen gezielte Bearbeitungsdialoge.

Unter **Pooleinstellungen** ändern Sie Beschreibung, Verteilungsmodus, **Grundanteile aufrunden** oder **Berechnungs-E-Mails automatisch senden** und wählen **Pooleinstellungen speichern**. Geänderte Rundung verlangt bei geschlossenen Pools eine Neuberechnung. Der E-Mail-Schalter setzt die Voreinstellung für künftige Berechnungen; Sie können sie für eine einzelne Berechnung überschreiben. Speichern Sie jeden Dialog vor Vorschau oder Berechnung. Das Speichern eines Dialogs speichert keine Änderungen in einem anderen.

#### Verteilungsmodi

| Sichtbare Auswahl | Berechnung |
|---|---|
| **Unter Teilnehmenden verteilen** | Beginnt für jeden zugeordneten, nicht befreiten Teilnehmer mit Gewicht 1 und multipliziert es mit seinem Faktor. Gleiche Faktoren ergeben gleiche Anteile. |
| **Nach Anwesenheitstagen verteilen** | Multipliziert einschließlich gerechnete Anwesenheitstage mit dem jeweiligen Teilnehmerfaktor. |
| **Nach Übernachtungen verteilen** | Multipliziert die Nächte zwischen Ankunft und Abreise mit dem jeweiligen Faktor. Eine Anmeldung für denselben Tag trägt null Nächte bei. |

Prüfen Sie vor einer Verteilung nach Tagen oder Nächten die Anwesenheitsdaten. Eine spätere Anwesenheitskorrektur wirkt erst beim erstmaligen Schließen oder einer ausdrücklichen Neuberechnung.

### Teilnehmereinreichungen stoppen oder wieder zulassen

Mit diesen Funktionen ändern Sie vor Berechnung und Schließung des Pools, ob Teilnehmer Rechnungen einreichen dürfen.

1. Öffnen Sie den noch nicht berechneten Pool.
2. Wählen Sie **Teilnehmerrechnungen schließen**.
3. Prüfen und akzeptieren Sie die Bestätigungsabfrage des Browsers.

Der Pool zeigt **Nur Rechnungen der Organisation**. Teilnehmer können keine Rechnungen mehr einreichen und keine Übernahmen bearbeiten. Ihre bestehende Rechnungshistorie bleibt verfügbar. Organisatoren können weiterhin Ausgaben hinzufügen, Rechnungen prüfen, Verteilungsgrundlagen ändern und Anteile vorab ansehen oder berechnen. Diese Aktion erhält Kosten und Einstellungen und berechnet weder Anteile noch erfasst sie Zahlungen.

Um Teilnehmereinreichungen vor der Berechnung zuzulassen, wählen Sie **Teilnehmerrechnungen öffnen** und bestätigen. Das funktioniert auch bei einem direkt als **Nur Rechnungen der Organisation** erstellten Pool. Er wird **Offen für Rechnungen**. Speichern oder verwerfen Sie vorher offene Bearbeitungsentwürfe. Ändert sich der Pool während Ihrer Prüfung, laden Sie neu und kontrollieren Sie vor einem erneuten Versuch den aktuellen Zustand. Sobald **Close pool & calculate** den Pool auf **Abgeschlossen** gesetzt hat, lassen sich Teilnehmereinreichungen nicht wieder öffnen.

### Die Poolsummen verstehen

Im Kopf geschlossener Pools bleiben **Full pool total**, **Payments due** und vorzeichenbehaftete **Refunds due** sichtbar. Klappen Sie den Pool für weitere Angaben auf, einschließlich **Base to distribute**, wenn umverteilte Anpassungen verwendet werden. **Calculation breakdown** trennt verwendete Zuschläge und Rabatte nach ihrem Umverteilungsmodus, auch wenn sie sich zu null aufheben, und zeigt relevante Rechnungs- und Abwicklungssummen als beschriftete Zahlen. Hinzu kommen die Anzahl zugeordneter Teilnehmer und zutreffende Gesamttage oder -nächte, berechtigte Einheiten, Befreiungen und das mit Faktoren gewichtete Gesamtgewicht. Dieser Bereich enthält nur Zahlen; Erklärung und Rechenschritte stehen unter **Example calculation**. Die Zahlen beschreiben den gesamten Pool, nicht nur einen Beispielteilnehmer. Beide fälligen Summen bleiben mit null sichtbar, wenn alle gespeicherten Anteile abgewickelt sind. Verteilungseinstellungen befinden sich unter **Pool settings** und **Participants & factors**. Klappen Sie separat **Example calculation** auf, um zuerst Poolsummen und Verteilungsbasis und gegebenenfalls danach die Berechnung eines anonymen Teilnehmers zu sehen. **View breakdown** erklärt den konkreten gespeicherten Anteil jedes Zahlers.

| Anzeige | Inhalt |
|---|---|
| **Invoice costs** | Wirksame Beträge von Accepted- und Closed-Rechnungen, die als gemeinsame Kosten zählen. |
| **Accepted invoice costs** | Angerechnete Rechnungen, die noch Accepted statt Closed sind. Ungeprüfte Einreichungen sind ausgeschlossen. Der Abschluss einer Rechnung bezahlt keinen Anteil. |
| **Base to distribute** | Rechnungskosten minus vorzeichenbehaftete umverteilte Anpassungen, vor Rundung und persönlichen Anpassungen oder Gutschriften. |
| **Redistributed surcharges** | Bestimmten Teilnehmern zugeordnete positive Beträge, die von der gemeinsamen Basis abgezogen werden. Sie ändern die Gesamtsumme nicht. |
| **Redistributed rebates** | Bestimmten Teilnehmern zugeordnete negative Beträge. Ihr Abzug erhöht die gemeinsame Basis, ohne die Gesamtsumme zu ändern. |
| **On-top surcharges** | Nach der Grundverteilung aufgeschlagene positive Beträge. Sie erhöhen die Gesamtsumme, ohne andere Grundanteile zu ändern. |
| **On-top rebates** | Nach der Grundverteilung angewendete negative Beträge. Sie senken die Gesamtsumme, ohne andere Grundanteile zu ändern. |
| **Full pool total** | Wirksame Beträge von Accepted- und Closed-Rechnungen plus aufgeschlagene Anpassungen. Awaiting review, Rejected und Retracted sind ausgeschlossen. Umverteilte Anpassungen ändern diese Summe nicht. |
| **Payments due** | Positive verbleibende Salden. |
| **Refunds due** | Negative verbleibende Salden mit negativem Vorzeichen. |
| **Invoice credit** | Angerechnete, einer Anmeldung zugeordnete Rechnungen, die von gespeicherten Zahleranteilen abgezogen werden, einschließlich Organisatorrechnungen für den zahlenden Teilnehmer. |
| **Previously settled** | Vorzeichenbehaftete Gutschriften aus früheren Berechnungen. |
| **Payments received** | Positive berechnete Salden, die in dieser gespeicherten Berechnung als bezahlt erfasst wurden. |
| **Refunds paid** | Negative berechnete Salden, die in dieser gespeicherten Berechnung als erstattet erfasst wurden. |
| **Rounding difference** | Ein durch Rundung jedes Teilnehmergrundanteils verursachter Überschuss oder Fehlbetrag ungleich null. |

Nicht verwendete Kontextsummen werden weggelassen. Eine aktuelle geschlossene Berechnung wiederholt keine Kosten, die bereits in ihrer gespeicherten Aufschlüsselung stehen; zutreffende **Accepted invoice costs** und Abwicklungssummen bleiben erhalten. Offene Pools, veraltete Berechnungen und ältere Berechnungen ohne gespeicherte Kosteneingaben behalten die relevanten aktuellen Kostenangaben. Sind Rechnungskosten, Verteilungsbasis und Gesamtsumme in einem gewöhnlichen Pool ohne Anpassungen identisch, erscheint eine Kostenkennzahl; **Example calculation** erklärt die Gleichheit. Bei verwendeten Anpassungen bleiben die relevanten Kostenebenen auch bei gleichen Beträgen getrennt. Eine ältere Berechnung ohne gespeicherte numerische Eingaben zeigt **Saved calculation inputs: Not saved**. Bekannte historische Beträge bleiben verfügbar, während eine nicht belegbare **Full pool total** als **Unavailable** gekennzeichnet wird.

Poolsummen aktualisieren sich durch Rechnungsprüfungen, geänderte Anpassungen und geänderte Zahlungsmarkierungen. In einem veralteten geschlossenen Pool unterscheiden **Current pool costs** und **Saved settlement totals** neuere Eingaben von der gespeicherten Berechnung. **Recalculation required** kennzeichnet gespeicherte Berechnungsänderungen. Prüfen Sie sie vor Neuberechnung oder Rücknahme. Fällige Zahlungen und Erstattungen beruhen bis zur Neuberechnung auf gespeicherten Anteilen und ihrem aktuellen Zahlungsstatus. Empfangene und erstattete Summen beschreiben nur diese Berechnung; **Previously settled** hält übertragene Gutschriften getrennt, auch mit null, wenn positive und negative Überträge einander aufheben. Diese Summen sind keine vollständige chronologische Transferhistorie. Für automatische Aufbewahrungsbereinigung gilt eine unten beschriebene gesonderte Ausnahme.

### Teilnehmer und Befreiungen auswählen

Öffnen Sie einen Pool und wählen Sie **Teilnehmende und Faktoren**.

1. Aktivieren oder deaktivieren Sie **Allen Teilnehmenden zuordnen**.
2. Aktivieren oder deaktivieren Sie **Standard für neue Teilnehmende**.
3. Aktivieren oder deaktivieren Sie **Eingereichte Rechnungen vom eigenen Anteil abziehen**.
4. Verwenden Sie bei vielen Anmeldungen **Teilnehmende suchen**.
5. Wählen Sie jede einzuschließende Anmeldung, wenn der Pool nicht allen zugeordnet ist.
6. Setzen Sie den **Anteilsfaktor** jedes eingeschlossenen Teilnehmers oder lassen Sie `1` stehen.
7. Wählen Sie gegebenenfalls **Befreit**.
8. Wählen Sie **Teilnehmende und Faktoren speichern**. Das ist bei jedem Poolstatus möglich.

Ein Faktor gehört zu diesem Teilnehmer in diesem Pool. `1.5` gibt 50 % mehr Gewicht als `1`, `0.5` die Hälfte. Faktoren multiplizieren das gewählte Anwesenheitsgewicht vor der Aufteilung. Sie multiplizieren weder Zuschläge, Rabatte noch Rechnungsgutschriften und erhöhen nicht die Gesamtkosten. Ein Pool über 120.00 mit gleichmäßiger Verteilung und Faktoren `1`, `1.5`, `0.5` ergibt beispielsweise Grundanteile von 40.00, 60.00 und 20.00.

Faktoren dürfen zwischen `0` und `1000` liegen und bis zu vier Nachkommastellen haben. Faktor `0` gibt keinen automatischen Grundanteil. Wenn ein gemeinsamer Betrag ungleich null verteilt werden muss, benötigt mindestens ein Teilnehmer positives wirksames Gewicht. Prüfen Sie im Nächte-Modus, ob jemand mindestens eine Nacht hat. Befreiungen unterdrücken den Grundanteil unabhängig vom Faktor.

Die beiden Schalter zur automatischen Zuordnung unterscheiden sich:

- **Allen Teilnehmenden zuordnen** wendet den Pool auf jede Veranstaltungsanmeldung einschließlich späterer Anmeldungen an.
- **Standard für neue Teilnehmende** fügt künftige Anmeldungen automatisch hinzu, zwingt aber nicht alle bestehenden in den Pool.

Ein befreiter Teilnehmer bleibt dem Pool zugeordnet, erhält aber keinen automatischen Base share. Er kann weiterhin Zuschläge, Rabatte, Rechnungsgutschriften oder eine Übernahmebeziehung haben. Sein Endergebnis kann daher positiv, null oder negativ sein.

Das Entfernen eines Teilnehmers aus dem Pool entfernt auch unvereinbare Übernahmen und Anpassungen für nicht mehr zugeordnete Anmeldungen. Prüfen Sie nach einer Änderung des Teilnehmerkreises die Anpassungsliste.

Speichern Sie bei einem geschlossenen Pool zuerst den Dialog. Der Pool benötigt dann eine Neuberechnung. Die bisherigen Anteile bleiben bis zur ausdrücklichen Neuberechnung unverändert.

### Übernahmen für die Gruppe verwalten

Ein Organisator kann die Übernahmen jedes Zahlers im Pool einrichten oder neu zuordnen.

**Übernahmen** zeigt jeden Zahler neben Namensmarkierungen seiner Begünstigten. **Übernahmen suchen** findet Zahler und Begünstigte, auch jenseits der zunächst sechs sichtbaren Markierungen. Wählen Sie die Schaltfläche zum Aufklappen, beispielsweise **Alle 8 anzeigen**, um eine längere Gruppe zu sehen. **Weniger anzeigen** klappt sie wieder zusammen. Lange Markierungslisten scrollen innerhalb ihrer Zeile. Wählen Sie 10, 25 oder 50 Zahler je Seite und blättern Sie mit **Zurück** und **Weiter**.

Mit **Bearbeiten** in der Zahlerzeile ändern Sie seine Übernahmen. **Übernahmen verwalten** erlaubt ebenfalls die Auswahl jedes Zahlers. Der Bearbeitungsdialog zeigt ausgewählte Übernahmen und erklärt nicht verfügbare Optionen. Lange Listen scrollen im Dialog, während **Änderungen speichern** erreichbar bleibt.

Wenn das Speichern gelingt, die gespeicherten Übernahmen aber nicht aktualisiert werden können, bleibt Ihre bestätigte Auswahl auch nach Schließen und erneutem Öffnen des Dialogs erhalten. Vor dem Wechsel zu einem anderen Zahler werden die gespeicherten Übernahmen aktualisiert. Schlägt dies fehl, bleibt der aktuelle Zahler ausgewählt.

1. Öffnen Sie den Pool.
2. Wählen Sie in seinen Funktionen **Übernahmen verwalten**.
3. Wählen Sie unter **Zahlende Person** den Zahler.
4. Verwenden Sie bei Bedarf **Teilnehmende suchen**.
5. Wählen Sie die von diesem Zahler übernommenen Begünstigten.
6. Wählen Sie **Änderungen speichern**.

Es gelten dieselben Regeln wie bei der Selbstverwaltung: keine Selbstübernahme, nur ein Zahler je Begünstigtem und keine eigenen Übernahmen durch bereits übernommene Teilnehmer. Eine Neuzuordnung durch den Organisator entfernt die alte Zahlerzuordnung und erstellt die neue.

Vor der Anteilsberechnung sendet eine Änderung **Invoice takeovers updated** an betroffene Zahler und Begünstigte mit E-Mail-Adresse. Die Nachricht nennt Veranstaltung, Pool, handelnde Person und hinzugefügte oder entfernte Übernahmen.

Nach Schließung zeigt **Übernahmen** zuerst die in der gespeicherten Berechnung verwendeten Übernahmen. Organisatoränderungen erscheinen separat unter **Ausstehende Übernahmeänderungen** und lassen gespeicherte Anteile unverändert. **Übernahmeänderungen ausstehend** erscheint außerdem im zugeklappten Poolkopf und neben diesen Änderungen. Teilnehmer werden erst nach erfolgreichem **Apply recalculation** benachrichtigt, anhand des Unterschieds zwischen vorher angewendeten und endgültigen neuen Übernahmen. Zwischenänderungen, eine fehlgeschlagene Berechnung oder **Roll back pool changes** senden keine Übernahmemeldung. Diese Benachrichtigung ist unabhängig von **Email participants after this calculation**. Ältere Berechnungen ohne gespeicherten Übernahmenachweis kennzeichnen dessen Fehlen, statt ausstehende Änderungen als angewendet darzustellen. Ihre nächste erfolgreiche Berechnung legt einen Ausgangszustand fest, ohne frühere Verantwortungsänderungen zu erraten. Die aktuell bearbeitbaren Auswahlwerte stehen unter **Übernahmen für die nächste Berechnung**.

### Einen Zuschlag hinzufügen

Wählen Sie **Zuschläge und Rabatte** für eine feste persönliche Anpassung.

1. Wählen Sie unter **Teilnehmende Person** die betreffende Person.
2. Geben Sie unter **Betrag (für einen Rabatt negativ)** einen positiven Zuschlag oder negativen Rabatt wie `-15.00` ein. Null ist keine Anpassung; verwenden Sie höchstens zwei Nachkommastellen.
3. Geben Sie eine erforderliche **Notiz** zur Erklärung ein.
4. Entscheiden Sie, ob **Innerhalb des Pools umverteilen** gelten soll.
5. Wählen Sie **Zuschlag oder Rabatt hinzufügen**.

Die beiden Anpassungsarten wirken unterschiedlich:

- **Innerhalb des Pools umverteilen** aktiviert: Die vorzeichenbehaftete Anpassung wird von der gemeinsamen Summe abgezogen und danach dem Teilnehmer oder übernehmenden Zahler hinzugefügt. Ein umverteilter Zuschlag senkt den gemeinsamen Rest, ein umverteilter Rabatt erhöht ihn. Die Gesamtsumme des Pools bleibt gleich.
- **Innerhalb des Pools umverteilen** deaktiviert: Zuschlag oder Rabatt wird nach der Grundverteilung direkt auf Teilnehmer oder übernehmenden Zahler angewendet und in der Anpassungsliste als **Zusätzlicher Zuschlag / Rabatt** bezeichnet. Andere Grundanteile bleiben gleich. Ein aufgeschlagener Zuschlag erhöht die Gesamtsumme, ein entsprechender Rabatt senkt sie. Der Organisator muss daher die Finanzierung dieses Rabatts außerhalb der gemeinsamen Kosten berücksichtigen.

Beispiel: 100.00 werden bei deaktivierten Rechnungsgutschriften gleichmäßig auf zwei Teilnehmer verteilt. Ein umverteilter Rabatt von `-10.00` für eine Person erhöht den gemeinsamen Rest auf 110.00. Beide Grundanteile sind 55.00; nach Rabatt ergeben sich 45.00 und 55.00. Ohne Umverteilung ergeben sich 40.00 und 50.00. Faktoren beeinflussen in beiden Fällen die Grundverteilung; der feste Rabatt wird danach angewendet.

Entfernen Sie eine falsche Anpassung mit **Entfernen** und akzeptieren Sie die Bestätigungsabfrage des Browsers. Fügen Sie anschließend den Ersatz hinzu. Ein noch nicht gespeicherter neuer Anpassungsentwurf bleibt beim Entfernen erhalten. Die Notiz erscheint in den Anteilsdetails. Formulieren Sie sie für den Teilnehmer, der die endgültige Berechnung liest.

Anpassungen können nach Schließung hinzugefügt oder entfernt werden. Jede gespeicherte Änderung wirkt erst nach **Recalculate pool** auf die Anteilszeilen. Prüfen Sie vor der Neuberechnung alle Anpassungen.

### Eine Organisatorausgabe hinzufügen

Verwenden Sie **Rechnung / Betrag hinzufügen** für gemeinsame Poolkosten, etwa eine außerhalb des Teilnehmerablaufs bezahlte Raumrechnung. Zum Erfassen ist keine Veranstaltungsanmeldung erforderlich. Sie können die Ausgabe ohne Personenzuordnung lassen oder den zahlenden Teilnehmer angeben.

1. Öffnen Sie den Pool unter **Rechnungspools und Zahlungen**.
2. Wählen Sie **Rechnung / Betrag hinzufügen**.
3. Geben Sie einen positiven **Betrag** mit höchstens zwei Nachkommastellen ein.
4. Wählen Sie unter **Bezahlt von (optional)** den zahlenden Teilnehmer oder behalten Sie **Keine Person — gemeinsame Poolausgabe**.
5. Geben Sie eine erforderliche **Beschreibung** der Kosten ein.
6. Fügen Sie unter **Beleg (optional)** bei Verfügbarkeit einen Beleg oder eine Rechnung hinzu.
7. Wählen Sie **Rechnung / Betrag hinzufügen** und warten Sie auf Bestätigung.

Die Rechnung ist sofort **Angenommen** und zählt bei jedem Poolstatus zu den Kosten. Die Übersicht zeigt den ausgewählten Teilnehmer oder ohne Zuordnung **Poolausgabe**, daneben **Erfasst von** mit dem Organisatornamen. Zahlender Teilnehmer und erfassender Organisator sind getrennte Angaben. Ohne Beleg steht dort **Kein Beleg beigefügt**. Der Beleg bleibt bei beiden Auswahlmöglichkeiten optional; es gelten dieselben Dateitypen und 10 MiB wie bei Teilnehmerbelegen. Beim Hinzufügen wird keine Erstellungs-E-Mail gesendet.

Ein bestätigter Validierungsfehler erhält Ihre Eingaben und den ausgewählten Beleg zur Korrektur. Kann Surveyor nicht bestätigen, ob die Ausgabe gespeichert wurde, bleibt das Formular gesperrt. Wählen Sie **Rechnungsverlauf prüfen**, um die gespeicherten Rechnungen im Dialog zu laden. Prüfen Sie diese und wählen Sie danach **Ich habe den Rechnungsverlauf geprüft**. Dadurch werden die festgehaltenen Formulareingaben geleert, ohne die Ausgabe erneut einzureichen. Eine verlorene Antwort bedeutet nicht, dass die Ausgabe abgelehnt wurde. Prüfen Sie vor einer weiteren Ausgabe den gespeicherten Verlauf.

Die Auswahl enthält vorhandene, diesem Pool zugeordnete Teilnehmer; sie fügt niemanden zur Veranstaltung oder zum Pool hinzu. Bei aktiviertem **Eingereichte Rechnungen vom eigenen Anteil abziehen** senkt eine zugeordnete Rechnung den Anteil dieses Teilnehmers oder seines übernehmenden Zahlers. Sie erscheint außerdem im Bereich **Dein Rechnungsverlauf** dieses Teilnehmers mit Zugriff auf den Beleg und der bestehenden Aktion **Schließen** für angenommene Rechnungen. Die Voreinstellung ohne Zuordnung erzeugt weder persönliche Rechnungsgutschrift noch Teilnehmereintrag in der Historie, auch nicht für einen Organisator, der selbst teilnimmt. Allein die erfassende Person bestimmt niemals Erstattung oder Belegzugang.

Sie können Organisatorausgaben zu geschlossenen Pools hinzufügen. Gespeicherte Anteile und Zahlungen bleiben unverändert; **Neuberechnung erforderlich** erscheint. Prüfen und verwenden Sie **Recalculate pool**, um die neuen Kosten aufzunehmen. **Roll back pool changes** entfernt weder die gespeicherte Ausgabe noch ihre Annahme.

### Eingereichte Rechnungen prüfen

Öffnen Sie den Pool unter **Rechnungspools und Zahlungen**, um **Rechnungsverwaltung** zu erreichen. Neueste Einreichungen stehen zuerst.

Verwenden Sie:

- **Rechnungen suchen** für Rechnungsnummer, Teilnehmername oder -adresse, Beträge, Beschreibungen, Korrekturen und Ablehnungsgründe.
- **Alle Status** zum Filtern von **Prüfung ausstehend**, **Angenommen**, **Abgelehnt**, **Abgeschlossen** und **Zurückgezogen**.
- 25, 50 oder 100 Zeilen pro Seite.
- **Zurück** und **Weiter** für längere Übersichten.

Vergleichen Sie bei jeder Teilnehmereinreichung **Eingereichte Angaben** mit **Beleg ansehen**. **Annehmen** oder **Ablehnen** öffnet den jeweiligen Prüfungsdialog. **Teilnehmende Person / Herkunft** trennt die Teilnehmerzuordnung vom Organisatorhinweis **Erfasst von**. Organisatorrechnungen sind bereits angenommen, können ohne Beleg sein und zeigen ohne Teilnehmerauswahl **Poolausgabe**.

#### Ohne Korrektur akzeptieren

1. Wählen Sie bei der Rechnung **Annehmen**.
2. Lassen Sie im Dialog **Korrigierter Betrag** und **Korrigierte Beschreibung** leer.
3. Prüfen Sie Rechnung und Betrag und wählen Sie **Bestätigen**.

Eingereichter Betrag und eingereichte Beschreibung werden die wirksamen akzeptierten Werte.

#### Mit Korrektur akzeptieren

1. Wählen Sie bei der Rechnung **Annehmen**.
2. Geben Sie unter **Korrigierter Betrag** einen positiven Betrag ein, wenn der akzeptierte Betrag vom eingereichten abweicht.
3. Geben Sie eine **Korrigierte Beschreibung** ein, wenn die akzeptierte Erklärung abweichen soll. Sie darf bis zu 4.000 Zeichen enthalten.
4. Prüfen Sie Rechnung und korrigierten Betrag und wählen Sie **Bestätigen**.

Surveyor erhält die ursprüngliche Einreichung und zeigt sie neben der Korrektur. Der korrigierte Betrag gilt für Poolsummen, Rechnungsgutschriften und endgültige Anteile. Ein leeres Korrekturfeld behält den entsprechenden eingereichten Wert.

#### Ablehnen

1. Wählen Sie bei der Rechnung **Ablehnen**.
2. Geben Sie im Dialog einen **Ablehnungsgrund** ein. Er ist erforderlich und darf bis zu 4.000 Zeichen enthalten.
3. Prüfen Sie die Rechnung und wählen Sie **Bestätigen**.

Die Rechnung wird abgelehnt. Sie zählt nicht zu den Summen, bleibt aber mit Grund und Beleg sowohl in der Organisatorübersicht als auch der Historie des Einreichers.

#### Eine akzeptierte Rechnung abschließen

Wählen Sie bei einer angenommenen Rechnung **Schließen**, wenn ihre Prüfung abgeschlossen ist. Prüfen Sie Rechnung und Betrag im Dialog und wählen Sie **Bestätigen**. Die Rechnung wird abgeschlossen, bleibt aber in **Gesamtkosten des Pools** und der endgültigen Anteilsberechnung enthalten. Die Aktion bezahlt keinen Teilnehmeranteil.

Der zugeordnete Teilnehmer kann eine eigene angenommene Rechnung ebenfalls im Bereich **Dein Rechnungsverlauf** abschließen, auch wenn ein Organisator sie für ihn erfasst hat.

#### Eine akzeptierte oder abgeschlossene Rechnung korrigieren oder ablehnen

Diese Aktionen gelten für Teilnehmerrechnungen und Organisatorausgaben, auch in geschlossenen Pools.

So korrigieren Sie angerechnete Kosten:

1. Wählen Sie bei einer angenommenen oder abgeschlossenen Rechnung **Korrigieren**.
2. Prüfen Sie unter **Rechnung korrigieren** den wirksamen **Betrag** und die **Beschreibung**. Geben Sie dann einen positiven korrigierten Betrag ein oder ändern Sie die Beschreibung.
3. Wählen Sie **Weiter**.
4. Prüfen Sie **Rechnungsänderung bestätigen** und wählen Sie **Korrektur bestätigen**. **Zurück zur Bearbeitung** kehrt zu den Feldern zurück.

Ursprüngliche Einreichung und Beleg bleiben erhalten. Korrigierter Betrag und korrigierte Beschreibung werden wirksam; der Status **Angenommen** oder **Abgeschlossen** bleibt bestehen. Das Leeren der Korrekturbeschreibung stellt die ursprüngliche Beschreibung wieder her.

Um angerechnete Kosten zu entfernen, wählen Sie **Aus Pool ablehnen**, geben unter **Rechnung aus Pool ablehnen** einen erforderlichen **Ablehnungsgrund** ein und wählen **Weiter** sowie **Ablehnung bestätigen**. Die Rechnung wird abgelehnt und aus Poolkosten und persönlicher Rechnungsgutschrift ausgeschlossen. Ursprüngliche Angaben, Beleg und vorhandene Korrektur bleiben in der Historie.

Bei einem geschlossenen Pool erfordert jede dieser Änderungen **Recalculate pool**. Anteile und Zahlungen bleiben gespeichert, bis Sie die neue Berechnung prüfen und anwenden; dabei werden frühere Abwicklungen übernommen. **Roll back pool changes** macht Rechnungskorrekturen und -ablehnungen nicht rückgängig. Änderte sich der Pool seit Öffnung des Dialogs, brechen Sie die Prüfung ab, wählen **Aktualisieren** und öffnen die Rechnung zur erneuten Prüfung vor der Bestätigung.

#### Benachrichtigungen und späte Prüfung

Hat der zugeordnete Teilnehmer eine E-Mail-Adresse, sendet Surveyor eine Annahme-, Ablehnungs- oder Abschlussnachricht mit der angezeigten Bezeichnung des handelnden Organisators. Bei Organisatorrechnungen gehen diese bestehenden Prüfmeldungen an den ausgewählten Teilnehmer, nicht an die erfassende Person. Die gespeicherte Prüfung wird bestätigt, ohne auf E-Mail-Zustellung zu warten. Hat ein anderer Organisator dieselbe Rechnung bereits geprüft, laden Sie vor einer weiteren Aktion den gespeicherten Status neu. Prüfaktionen bleiben für Awaiting-review-Rechnungen auch im geschlossenen Pool verfügbar. Nachträgliche Annahme verlangt **Recalculate pool**, bevor die neuen Kosten in den festgeschriebenen Anteilen stehen.

Klären oder schließen Sie möglichst jede ungeprüfte Rechnung bewusst aus, bevor Sie den Pool schließen. Bei der Schließung werden Awaiting review, Rejected und Retracted ignoriert.

### Eine Berechnung vorab ansehen

1. Speichern Sie gewünschte Einstellungen, Teilnehmerfaktoren, Anpassungen und Übernahmen.
2. Wählen Sie **Preview calculation** oder bei einem geschlossenen Pool **Recalculate pool**.
3. Klappen Sie **Calculation breakdown** für die Kontextzahlen des Pools auf. Öffnen Sie separat **Example calculation** für die Rechenschritte und prüfen Sie danach die zutreffenden Bestandteile und den Calculated balance jedes Zahlers.
4. Schließen Sie den Dialog für weitere Änderungen oder bestätigen Sie die Berechnung, wenn die Beträge stimmen.

Die Vorschau speichert keine Anteile, schließt den Pool nicht, ändert keine Zahlungsmarkierungen und sendet keine E-Mails. Sie verwendet dieselben Berechnungs- und Zahlungsübertragsregeln wie die endgültige Aktion. Ändert jemand nach der Vorschau Eingaben oder erfasst eine Zahlung, aktualisieren Sie die Vorschau vor der Anwendung.

**Calculation breakdown** listet Kontextzahlen: gespeicherte Kosten, zugeordnete Teilnehmerzahl, zutreffende Tage oder Nächte, berechtigte Einheiten, Befreiungen und Gesamtgewicht sowie verwendete Zuschlags- und Rabattkategorien und relevante Abwicklungssummen. Es enthält weder Formeln noch erklärende Absätze. Das separate, zugeklappte **Example calculation** erklärt zuerst Gesamtsumme und Basis und danach die Rechnung eines geeigneten anonymen Zahlers samt Rundungsrichtung. Gibt es keinen geeigneten Zahler, können gespeicherte Kostenrechnungen die Poolsummen auch ohne eine Beispielperson erklären. Entgegengesetzte Zuschlags- und Rabattsummen bleiben auch bei Nettowirkung null sichtbar. Doppelte Beträge werden weggelassen.
**Rounding difference** zeigt den kleinen Überschuss oder Fehlbetrag der gewählten Rundung. Bei gleicher Dreiteilung von 100.00 ergeben sich aufgerundet je 33.34, insgesamt 100.02, oder abgerundet je 33.33, insgesamt 99.99. Surveyor gibt ansonsten gleichen Teilnehmern keine unterschiedlichen Centbeträge, um eine exakt passende Gesamtsumme zu erzwingen.

Die Rundung erfolgt je Teilnehmergrundanteil, bevor Übernahmegruppen zusammengeführt werden. Zuschläge, Rabatte und Rechnungserstattungen behalten ihre eingegebenen Centbeträge. Bei negativen Grundbeträgen geht Aufrunden zum größeren Wert: −33.333 wird −33.33, Abrunden ergibt −33.34.

#### Kosten und Erstattungen abgleichen

**Full pool total** sind angerechnete Rechnungskosten plus vorzeichenbehaftete aufgeschlagene Zuschläge oder Rabatte. **Base to distribute** ist die gemeinsame Summe nach Berücksichtigung umverteilter Zuschläge oder Rabatte. Umverteilung ändert, wer die vorhandenen Rechnungskosten trägt, nicht die Gesamtsumme. Aufgeschlagene Anpassungen ändern Gesamtsumme und betroffenen Teilnehmersaldo, lassen die gemeinsame Basis aber unverändert. Ohne beide Anpassungsarten sind die relevanten Beträge gleich. **Calculation breakdown** zeigt eine Kostenkennzahl; **Example calculation** erklärt den Zusammenhang.

Poolkosten und noch erforderliche Transfers sind unterschiedliche Beträge. Bei **Deduct submitter invoices from their share** mindern Rechnungsgutschriften den Saldo jedes Einreichers oder seines übernehmenden Zahlers. Ein Grundanteil von `80.00` und eine Rechnungsgutschrift von `100.00` ergeben beispielsweise einen berechneten Saldo von `-20.00`, also eine Erstattung an diesen Zahler. Früher abgewickelte Zahlungen und Erstattungen beeinflussen den berechneten Saldo ebenfalls und werden bei Zutreffen angezeigt.

Faktoren und Anwesenheit bestimmen jeden Grundanteil. Übernahmen führen diese Anteile samt Anpassungen zusammen. Weicht ein Ergebnis von Ihrer Erwartung ab, prüfen Sie Befreiungen, Faktoren, Anwesenheitsdaten und den für jede Anpassung ausgewählten Teilnehmer. Nach der Berechnung hält **View breakdown** den vollständigen Rechenweg mit Vorzeichen für jeden Zahler fest.

### Den Pool schließen und Anteile berechnen

Diese endgültige Berechnung ist bei **Open for invoices** und **Organizer invoices only** verfügbar. Sie erzeugt gespeicherte Anteile und schließt den Pool. Das alleinige Stoppen von Teilnehmereinreichungen tut keines von beidem.

Prüfen Sie vor **Preview calculation**:

1. Alle vorgesehenen Teilnehmer sind zugeordnet.
2. Die Anwesenheitsdaten stimmen für eine Verteilung nach Tagen oder Nächten.
3. Faktoren und Befreiungen sind korrekt.
4. Übernahmen sind korrekt.
5. Zuschläge, Rabatte und deren Umverteilungsmodus sind korrekt.
6. Alle vorgesehenen Rechnungen sind Accepted oder Closed.
7. **Deduct submitter invoices from their share** ist wie gewünscht eingestellt.

Danach:

1. Speichern Sie jeden Bearbeitungsdialog.
2. Wählen Sie **Preview calculation**.
3. Prüfen Sie die Vorschau und den Schalter **Email participants after this calculation**.
4. Wählen Sie **Close pool & calculate**.

Mindestens ein Teilnehmer muss zugeordnet sein. Surveyor führt dann Folgendes aus:

- Es wählt Accepted- und Closed-Rechnungen und ignoriert Awaiting review, Rejected und Retracted.
- Es berechnet die verteilbare Summe nach vorzeichenbehafteten umverteilten Anpassungen.
- Es verteilt den Base share nach Teilnehmer-, einschließlich gerechneten Tages- oder Nachtgewichten, multipliziert mit individuellen Faktoren.
- Befreite Teilnehmer erhalten keinen automatischen Base share.
- Persönliche Zuschläge und negative Rabatte werden nach der gewichteten Verteilung hinzugefügt.
- Aktivierte Rechnungsgutschriften werden angewendet.
- Begünstigte werden mit ihrem übernehmenden Zahler zusammengeführt.
- Für jeden resultierenden Zahler wird eine Anteilszeile erstellt.
- Positive Salden zeigen **Payment due**, negative **Refund due** und Nullsalden **No payment**.
- Der Pool wird **Closed**.
- Zahler mit E-Mail-Adresse erhalten eine Nachricht, wenn **Email participants after this calculation** ausgewählt ist.

Die Vorschau verwendet dasselbe **Example calculation** wie die Organisatoransicht und das PDF. Sie erklärt die gespeicherten Poolsummen und die Basis und zeigt anschließend ein anonymes Beispiel für eine Person mit fälliger Zahlung, einschließlich zutreffender Faktoren, Anpassungen oder Gutschriften. Übernimmt diese Person die Kosten anderer Teilnehmer, nennt die Einleitung deren Anzahl. Erstattungen, befreite Zahler und Nullsalden erscheinen nicht als gewöhnliche Zahlungsbeispiele. Ist kein passendes Zahlungsbeispiel verfügbar, kann die Erklärung allein die Poolsummen zeigen. Ältere Berechnungen behalten ihre verfügbaren Beträge und Notizen; einzelne Erklärungswerte können fehlen. Aktuelle Einstellungen ersetzen keine fehlenden Angaben einer früheren Berechnung.
Zutreffende Anpassungen, Rechnungsgutschriften und bereits abgewickelte Beträge erklären den berechneten Saldo. **Payments due** und vorzeichenbehaftete **Refunds due** zeigen einzuziehende beziehungsweise auszuzahlende Summen und bleiben neben relevanten Kostenangaben sichtbar.

Eine Übernahme führt den bereits berechneten Base share, Anpassungen und Invoice credit des Begünstigten in der Zahlerzeile zusammen. Der Begünstigte behält seinen Faktor; der Faktor des Zahlers wird nicht erneut angewendet. Die Basis jedes Teilnehmers wird einheitlich in der durch **Round base shares up** gewählten Richtung gerundet. Der entstehende Überschuss oder Fehlbetrag bleibt in der Vorschau sichtbar.

### Einen geschlossenen Pool neu berechnen

Verwenden Sie **Recalculate pool** nach Änderungen an Einstellungen, Zuordnungen, Faktoren, Befreiungen, Übernahmen, Zuschlägen, Rabatten, Anwesenheitsdaten oder akzeptierten Rechnungen. Während **Recalculation required** angezeigt wird, können Sie weiterhin Zahlungen auf gespeicherte Anteile erfassen.

1. Korrigieren und speichern Sie die Eingaben.
2. Erfassen Sie mit **Record payment** oder **Record refund** bereits abgeschlossene Transfers auf die gespeicherten berechneten Salden.
3. Wählen Sie **Recalculate pool** und prüfen Sie die Vorschau.
4. Entscheiden Sie über **Email participants after this calculation**.
5. Wählen Sie **Apply recalculation**.

Bereits abgewickelte Beträge werden als Gutschrift auf die neue Berechnung angerechnet. Wer beispielsweise 100.00 bezahlt hat und nun einen berechneten Anteil von 120.00 schuldet, erhält einen **Calculated balance** von `20.00`. Bei einem neuen Anteil von 80.00 ergibt sich eine Erstattung von `-20.00`. War beim alten Anteil keine Abwicklung erfasst, wird sein Betrag durch den neu berechneten Saldo ersetzt.

Die Gutschrift wird auch bei wiederholten Neuberechnungen genau einmal angerechnet. Wurde die zusätzliche Zahlung von 20.00 erfasst, bleiben bei einem späteren Anteil von 130.00 noch 10.00 zu zahlen. Erstattungen funktionieren entsprechend: Eine zuvor abgewickelte Erstattung von `-30.00` gegenüber einer korrigierten Erstattung von `-20.00` ergibt `10.00`, die zurückgezahlt werden müssen.

Zahlungen bleiben bei der Person, die sie geleistet oder erhalten hat. Ändert eine Übernahme den Zahler oder wird jemand aus diesem Pool entfernt, bleibt aber zur Veranstaltung angemeldet, kann seine vorhandene Zahlung als separater Erstattungsanteil erscheinen. Sie wird nicht stillschweigend einem anderen Zahler übertragen.

Wird ein Teilnehmer mit erfassten Zahlungen oder Erstattungen befreit oder von jemand anderem übernommen, zeigt sein gespeicherter Anteil **Exempt · settlement retained** oder **Covered by … · settlement retained**, solange ein Korrekturtransfer nötig ist. Erfassen Sie diese Erstattung oder Rückzahlung und berechnen Sie danach neu, um sie anzuwenden. Erreicht der übertragene Saldo null, verschwindet der Hinweis: Ein befreiter Teilnehmer behält seinen normalen Nullanteil und die Beschriftung **Own share**; ein von jemand anderem übernommener früherer Zahler benötigt keine separate Zeile mehr. Die Hinweise beschreiben die gespeicherte Berechnung. Ausstehende Änderungen ersetzen sie nicht. Der Teilnehmer erhält **Your payment responsibility changed**, sobald eine Neuberechnung die Befreiung oder geänderte Übernahme anwendet, auch bei deaktivierten allgemeinen Berechnungs-E-Mails. Bereits abgewickelte Gutschriften bleiben vorzeichenbehaftete Nettobeträge, kein vollständiges chronologisches Transferbuch.

Der Pool bleibt geschlossen und Rechnungsprüfungen bleiben unverändert. Eine fehlgeschlagene Berechnung erhält alte Anteile und Zahlungen. Haben sich Eingaben oder Zahlungen geändert, aktualisieren Sie vor der Anwendung die Vorschau. Speichern Sie offene Dialoge oder wählen Sie vor der Berechnung **Discard edits**.

### Pooländerungen zurücknehmen

Verwenden Sie **Roll back pool changes**, wenn Sie die letzte Berechnung behalten möchten, statt gespeicherte Pooländerungen anzuwenden.

1. Öffnen Sie den geschlossenen Pool mit **Recalculation required**.
2. Wählen Sie **Roll back pool changes** und lesen Sie die Bestätigung.
3. Wählen Sie **Restore last calculated settings**, lesen Sie das Ergebnis und wählen Sie danach **Return to pool**.

Die Rücknahme stellt Beschreibung, Verteilungseinstellungen, Rundungsrichtung, E-Mail-Voreinstellung, Zuordnungen, Faktoren, Befreiungen, Zuschläge und Rabatte sowie Übernahmen aus der letzten erfolgreichen Berechnung wieder her. Bestehende Anteile und erfasste Zahlungen bleiben erhalten. Es wird keine Berechnungs-, Abrechnungs- oder Übernahme-E-Mail gesendet.

Die Rücknahme macht Änderungen an Veranstaltungsanmeldungen, Anwesenheitsdaten, Rechnungsprüfungen oder Organisatorausgaben nicht rückgängig. Sie löscht keine gespeicherte Organisatorausgabe und erstellt keine gelöschten Teilnehmer neu. Haben sich diese Angaben seit der letzten Berechnung geändert, kann der Pool trotz wiederhergestellter Einstellungen weiterhin eine Neuberechnung verlangen. Prüfen Sie die Ergebnismeldung.

Bei einigen älteren geschlossenen Pools sind die zuletzt berechneten Einstellungen nicht verfügbar. Berechnen Sie erfolgreich neu, bevor Sie die Rücknahme verwenden. Stammt eine ältere Berechnung aus der Zeit vor der Rundungsauswahl, stellt die Rücknahme ihre Einstellungen mit aktiviertem Aufrunden wieder her; eine Neuberechnung bleibt erforderlich. **Discard edits** setzt nur ungespeicherte Formularfelder zurück; **Roll back pool changes** stellt gespeicherte Pooleinstellungen wieder her. Eine bereits angewendete Neuberechnung wird nicht rückgängig gemacht. Sind frühere Übernahmeangaben nicht verfügbar, lässt Surveyor Eingaben und Abwicklungen unverändert und bittet vor einer Rücknahme um Neuberechnung.

### Abrechnungs-E-Mails senden

**Send calculation emails automatically** unter **Pool settings** steuert die Voreinstellung. **Email participants after this calculation** erlaubt eine abweichende Auswahl vor Schließung oder Neuberechnung. Bei einem neuen Pool sind beide aktiviert. Diese Auswahl steuert Abrechnungsnachrichten; Benachrichtigungen über bei erfolgreicher Neuberechnung angewendete Übernahmeänderungen werden dadurch nicht deaktiviert.

Für spätere Nachrichten öffnen Sie einen geschlossenen Pool, wählen **Send settlement emails** und bestätigen. Das funktioniert auch bei ausgeschalteten automatischen E-Mails. Es sendet an Zahler mit E-Mail-Adresse, ohne neu zu berechnen, Zahlungsmarkierungen zu ändern oder Geld zu bewegen. Der Dialog schließt, wenn Surveyor den Erfolg der Anfrage bestätigt. Bei Fehlern oder unbestätigtem Erfolg bleibt er mit Rückmeldung geöffnet.

E-Mails zeigen **Your calculated balance**, Status, Veranstaltung und Pool sowie **View your invoice pool** weit oben. **Payment due**, **Refund due**, **Paid**, **Refunded** oder **No payment** beschreibt den aktuellen Status. **Saved calculation notes** erhält die ursprünglich gespeicherten Notizen und verfassten Beschreibungen vor und außerhalb der vollständigen **Calculation explanation**. Wählen Sie **Calculation explanation**, um sie aufzuklappen, sofern Ihr E-Mail-Programm dies unterstützt. Andere Programme zeigen den vollständigen Inhalt möglicherweise direkt. Die konkrete Berechnung verwendet Ihren Namen und gegebenenfalls die Namen übernommener Teilnehmer, um jeden tatsächlichen Grundanteil und sämtliche zutreffenden Saldobestandteile zu erklären. Die gespeicherten Notizen bleiben erhalten und werden weder ersetzt noch umgeschrieben. Klartext-E-Mails enthalten immer die vollständige Erklärung und die Notizen. Bei geänderten Eingaben beschreibt die Nachricht die bisherige gespeicherte Berechnung. Die Zustellung hängt vom E-Mail-Dienst der Installation ab.

### Erfassen, ob ein Anteil abgewickelt ist

Nach Schließung enthält **Shares & settlement** die Übersicht **Calculated shares**. Jede Zeile zeigt **Payer**, den vorzeichenbehafteten **Calculated balance** und einen kompakten Zahlungs- oder Erstattungsstatus. Der Status bezieht sich auf den benannten Zahler. **View breakdown** öffnet zutreffende gespeicherte Bestandteile, Notizen und die konkrete **Calculation explanation**. Das separate **Example calculation** des Pools erklärt Gesamtsumme und Basis und zeigt gegebenenfalls ein anonymes Zahlerbeispiel. **Calculation breakdown** listet poolweite Kontextzahlen und relevante Abwicklungssummen ohne Formeln oder Erklärungen. Telefone und Tablets zeigen dieselben Informationen als Karten. Gespeicherte Anteile bleiben auch bei erforderlicher Neuberechnung verfügbar.

**Filter share status** bietet **All statuses**, **Payment due**, **Refund due** und **Settled**. Verwenden Sie **Search shares**, **Sort shares**, **Shares per page**, **Previous** und **Next** zur Navigation. Die Erfassung eines Transfers aktualisiert den Status, behält aber berechneten Saldo und aktuelle Zeilenreihenfolge bei. **Refresh list** wendet Filter und Sortierung neu an. Die Funktion wird nach einer Statusänderung bei aktivem Filter hervorgehoben.

Nachdem der tatsächliche Transfer abgeschlossen ist:

1. Prüfen Sie Zahler und vorzeichenbehafteten **Calculated balance**.
2. Wählen Sie bei positivem Saldo **Record payment**, bei negativem **Record refund**.
3. Prüfen Sie **Confirm invoice action** einschließlich Betrag und Transferrichtung.
4. Wählen Sie erneut **Record payment** beziehungsweise **Record refund** und warten Sie auf Bestätigung.

**Cancel**, die Schließen-Schaltfläche, Escape und das Schließen über den Hintergrund lassen den gespeicherten Zustand unverändert. Die Prüfung fokussiert zunächst **Cancel**. Scrollen über einem fokussierten numerischen Rechnungsfeld verändert dessen Entwurfsbetrag nicht schrittweise.

Die laufende Aktion zeigt einen Fortschrittsindikator. Erfolg zeigt **Paid** oder **Refunded**, erhält den vorzeichenbehafteten berechneten Saldo und aktualisiert **Payments due** beziehungsweise **Refunds due**. Warten Sie vor einer weiteren Aktion auf das Ergebnis. Bei vorhandener Adresse sendet Surveyor dem Zahler eine E-Mail.

Um eine falsche Erfassung zu korrigieren, wählen Sie **Undo payment** oder **Undo refund**, prüfen den vorzeichenbehafteten Betrag und bestätigen dieselbe Aktion. Dadurch wird **Payment due** oder **Refund due** wiederhergestellt, während berechneter Saldo und Gutschriften aus früheren Berechnungen erhalten bleiben. Machen Sie fehlerhafte Erfassungen vor einer neuen Berechnung rückgängig.

### Gespeicherte Anteile als PDF exportieren

1. Öffnen Sie die Übersicht **Calculated shares** des Pools.
2. Wählen Sie **Export shares PDF with example** oder **Export shares PDF without example**.
3. Speichern oder drucken Sie das Dokument im A4-Hochformat.

Beide PDF-Varianten beginnen mit **Calculation breakdown** und gespeicherten Kontextzahlen: relevante Kosten, verwendete vorzeichenbehaftete Anpassungskategorien sowie zutreffende Teilnehmer-, Tages-/Nacht-, Einheiten-, Befreiungs- und Gesamtgewichtsangaben. Dieser Bereich enthält keine Formeln oder erklärenden Absätze. Diese Zahlen bleiben unabhängig von einem Beispiel verfügbar. Gewöhnliche Pools ohne Anpassungen verwenden eine Kostenkennzahl, statt gleiche Kostenebenen mehrfach aufzuführen.

**Export shares PDF with example** ergänzt dasselbe **Example calculation** wie Organisatoransicht und Vorschau. Es erklärt Gesamtsumme und gemeinsame Basis mit den gespeicherten Beträgen und zutreffenden Anpassungen. Ein anonymes Zahlungsbeispiel kann Anwesenheit, Anteilsfaktor, Gesamtgewicht, gerundeten Grundanteil und Saldobestandteile zeigen. Ein umverteilter Zuschlag senkt die gemeinsame Basis und wird anschließend zum betroffenen Anteil addiert, ohne die Gesamtsumme zu erhöhen. Übernimmt die Beispielperson die Kosten anderer Teilnehmer, nennt die Einleitung deren Anzahl vor der Erklärung des zusammengeführten Grundanteils. Dieses Beispiel ist von Ihrer persönlichen Erklärung in **View breakdown** und E-Mails getrennt. Ältere Berechnungen behalten verfügbare Beträge und Notizen. Ist kein passendes Zahlungsbeispiel verfügbar, kann der Export allein die Poolsummen erklären. Ist für die frühere Berechnung keine Erklärung verfügbar, erscheint kein Beispielabschnitt.

**Export shares PDF without example** enthält Kontextzahlen, Anteile, ursprüngliche sachliche Notizen, Abwicklungsstatus und -daten sowie Transfersummen. Es enthält keine Rechenerklärungen oder Formeln. Zutreffende Anwesenheits- und Verteilungszahlen bleiben in **Calculation breakdown**. Ein veralteter kompakter Export verwendet den kurzen Hinweis **Recalculation required**. Seine gespeicherten Anteile und Abwicklungssummen stimmen mit der Variante mit Beispiel überein.

Die Tabelle enthält jeden gespeicherten Anteil des Pools, unabhängig von Suche, Statusfilter, Sortierung oder Seite auf dem Bildschirm. Die zutreffenden Teilbeträge, der vorzeichenbehaftete **Calculated balance**, Status und gespeicherte Notizen jedes Zahlers erscheinen, ohne Formel oder Saldo unter jeder Zeile zu wiederholen. Erfasste Abwicklungen zeigen **Paid** oder **Refunded** und bei Verfügbarkeit das Abwicklungsdatum. **Saved settlement totals** enthält **Payments due** und vorzeichenbehaftete **Refunds due** für noch zu erfassende Transfers sowie zutreffende Rechnungsgutschriften, frühere Zahlungsüberträge und in dieser Berechnung erfasste **Payments received** beziehungsweise negative **Refunds paid**. Abgewickelte Beträge sind aus den fälligen Summen ausgeschlossen, während ihr ursprünglicher berechneter Saldo sichtbar bleibt. Bei **Recalculation required** stammen die exportierten Anteile aus der vorherigen gespeicherten Berechnung. Ein Export berechnet den Pool nicht neu und ändert keine Zahlungen.

Der Export erfordert Zugriff auf die Rechnungspoolverwaltung. Behandeln Sie die heruntergeladene Datei als finanzielle Teilnehmerdaten und teilen Sie sie nur mit berechtigten Empfängern.

## Datenschutz, Belegzugriff, Speicherung und Aufbewahrung

Rechnungsdaten sind sensibel. Ein Beleg kann Privatadressen, Bank- oder Kartenangaben, Steuerkennzeichen, einzelne Einkäufe oder Namen Dritter enthalten.

- Teilnehmer sehen ihre eigene Rechnungshistorie und eigene Belege.
- Organisatoren mit **Manage Assignments** sehen alle Rechnungen und Belege der Veranstaltungspools.
- Nicht zugeordnete Organisatorausgaben und optionale Belege erscheinen in der Organisatorübersicht ohne Teilnehmerhistorieneintrag. Wählt ein Organisator **Paid by participant (optional)**, erscheinen Rechnung und optionaler Beleg nach den bestehenden Zugriffsregeln auch in der Historie dieses Teilnehmers. Der gespeicherte Organisatorname bleibt unabhängig auf der Rechnung erhalten, wenn sein Profil später gelöscht wird.
- Andere Teilnehmer sehen weder Betrag, Beschreibung, Beleg, Korrektur noch Ablehnungsgrund fremder Rechnungen.
- Teilnehmer eines offenen Pools sehen die zur Übernahmeverwaltung benötigten Namen, aber keine fremde Rechnungsübersicht.
- Laden Sie nur die erforderlichen Nachweise hoch und vermeiden Sie sachfremde persönliche Angaben.
- Gewähren Sie keine Rechnungspoolverwaltung allein dafür, dass jemand die Veranstaltungsübersicht sehen soll.
- Laden Sie Belege nur bei betrieblicher Notwendigkeit herunter, bewahren Sie Kopien sicher auf und entfernen Sie lokale Kopien entsprechend den Datenschutzregeln Ihrer Gruppe.

JPEG-, PNG-, GIF- und PDF-Belege sind auf 10 MiB begrenzt.

Rechnungen und Belege bleiben für die vom Surveyor-Betreiber festgelegte Dauer ab dem Enddatum der Veranstaltung erhalten. Nach dieser Frist werden sie dauerhaft entfernt und betroffene Poolsummen aktualisiert. Rechnungshistorie und Belege sind danach in Surveyor nicht mehr verfügbar. Sicherungskopien können einer eigenen Aufbewahrungsregel unterliegen.

Die automatische Bereinigung erhält zuvor berechnete Abrechnungsanteile und verlangt selbst keine Neuberechnung. Eine spätere Neuberechnung verwendet nur noch vorhandene Rechnungen. Schließen Sie Korrekturen daher vor dem Ablauf der betreffenden Rechnungen ab.

Fragen Sie Ihren Organisator oder Surveyor-Betreiber, wie lange Rechnungen aufbewahrt werden. Schließen Sie Korrekturen ab und bewahren Sie erlaubte Kopien auf, bevor die Frist endet.

## Problemlösung

### Ich sehe **Invoice pools & payments** nicht

Prüfen Sie:

- Das aktive Profil ist zur Veranstaltung angemeldet.
- Die Veranstaltung hat mindestens einen Rechnungspool.
- Sie verwenden dasselbe Profil, dem die Anmeldung gehört.

### Ich sehe die Rechnungshistorie, kann aber nichts einreichen

Einreichungen verlangen einen offenen, Ihrer Anmeldung zugeordneten Pool. Ein Organisator könnte ihn geschlossen, Ihre Zuordnung entfernt oder ihn für eine andere Teilnehmergruppe erstellt haben.

### Meine Rechnung ist nicht in der Summe enthalten

Nur Accepted und Closed zählen. Awaiting review, Rejected und Retracted sind ausgeschlossen. Bitten Sie einen Organisator um Prüfung einer noch ungeprüften Rechnung. Ist der Pool bereits geschlossen, muss er zusätzlich neu berechnet werden, bevor neu akzeptierte Kosten in den festgeschriebenen Anteilen stehen.

### Mein akzeptierter Betrag oder meine Beschreibung hat sich geändert

Organisatoren können Betrag oder Beschreibung bei der Annahme korrigieren und spätere Korrekturen bei Accepted oder Closed bestätigen. Ihre Historie erhält und zeigt die ursprüngliche Einreichung. Fragen Sie den Organisator, wenn die Korrektur unerwartet ist.

### Ich kann unter **Manage takeovers** jemanden nicht auswählen

Die Person muss demselben offenen Pool zugeordnet sein. Sie können weder sich selbst noch bereits von einem anderen Zahler übernommene Personen wählen oder eine Kette von Übernahmebeziehungen erzeugen. Bitten Sie einen Organisator, eine bestehende Übernahme neu zuzuordnen.

### Ein Anteil weicht von der einfachen Gleichverteilung ab

Prüfen Sie Verteilungsmodus, Anwesenheitsdaten, individuelle Faktoren, Befreiungen, umverteilte und aufgeschlagene Anpassungen, Rechnungsgutschriften und Übernahmen. Öffnen Sie **View breakdown**, um **Saved calculation notes** und gespeicherte numerische Eingaben zu lesen.

### Der Pool hat sich geändert, die Anteile aber nicht

Die Berechnung eines geschlossenen Pools bleibt gespeichert, bis Sie eine Neuberechnung anwenden. Speichern Sie Änderungen im jeweiligen Dialog und prüfen und berechnen Sie danach neu. Alternativ stellt **Roll back pool changes** gespeicherte Pooleingaben wieder her. **Record payment** und **Record refund** bleiben währenddessen für die gespeicherten Salden verfügbar.

### Ein neu berechneter Anteil verlangt eine Zahlung, obwohl ich schon bezahlt habe

Prüfen Sie **Previously settled** und **Calculated balance** unter **View breakdown**. Frühere Zahlungen senken den neuen Saldo. Nur die neue Differenz muss abgewickelt werden. Ein Nullsaldo zeigt **No payment**. Eine Erstattung hat einen negativen berechneten Saldo.

### Eine erwartete E-Mail ist nicht angekommen

Benachrichtigungen benötigen eine E-Mail-Adresse am Teilnehmerkonto oder Gastprofil und funktionierenden E-Mail-Versand der Surveyor-Installation. Prüfen Sie den Spamordner und die Profiladresse. Sind mehrere Empfänger betroffen, bitten Sie den Betreiber um Prüfung des Versands.

### Ein Beleg ist nicht verfügbar

Prüfen Sie, ob Sie Ihre eigene Rechnung öffnen oder zur Rechnungspoolverwaltung berechtigt sind. Der Beleg könnte außerdem die Aufbewahrungsgrenze der Installation erreicht haben. Organisatoren sollten den Betreiber kontaktieren, statt sensible Belege über einen nicht freigegebenen Kanal auszutauschen.

---

**Verwandte Anleitungen:** [Veranstaltungen](EVENTS.md) · [Berechtigungen und Freigaben](PERMISSIONS.md) · [Erste Schritte](GETTING_STARTED.md)

**Zurück zu:** [Startseite der Benutzerhilfe](README.md)
