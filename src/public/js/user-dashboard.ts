//Empty js to use when no custom module js is loaded instead to prevent errors
import {initEntityLists, setCurrentNavLocation} from "./module_functions";

export function init() {
    setCurrentNavLocation();
    initEntityLists();
}

// Expose to global scope
window.Surveyor.init = init;