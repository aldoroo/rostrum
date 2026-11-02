/* The frame menu with the arrangement of the open tab, snapshots, flight and look
   It opens from a sliver in the screen corner, which is easy to reach without looking */
import {STANDARD} from './arrangement.js';
import {loosen} from './object.js';
import {esc, targetOf} from './util.js';

export class Settings {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    this.corner = document.createElement('button');
    this.corner.id = 'rostrumCorner';
    this.corner.type = 'button';
    this.corner.setAttribute('aria-label', rostrum.strings.settings);
    this.corner.setAttribute('aria-expanded', 'false');
    this.panel = document.createElement('div');
    this.panel.id = 'rostrumSettings';
    this.panel.dataset.rostrumPopup = '';
    this.panel.hidden = true;
    this.panel.innerHTML = '<div class="rostrum-tray-body"></div>';
    document.body.append(this.corner, this.panel);
    this.corner.addEventListener('click', () => this.toggle(this.panel.hidden));
    this.rostrum.listen(window, 'pointerdown', e => {
      if (targetOf(e).closest && !targetOf(e).closest('#rostrumSettings,#rostrumCorner')) this.toggle(false);
    }, true);
    this.rostrum.listen(window, 'keydown', e => {
      if (e.key === 'Escape') this.toggle(false);
    });
    this.panel.addEventListener('change', e => {
      const row = targetOf(e).closest('.rostrum-shot');
      if (row) this.rostrum.arrangement(this.rostrum.tab).renameShot(row.dataset.id, targetOf(e).value);
    });
    this.panel.addEventListener('click', e => this.act(e));
  }

  stop() {
    this.corner.remove();
    this.panel.remove();
  }

  toggle(open) {
    if (this.panel.hidden === !open) return;
    if (!open) this.rostrum.focus.close(this.panel);
    this.panel.hidden = !open;
    this.corner.setAttribute('aria-expanded', String(open));
    if (open) this.render();
  }

  render() {
    if (this.panel.hidden) return;
    const {rostrum} = this, {strings, options} = rostrum, arrangement = rostrum.arrangement(rostrum.tab), {shots} = arrangement, flight = rostrum.flightOn;
    const shotRow = shot => `<div class="rostrum-shot" data-id="${esc(shot.id)}"><input value="${esc(shot.name)}" maxlength="60" aria-label="${esc(strings.shotName)}"><button type="button" data-set="back">${esc(strings.back)}</button><button type="button" data-set="drop" aria-label="${esc(strings.dropShot)}">×</button></div>`;
    const looks = options.looks.map(look => `<button type="button" data-set="look" data-look="${esc(look.id)}" aria-pressed="${look.id === options.currentLook()}">${esc(look.label)}</button>`).join('');
    this.panel.firstElementChild.innerHTML = `<button type="button" data-set="standard">${esc(strings.standard)}</button>` +
      (arrangement.previous ? `<button type="button" data-set="previous">${esc(strings.previous)}</button>` : '') +
      `<button type="button" data-set="take">${esc(strings.takeShot)}</button>` +
      (shots.length ? `<div class="rostrum-shots-list">${shots.map(shotRow).join('')}</div>` : '') +
      `<div class="rostrum-settings-rows"><button type="button" data-set="flight" aria-pressed="${flight}">${esc(strings.flight)}</button>` +
      (options.chrome && options.chrome.maps === false ? '' : `<button type="button" data-set="tableMap" aria-pressed="${rostrum.maps.tableShown}">${esc(strings.tableMap)}</button><button type="button" data-set="tabMap" aria-pressed="${rostrum.maps.tabShown}">${esc(strings.tabMap)}</button>`) +
      options.switches.map(item => `<button type="button" data-set="switch" data-id="${esc(item.id)}" aria-pressed="${!!item.get()}">${esc(item.label)}</button>`).join('') +
      (looks ? `<div class="rostrum-settings-look"><span>${esc(strings.look)}</span>${looks}</div>` : '') + '</div>';
  }

  /* the whole arrangement is replaced, on the workbench together with the list of what lies there */
  apply(wanted) {
    const {rostrum} = this, tab = rostrum.tab, arrangement = rostrum.arrangement(tab), onBench = rostrum.workbench && tab === rostrum.workbench.id;
    const was = onBench ? {bench: [...rostrum.workbench.list]} : {};
    if (onBench && wanted.bench) rostrum.workbench.setList(wanted.bench);
    arrangement.replace(wanted, was);
    rostrum.section.querySelectorAll('.rostrum-on-table').forEach(loosen);
    this.render();
    rostrum.collect();
    rostrum.camera.apply();
    rostrum.redraw(tab);
    rostrum.emit('arranged', {tab});
  }

  act(e) {
    const button = targetOf(e).closest('button');
    if (!button) return;
    const {rostrum} = this, tab = rostrum.tab, arrangement = rostrum.arrangement(tab), act = button.dataset.set, row = button.closest('.rostrum-shot');
    if (act === 'take') {
      const now = new Date(), two = n => String(n).padStart(2, '0');
      const name = `${two(now.getDate())}.${two(now.getMonth() + 1)} ${two(now.getHours())}:${two(now.getMinutes())}`;
      arrangement.takeShot(name, now.getTime().toString(36), rostrum.workbench && tab === rostrum.workbench.id ? {bench: rostrum.workbench.list} : {});
      this.render();
      /** @type {HTMLInputElement} */ (this.panel.querySelector('.rostrum-shot input')).select();
    } else if (act === 'standard') this.apply(STANDARD);
    else if (act === 'previous') this.apply(arrangement.previous);
    else if (act === 'back') this.apply(arrangement.shot(row.dataset.id));
    else if (act === 'drop') {
      arrangement.dropShot(row.dataset.id);
      this.render();
    } else if (act === 'flight') {
      rostrum.flightOn = !rostrum.flightOn;
      this.render();
    } else if (act === 'tableMap') {
      rostrum.maps.tableShown = !rostrum.maps.tableShown;
      this.render();
    } else if (act === 'tabMap') {
      rostrum.maps.tabShown = !rostrum.maps.tabShown;
      this.render();
    } else if (act === 'switch') {
      const item = rostrum.options.switches.find(one => one.id === button.dataset.id);
      item.set(!item.get());
      this.render();
    } else if (act === 'look') rostrum.options.chooseLook(button.dataset.look);
  }
}
