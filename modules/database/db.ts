// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fs'.
const fs = require('fs');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'path'.
const path = require('path');

// @ts-expect-error TS(2304): Cannot find name '__dirname'.
const domainsDir = path.join(__dirname, 'domains');
// load each module under its folder-name
const modules = fs
    .readdirSync(domainsDir)
    .filter((f: any) => f.endsWith('.js'))
    .filter((f: any) => f !== 'db.js')
    .reduce((acc: any, file: any) => {
        const name = path.basename(file, '.js');
        // @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
        acc[name] = require(path.join(domainsDir, file));
        return acc;
    }, {});

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = new Proxy({}, {
    get(_, fnName) {
        // first look for an exact export match in any module
        // @ts-expect-error TS(2550): Property 'values' does not exist on type 'ObjectCo... Remove this comment to see the full error message
        for (const mod of Object.values(modules)) {
            if (fnName in mod) return mod[fnName];
        }
        // or fall back to nested lookup (api.users.registerUser, etc.)
        // @ts-expect-error TS(2339): Property 'split' does not exist on type 'string | ... Remove this comment to see the full error message
        const [domain, method] = fnName.split('.');
        if (modules[domain] && modules[domain][method]) {
            return modules[domain][method];
        }
        return undefined;
    }
});
