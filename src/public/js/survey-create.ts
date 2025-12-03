// public/js/survey-create.js

import {setCurrentNavLocation} from "./modules/module_functions";

/**
 * Initializes the dynamic combination rows on the Create Survey page.
 * Call this function from <body onload="init()">
 */
export function initButtons() {
    const tableBody = document.getElementById('combinationTable');
    const addBtn = document.getElementById('addCombinationBtn');
    let counter = 0;

    // Labels & values for selects
    const weekdays = [
        ['Monday', 'MON'],
        ['Tuesday', 'TUE'],
        ['Wednesday', 'WED'],
        ['Thursday', 'THU'],
        ['Friday', 'FRI'],
        ['Saturday', 'SAT'],
        ['Sunday', 'SUN']
    ];
    const weeks = ['1', '2', '3', '4', 'LAST'];

    // Build one <tr> with two selects and a remove button
    function addCombinationRow(weekday = undefined, week = undefined) {
        const id = counter++;
        const tr = document.createElement('tr');
        tr.id = `row-${id}`;

        // Weekday cell
        const tdDay = document.createElement('td');
        const selDay = document.createElement('select');
        selDay.className = 'form-select text-bg-dark';
        selDay.name = `combinations[${id}][weekday]`;
        selDay.required = true;
        weekdays.forEach(([label, val]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            selDay.appendChild(opt);
        });
        if (weekday) {
            selDay.value = weekday;
        }
        tdDay.appendChild(selDay);

        // Week-of-month cell
        const tdWeek = document.createElement('td');
        const selWeek = document.createElement('select');
        selWeek.className = 'form-select text-bg-dark';
        selWeek.name = `combinations[${id}][week]`;
        selWeek.required = true;
        weeks.forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val === 'LAST' ? 'Last' : val;
            selWeek.appendChild(opt);
        });
        if (week) {
            selWeek.value = week;
        }
        tdWeek.appendChild(selWeek);

        // Remove-button cell
        const tdAction = document.createElement('td');
        tdAction.className = 'text-center';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-danger btn-sm remove-combination-btn';
        btn.textContent = 'Remove';
        tdAction.appendChild(btn);

        tr.appendChild(tdDay);
        tr.appendChild(tdWeek);
        tr.appendChild(tdAction);

        tableBody?.appendChild(tr);
    }


    // @ts-expect-error TS(2339): Property 'PREFILLED_COMBINATIONS' does not exist o... Remove this comment to see the full error message
    if (window.PREFILLED_COMBINATIONS) {

        // @ts-expect-error TS(2339): Property 'PREFILLED_COMBINATIONS' does not exist o... Remove this comment to see the full error message
        window.PREFILLED_COMBINATIONS.forEach((c: any) => addCombinationRow(c.weekday, c.nth_week));
    } else {
        // Add the first row
        addCombinationRow();
    }

    // Add new row on button click
    addBtn?.addEventListener('click', (e) => addCombinationRow());

    // Delegate removal to tbody
    tableBody?.addEventListener('click', function (e) {

        // @ts-expect-error TS(2531): Object is possibly 'null'.
        if (e.target.matches('.remove-combination-btn')) {

            // @ts-expect-error TS(2531): Object is possibly 'null'.
            const row = e.target.closest('tr');
            if (row) row.remove();
        }
    });
}

export function init() {
    setCurrentNavLocation()
    initButtons()
}

// Expose to global scope
window.Surveyor.init = init;
