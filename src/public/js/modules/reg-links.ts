// src/public/js/modules/reg-links.ts
function qs<T extends Element>(sel: string, scope: ParentNode | Document = document): T | null {
    return scope.querySelector(sel) as T | null;
}

function qsAll<T extends Element>(sel: string, scope: ParentNode | Document = document): T[] {
    return Array.from(scope.querySelectorAll(sel)) as T[];
}

function fmtDate(d?: string | null) {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString();
}

function badge(status: string): string {
    const map: Record<string, string> = {
        active: 'success',
        consumed: 'warning',
        expired: 'secondary',
        revoked: 'danger',
    };
    const cls = map[status] || 'secondary';
    return `<span class="badge bg-${cls} text-uppercase">${status}</span>`;
}

function spinnerOn(btn: HTMLButtonElement) {
    btn.disabled = true;
    const sp = btn.querySelector('.spinner-border') as HTMLElement | null;
    if (sp) sp.classList.remove('d-none');
}

function spinnerOff(btn: HTMLButtonElement) {
    btn.disabled = false;
    const sp = btn.querySelector('.spinner-border') as HTMLElement | null;
    if (sp) sp.classList.add('d-none');
}

async function http(method: string, url: string, body?: any) {
    const res = await fetch(url, {
        method,
        headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (data?.status !== "success") throw new Error(`${data?.status}: ${data?.message}`);
    return data
}

function copy(text: string) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
}

function renderRows(root: HTMLElement, rows: any[]) {
    const tb = qs<HTMLTableSectionElement>('tbody.js-rows', root)!;
    const cnt = qs<HTMLElement>('.js-count', root)!;
    tb.innerHTML = '';

    if (!rows.length) {
        const tr = document.createElement('tr');
        tr.className = 'js-empty';
        tr.innerHTML = `<td colspan="5"><div class="text-secondary small">No links yet.</div></td>`;
        tb.appendChild(tr);
        cnt.textContent = '0';
        return;
    }

    rows.forEach((r: any) => {
        const tr = document.createElement('tr');
        tr.dataset.id = r.id;

        const tokenCell = `<code class="text-wrap">${r.token}</code>`;
        const created = fmtDate(r.createdAt);
        const expires = fmtDate(r.expiresAt);
        const status = r.status || 'active';

        // Build full URL for copy
        const eventId = root.dataset.eventId!;
        const fullUrl = `${location.origin}/event/${encodeURIComponent(eventId)}?regToken=${encodeURIComponent(r.token)}`;

        const disabled = status !== 'active' ? 'disabled' : '';
        tr.innerHTML = `
      <td>${tokenCell}</td>
      <td>${created}</td>
      <td>${expires}</td>
      <td>${badge(status)}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm" role="group">
          <button class="btn btn-outline-light btn-copy" type="button" data-url="${fullUrl}" ${disabled}>
            <i class="bi bi-clipboard"></i> Copy
          </button>
          <button class="btn btn-outline-danger btn-revoke" type="button" ${status === 'revoked' ? 'disabled' : ''}>
            <i class="bi bi-x-circle"></i> Revoke
          </button>
        </div>
      </td>
    `;
        tb.appendChild(tr);
    });

    cnt.textContent = String(rows.length);
}

async function refreshList(root: HTMLElement) {
    try {
        const res = await http('GET', root.dataset.apiList!);
        renderRows(root, res.data || []);
    } catch (e: any) {
        console.error(e);
    }
}

async function handleCreate(btn: HTMLButtonElement) {
    const modalSel = btn.dataset.modal!;
    const modal = qs<HTMLElement>(modalSel)!;
    const root = btn.closest('.reg-links') as HTMLElement;
    const api = root.dataset.apiCreate!;
    const usesEl = qs<HTMLInputElement>('input[type="number"]', modal)!;
    const expEl = qs<HTMLInputElement>('input[type="datetime-local"]', modal)!;

    const maxUses = Math.max(1, Number(usesEl.value || 1));
    const expiresAt = expEl.value ? new Date(expEl.value) : null;

    spinnerOn(btn);
    try {
        const payload: any = {maxUses};
        if (expiresAt) payload.expiresAt = expiresAt.toISOString();
        const data = await http('POST', api, payload); // { id, token }
        // Optionally auto-copy the new link
        const eventId = root.dataset.eventId!;
        const url = `${location.origin}/event/${encodeURIComponent(eventId)}?regToken=${encodeURIComponent(data.token)}`;
        await copy(url).catch(() => {
        });
        // Close modal (if bootstrap present)
        (window as any).bootstrap?.Modal.getOrCreateInstance(modal)?.hide();
        await refreshList(root);
    } catch (e: any) {
        alert(`Create failed: ${e?.message || e}`);
    } finally {
        spinnerOff(btn);
    }
}

async function handleRevoke(btn: HTMLButtonElement) {
    const tr = btn.closest('tr')!;
    const root = btn.closest('.reg-links') as HTMLElement;
    const id = tr.dataset.id!;
    const api = root.dataset.apiRevoke!;
    if (!confirm('Revoke this link? It cannot be used afterwards.')) return;

    btn.disabled = true;
    try {
        await http('DELETE', `${api}/${encodeURIComponent(id)}`);
        await refreshList(root);
    } catch (e: any) {
        alert(`Revoke failed: ${e?.message || e}`);
    } finally {
        btn.disabled = false;
    }
}

export function initRegLinks() {
    const roots = qsAll<HTMLElement>('.reg-links');
    roots.forEach(refreshList);

    document.addEventListener('click', (ev) => {
        const t = ev.target as Element | null;
        if (!t) return;

        const btnCreate = t.closest<HTMLButtonElement>('.btn-create-submit');
        if (btnCreate) {
            ev.preventDefault();
            handleCreate(btnCreate);
            return;
        }

        const btnCopy = t.closest<HTMLButtonElement>('.btn-copy');
        if (btnCopy) {
            ev.preventDefault();
            const url = btnCopy.dataset.url!;
            spinnerOn(btnCopy);
            copy(url).catch(() => {
            }); // silent
            spinnerOff(btnCopy);
            return;
        }

        const btnRevoke = t.closest<HTMLButtonElement>('.btn-revoke');
        if (btnRevoke) {
            ev.preventDefault();
            handleRevoke(btnRevoke);
            return;
        }
    });
}
