//Custom conditional class switch

import type {PermBundle, PermType, PermView} from "../../../types/PermissionTypes";
import {PERM} from "../../../modules/lib/permissions";

export function refreshState(object: JQuery<HTMLElement>, validated: boolean, validatedClass: string, invalidatedClass: string) {
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
export function setCurrentNavLocation() {
    let path = window.location.pathname;

    //Set corresponding nav items active
    if (path.includes("/settings")) {
        $("#settings").addClass("active");
    } else if (path.includes("/login")) {
        $("#login").addClass("active");
    } else if (path.includes("/register")) {
        $("#register").addClass("active");
    }
}

//Verify password (GUI)
export function verifyPassword(passwordObj: JQuery<HTMLInputElement>, infoObj: JQuery<HTMLElement>) {
    let isEightChars = ((passwordObj.val()?.length || 0) >= 8);
    let hasLetter = (/[a-z,A-Z]/g.test(passwordObj.val() ?? ''));
    let hasDigit = (/\d/g.test(passwordObj.val() ?? ''));

    //Show tooltip
    infoObj.empty();
    infoObj.append(generateTooltip(isEightChars, hasLetter, hasDigit));

    //Show field status using bootstrap
    refreshState(passwordObj, isPasswordValid(passwordObj.val()), "is-valid", "is-invalid");
}

export function matchPassword(passwordObj: JQuery<HTMLInputElement>, passwordRepeatObj: JQuery<HTMLInputElement>, repeatInfoObj: JQuery<HTMLElement>) {
    //Hide or show "Passwords do not match"
    refreshState(repeatInfoObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "invisible", "visible");

    //Show field status using bootstrap
    refreshState(passwordRepeatObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "is-valid", "is-invalid");
}

//Remove tooltip if password is valid when password field looses focus
export function removeTooltip(passwordObj: JQuery<HTMLInputElement>, infoObj: JQuery<HTMLElement>) {
    if (isPasswordValid(passwordObj.val() ?? '')) {
        infoObj.empty();
    }
}

//Test if password is valid
export function isPasswordValid(password?: string) {
    return !!password && password.length >= 8 && /[a-z,A-Z]/g.test(password) && /\d/g.test(password);
}

//Test if password repeat is valid
export function isPasswordRepeatValid(password?: string, passwordRepeat?: string) {
    return password === passwordRepeat;
}

//Generate tooltip html
export function generateTooltip(hasEight: boolean, hasLettr: boolean, hasDigit: boolean) {
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
export function validate(event: Event, passwordObj: JQuery<HTMLInputElement>, passwordRepeatObj: JQuery<HTMLInputElement>, infoObj: JQuery<HTMLElement>, passwordRepeatInfoObj: JQuery<HTMLElement>) {
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

export function objectToArray(obj: any) {
    const arr = [];
    const idx = [];
    const keys = Object.keys(obj).sort();

    for (let i = 0; i < keys.length; i++) {
        arr.push(obj[keys[i]]);
        idx.push(keys[i]);
    }

    return [idx, arr];
}

//Pads numbers
export function padNumber(num: number) {
    return String(num).padStart(2, '0');
}

export async function post(url: string, payload: any = {}) {
    const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData;
    const res = await fetch('/api' + url, {
        method: 'POST',
        headers: isFormData ? undefined : {'Content-Type': 'application/json'},
        body: isFormData ? payload : JSON.stringify(payload),
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


export function showInlineAlert(status: 'success' | 'info' | 'error', message: any) {
    const alertBox = document.getElementById('liveAlerts')
    if (!alertBox) return;

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

export function disableDnD() {
    const draggables = document.getElementsByClassName('draggable');
    for (let elem of draggables) {
        // @ts-ignore
        elem.draggable = false;
    }
}

export function enableDnD() {

    // @ts-expect-error TS(2339): Property 'IS_MANAGE' does not exist on type 'Windo... Remove this comment to see the full error message
    if (!window.IS_MANAGE) return;
    const draggables = document.getElementsByClassName('draggable');
    for (let elem of draggables) {
        // @ts-ignore
        elem.draggable = true;
    }
}

export function startInlineEditArea(desc: HTMLElement, url: string) {
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

export function startInlineEdit(elem: HTMLElement, baseUrl: string) {
    if (!elem || elem.querySelector('input')) return;

    disableDnD();

    const field = elem.dataset.edit;           // title | description | max
    const id = elem.dataset.id;         // from template
    const isTd = elem.nodeName === 'TD';

    let old: string | undefined, countTxt: string | undefined;
    if (isTd && field === 'maxAssignees') {
        // Special handling: whole td field is selected
        const cntSpan = elem.querySelector('[data-count]')!;
        countTxt = cntSpan.textContent?.trim();
        old = elem.querySelector('[data-max]')?.textContent?.trim();
    } else {
        old = elem.textContent?.trim();
    }

    const inp = document.createElement('input');
    inp.className = 'form-control form-control-sm text-bg-dark draggable-false';
    inp.type = field === 'maxAssignees' ? 'number' : 'text';
    inp.value = old || '';
    elem.textContent = '';
    elem.appendChild(inp);
    inp.focus();

    async function save() {
        const val = inp.value.trim();
        if (val === old) {
            await rollback(old);
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
            await rollback(old);

            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    }

    async function rollback(val?: string) {
        if (isTd && field === 'maxAssignees')
            elem.innerHTML = `<span data-count>${countTxt}</span> / <span data-max>${val}</span>`;
        else
            elem.textContent = val || '';
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
export function getSelectValues(select: HTMLSelectElement) {
    let result = [];
    let options = select && select.options;

    for (let i = 0, iLen = options.length; i < iLen; i++) {
        let opt = options[i];

        if (opt.selected) {
            result.push(opt.value || opt.text);
        }
    }
    return result;
}

export /**
 * Format a Date for a given IANA timezone into an ISO-like string.
 * @param {Date} date - A JavaScript Date (any tz; usually UTC or local).
 * @param {string} timeZone - IANA timezone, e.g. "Europe/Berlin", "America/New_York".
 * @returns {string} e.g. "2025-08-22T14:05:09+02:00"
 */
function formatISOInTimeZone(date: Date, timeZone: string) {
    // Get date/time fields in the target timezone
    const parts = new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(date).reduce((acc: Record<string, string>, p) => {
        acc[p.type] = p.value;
        return acc;
    }, {});

    // Get a numeric UTC offset label like "GMT+2" or "GMT+02:00"
    const tzNamePart = new Intl.DateTimeFormat(undefined, {
        timeZone,
        timeZoneName: 'shortOffset', // yields "GMT", "GMT+2", "GMT-05:30", etc.
    }).formatToParts(date).find(p => p.type === 'timeZoneName');

    // Parse that into "+HH:MM"
    let offset = '+00:00';
    if (tzNamePart && tzNamePart.value.startsWith('GMT')) {
        const m = tzNamePart.value.match(/^GMT(?:(?<sign>[+-])(?<hh>\d{1,2})(?::?(?<mm>\d{2}))?)?$/);
        if (m && m.groups) {
            const sign = m.groups.sign || '+';
            const hh = String(m.groups.hh || '0').padStart(2, '0');
            const mm = String(m.groups.mm || '0').padStart(2, '0');
            offset = `${sign}${hh}:${mm}`;
        }
    }

    // Compose ISO-like string
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export function initEntityLists() {
    document.querySelectorAll('[data-filter="section"]').forEach(sec => {
        const input = sec.querySelector('input[type="search"]') as HTMLInputElement;
        const list = sec.querySelector('.js-list');
        const count = sec.querySelector('.js-count');
        if (!input || !list || !count) return;
        const items = Array.from(list.querySelectorAll('.list-group-item'));
        const total = items.length;
        const update = () => {
            const q = (input.value || '').trim().toLowerCase();
            let visible = 0;
            items.forEach(li => {
                const txt = (li.getAttribute('data-search') || li.textContent || '').toLowerCase();
                const show = !q || txt.includes(q);
                li.classList.toggle('d-none', !show);
                if (show) visible++;
            });
            count.textContent = `${visible}/${total}`;
        };
        // mark section for script
        sec.setAttribute('data-filter', 'section');
        input.addEventListener('input', update);
        update();
    });
}

export function jsonReviver(key: any, value: any) {
    if (typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
            return new Map(value.value);
        }
    }
    return value;
}

export function loadPerms() {
    // @ts-ignore
    if (window.PERM_DATA) {
        // @ts-ignore
        window.PERMS = restorePermBundle(JSON.parse(window.PERM_DATA, jsonReviver))
    }
}

function restorePermBundle(data: Partial<PermBundle>): PermBundle {
    const entity = restorePermView(data.entity!)
    const itemMap = data.items!;
    for (let key of itemMap.keys()) {
        itemMap.set(key, restorePermView(itemMap.get(key)!, entity))
    }

    const empty = restorePermView({mask: 0, parentMask: entity.mask, bits: {}}, entity);
    const getItem = (id: string) => itemMap.get(id) ?? empty;

    const bundle: PermBundle = {
        entity: restorePermView(data.entity!),
        items: itemMap,
        item: getItem,
        itemHas: (id: string, key: keyof typeof PERM) => getItem(id).has(key),
        itemAllow: (id: string, key: keyof typeof PERM, parentKey?: keyof typeof PERM) => getItem(id).allow(key, parentKey),
    };

    return bundle;
}

function restorePermView(data: Partial<PermView>, parentData?: Partial<PermView>): PermView {
    const selfHas = (k: PermType) => (data.bits ? data.bits[k] : false) ?? false;
    const parentHas = (k: PermType) => (parentData?.bits ? parentData.bits[k] : false) ?? false;

    return {
        mask: data.mask!,
        parentMask: data.parentMask!,
        has: selfHas,
        allow: (k, parentKey) => selfHas(k) || parentHas(k),
        all: (...keys) => keys.every(selfHas),
        any: (...keys) => keys.some(selfHas),
        bits: data.bits!
    }
}