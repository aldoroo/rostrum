/* The engine as HTML, for a site with no code of its own

     <rostrum-table storage="my-site." workbench="bench" workbench-title="Workbench">
       <rostrum-tab name="work" title="Work">
         <rostrum-object name="about" cols="1">...</rostrum-object>
       </rostrum-tab>
     </rostrum-table>

   Each rostrum-object has its own remembered place, size, scale and menu
   What is inside it is up to the site */
import {createRostrum} from './index.js';
import {esc} from './util.js';

class RostrumObjectElement extends HTMLElement {}
class RostrumTabElement extends HTMLElement {}

class RostrumTableElement extends HTMLElement {
  disconnectedCallback() {
    // moved within the page it is connected again by the time this runs
    queueMicrotask(() => {
      if (this.isConnected || !this.rostrum) return;
      this.rostrum.destroy();
      this.rostrum = null;
      this.head.remove();
      this.rail.remove();
      this.append(...this.plane.children);
      this.plane.remove();
    });
  }

  connectedCallback() {
    if (this.rostrum) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.start(), {once: true});
    else this.start();
  }

  start() {
    const tabs = [...this.querySelectorAll(':scope>rostrum-tab')], names = tabs.map(tab => tab.getAttribute('name'));
    const place = Object.fromEntries(tabs.filter(tab => tab.hasAttribute('place')).map(tab => [tab.getAttribute('name'), tab.getAttribute('place').split(',').map(Number)]));
    const titles = Object.fromEntries(tabs.map(tab => [tab.getAttribute('name'), tab.getAttribute('title') || tab.getAttribute('name')]));
    const workbench = this.getAttribute('workbench');
    if (workbench) titles[workbench] = this.getAttribute('workbench-title') || workbench;
    const plane = document.createElement('div');
    for (const tab of tabs) {
      tab.id = `t-${tab.getAttribute('name')}`;
      plane.append(tab);
    }
    this.prepend(plane);
    this.plane = plane;
    const head = document.createElement('h2');
    head.className = 'rostrum-title';
    const rail = document.createElement('nav');
    rail.className = 'rostrum-rail';
    rail.innerHTML = names.map(name => `<button type="button" data-tab="${esc(name)}">${esc(titles[name])}</button>`).join('');
    document.body.append(head, rail);
    this.head = head;
    this.rail = rail;
    // the workbench is not where a site starts unless it says so
    const asked = this.getAttribute('start'), known = asked === workbench || names.includes(asked);
    if (asked && !known) console.error(`${new Date().toISOString()} rostrum-table: start="${asked}" names no tab, the first one opens`);
    this.rostrum = createRostrum({
      frame: this,
      plane,
      tabs: workbench ? [workbench, ...names] : names,
      place,
      start: known ? asked : names[0],
      // by default two sites on one origin keep separate storage
      storage: this.getAttribute('storage') || `rostrum.${location.pathname}.`,
      sectionTag: 'rostrum-tab',
      rail,
      head,
      left: 78,
      top: 96,
      bottom: 60,
      dockTop: 70,
      compactTop: 76,
      workbench,
      titleOf: tab => titles[tab],
      strings: workbench ? {workbench: titles[workbench]} : {},
      plan: (tab, items) => items.map(el => ({el, lane: Number(el.getAttribute('lane')) || 0, span: Number(el.getAttribute('cols')) || 2})),
      ownKey: el => (el.localName === 'rostrum-object' && el.getAttribute('name')) || '',
      ...this.extraOptions(),
    });
    head.textContent = titles[this.rostrum.tab];
    this.rostrum.listen(this, 'rostrum:tab', (/** @type {CustomEvent} */ e) => {
      head.textContent = titles[e.detail.tab];
    });
    this.dispatchEvent(new CustomEvent('rostrum-ready', {detail: this.rostrum}));
  }

  /* more createRostrum options as JSON in the attribute options */
  extraOptions() {
    const raw = this.getAttribute('options');
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error(`${new Date().toISOString()} rostrum-table: the attribute options is not JSON: ${raw}`, error);
      return {};
    }
  }
}

customElements.define('rostrum-object', RostrumObjectElement);
customElements.define('rostrum-tab', RostrumTabElement);
customElements.define('rostrum-table', RostrumTableElement);
