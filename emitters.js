/* What gives light on the table
   Each object is a plate with a rim and a glow in the surface, and elements the site names as accents are lit on their own inside an object
   Both go to the scene in world coordinates as {kind: 'plate'|'accent', x, y, w, h, tint: {color, strength, edge}, owner, tab, slide?, since?} */

export class Emitters {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    this.since = new Map();
  }

  collect(tab, items) {
    const {rostrum} = this, zone = rostrum.zoneOf(tab), {options} = rostrum, found = [];
    for (const el of items) {
      const object = rostrum.objectOf(el), at = object.world;
      if (at.w > 1 && at.h > 1) found.push({kind: 'plate', x: zone.x + at.x, y: zone.y + at.y, w: at.w, h: at.h, tint: options.tint(el), owner: el, tab, slide: object.slide});
    }
    if (options.accents) this.accentsOf(tab, zone, found);
    rostrum.scene.setEmitters(tab, found);
  }

  accentsOf(tab, zone, found) {
    const {rostrum} = this;
    rostrum.sectionOf(tab).querySelectorAll(rostrum.options.accents).forEach((/** @type {HTMLElement} */ el, i) => {
      const owner = /** @type {HTMLElement | null} */ (el.closest('.rostrum-on-table'));
      if (!owner || !el.offsetWidth || !el.offsetHeight) return;
      // summed from offsets because a screen rect would depend on the camera, which may be anywhere and tilted
      let dx = 0, dy = 0;
      for (let n = el; n && n !== owner; n = /** @type {HTMLElement} */ (n.offsetParent)) {
        const parent = n.offsetParent;
        dx += n.offsetLeft - (parent ? parent.scrollLeft : 0);
        dy += n.offsetTop - (parent ? parent.scrollTop : 0);
      }
      const object = rostrum.objectOf(owner), at = object.world, z = object.zoom, key = `${tab}|${rostrum.keyOf(owner)}|${i}`;
      if (!this.since.has(key)) this.since.set(key, performance.now());
      found.push({kind: 'accent', x: zone.x + at.x + dx * z, y: zone.y + at.y + dy * z, w: el.offsetWidth * z, h: el.offsetHeight * z, tint: rostrum.options.tint(el), owner, tab, since: this.since.get(key)});
    });
  }

  /* one object is being carried, so only its lights move */
  moved(object) {
    const {rostrum} = this, list = rostrum.scene.emittersOf(rostrum.tab), plate = list.find(r => r.kind === 'plate' && r.owner === object.el);
    if (!plate) return;
    const at = object.world, zone = rostrum.zoneOf(rostrum.tab), dx = zone.x + at.x - plate.x, dy = zone.y + at.y - plate.y;
    for (const r of list) {
      if (r.owner !== object.el) continue;
      r.x += dx;
      r.y += dy;
    }
    rostrum.scene.request();
  }
}
