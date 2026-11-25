import init, { Arena } from './wasm/strain_fighter.js?v=3';
import { openSave } from './save-client.js';
import { locale, t } from './i18n.js?v=3';
import { createArenaEffects, moves } from './arena-fx.js';

import { createProgressionUI, fighters, rivals } from './progression-ui.js?v=3';
import { makeCommand, messageFor, readArena, sendCommand } from './arena-server.js';
import { mountMarket } from './market.js';


const SAVE_KEY = 'strain-fighter-v1';
const byId = id => document.getElementById(id);

const format = new Intl.NumberFormat(locale);
const notice = byId('notice');
const battlefield = byId('combat');
const effects = createArenaEffects(battlefield);

for (const button of document.querySelectorAll('[data-panel]')) {
  const panel = byId(button.dataset.panel);
  button.addEventListener('click', () => panel.showModal());
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

async function start() {
  await init({ module_or_path: new URL('./wasm/strain_fighter_bg.wasm?v=3', import.meta.url) });
  const requestedSolo = new URL(location.href).searchParams.get('mode') === 'solo';
  const first = requestedSolo ? null : await readArena().catch(error => {
    if (error.status === 404 || error.status === 405) return null;
    throw error;
  });
  const online = first !== null;
  let clockOffset = online ? first.nowMs - Date.now() : 0;
  const now = () => BigInt(Date.now() + clockOffset);
  const saves = online ? null : await openSave({
    game: 'strain-fighter',
    key: SAVE_KEY,
    translate: t,
    controls: byId('save-tools'),
    validate(value) {
      const candidate = new Arena(now(), JSON.stringify(value));
      candidate.free();
      return true;
    },
  });
  let arena = new Arena(now(), online ? JSON.stringify(first.save) : saves.initial ?? undefined);

  function persist() {
    if (saves) saves.write(arena.save());
  }

  if (online) {
    byId('market-button').hidden = false;
    byId('online-save').hidden = false;
    byId('crate-odds').hidden = false;
    const market = mountMarket(byId('market-content'), () => {
      nextRefresh = 0;
      void refresh();
    });
    byId('market-button').addEventListener('click', () => market.refresh());
  } else {
    byId('return-online').hidden = !requestedSolo;
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
    button.addEventListener('click', async () => {
      if (await action({type:'select',fighter:index})) byId('roster-panel').close();
    });
    byId('roster').append(button);
    return { button, level };
  });

  const renderProgression = createProgressionUI(format, online, async (command, id) => {
    if (command === 'rival') {
      if (await action({type:'rival',stage:id})) byId('rivals-panel').close();
    } else if (command === 'advance') {
      if (await action({type:'advance_campaign'})) byId('rivals-panel').close();
    } else if (command === 'equip' || command === 'upgrade' || command === 'crate') {
      await action({type:command,gear:id});
    }
  });

  let previous;
  let dropTimer;
  let networkBusy = false;
  let refreshTask;
  let nextRefresh = Date.now() + 8_000;
  function draw({ normal = false, special = false } = {}) {
    const view = JSON.parse(arena.view());
    const fighter = fighters[view.fighter];
    const rival = rivals[view.stage];
    byId('coins').textContent = format.format(view.coins);
    byId('wins').textContent = format.format(view.wins);
    byId('player-name').textContent = fighter.name;
    byId('rival-name').textContent = rival.name;
    byId('stage-label').textContent = t('Etapa {0} de {1}',view.stage + 1,rivals.length);
    byId('arena-name').textContent = t(rival.arena);
    byId('player-hp').max = view.maxHp;
    byId('player-hp').value = view.hp;
    byId('player-hp-label').textContent = view.hp + '/' + view.maxHp;
    byId('rival-hp').max = view.rivalMaxHp;
    byId('rival-hp').value = view.rivalHp;
    byId('rival-hp-label').textContent = view.rivalHp + '/' + view.rivalMaxHp;
    const playerSprite = byId('player-sprite');
    const rivalSprite = byId('rival-sprite');
    if (!previous || previous.stage !== view.stage || previous.fighter !== view.fighter) {
      effects.clear();
      battlefield.dataset.stage = view.stage;
      playerSprite.className = 'sprite ' + fighter.sprite;
      rivalSprite.className = 'sprite rival ' + rival.sprite;
    }

    const attack = special || (normal && previous?.stage === view.stage && previous.fighter === view.fighter && previous.rivalHp > view.rivalHp);
    if (attack) {
      rivalSprite.classList.remove('defeated');
      const move = moves[fighter.sprite][special ? 'special' : 'normal'];
      effects.play(fighter.sprite, special, t(move.name), view.outcome === 'knockout');
    } else {
      rivalSprite.classList.toggle('defeated', view.outcome === 'knockout');
    }
    playerSprite.classList.toggle('defeated', view.outcome === 'defeat');
    battlefield.classList.toggle('special-active', view.progression.specialTurns > 0);
    if (previous && view.inventory.length > previous.inventory.length) {
      const drop = view.inventory.find(item => !previous.inventory.some(old => old.id === item.id));
      const feed = byId('gear-drop');
      feed.textContent = t('Equipamento obtido · {0}',t(rivals[drop.id].gear));
      feed.hidden = false;
      clearTimeout(dropTimer);
      dropTimer = setTimeout(() => { feed.hidden = true; },3200);
    }
    previous = view;
    renderProgression(view);

    const status = view.outcome === 'knockout' ? 'Vitória por nocaute'
      : view.outcome === 'defeat' ? 'Derrota · revanche automática'
        : view.progression.farming ? 'Treinando contra o mesmo rival' : 'Combate automático';
    const statusElement = byId('fight-status');
    const statusText = t(view.paused ? 'Pausado' : status);
    if (statusElement.textContent !== statusText) statusElement.textContent = statusText;
    const call = byId('fight-call');
    call.hidden = view.outcome === 'fighting' || view.paused;
    call.textContent = t(view.outcome === 'knockout' ? 'K.O.!' : 'REVANCHE');

    for (const [index, entry] of roster.entries()) {
      entry.button.setAttribute('aria-pressed', String(index === view.fighter));
      entry.level.textContent = t('Nv. {0} · Maestria {1}',view.levels[index],view.mastery[index]);
    }
    byId('fighter-xp').textContent = t('{0} XP',format.format(view.progression.xp[view.fighter]));
    byId('fighter-stats').textContent = t('{0} ATQ · {1} PV',view.damage,view.maxHp);
    byId('normal-move').textContent = t(moves[fighter.sprite].normal.name);
    byId('special-name').textContent = t(moves[fighter.sprite].special.name);
    byId('train-cost').textContent = view.trainingCost === null
      ? t('Nível máximo') : t('{0} fichas',format.format(view.trainingCost));
    byId('train').disabled = view.trainingCost === null || view.coins < view.trainingCost;
    byId('charge').textContent = view.charge + ' / ' + view.fullCharge;
    byId('special-meter').max = view.fullCharge;
    byId('special-meter').value = view.charge;
    byId('special').disabled = view.paused || view.charge < view.fullCharge || view.outcome !== 'fighting';
    byId('pause').setAttribute('aria-pressed', String(view.paused));
    byId('pause').textContent = t(view.paused ? 'Retomar' : 'Pausar');
  }

  function applyLocal(command) {
    switch (command.type) {
      case 'train': return arena.train();
      case 'special': return arena.special();
      case 'pause':
        arena.set_paused(command.paused, now());
        return true;
      case 'select': return command.fighter === previous.fighter || arena.select(command.fighter);
      case 'rival': return arena.select_rival(command.stage);
      case 'advance_campaign': return arena.advance_campaign();
      case 'equip': return arena.equip(command.gear);
      case 'upgrade': return arena.upgrade_gear(command.gear);
    }
  }

  function accept(snapshot) {
    clockOffset = snapshot.nowMs - Date.now();
    const replacement = new Arena(now(), JSON.stringify(snapshot.save));
    arena.free();
    arena = replacement;
    nextRefresh = Date.now() + 8_000;
  }

  async function action(command) {
    if (!online) {
      const advanced = JSON.parse(arena.advance(now()));
      const applied = applyLocal(command);
      persist();
      draw({normal:advanced.seconds === 1,special:command.type === 'special' && applied});
      return applied;
    }
    if (refreshTask) await refreshTask;
    if (networkBusy) return false;
    networkBusy = true;
    try {
      const snapshot = await sendCommand(makeCommand(command));
      accept(snapshot);
      draw({special:command.type === 'special' && snapshot.applied});
      if (command.type === 'crate') {
        byId('crate-result').textContent = snapshot.rankGain
          ? t('Caixa aberta. A peça subiu +{0}.', snapshot.rankGain)
          : t('Caixa aberta. A peça manteve o nível.');
      }
      return snapshot.applied || command.type === 'select';
    } catch (error) {
      if (command.type === 'crate') byId('crate-result').textContent = t(messageFor(error));
      else showNotice(t(messageFor(error)));
      return false;
    } finally {
      networkBusy = false;
    }
  }

  function offlineNotice(result) {
    if (result.seconds < 60 || (result.coins === 0 && result.xp === 0)) return;
    const summary = t('Retorno à arena · +{0} fichas · +{1} XP · {2} vitórias',
      format.format(result.coins),format.format(result.xp),format.format(result.wins));
    showNotice(result.gearEarned ? summary + ' · ' + t('{0} equipamentos',format.format(result.gearEarned)) : summary);
  }

  function refresh(returning = false) {
    if (!online || networkBusy) return;
    networkBusy = true;
    refreshTask = readArena().then(snapshot => {
      accept(snapshot);
      if (returning) offlineNotice(snapshot.advance);
      draw({normal:!returning && snapshot.advance.seconds === 1});
    }).catch(error => {
      nextRefresh = Date.now() + 8_000;
      showNotice(t(messageFor(error)));
    }).finally(() => {
      networkBusy = false;
      refreshTask = undefined;
    });
    return refreshTask;
  }

  function sync(returning = false) {
    const result = JSON.parse(arena.advance(now()));
    if (returning) offlineNotice(result);
    if (result.seconds > 0) persist();
    if (result.seconds > 0 || returning) draw({ normal: !returning && result.seconds === 1 });
  }

  byId('train').addEventListener('click', () => action({type:'train'}));
  byId('special').addEventListener('click', () => action({type:'special'}));
  byId('pause').addEventListener('click', () => action({type:'pause',paused:!previous.paused}));
  document.addEventListener('visibilitychange', () => {
    if (online) {
      if (!document.hidden) void refresh(true);
    } else sync(!document.hidden);
  });
  window.addEventListener('pagehide', () => {
    if (!previous.paused) persist();
  });
  saves?.onRestore(raw => {
    const replacement = new Arena(now(), raw);
    arena.free();
    arena = replacement;
    previous = undefined;
    clearTimeout(dropTimer);
    byId('gear-drop').hidden = true;
    notice.hidden = true;
    sync(true);
  });
  window.setInterval(() => {
    if (document.hidden || networkBusy) return;
    sync();
    if (online && Date.now() >= nextRefresh) void refresh();
  }, 1_000);

  notice.hidden = true;
  if (online) {
    offlineNotice(first.advance);
    draw();
  } else {
    sync(true);
    if (saves.initial === null) persist();
  }
  byId('controls').inert = false;
}

start().catch(error => {
  showNotice(t('Não foi possível carregar a arena. Abra a demo pelo site ou por um servidor HTTP.'));
  console.error(error);
});
