const fs = require('fs');
const path = require('path');

const domainsDir = path.join(__dirname, 'database');
// load each module under its folder-name
const modules = fs
    .readdirSync(domainsDir)
    .filter(f => f.endsWith('.js'))
    .filter(f => f !== 'db.js')
    .reduce((acc, file) => {
        const name = path.basename(file, '.js');
        acc[name] = require(path.join(domainsDir, file));
        return acc;
    }, {});

module.exports = new Proxy({}, {
    get(_, fnName) {
        // first look for an exact export match in any module
        for (const mod of Object.values(modules)) {
            if (fnName in mod) return mod[fnName];
        }
        // or fall back to nested lookup (api.users.registerUser, etc.)
        const [domain, method] = fnName.split('.');
        if (modules[domain] && modules[domain][method]) {
            return modules[domain][method];
        }
        return undefined;
    }
});
