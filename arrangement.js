/* Where the objects of one surface stand, how large they are, which ones are held to the lens, plus the snapshots of all that
   It lives in browser storage and touches no DOM, so it can be tested on its own */

export const STANDARD = {spots: {}, sizes: {}, pins: {}, loose: {}};
// object names come from the site, and one called "constructor" would otherwise find a value on Object.prototype
const table = object => Object.assign(Object.create(null), object);

export class Arrangement {
  constructor(store, surface) {
    this.store = store;
    this.surface = surface;
    this.spots = table(store.get(`rostrumSpots.${surface}`, {}));
    this.sizes = table(store.get(`rostrumSizes.${surface}`, {}));
    this.pins = table(store.get(`rostrumPins.${surface}`, {}));
    this.loose = table(store.get(`rostrumLoose.${surface}`, {}));
  }

  save() {
    this.store.set(`rostrumSpots.${this.surface}`, this.spots);
    this.store.set(`rostrumSizes.${this.surface}`, this.sizes);
    this.store.set(`rostrumPins.${this.surface}`, this.pins);
    this.store.set(`rostrumLoose.${this.surface}`, this.loose);
  }

  /* an order above every object moved so far, so the next moved object lies on top */
  topOrder() {
    return Math.max(9, ...Object.values(this.spots).map(spot => spot.o || 0)) + 1;
  }

  /* drops an object and everything nested under its key */
  forget(key) {
    for (const part of [this.spots, this.sizes, this.pins, this.loose]) {
      for (const name of Object.keys(part)) {
        if (name === key || name.startsWith(`${key}/`)) delete part[name];
      }
    }
    this.save();
  }

  picture() {
    return {spots: this.spots, sizes: this.sizes, pins: this.pins, loose: this.loose};
  }

  /* the replaced arrangement is kept as the previous one */
  replace(wanted, extra = {}) {
    this.store.set(`rostrumShotPrev.${this.surface}`, {...this.picture(), ...extra});
    this.spots = table(wanted.spots);
    this.sizes = table(wanted.sizes);
    this.pins = table(wanted.pins);
    this.loose = table(wanted.loose || {});
    this.save();
  }

  get previous() {
    return this.store.get(`rostrumShotPrev.${this.surface}`, null);
  }

  get shots() {
    return this.store.get(`rostrumShots.${this.surface}`, []);
  }

  takeShot(name, id, extra = {}) {
    this.store.set(`rostrumShots.${this.surface}`, [{id, name, ...this.picture(), ...extra}, ...this.shots]);
  }

  renameShot(id, name) {
    this.store.set(`rostrumShots.${this.surface}`, this.shots.map(shot => (shot.id === id ? {...shot, name} : shot)));
  }

  dropShot(id) {
    this.store.set(`rostrumShots.${this.surface}`, this.shots.filter(shot => shot.id !== id));
  }

  shot(id) {
    return this.shots.find(shot => shot.id === id);
  }
}
