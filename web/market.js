import { locale, t } from './i18n.js?v=3';
import { rivals } from './progression-ui.js?v=3';
import { makeCommand, messageFor, readMarket, sendCommand } from './arena-server.js';

const fmt = new Intl.NumberFormat(locale);
const element = (tag, value) => Object.assign(document.createElement(tag), { textContent: value });
const gearName = ({id, rank}) => t(rivals[id].gear) + (rank ? ' +' + rank : '');

export function mountMarket(root, onChange = () => {}) {
  const wallet = element('strong', '–');
  const status = element('p', '');
  status.className = 'market-status';
  status.setAttribute('role', 'status');
  const tools = document.createElement('div');
  tools.className = 'market-tools';
  const balance = element('span', t('Saldo de fichas') + ' ');
  const reload = element('button', t('Atualizar'));
  const retry = element('button', t('Reenviar ação'));
  retry.hidden = true;
  balance.append(wallet);
  tools.append(balance, reload, retry);

  const form = document.createElement('form');
  form.className = 'listing-form';
  const gear = document.createElement('select');
  gear.required = true;
  const price = document.createElement('input');
  Object.assign(price, { type: 'number', min: '1', max: '1000000', step: '1', required: true });
  const gearLabel = element('label',t('Peça para vender'));
  gearLabel.append(gear);
  const priceLabel = element('label',t('Preço em fichas'));
  priceLabel.append(price);
  const publish = element('button',t('Anunciar'));
  publish.disabled = true;
  form.append(gearLabel, priceLabel, publish);

  const mine = document.createElement('ul');
  const publicOffers = document.createElement('ul');
  mine.className = publicOffers.className = 'market-list';
  const paging = document.createElement('div');
  paging.className = 'market-tools';
  const first = element('button',t('Ofertas recentes'));
  const next = element('button',t('Ofertas anteriores'));
  first.hidden = next.hidden = true;
  paging.append(first,next);
  root.replaceChildren(tools,status,form,element('h3',t('Minhas ofertas')),mine,element('h3',t('Ofertas de jogadores')),publicOffers,paging);

  let before, nextBefore, current, pending, busy = false;
  const render = state => {
    current = state;
    wallet.textContent = fmt.format(state.coins);
    const selected = gear.value;
    const sellable = state.inventory.filter(item => !item.equipped);
    gear.replaceChildren(...sellable.map(({gear}) => Object.assign(element('option',gearName(gear)),{value:String(gear.id)})));
    if (!sellable.length) gear.append(Object.assign(element('option',t('Nenhuma peça desequipada')),{value:''}));
    if (sellable.some(item => String(item.gear.id) === selected)) gear.value = selected;
    nextBefore = state.nextBefore;
    first.hidden = !before;
    next.hidden = !nextBefore;

    const renderOffers = (list, entries, own) => {
      list.replaceChildren(...entries.map(offer => {
        const item = document.createElement('li');
        const details = document.createElement('div');
        details.append(element('strong',gearName(offer.gear)),element('small',t('{0} fichas',fmt.format(offer.price))));
        const owned = state.inventory.some(item => item.gear.id === offer.gear.id)
          || state.mine.some(item => item.gear.id === offer.gear.id);
        const label = own ? 'Cancelar oferta' : owned ? 'Já possui esta peça' : 'Comprar';
        const control = element('button',t(label));
        control.disabled = !own && (owned || offer.price > state.coins);
        control.addEventListener('click',() => submit({type:own ? 'cancel' : 'buy',listing:offer.id}));
        item.append(details,control);
        return item;
      }));
      if (!entries.length) list.append(element('li',t(own?'Você não tem ofertas ativas.':'Nenhuma oferta nesta página.')));
    };
    renderOffers(mine,state.mine,true);
    renderOffers(publicOffers,state.listings,false);
  };

  function setBusy(value) {
    busy = value;
    root.setAttribute('aria-busy',String(value));
    gear.disabled = price.disabled = publish.disabled = value || Boolean(pending) || !gear.value;
    retry.disabled = value;
    reload.disabled = first.disabled = next.disabled = value;
    for (const control of root.querySelectorAll('.market-list button')) {
      if (!control.hasAttribute('data-disabled')) control.dataset.disabled = String(control.disabled);
      control.disabled = value || Boolean(pending) || control.dataset.disabled === 'true';
    }
  }

  async function refresh(page = before) {
    if (busy) return;
    setBusy(true);
    try {
      const state = await readMarket(page);
      before = page;
      render(state);
      status.textContent = '';
    } catch (error) {
      status.textContent = t(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(command) {
    if (busy || (!command && !pending) || (command && pending)) return;
    pending ??= makeCommand(command);
    setBusy(true);
    let resultMessage;
    try {
      await sendCommand(pending);
      pending = undefined;
      resultMessage = t('Mercado atualizado.');
      if (command?.type === 'list') price.value = '';
      onChange();
    } catch (error) {
      if (error.status && error.status < 500) pending = undefined;
      resultMessage = t(messageFor(error));
    } finally {
      retry.hidden = !pending;
      setBusy(false);
    }
    await refresh();
    if (current) status.textContent = resultMessage;
  }

  form.addEventListener('submit',event => {
    event.preventDefault();
    if (!gear.value || !form.reportValidity()) return;
    void submit({type:'list',gear:Number(gear.value),price:Number(price.value)});
  });
  reload.addEventListener('click',()=>refresh());
  retry.addEventListener('click',()=>submit());
  first.addEventListener('click',()=>refresh(0));
  next.addEventListener('click',()=>refresh(nextBefore));
  return { refresh };
}

if (document.body.classList.contains('strain-market-page')) {
  const market = mountMarket(document.querySelector('[data-strain-market]'));
  void market.refresh();
}
