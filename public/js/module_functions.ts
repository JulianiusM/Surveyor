//Custom conditional class switch
function refreshState(object: any, validated: any, validatedClass: any, invalidatedClass: any) {
    if (validated && !object.hasClass(validatedClass)) {
        if (object.hasClass(invalidatedClass)) {
            object.removeClass(invalidatedClass);
        }
        object.addClass(validatedClass);
    } else if (!validated && !object.hasClass(invalidatedClass)) {
        if (object.hasClass(validatedClass)) {
            object.removeClass(validatedClass);
        }
        object.addClass(invalidatedClass);
    }
}

//Function to set current location on navbar active
function setCurrentNavLocation() {
    let path = window.location.pathname;

    //Set corresponding nav items active
    if (path.includes("/settings")) {
        // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $("#settings").addClass("active");
    } else if (path.includes("/login")) {
        // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $("#login").addClass("active");
    } else if (path.includes("/register")) {
        // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $("#register").addClass("active");
    }
}

//Verify password (GUI)
function verifyPassword(passwordObj: any, infoObj: any) {
    let isEightChars = (passwordObj.val().length >= 8);
    let hasLetter = (/[a-z,A-Z]/g.test(passwordObj.val()));
    let hasDigit = (/\d/g.test(passwordObj.val()));

    //Show tooltip
    infoObj.empty();
    infoObj.append(generateTooltip(isEightChars, hasLetter, hasDigit));

    //Show field status using bootstrap
    refreshState(passwordObj, isPasswordValid(passwordObj.val()), "is-valid", "is-invalid");
}

function matchPassword(passwordObj: any, passwordRepeatObj: any, repeatInfoObj: any) {
    //Hide or show "Passwords do not match"
    refreshState(repeatInfoObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "invisible", "visible");

    //Show field status using bootstrap
    refreshState(passwordRepeatObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "is-valid", "is-invalid");
}

//Remove tooltip if password is valid when password field looses focus
function removeTooltip(passwordObj: any, infoObj: any) {
    if (isPasswordValid(passwordObj.val())) {
        infoObj.empty();
    }
}

//Test if password is vailid
function isPasswordValid(password: any) {
    return password.length >= 8 && /[a-z,A-Z]/g.test(password) && /\d/g.test(password);
}

//Test if password repeat is valid
function isPasswordRepeatValid(password: any, passwordRepeat: any) {
    return password === passwordRepeat;
}

//Generate tooltip html
function generateTooltip(hasEight: any, hasLettr: any, hasDigit: any) {
    //Define tooltip parts
    let tooltipDesc = "<p><b>Password must match the following criteria:</b></p><ul style=\"list-style-type:none\">";
    let tooltipCritOK = "<li style=\"color:green\"><b>✓</b>";
    let tooltipCritNO = "<li style=\"color:red\">🗙";
    let tooltipCritEight = "At least <b>eight (8) characters</b>";
    let tooltipCritLettr = "At least <b>one (1) letter</b>";
    let tooltipCritDigit = "At least <b>one (1) digit</b>";
    let tooltipCritClose = "</li>"
    let tooltipClose = "</ul>";

    //Generate tooltip
    let tooltipHTML = tooltipDesc;
    if (hasEight) {
        tooltipHTML += tooltipCritOK;
    } else {
        tooltipHTML += tooltipCritNO;
    }
    tooltipHTML += (tooltipCritEight + tooltipCritClose);
    if (hasLettr) {
        tooltipHTML += tooltipCritOK;
    } else {
        tooltipHTML += tooltipCritNO;
    }
    tooltipHTML += (tooltipCritLettr + tooltipCritClose);
    if (hasDigit) {
        tooltipHTML += tooltipCritOK;
    } else {
        tooltipHTML += tooltipCritNO;
    }
    tooltipHTML += (tooltipCritDigit + tooltipCritClose);
    tooltipHTML += tooltipClose;

    return tooltipHTML;
}

//Validate passwords on submit and prevent submit if not
function validate(event: any, passwordObj: any, passwordRepeatObj: any, infoObj: any, passwordRepeatInfoObj: any) {
    let password = passwordObj.val();
    let passwordRepeat = passwordRepeatObj.val();

    if (!isPasswordValid(password) || !isPasswordRepeatValid(password, passwordRepeat)) {
        event.preventDefault();
        event.stopPropagation();
        alert("Please check that both the password and the password repetition are vaild!");
        verifyPassword(passwordObj, infoObj);
        removeTooltip(passwordObj, infoObj);
        matchPassword(passwordObj, passwordRepeatObj, passwordRepeatInfoObj);
    }
}

function objectToArray(obj: any) {
    var arr = [];
    var idx = [];
    var keys = Object.keys(obj);

    keys.sort(function (a, b) {
        // @ts-expect-error TS(2362): The left-hand side of an arithmetic operation must... Remove this comment to see the full error message
        return a - b;
    });

    for (var i = 0; i < keys.length; i++) {
        arr.push(obj[keys[i]]);
        idx.push(keys[i]);
    }

    return [idx, arr];
}

