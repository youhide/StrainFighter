const api = '/api/v1/strain-fighter';
const headers = { 'x-idlerite-client': '1' };
let guestSession;

export class ArenaRequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function connectGuest() {
  guestSession ??= fetch('/api/v1/session', {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(8000),
  }).then(response => {
    if (!response.ok) throw new ArenaRequestError(response.status, 'session');
  }).finally(() => { guestSession = undefined; });
  return guestSession;
}

async function request(path, options) {
  const send = () => fetch(api + path, { ...options, signal: AbortSignal.timeout(8000) });
  let response = await send();
  if (response.status === 401) {
    await connectGuest();
    response = await send();
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new ArenaRequestError(response.status, failure.error ?? 'unavailable');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ArenaRequestError(404, 'unavailable');
  }
  return response.json();
}

export const readArena = () => request('/arena');
export const readMarket = before => request(before ? '/market?before=' + before : '/market');

export const makeCommand = command => ({ request_id: crypto.randomUUID(), command });

export async function sendCommand(envelope) {
  const options = {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  };
  try {
    return await request('/arena', options);
  } catch (error) {
    if (error.status && error.status < 500) throw error;
    return request('/arena', options);
  }
}

const errors = {
  insufficient_coins: 'Fichas insuficientes.',
  duplicate_gear: 'Você já tem essa peça no inventário ou no mercado.',
  listing_closed: 'A oferta já foi encerrada.',
  gear_unavailable: 'Peça indisponível. Retire-a do lutador antes de anunciar.',
  invalid_price: 'Informe um preço entre 1 e 1.000.000 fichas.',
  max_rank: 'A peça já está no nível máximo.',
  own_listing: 'Você não pode comprar sua própria oferta.',
};

export const messageFor = error => errors[error.code] ?? 'O servidor está indisponível. Tente novamente.';
