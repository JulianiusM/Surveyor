# Erste Schritte mit Surveyor
<!--
documentation-metadata
audience: neue Nutzer; Gäste; registrierte Nutzer
owner: identity feature maintainers
status: current
last-verified: 2026-10-20
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Migrated controls and exact localized labels source-reconciled with current component/catalog owners; settings save/discard, refresh and notice wording corrected where applicable. Native business reference, declared anchors and image bytes retained; no new browser execution claimed.
source-anchors: src/controller/userController.ts; src/locales/de.json; src/frontend/features/identity/IdentityPage.vue; src/frontend/features/overview/OverviewPage.vue; src/frontend/features/identity/; src/frontend/components/CommandFeedback.vue; src/locales/; src/frontend/; src/controller/helpController.ts
heading-anchors: 1:getting-started-with-surveyor; 2:find-your-task; 2:choose-how-to-enter-surveyor; 2:create-and-activate-a-local-account; 3:activation-link-problems; 2:sign-in-with-an-organization-account; 2:log-in-to-a-local-account; 3:reset-a-local-password; 2:join-an-invitation-as-a-guest; 3:when-the-email-already-has-guest-accounts; 3:what-a-guest-account-can-do; 2:recover-guest-access-by-email; 2:understand-accounts-and-profiles; 2:edit-the-active-profile; 2:create-or-switch-profiles-on-a-full-account; 3:create-another-profile; 3:switch-profiles; 2:move-a-profile-to-another-full-account; 3:obtain-the-token-from-the-profile-being-moved; 3:complete-the-migration-in-the-receiving-account; 2:deactivate-a-profile-or-delete-an-account; 3:deactivate-one-profile-on-a-full-account; 3:delete-a-full-or-guest-account; 2:troubleshooting; 3:i-do-not-see-local-registration-or-password-fields; 3:local-login-says-the-account-is-not-activated; 3:i-requested-a-password-reset-but-received-no-email; 3:i-requested-guest-access-but-received-no-email; 3:my-overview-does-not-show-the-item-i-expected; 3:a-migration-token-is-rejected; 2:next-steps
next-review: identity-or-authentication-visible-behavior-change
production-reference: 2dfa257 native business comparator with current German migrated controls and approved exceptions; not an installed production commit
-->

Diese Anleitung hilft dir, Surveyor zu öffnen, deinen Zugang wiederherzustellen und das Profil zu verwalten, das dich repräsentiert. Die Beschriftungen entsprechen der deutschen Ansicht; englische E-Mail-Betreffzeilen und Schaltflächen in E-Mails bleiben zur Wiedererkennung angegeben.

Surveyor-E-Mails beginnen mit einer Anrede mit deinem Konto- oder Profilnamen. Auch im Empfängerfeld steht dieser Name neben deiner E-Mail-Adresse. Eine E-Mail zur Gastwiederherstellung kann mehrere Gastidentitäten derselben Adresse nennen.

Kurze Aktionsmeldungen verschwinden nach zehn Sekunden und können vorher geschlossen werden. Hinweise auf ungültige Eingaben, Prüfungen, Wiederherstellung, notwendige Anmeldungen oder laufende Aktionen bleiben sichtbar, solange sie relevant sind. Warte auf die Speicherbestätigung, bevor du eine noch laufende Aktion wiederholst.

## Deine Aufgabe finden

