import { t } from './i18n.js?v=3';

export const fighters = [
  { name: 'Lemon Haze', sprite: 'lemon', techniques: [
    ['Carga em cadeia', 'O terceiro golpe de cada sequência carrega o especial duas vezes.'],
    ['Rastro elétrico', 'Raio Limão reforça em 50% os próximos três golpes do round.'],
  ] },
  { name: 'Purple Kush', sprite: 'violet', techniques: [
    ['Guarda de pétalas', 'Recebe 25% menos dano dos contra-ataques.'],
    ['Casca violeta', 'Abalo Violeta reduz pela metade os próximos dois contra-ataques.'],
  ] },
  { name: 'Mango Punch', sprite: 'mango', techniques: [
    ['Contrapé solar', 'A cada quatro golpes, causa 75% a mais de dano.'],
    ['Fôlego solar', 'Vórtice Solar recupera 25% da vida máxima.'],
  ] },
];

export const rivals = [
  { name: 'Violet Skunk', sprite: 'violet', arena: 'Estufa Subsolo', gear: 'Bandagens de cânhamo' },
  { name: 'Solar Diesel', sprite: 'mango', arena: 'Viveiro Leste', gear: 'Pingente de âmbar' },
  { name: 'Jade Widow', sprite: 'lemon', arena: 'Jardim de Vidro', gear: 'Ataduras de jade' },
  { name: 'Nightshade', sprite: 'night', arena: 'Cúpula Noturna', gear: 'Talismã da noite' },
  { name: 'Black Resin', sprite: 'night resin', arena: 'Ringue da Resina', gear: 'Luvas de resina' },
  { name: 'Copper Thorn', sprite: 'bramble copper', arena: 'Pátio de Cobre', gear: 'Selo de cobre', style: 'Contra-ataque forte a cada quatro golpes' },
  { name: 'Frost Root', sprite: 'bramble frost', arena: 'Estufa Congelada', gear: 'Punhos de gelo', style: 'Defesa reforçada' },
  { name: 'Ember Bloom', sprite: 'bramble ember', arena: 'Caldeira Floral', gear: 'Amuleto de brasa', style: 'Contra-ataque forte a cada três golpes' },
  { name: 'Briar Crown', sprite: 'bramble briar', arena: 'Trono de Espinhos', gear: 'Coroa de espinhos', style: 'Defesa reforçada e contra-ataques fortes' },
];

const byId = id => document.getElementById(id);
const element = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
function button(label, command, id, disabled = false) {
  const control = element('button', label);
  control.type = 'button';
  control.dataset.command = command;
  if (id !== undefined) control.dataset.item = id;
  control.disabled = disabled;
  return control;
}

function updateList(root, entries) {
  const focused = document.activeElement;
  const command = root.contains(focused) && focused.dataset.command;
  const item = focused?.dataset.item;
  root.replaceChildren(...entries);
  if (command) {
    for (const control of root.querySelectorAll('button')) {
      if (!control.disabled && control.dataset.command === command && control.dataset.item === item) {
        control.focus({ preventScroll: true });
        break;
      }
    }
  }
}

function renderTechniques(view, format) {
  const {fighter, mastery, techniqueXp, progression} = view;
  const xp = progression.xp[fighter];
  const cards = fighters[fighter].techniques.map(([name, description], tier) => {
    const card = document.createElement('li');
    const unlocked = xp >= techniqueXp[tier];
    card.dataset.learned = unlocked;
    card.append(
      element('strong', t(name)),
      element('span', unlocked ? t('Aprendida') : t('Libera com {0} XP', format.format(techniqueXp[tier]))),
      element('p', t(description)),
    );
    return card;
  });
  byId('mastery-summary').textContent = t('Maestria {0} · {1} XP', mastery[fighter], format.format(xp));
  byId('techniques').replaceChildren(...cards);
}

function renderRivals(view) {
  const cards = rivals.map((rival, index) => {
    const locked = index > view.progression.highestStage;
    const card = button(rival.name, 'rival', index, locked);
    const defeated = index < view.progression.highestStage || (index === rivals.length - 1 && view.outcome === 'knockout' && index === view.stage);
    const label = index === view.stage ? 'Rival atual' : locked ? 'Bloqueado' : defeated ? 'Vencido' : 'Disponível';
    card.replaceChildren(
      element('strong', t('Etapa {0} · {1}', index + 1, rival.name)),
      element('small', t(label) + (rival.style ? ' · ' + t(rival.style) : '')),
    );
    if (index === view.stage) card.setAttribute('aria-current', 'location');
    return card;
  });
  updateList(byId('rival-list'),cards);
  byId('auto-advance').disabled = !view.progression.farming;
}

function renderInventory(view, format, online) {
  const cards = view.inventory.map(item => {
    const card = document.createElement('li');
    const label = document.createElement('div');
    const actions = document.createElement('div');
    actions.className = 'gear-actions';
    const selected = item.wearer === view.fighter;
    const wearLabel = selected ? 'Retirar' : item.wearer === null ? 'Equipar' : 'Transferir';
    const detail = [t(item.slot === 'wraps' ? 'Punhos' : 'Amuleto')];
    if (item.stats.attack) detail.push(t('+{0} ATQ',item.stats.attack));
    if (item.stats.hp) detail.push(t('+{0} PV',item.stats.hp));
    if (item.stats.guard) detail.push(t('+{0} DEF',item.stats.guard));
    if (item.wearer !== null) detail.push(fighters[item.wearer].name);
    card.dataset.equipped = selected;
    label.append(element('strong',t(rivals[item.id].gear) + (item.rank ? ' +' + item.rank : '')), element('small',detail.join(' · ')));
    actions.append(
      button(t(wearLabel),'equip',item.id),
      button(item.upgradeCost === null ? t('Melhoria máxima') : t('Melhorar · {0} fichas',format.format(item.upgradeCost)),
        'upgrade',item.id,item.upgradeCost === null || view.coins < item.upgradeCost),
    );
    if (online) actions.append(button(t('Caixa · 40 fichas'),'crate',item.id,
      item.wearer !== null || item.upgradeCost === null || view.coins < 40));
    card.append(label,actions);
    return card;
  });
  byId('equipment-fighter').textContent = fighters[view.fighter].name;
  if (!cards.length) cards.push(element('li',t('Vença cada rival pela primeira vez para ganhar equipamento.')));
  updateList(byId('inventory'),cards);
}

export function createProgressionUI(format, online, handle) {
  let renderedTechniques, renderedRivals, renderedInventory;
  for (const panel of [byId('rivals-panel'),byId('equipment-panel')]) {
    panel.addEventListener('click', event => {
      const control = event.target.closest('button[data-command]');
      if (!control || control.disabled) return;
      handle(control.dataset.command,Number(control.dataset.item));
    });
  }
  return view => {
    const xpKey = [view.fighter,view.progression.xp[view.fighter]].join(':');
    if (xpKey !== renderedTechniques) {
      renderedTechniques = xpKey;
      renderTechniques(view, format);
    }
    const rivalKey = JSON.stringify([view.stage,view.progression.highestStage,view.progression.farming,view.outcome]);
    if (rivalKey !== renderedRivals) {
      renderedRivals = rivalKey;
      renderRivals(view);
    }
    const inventoryKey = JSON.stringify([view.fighter,view.coins,view.inventory]);
    if (inventoryKey !== renderedInventory) {
      renderedInventory = inventoryKey;
      renderInventory(view, format, online);
    }
  };
}