//Pads numbers
function padNumber(num: any) {
    return ("00" + num).substr(-2, 2);
}

async function post(url: any, payload: any) {
    const res = await fetch('/api' + url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });

    let data = {};
    try {
        data = await res.json();
    } catch {
    }

    // @ts-expect-error TS(2339): Property 'status' does not exist on type '{}'.
    if (!res.ok || data.status === 'error') {
        // @ts-expect-error TS(2339): Property 'message' does not exist on type '{}'.
        throw new Error(data.message || 'Request failed');
    }
    return data;          // { status:'success', message:'…' }
}


function showInlineAlert(status: any, message: any) {
    const alertBox = document.getElementById('liveAlerts')
    if (!alertBox) return;
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    const cls = {
        success: 'alert-success',
        info: 'alert-info',
        error: 'alert-danger',
    }[status] || 'alert-info';

    alertBox.innerHTML = `
      <div class="alert ${cls} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>`;
}

function disableDnD() {
    const draggables = document.getElementsByClassName('draggable');
    for (let elem of draggables) {
        // @ts-expect-error TS(2339): Property 'draggable' does not exist on type 'Eleme... Remove this comment to see the full error message
        elem.draggable = false;
    }
}

function enableDnD() {
    // @ts-expect-error TS(2339): Property 'IS_MANAGE' does not exist on type 'Windo... Remove this comment to see the full error message
    if (!window.IS_MANAGE) return;
    const draggables = document.getElementsByClassName('draggable');
    for (let elem of draggables) {
        // @ts-expect-error TS(2339): Property 'draggable' does not exist on type 'Eleme... Remove this comment to see the full error message
        elem.draggable = true;
    }
}

function startInlineEditArea(desc: any, url: any) {
    if (!desc || desc.querySelector('textarea')) return;

    const old = desc.innerText.trim();

    const ta = document.createElement('textarea');
    ta.className = 'form-control text-bg-dark';
    ta.style.minHeight = '6rem';
    ta.value = old === 'double-click to add description' ? '' : old;
    ta.maxLength = 1999;

    desc.innerHTML = '';
    desc.appendChild(ta);
    ta.focus();

    function restore(val: any) {
        if (val === 'double-click to add description') val = '';
        desc.innerHTML = val
            ? val.replace(/\n/g, '<br>')
            : '<em class="text-secondary">double-click to add description</em>';
    }

    async function save() {
        const val = ta.value.trim();
        try {
            await post(url, {description: val});
            restore(val);
            showInlineAlert('success', 'Description updated');
        } catch (err) {
            restore(old);
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    }

    ta.addEventListener('blur', save);
    ta.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && ev.ctrlKey) {
            ev.preventDefault();
            save();
        }
        if (ev.key === 'Escape') {
            restore(old);
            ta.blur();
        }
    });
}

function startInlineEdit(elem: any, baseUrl: any) {
    if (!elem || elem.querySelector('input')) return;

    disableDnD();

    const field = elem.dataset.edit;           // title | description | max
    const id = elem.dataset.id;         // from template
    const isTd = elem.nodeName === 'TD';

    let old: any, countTxt: any;
    if (isTd && field === 'maxAssignees') {
        // Special handling: whole td field is selected
        const cntSpan = elem.querySelector('[data-count]');
        countTxt = cntSpan.textContent.trim();
        old = elem.querySelector('[data-max]').textContent.trim();
    } else {
        old = elem.textContent.trim();
    }

    const inp = document.createElement('input');
    inp.className = 'form-control form-control-sm text-bg-dark draggable-false';
    inp.type = field === 'maxAssignees' ? 'number' : 'text';
    inp.value = old;
    elem.textContent = '';
    elem.appendChild(inp);
    inp.focus();

    async function save() {
        const val = inp.value.trim();
        if (val === old) {
            rollback(old);
            return;
        }
        const url = `${baseUrl}/${id}/${field === 'description' ? 'description' : 'attr'}`;

        try {
            await post(url,
                field === 'description' ? {description: val}
                    : {field, value: val});
            rollback(val);
            showInlineAlert('success', 'Updated');
            if (field === 'maxAssignees') {
                setTimeout(() => location.reload(), 100);
            }
        } catch (err) {
            rollback(old);
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    }

    async function rollback(val: any) {
        if (isTd && field === 'maxAssignees')
            elem.innerHTML = `<span data-count>${countTxt}</span> / <span data-max>${val}</span>`;
        else
            elem.textContent = val;
        enableDnD();
    }

    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            save();
        }
        if (ev.key === 'Escape') rollback(old);
    });
}

// Return an array of the selected option values in the control.
// Select is an HTML select element.
function getSelectValues(select: any) {
    let result = [];
    let options = select && select.options;
    let opt;

    for (let i = 0, iLen = options.length; i < iLen; i++) {
        opt = options[i];

        if (opt.selected) {
            result.push(opt.value || opt.text);
        }
    }
    return result;
}