| Ich möchte … | Weiter zu … |
|---|---|
| Ein Konto mit Benutzername und Passwort erstellen | [Lokales Konto erstellen und aktivieren](#create-and-activate-a-local-account) |
| Mich über meine Organisation anmelden | [Mit einem Organisationskonto anmelden](#sign-in-with-an-organization-account) |
| Ein lokales Passwort zurücksetzen | [Lokales Passwort zurücksetzen](#reset-a-local-password) |
| Ohne vollständiges Konto einer Einladung folgen | [Über eine Einladung als Gast teilnehmen](#join-an-invitation-as-a-guest) |
| Ein Gastkonto wiederherstellen | [Gastzugang per E-Mail wiederherstellen](#recover-guest-access-by-email) |
| Meine Identität umbenennen oder wechseln | [Konten und Profile verstehen](#understand-accounts-and-profiles) |
| Ein Gastprofil oder anderes Profil in ein anderes Konto verschieben | [Profil in ein anderes vollständiges Konto übertragen](#move-a-profile-to-another-full-account) |
| Zugang endgültig entfernen | [Profil deaktivieren oder Konto löschen](#deactivate-a-profile-or-delete-an-account) |

## Den Zugangsweg zu Surveyor wählen

Eine Surveyor-Installation kann eine oder beide Anmeldemethoden für vollständige Konten anbieten:

| Methode | Das verwendest du | Einrichtung beim ersten Mal |
|---|---|---|
| Lokales Konto | Surveyor-Benutzername oder E-Mail-Adresse und Passwort | Registrieren, Konto per E-Mail aktivieren, dann anmelden. |
| Organisationsanmeldung | **Mit _Anbietername_ anmelden** oder automatische Weiterleitung zum Anbieter | Beim Anbieter anmelden; Surveyor erstellt oder verknüpft ein vollständiges Konto. |

Du kannst einer Einladung auch als **Gast** folgen. Gäste setzen kein Passwort und besitzen ein Gastprofil. Sie erhalten einen privaten Zugangslink und können über **Deine Übersicht** zu den Einträgen dieses Profils zurückkehren.

Die angezeigten Seiten hängen von der Konfiguration dieser Installation ab. **Anmelden** oder **Registrieren** kann lokale Kontofelder, eine Schaltfläche zur Organisationsanmeldung, beides oder sofort die Anmeldeseite der Organisation öffnen.

## Lokales Konto erstellen und aktivieren

Diese Schritte gelten, wenn **Registrieren** Felder für Benutzername, E-Mail und Passwort zeigt.

1. Wähle **Registrieren** in der oberen Navigation.
2. Fülle das Formular aus:
   - **Benutzername**: eindeutiger Benutzername für die lokale Anmeldung.
   - **Anzeigename**: erster Name, den andere Teilnehmer sehen.
   - **E-Mail**: für Aktivierung und Passwortwiederherstellung.
   - **Passwort** und **Passwort wiederholen**: Passwort und Wiederholung.
3. Verwende mindestens 8 Zeichen, mindestens einen Buchstaben und mindestens eine Ziffer.
4. Prüfe, ob beide Passwörter übereinstimmen, und wähle **Registrieren**.
5. Öffne die E-Mail mit dem Betreff **Activate your account** und wähle innerhalb einer Stunde **Activate account**.
6. Wenn Surveyor **Anmelden** öffnet, gib unter **Benutzername oder E-Mail** Benutzername oder E-Mail sowie das Passwort ein und wähle **Anmelden**.

Die Registrierung meldet dich nicht an. Vor der ersten lokalen Anmeldung musst du das Konto aktivieren.

Surveyor erstellt das erste Profil aus dem bei der Registrierung angegebenen Anzeigenamen. Nach der Anmeldung ist dieses Profil aktiv, und Surveyor öffnet **Deine Übersicht**.

### Probleme mit dem Aktivierungslink

Ein Aktivierungslink ist eine Stunde gültig und kann einmal verwendet werden. Ungültige, abgelaufene oder bereits verwendete Links werden abgewiesen.

Ist der Link eines inaktiven Kontos abgelaufen, verschickt Surveyor bei einem Anmeldeversuch eine neue Aktivierungs-E-Mail. Prüfe die bei der Registrierung angegebene Adresse und den Spamordner. Wende dich an den Betreiber, wenn keine verwendbare E-Mail ankommt.

## Mit einem Organisationskonto anmelden

Diese Schritte gelten, wenn Surveyor **Mit _Anbietername_ anmelden** zeigt oder dich zur Anmeldung einer Organisation weiterleitet.

1. Wähle die Organisationsanmeldung, falls sie angezeigt wird.
2. Melde dich beim externen Anbieter an.
3. Bestätige gegebenenfalls die vom Anbieter verlangte Freigabe.
4. Nach der Rückkehr öffnet Surveyor **Deine Übersicht** mit dem aktiven Profil.

Die erste erfolgreiche Anmeldung beim Anbieter erstellt ein aktives Surveyor-Konto und Profil, falls noch keines vorhanden ist. Liefert der Anbieter eine E-Mail-Adresse, die bereits ein Surveyor-Konto verwendet, kann Surveyor die Anbieteridentität stattdessen mit diesem Konto verbinden.

Die Zugangsdaten dieser Methode verwaltet der externe Anbieter. Nutze dessen Kontowiederherstellung statt **Passwort vergessen?** in Surveyor.

## Bei einem lokalen Konto anmelden

1. Wähle **Anmelden**.
2. Trage unter **Benutzername oder E-Mail** den Surveyor-Benutzernamen oder die E-Mail-Adresse des Kontos ein.
3. Gib das Passwort ein.
4. Wähle **Anmelden**.

Surveyor öffnet **Deine Übersicht** und aktiviert das Standardprofil des Kontos. Ist kein Profil als Standard markiert, verwendet Surveyor das älteste Profil des Kontos.

### Lokales Passwort zurücksetzen

1. Wähle auf **Anmelden** den Link **Passwort vergessen?**.
2. Gib unter **Benutzername oder E-Mail** Benutzername oder E-Mail-Adresse des Kontos ein.
3. Wähle **Link zum Zurücksetzen senden**.
4. Öffne die E-Mail mit dem Betreff **Reset your password** und wähle innerhalb einer Stunde **Reset password**.
5. Gib das neue Passwort zweimal ein und wähle **Passwort ändern**.

Das neue Passwort braucht mindestens 8 Zeichen, mindestens einen Buchstaben und mindestens eine Ziffer. Beide Eingaben müssen übereinstimmen.

Aus Datenschutzgründen zeigt Surveyor dieselbe Bestätigung, unabhängig davon, ob ein Konto zur Eingabe passt. Kommt keine E-Mail an, prüfe Schreibweise, Spamordner und ob das Konto normalerweise die Organisationsanmeldung verwendet. Ein Rücksetzlink läuft nach einer Stunde ab und kann nach der Passwortänderung nicht wiederverwendet werden.

## Über eine Einladung als Gast teilnehmen

Gastzugang ist hilfreich, wenn du teilnehmen möchtest, ohne ein vollständiges Konto zu erstellen.

1. Öffne den Einladungslink des Organisators.
2. Wähle auf **Bei „…“ mitmachen** gegebenenfalls einen vorhandenen Kontoweg:
   - **Anmelden** für ein vollständiges Konto;
   - **Gastkonto wiederherstellen** für eine bestehende Gastidentität; oder
   - **Konto erstellen** für ein neues vollständiges Konto.
3. Fahre zum Gastformular fort, wenn du eine separate Gastidentität erstellen möchtest.
4. Gib im Feld **Anzeigename** deinen Namen ein. Diesen Namen sehen andere Teilnehmer zunächst.
5. Gib möglichst eine E-Mail-Adresse an. Sie ist optional, ermöglicht aber die Wiederherstellung dieses Gastkontos.
6. Wähle **Als Gast fortfahren**.

Surveyor meldet dich beim neuen Gastkonto an und öffnet den eingeladenen Eintrag. Außerdem erstellt es einen privaten Zugangslink. Wenn du eine E-Mail-Adresse angegeben hast, wird der Link auch dorthin geschickt.

Halte den privaten Link geheim. Wer ihn verwenden kann, kann dieses Gastkonto betreten. Abmelden macht ihn nicht ungültig; bewahre ihn oder die Wiederherstellungs-E-Mail auf, um später zurückzukehren.

### Wenn die E-Mail-Adresse schon Gastkonten hat

Erkennt Surveyor die eingegebene Adresse, kann **Gastkonto gefunden!** erscheinen. Wähle:

- **Gastkonto wiederherstellen**, um die vorhandenen Gastlinks zu erhalten; oder
- **Als neuer Gast fortfahren**, um ein weiteres eigenständiges Gastkonto zu erstellen.

Eine E-Mail-Adresse kann mehreren Gastkonten zugeordnet sein. Jeder private Link öffnet genau ein bestimmtes Gastkonto und Profil.

### Was ein Gastkonto kann

Ein Gastkonto hat ein Profil und kein Passwort. Angemeldete Gäste können:

- **Deine Übersicht** öffnen und zu Einträgen ihres Gastprofils zurückkehren;
- an eingeladenen Funktionen im dort erlaubten Umfang teilnehmen;
- ihren Profilnamen ändern;
- ein Übertragungstoken erhalten und das Gastprofil in ein vollständiges Konto verschieben; und
- sich abmelden und per privatem Link oder E-Mail-Wiederherstellung zurückkehren.

Gäste können keine neuen Umfragen, Veranstaltungen, Listen oder Pläne erstellen und keine weiteren Profile anlegen oder zwischen mehreren Profilen wechseln. Funktionsaktionen hängen gegebenenfalls vom Eintrag und seinen Freigaben ab; Einzelheiten stehen in der jeweiligen Anleitung.

## Gastzugang per E-Mail wiederherstellen

Die Wiederherstellung per E-Mail funktioniert nur für Gastkonten, die mit einer E-Mail-Adresse erstellt wurden.

1. Wähle **Anmelden**.
2. Suche **Suchst du dein Gastkonto?**.
3. Gib die bei der Gastregistrierung verwendete E-Mail-Adresse ein.
4. Wähle **Zugang anfordern**.
5. Öffne die E-Mail mit dem Betreff **Your guest accounts**.
6. Wähle **Open _Gastname_** für das gewünschte Konto.

Die E-Mail enthält jedes Gastkonto dieser Adresse mit Gastname und Erstellungszeit. Bei einem Ergebnis lautet die Überschrift **Your guest account**. Ein privater Link meldet dich beim zugehörigen Gastkonto an und öffnet normalerweise **Deine Übersicht**.

Aus Datenschutzgründen bestätigt die Seite die Anfrage auch dann, wenn kein Gastkonto zur Adresse passt. Prüfe bei ausbleibender E-Mail Schreibweise und Spamordner. Ein ohne E-Mail erstelltes Gastkonto benötigt seinen gespeicherten privaten Link und kann diese Wiederherstellung nicht verwenden.

Jeder Link öffnet immer das daneben genannte Gastkonto. Fordere verlorene Links erneut per E-Mail an und wähle das richtige Konto, statt unnötig ein Duplikat anzulegen.

## Konten und Profile verstehen

Ein **Konto** dient der Anmeldung. Ein **Profil** ist die Teilnehmeridentität, die Surveyor-Einträge besitzt, verwaltet oder daran teilnimmt.

- Ein vollständiges Konto kann mehrere Profile haben, aber nur eines ist gleichzeitig aktiv.
- Ein Gastkonto hat ein Profil.
- Jedes Profil besitzt einen eigenen Anzeigenamen sowie eigene Teilnahme- und Eigentumsbeziehungen.
- Ein Profilwechsel ändert die Einträge in **Deine Übersicht** und die Identität für neue Aktionen.

Der Benutzername eines lokalen Kontos ist nicht der Profilname. Die Umbenennung eines Profils ändert den sichtbaren Teilnehmernamen, aber nicht den Benutzernamen für die lokale Anmeldung. In E-Mails zur Gastwiederherstellung behält das Gastkonto seinen ursprünglichen Namen, auch nach einer Umbenennung des Profils.

## Das aktive Profil bearbeiten

1. Öffne das Benutzermenü mit dem aktuellen Profilnamen.
2. Wähle **Profileinstellungen**.
3. Ändere bei Bedarf **Profilname**.
4. Wähle bei einem vollständigen Konto **Standardprofil**, wenn dieses Profil bei der Anmeldung automatisch aktiv werden soll.
5. Wähle **Änderungen speichern**.

Die Auswahl eines Standardprofils hebt das bisherige Standardprofil desselben Kontos auf. Ist keines markiert, wählt Surveyor bei der nächsten Anmeldung das älteste Profil.

## Profile in einem vollständigen Konto erstellen oder wechseln

Mehrere Profile sind nützlich, wenn eine Anmeldung unterschiedliche Menschen repräsentieren soll, etwa Familienmitglieder, oder getrennte Teilnehmeridentitäten nötig sind.

### Ein weiteres Profil erstellen

1. Öffne im Benutzermenü **Deine Profile**.
2. Wähle **Neues Profil erstellen**.
3. Gib im Feld **Profilname** den gewünschten Namen ein.
4. Wähle **Neues Profil erstellen**.
5. Kehre zu **Deine Profile** zurück und wähle beim gewünschten Profil **Zu diesem Profil wechseln**.

### Profile wechseln

1. Öffne im Benutzermenü **Deine Profile**.
2. Wähle neben der gewünschten Identität **Zu diesem Profil wechseln**.

In der deutschen Navigation kannst du das Profil auch direkt unter **Deine Profile** über **Profil auswählen** wechseln. Bestätige den Wechsel und entscheide vorher, ob du noch ungespeicherte Änderungen speichern oder verwerfen möchtest.

Das ausgewählte Profil wird sofort aktiv. Prüfe den Profilnamen im Menü, bevor du abstimmst, dich anmeldest, einen Gegenstand übernimmst oder Inhalte erstellst.

## Profil in ein anderes vollständiges Konto übertragen

Eine Profilübertragung erhält das Profil einschließlich seiner bisherigen Teilnahme- und Eigentumsbeziehungen und ändert nur das steuernde vollständige Konto. So kannst du ein Gastprofil in ein vollständiges Konto übernehmen oder ein Profil zwischen vollständigen Konten verschieben.

### Token vom zu übertragenden Profil erhalten

1. Melde dich beim Gastkonto oder vollständigen Konto an, das das Profil derzeit steuert.
2. Aktiviere dieses Profil.
3. Öffne **Profileinstellungen**.
4. Wähle **Token zur Profilübertragung anzeigen**.
5. Kopiere das Token und halte es geheim.

Das Token gewährt Kontrolle über das Profil und gilt 24 Stunden. Ein neu erzeugtes Token ersetzt das vorherige. Teile es nur mit dem vorgesehenen Empfängerkonto.

### Übertragung im Empfängerkonto abschließen

1. Melde dich vom bisherigen Konto ab.
2. Melde dich beim vollständigen Konto an, das das Profil erhalten soll.
3. Öffne im Benutzermenü **Deine Profile**.
4. Wähle **Profil zum Konto übertragen**.
5. Füge das Token ein und wähle **Zu übertragendes Profil anzeigen**.
6. Prüfe das angezeigte Profil und seinen derzeitigen Eigentümer.
7. Wähle **Profil dauerhaft übertragen**.
8. Wähle unter **Deine Profile** **Zu diesem Profil wechseln**, sobald du die übertragene Identität verwenden möchtest.

Die Übertragung entfernt das Profil vom bisherigen Eigentümer. Surveyor schließt ein bisheriges Gastkonto nach der Übertragung seines Profils. Auch ein bisheriges vollständiges Konto wird geschlossen, wenn dies sein letztes Profil war. Ist eine E-Mail-Adresse vorhanden, verschickt Surveyor eine Übertragungsbenachrichtigung und gegebenenfalls eine Nachricht zur Kontoschließung.

Deaktiviere ein Profil nicht, wenn du es übertragen oder erhalten möchtest. Verwende stattdessen die Profilübertragung.

## Profil deaktivieren oder Konto löschen

Diese Aktionen sind endgültig. Bisherige Teilnahmen können in gemeinsamen Einträgen sichtbar bleiben, nachdem du den Zugang verloren hast.

### Ein Profil eines vollständigen Kontos deaktivieren

1. Aktiviere das Profil.
2. Öffne **Profileinstellungen**.
3. Wähle **Profil löschen**.
4. Gib den im Bestätigungsformular verlangten **Profilname** exakt ein.
5. Wähle **Profil dauerhaft deaktivieren**.

Das Profil wird vom Konto gelöst; du kannst es nicht mehr für den Zugriff auf seine Einträge verwenden. Andere Profile des vollständigen Kontos bleiben verfügbar. Die Deaktivierung des letzten Profils schließt auch das vollständige Konto. Verwende stattdessen die Übertragung, wenn ein anderes Konto das Profil und seinen Zugang behalten soll.

Ein Gastkonto enthält nur ein Profil und verwendet diesen Mehrprofil-Deaktivierungsablauf nicht. Schließe das Gastkonto stattdessen über **Konto löschen**.

### Ein vollständiges Konto oder Gastkonto löschen

1. Öffne das Benutzermenü.
2. Wähle **Konto löschen**.
3. Gib den im Bestätigungsformular geforderten Surveyor-**Benutzername** ein. Beim lokalen Konto ist dies der Anmeldebenutzername. Bei einem Gastkonto ist es der ursprüngliche Anzeigename bei der Gasterstellung, nicht ein später geänderter Profilname.
4. Wähle **Konto dauerhaft löschen**.

Das Löschen eines vollständigen Kontos schließt es und deaktiviert alle zugehörigen Profile. Das Löschen eines Gastkontos schließt diese Gastidentität und deaktiviert ihr einziges Profil. Surveyor kann dies nicht rückgängig machen. Bisherige Teilnahmen können sichtbar bleiben, soweit gemeinsame Gruppendatensätze sie benötigen.

Das Löschen eines Surveyor-Kontos mit Organisationsanmeldung löscht nicht das Konto beim externen Identitätsanbieter. Eine erneute Anmeldung erstellt oder verbindet ein Surveyor-Konto, stellt aber keine zuvor deaktivierten Profile wieder her.

## Probleme lösen

### Ich sehe keine lokale Registrierung oder Passwortfelder

Diese Installation verwendet möglicherweise ausschließlich die Organisationsanmeldung. Wähle **Anmelden** oder **Registrieren** und folge der Weiterleitung, oder verwende **Mit _Anbietername_ anmelden**.

### Die lokale Anmeldung meldet ein nicht aktiviertes Konto

Öffne zuerst die Aktivierungs-E-Mail. Ist der einstündige Link abgelaufen, verschickt ein Anmeldeversuch eine neue Nachricht. Prüfe Spam und kontaktiere den Betreiber, wenn keine verwendbare Nachricht ankommt.

### Ich habe ein Passwort zurückgesetzt, aber keine E-Mail erhalten

Prüfe die Schreibweise von Benutzername oder E-Mail und den Spamordner. Die Bestätigung verrät nicht, ob ein Konto gefunden wurde. Konten mit Organisationsanmeldung stellen Zugangsdaten beim externen Anbieter wieder her.

### Ich habe Gastzugang angefordert, aber keine E-Mail erhalten

Prüfe, ob das Gastkonto mit genau dieser E-Mail-Adresse erstellt wurde. Die Wiederherstellungsnachricht hat immer den Betreff **Your guest accounts** und kann mehrere Kontolinks enthalten. Ein Gast ohne E-Mail braucht seinen gespeicherten privaten Link.

### Meine Übersicht zeigt nicht den erwarteten Eintrag

Prüfe den aktiven Profilnamen im Benutzermenü. Wechsle bei einem vollständigen Konto über **Deine Profile**. Öffne als Gast den privaten Link des Kontos, das ursprünglich am Eintrag teilgenommen hat, oder fordere alle Links per E-Mail an.

### Ein Übertragungstoken wird abgewiesen

Übertragungstoken laufen nach 24 Stunden ab, gehören zu genau einem Profil und werden beim Erzeugen eines neuen Tokens ersetzt. Erzeuge in **Profileinstellungen** des Quellprofils ein neues Token und prüfe erneut die Vorschau, bevor du die Übertragung bestätigst.

## Nächste Schritte

- In [Deine Übersicht](DASHBOARD.md) erfährst du, wie deine Einträge angeordnet sind.
- Öffne die Anleitung der Funktion, zu der du eingeladen wurdest.
- Lies [Berechtigungen](PERMISSIONS.md), bevor du eine Funktion mit allgemeinem Berechtigungssystem freigibst oder verwaltest.
