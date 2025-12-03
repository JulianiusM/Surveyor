//Empty js to use when no custom module js is loaded instead to prevent errors
import {setCurrentNavLocation} from "./modules/module_functions";

export function init() {
    setCurrentNavLocation();
}

// Expose to global scope
window.Surveyor.init = init;