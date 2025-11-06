"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.E2EDataSource = void 0;
require("reflect-metadata");
var dotenv = require("dotenv");
var typeorm_1 = require("typeorm");
dotenv.config({ path: (_a = process.env.E2E_DOTENV_FILE) !== null && _a !== void 0 ? _a : '.env.e2e' });
// ---- Guardrails: refuse to run on non-E2E DBs ----
var DB_NAME = (_b = process.env.E2E_DB_NAME) !== null && _b !== void 0 ? _b : '';
if (!/e2e/i.test(DB_NAME)) {
    console.error("Refusing to run DB init because E2E_DB_NAME \"".concat(DB_NAME, "\" does not contain 'e2e'."));
    process.exit(1);
}
// ---- Build a TypeORM DataSource for MariaDB ----
exports.E2EDataSource = new typeorm_1.DataSource({
    type: 'mariadb',
    host: process.env.E2E_DB_HOST,
    port: parseInt((_c = process.env.E2E_DB_PORT) !== null && _c !== void 0 ? _c : '3306', 10),
    username: process.env.E2E_DB_USER,
    password: process.env.E2E_DB_PASS,
    database: DB_NAME,
    timezone: 'Z',
    // @ts-ignore common driver option
    dateStrings: ['DATE'],
    entities: ['src/modules/database/entities/**/*.ts'],
    migrations: ['src/migrations/*.ts'],
    subscribers: ['src/modules/database/subscribers/**/*.ts'],
    // Never use synchronize in CI; rely on migrations.
    synchronize: false,
    logging: false,
});
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var qr;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, exports.E2EDataSource.initialize()];
                case 1:
                    _a.sent();
                    qr = exports.E2EDataSource.createQueryRunner();
                    return [4 /*yield*/, qr.connect()];
                case 2:
                    _a.sent();
                    // MariaDB: speed up truncation
                    return [4 /*yield*/, qr.query('SET FOREIGN_KEY_CHECKS = 0')];
                case 3:
                    // MariaDB: speed up truncation
                    _a.sent();
                    return [4 /*yield*/, qr.clearDatabase()];
                case 4:
                    _a.sent(); // drops all tables
                    return [4 /*yield*/, qr.query('SET FOREIGN_KEY_CHECKS = 1')];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, qr.release()];
                case 6:
                    _a.sent();
                    // Recreate via migrations
                    return [4 /*yield*/, exports.E2EDataSource.runMigrations()];
                case 7:
                    // Recreate via migrations
                    _a.sent();
                    // ---- Seed minimal fixture data ----
                    // Example: create a test admin user. Replace with your own seeder logic.
                    // const userRepo = E2EDataSource.getRepository(User);
                    // const passwordHash = await bcrypt.hash(process.env.E2E_ADMIN_PASSWORD!, 10);
                    // await userRepo.save(userRepo.create({
                    //   email: process.env.E2E_ADMIN_EMAIL!,
                    //   passwordHash,
                    //   role: 'admin',
                    // }));
                    return [4 /*yield*/, exports.E2EDataSource.destroy()];
                case 8:
                    // ---- Seed minimal fixture data ----
                    // Example: create a test admin user. Replace with your own seeder logic.
                    // const userRepo = E2EDataSource.getRepository(User);
                    // const passwordHash = await bcrypt.hash(process.env.E2E_ADMIN_PASSWORD!, 10);
                    // await userRepo.save(userRepo.create({
                    //   email: process.env.E2E_ADMIN_EMAIL!,
                    //   passwordHash,
                    //   role: 'admin',
                    // }));
                    _a.sent();
                    // eslint-disable-next-line no-console
                    console.log('E2E database re-initialized.');
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (err) {
    console.error(err);
    process.exit(1);
});
