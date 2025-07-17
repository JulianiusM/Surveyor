// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'path'.
let path = require("path");

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fs'.
const fs = require("fs");
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const csv_reader = require("csv-reader");

class Settings {
    appPort: any;
    file: any;
    mysqlDatabase: any;
    mysqlHost: any;
    mysqlPassword: any;
    mysqlPort: any;
    mysqlUser: any;
    rootUrl: any;
    sessionSecret: any;
    smtpEmail: any;
    smtpHost: any;
    smtpPassword: any;
    smtpPool: any;
    smtpPort: any;
    smtpSecure: any;
    smtpUser: any;
    constructor() {
        this.rootUrl = "http://localhost:3000";

        this.mysqlHost = "localhost";
        this.mysqlPort = "3306";
        this.mysqlUser = "user";
        this.mysqlPassword = "password";
        this.mysqlDatabase = "database";

        this.smtpPool = true;
        this.smtpHost = "smtp.example.com";
        this.smtpPort = 465;
        this.smtpSecure = true;
        this.smtpEmail = "test@example.com";
        this.smtpUser = "username";
        this.smtpPassword = "password";

        this.sessionSecret = "CHANGE__" + this.generateRandomString(20);
        this.appPort = "3000";

        this.file = "./settings.csv";

        this.readSettingsFile();
    }

    async readSettingsFile() {
        let self = this;

        //Open inputstream from settings.csv
        let fileInputStream = fs.createReadStream(this.file, "utf-8");

        //Process inputstream with csv-reader
        await new Promise((resolve, reject) => {
            fileInputStream
                .on("error", function (error: any) {
                    console.log("Settings file is not present, create one!");
                    self.writeSettingsFile();
                    // @ts-expect-error TS(2794): Expected 1 arguments, but got 0. Did you forget to... Remove this comment to see the full error message
                    resolve();
                })
                .pipe(
                    new csv_reader({
                        parseNumbers: false,
                        trim: true,
                    })
                )
                .on("finish", function () {
                    // @ts-expect-error TS(2794): Expected 1 arguments, but got 0. Did you forget to... Remove this comment to see the full error message
                    resolve();
                })
                .on("data", function (row: any) {
                    switch (row[0]) {
                        case "ROOT_URL":
                            self.rootUrl = row[1];
                            break;
                        case "MYSQL_HOST":
                            self.mysqlHost = row[1];
                            break;
                        case "MYSQL_PORT":
                            self.mysqlPort = row[1];
                            break;
                        case "MYSQL_DATABASE":
                            self.mysqlDatabase = row[1];
                            break;
                        case "MYSQL_USER":
                            self.mysqlUser = row[1];
                            break;
                        case "MYSQL_PASSWORD":
                            self.mysqlPassword = row[1];
                            break;
                        case "SMTP_POOL":
                            self.smtpPool = row[1];
                            break;
                        case "SMTP_HOST":
                            self.smtpHost = row[1];
                            break;
                        case "SMTP_PORT":
                            self.smtpPort = row[1];
                            break;
                        case "SMTP_SECURE":
                            self.smtpSecure = row[1];
                            break;
                        case "SMTP_EMAIL":
                            self.smtpEmail = row[1];
                            break;
                        case "SMTP_USER":
                            self.smtpUser = row[1];
                            break;
                        case "SMTP_PASSWORD":
                            self.smtpPassword = row[1];
                            break;
                        case "SESSION_SECRET":
                            self.sessionSecret = row[1];
                            break;
                        case "APP_PORT":
                            self.appPort = row[1];
                            break;
                        default:
                            console.log("Invalid row: " + row);
                            break; //Invalid setting; Ignore!
                    }
                });
        });
    }

    writeSettingsFile() {
        let contents =
            "ROOT_URL," +
            this.rootUrl +
            "\nMYSQL_HOST," +
            this.mysqlHost +
            "\nMYSQL_PORT," +
            this.mysqlPort +
            "\nMYSQL_DATABASE," +
            this.mysqlDatabase +
            "\nMYSQL_USER," +
            this.mysqlUser +
            "\nMYSQL_PASSWORD," +
            this.mysqlPassword +
            "\nSMTP_POOL," +
            this.smtpPool +
            "\nSMTP_PASSWORD," +
            this.smtpHost +
            "\nSMTP_PORT," +
            this.smtpPort +
            "\nSMTP_SECURE," +
            this.smtpSecure +
            "\nSMTP_EMAIL," +
            this.smtpEmail +
            "\nSMTP_USER," +
            this.smtpUser +
            "\nSMTP_PASSWORD," +
            this.smtpPassword +
            "\nSESSION_SECRET," +
            this.sessionSecret +
            "\nAPP_PORT," +
            this.appPort;
        fs.writeFile(this.file, contents, "utf-8", function (error: any) {
            if (error) {
                console.log("Error writing settings file: " + error);
                return;
            }
            console.log("Settings file written!");
        });
    }

    generateRandomString(length: any) {
        const chars =
            "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890-_.!?#+";
        const randomArray = Array.from(
            {length: length},
            (v, k) => chars[Math.floor(Math.random() * chars.length)]
        );

        return randomArray.join("");
    }
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = new Settings();
