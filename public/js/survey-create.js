// public/js/survey-create.js

/**
 * Initializes the dynamic combination rows on the Create Survey page.
 * Call this function from <body onload="init()">
 */
function initButtons() {
    const tableBody = document.getElementById('combinationTable');
    const addBtn = document.getElementById('addCombinationBtn');
    let counter = 0;

    // Labels & values for selects
    const weekdays = [
        ['Monday', 'MO'],
        ['Tuesday', 'DI'],
        ['Wednesday', 'MI'],
        ['Thursday', 'DO'],
        ['Friday', 'FR'],
        ['Saturday', 'SA'],
        ['Sunday', 'SO']
    ];
    const weeks = ['1', '2', '3', '4', 'LAST'];

    // Build one <tr> with two selects and a remove button
    function addCombinationRow() {
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
        tableBody.appendChild(tr);
    }

    // Add the first row
    addCombinationRow();

    // Add new row on button click
    addBtn.addEventListener('click', addCombinationRow);

    // Delegate removal to tbody
    tableBody.addEventListener('click', function (e) {
        if (e.target.matches('.remove-combination-btn')) {
            const row = e.target.closest('tr');
            if (row) row.remove();
        }
    });
}

function init() {
    setCurrentNavLocation()
    initButtons()
}
