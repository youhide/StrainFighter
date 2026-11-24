import init, { Arena } from './wasm/strain_fighter.js';

const SAVE_KEY = 'strain-fighter-v1';
const fighters = [
  { name: 'Lemon Haze', sprite: 'lemon' },
  { name: 'Purple Kush', sprite: 'violet' },
  { name: 'Mango Punch', sprite: 'mango' },
];
const rivals = [
  { name: 'Violet Skunk', sprite: 'violet', arena: 'Estufa Subsolo' },
  { name: 'Solar Diesel', sprite: 'mango', arena: 'Viveiro Leste' },
  { name: 'Jade Widow', sprite: 'lemon', arena: 'Jardim de Vidro' },
  { name: 'Nightshade', sprite: 'night', arena: 'Cúpula Noturna' },
  { name: 'Black Resin', sprite: 'night', arena: 'Ringue da Resina' },
];
const byId = id => document.getElementById(id);
const now = () => BigInt(Date.now());
const format = new Intl.NumberFormat('pt-BR');
const notice = byId('notice');

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

async function start() {
  await init();
  let storageAvailable = true;
  let saved;
  try {
    saved = localStorage.getItem(SAVE_KEY) ?? undefined;
  } catch {
    storageAvailable = false;
  }

  let arena;
  try {
    arena = new Arena(now(), saved);
  } catch {
    showNotice('O save local está em um formato que esta versão não consegue abrir.');
    return;
  }

  function persist() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(SAVE_KEY, arena.save());
    } catch {
      storageAvailable = false;
      showNotice('O navegador bloqueou o salvamento. O progresso vale nesta sessão.');
    }
  }

  const roster = fighters.map((fighter, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const portrait = document.createElement('span');
    portrait.className = 'portrait ' + fighter.sprite;
    portrait.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.textContent = fighter.name;
    const level = document.createElement('span');
    button.append(portrait, name, level);
    button.addEventListener('click', () => action(() => arena.select(index)));
    byId('roster').append(button);
    return { button, level };
  });

  let previous;
  function draw() {
    const view = JSON.parse(arena.view());
    const fighter = fighters[view.fighter];
    const rival = rivals[view.stage];
    byId('coins').textContent = format.format(view.coins);
    byId('wins').textContent = format.format(view.wins);
    byId('player-name').textContent = fighter.name;
    byId('rival-name').textContent = rival.name;
    byId('stage-label').textContent = (view.stage + 1) + ' / ' + rivals.length;
    byId('arena-name').textContent = rival.arena;
    byId('player-hp').max = view.maxHp;
    byId('player-hp').value = view.hp;
    byId('player-hp-label').textContent = view.hp + '/' + view.maxHp;
    byId('rival-hp').max = view.rivalMaxHp;
    byId('rival-hp').value = view.rivalHp;
    byId('rival-hp-label').textContent = view.rivalHp + '/' + view.rivalMaxHp;
    byId('player-sprite').className = 'sprite ' + fighter.sprite;
    byId('rival-sprite').className = 'sprite rival ' + rival.sprite;

    if (previous?.stage === view.stage && previous.rivalHp > view.rivalHp) {
      byId('player-sprite').classList.add('hit');
      byId('rival-sprite').classList.add('hit');
    }
    previous = view;

    const status = view.outcome === 'knockout' ? 'Vitória por nocaute'
      : view.outcome === 'defeat' ? 'Derrota · revanche automática'
        : 'Combate automático';
    const statusElement = byId('fight-status');
    const statusText = view.paused ? 'Pausado' : status;
    if (statusElement.textContent !== statusText) statusElement.textContent = statusText;
    const call = byId('fight-call');
    call.hidden = view.outcome === 'fighting' || view.paused;
    call.textContent = view.outcome === 'knockout' ? 'K.O.!' : 'REVANCHE';

    for (const [index, entry] of roster.entries()) {
      entry.button.setAttribute('aria-pressed', String(index === view.fighter));
      entry.level.textContent = 'Nv. ' + view.levels[index];
    }
    byId('fighter-stats').textContent = view.damage + ' ATQ · ' + view.maxHp + ' PV';
    byId('train-cost').textContent = view.trainingCost === null
      ? 'Nível máximo' : format.format(view.trainingCost) + ' fichas';
    byId('train').disabled = view.trainingCost === null || view.coins < view.trainingCost;
    byId('charge').textContent = view.charge + ' / ' + view.fullCharge;
    byId('special').disabled = view.paused || view.charge < view.fullCharge || view.outcome !== 'fighting';
    byId('pause').setAttribute('aria-pressed', String(view.paused));
    byId('pause').textContent = view.paused ? 'Retomar' : 'Pausar';
  }

  for (const id of ['player-sprite', 'rival-sprite']) {
    byId(id).addEventListener('animationend', event => event.currentTarget.classList.remove('hit'));
  }

  function action(command) {
    arena.advance(now());
    command();
    persist();
    draw();
  }

  function sync(returning = false) {
    const result = JSON.parse(arena.advance(now()));
    if (returning && result.seconds >= 60 && result.coins > 0 && storageAvailable) {
      showNotice('Enquanto você esteve fora, a arena rendeu ' + format.format(result.coins)
        + ' fichas e ' + format.format(result.wins) + ' vitórias.');
    }
    persist();
    if (result.seconds > 0 || returning) draw();
  }

  byId('train').addEventListener('click', () => action(() => arena.train()));
  byId('special').addEventListener('click', () => action(() => arena.special()));
  byId('pause').addEventListener('click', () => action(() => arena.set_paused(!previous.paused, now())));
  document.addEventListener('visibilitychange', () => sync(!document.hidden));
  window.addEventListener('pagehide', persist);
  window.setInterval(() => {
    if (!document.hidden) sync();
  }, 1_000);

  notice.hidden = true;
  if (!storageAvailable) showNotice('O navegador bloqueou o salvamento. O progresso vale nesta sessão.');
  sync(true);
  byId('controls').inert = false;
}

start().catch(error => {
  showNotice('Não foi possível carregar a arena. Abra a demo pelo site ou por um servidor HTTP.');
  console.error(error);
});
