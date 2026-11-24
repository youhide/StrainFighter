// This module is also distributed in each game's static demo.
const maxSaveBytes = 64 * 1024;
const syncDelay = 5_000;
const retryDelay = 15_000;
const clientHeader = { 'X-IdleRite-Client': '1' };

function normalize(raw, validate) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && validate(value) ? JSON.stringify(value) : null;
  } catch {
    return null;
  }
}

function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  return element;
}

function download(game, save) {
  const file = new Blob([JSON.stringify({ game, save: JSON.parse(save) }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${game}-save.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function request(path, options) {
  return fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(3_000),
    ...options,
  });
}

export async function openSave({ game, key, validate, controls }) {
  const metaKey = `${key}:idlerite-sync`;
  const endpoint = `/api/v1/saves/${game}`;
  let storageAvailable = true;
  let latest = null;
  let localRaw = null;
  let metadata = null;
  try {
    localRaw = localStorage.getItem(key);
    latest = normalize(localRaw, validate);
    metadata = JSON.parse(localStorage.getItem(metaKey));
  } catch {
    // A damaged metadata value can be discarded while preserving the save.
    try { localStorage.getItem(key); } catch { storageAvailable = false; }
  }

  let base = null;
  let unreadable = localRaw !== null && latest === null;
  let conflict = null;
  let pending = null;
  let standalone = false;
  let busy = false;
  let timer;
  let restore;

  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  const exportButton = button('Exportar save', () => {
    if (latest !== null) download(game, latest);
  });
  const useServer = button('Usar save do servidor', () => {
    const snapshot = conflict;
    if (snapshot) adopt(snapshot);
  });
  const useLocal = button('Enviar meu save local', () => {
    if (!conflict) return;
    base = conflict;
    conflict = null;
    pending = null;
    show('Enviando o save local…');
    void sync();
  });
  const choose = document.createElement('span');
  choose.hidden = true;
  choose.append(useServer, useLocal);
  const transfer = document.createElement('span');
  transfer.append(exportButton, button('Importar save', () => file.click()), file);
  controls.append(status, transfer, choose);
  show('Verificando o save no servidor…');

  function show(message) {
    if (status.textContent !== message) status.textContent = message;
    choose.hidden = conflict === null;
    exportButton.disabled = latest === null;
  }

  function store(storageKey, value) {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      storageAvailable = false;
    }
  }

  function localStatus() {
    return storageAvailable ? 'Save local' : 'O navegador bloqueou o save local';
  }

  function replaceLocal(raw) {
    latest = raw;
    if (localRaw !== raw || !storageAvailable) {
      if (unreadable) {
        store(`${key}:unreadable`, localRaw);
        unreadable = false;
      }
      store(key, raw);
      localRaw = raw;
    }
    exportButton.disabled = false;
  }

  function acknowledge(snapshot) {
    base = snapshot;
    metadata = snapshot;
    store(metaKey, JSON.stringify(snapshot));
  }

  function adopt(snapshot) {
    conflict = null;
    pending = null;
    acknowledge(snapshot);
    const changed = latest !== snapshot.raw;
    replaceLocal(snapshot.raw);
    show('Save sincronizado');
    if (changed && restore) restore(snapshot.raw);
  }

  async function readSnapshot(response) {
    const { revision, save } = await response.json();
    const raw = save === null ? null : normalize(JSON.stringify(save), validate);
    if (!Number.isSafeInteger(revision) || revision < 0 || (revision === 0) !== (raw === null) || (save !== null && raw === null)) {
      throw new Error('Save incompatível com esta versão do jogo');
    }
    return { revision, raw };
  }

  function showConflict(snapshot) {
    conflict = snapshot;
    pending = null;
    show('Há dois saves diferentes. Escolha qual deseja manter.');
  }

  async function connect() {
    const establishSession = () => request('/api/v1/session', { method: 'POST', headers: clientHeader });
    const session = navigator.locks
      ? await navigator.locks.request('idlerite-guest-session', establishSession)
      : await establishSession();
    if ([404, 405, 501].includes(session.status) || (session.ok && session.status !== 204)) {
      standalone = true;
      show(localStatus());
      return;
    }
    if (!session.ok) throw new Error('Sessão indisponível');
    const response = await request(endpoint);
    if (!response.ok) throw new Error('Save indisponível');
    const snapshot = await readSnapshot(response);

    if (snapshot.raw === null || (metadata?.revision === snapshot.revision && metadata.raw === snapshot.raw)) {
      base = snapshot;
      if (latest === null && snapshot.raw !== null) adopt(snapshot);
    } else if (latest === null || latest === snapshot.raw || latest === metadata?.raw) {
      adopt(snapshot);
    } else {
      showConflict(snapshot);
    }
    if (!conflict && (!latest || latest === base.raw)) show(latest ? 'Save sincronizado' : localStatus());
  }

  function schedule(delay = syncDelay) {
    if (timer || busy || standalone || conflict) return;
    timer = setTimeout(() => {
      timer = undefined;
      void sync();
    }, delay);
  }

  async function sync(keepalive = false) {
    if (busy || standalone || conflict || (keepalive && base === null)) return;
    busy = true;
    let retry = syncDelay;
    try {
      if (base === null) await connect();
      if (standalone || conflict || latest === null || (pending === null && latest === base.raw)) return;
      pending ??= { revision: base.revision, raw: latest };
      const body = `{"revision":${pending.revision},"save":${pending.raw}}`;
      const response = await request(endpoint, {
        method: 'PUT',
        headers: { ...clientHeader, 'Content-Type': 'application/json' },
        body,
        keepalive,
      });
      if (response.status === 401) {
        base = null;
        pending = null;
        throw new Error('Sessão expirada');
      }
      if (!response.ok && response.status !== 409) throw new Error('Save indisponível');
      const snapshot = await readSnapshot(response);
      if (response.status === 409) {
        if (snapshot.raw === latest) {
          pending = null;
          acknowledge(snapshot);
          show('Save sincronizado');
        } else if (snapshot.raw === null) {
          // A deleted browser cookie or replaced database may yield an empty slot.
          base = snapshot;
          pending = null;
        } else {
          showConflict(snapshot);
        }
      } else {
        pending = null;
        acknowledge(snapshot);
        show('Save sincronizado');
      }
    } catch {
      show(`${localStatus()} · servidor indisponível`);
      retry = retryDelay;
    } finally {
      busy = false;
      if (base === null || pending || (latest !== null && latest !== base.raw)) schedule(retry);
    }
  }

  file.addEventListener('change', async () => {
    const selected = file.files[0];
    file.value = '';
    if (!selected) return;
    try {
      if (selected.size > maxSaveBytes) throw new Error();
      const parsed = JSON.parse(await selected.text());
      const raw = normalize(JSON.stringify(parsed?.game === game ? parsed.save : parsed), validate);
      if (raw === null) throw new Error();
      if (raw === latest || (latest !== null && !window.confirm('Substituir o progresso atual pelo save do arquivo?'))) return;
      replaceLocal(raw);
      if (!conflict) show(standalone ? localStatus() : 'Save importado · aguardando sincronização');
      restore?.(raw);
      schedule();
    } catch {
      show('O arquivo selecionado não é um save válido deste jogo.');
    }
  });

  window.addEventListener('online', () => { void sync(); });
  window.addEventListener('pagehide', () => { queueMicrotask(() => { void sync(true); }); });

  await sync();
  return {
    initial: latest,
    onRestore(handler) { restore = handler; },
    write(raw) {
      if (latest === raw) return;
      replaceLocal(raw);
      if (standalone) show(localStatus());
      schedule();
    },
  };
}
