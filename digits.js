/* Figures run through random digits and settle from first to last
   The random digits are written into the real text nodes, so code that needs the true value calls settle first */
import {reducedMotion} from './util.js';
import {countFromPaint, textNodes} from './writing.js';

export class Digits {
  constructor() {
    this.tasks = new Set();
    this.running = new Map();
    this.frame = 0;
  }

  run(el, delay, span, before) {
    if (reducedMotion()) return;
    this.settle(el);
    const nodes = textNodes(el).map(node => ({node, final: node.data, shown: node.data}));
    const count = nodes.reduce((sum, item) => sum + item.final.length, 0), now = nodes.map(item => item.final).join('');
    if (!count || !/\d/.test(now)) return;
    // the digits that did not change stay still, compared place by place
    const keep = before && before.length === now.length ? [...now].map((ch, i) => before[i] === ch) : null;
    const task = {el, nodes, count, start: performance.now() + delay, span, keep, laidAt: performance.now(), framesLeft: 2};
    this.tasks.add(task);
    this.running.set(el, task);
    if (!this.frame) this.frame = requestAnimationFrame(() => this.tick());
  }

  settle(el) {
    const task = this.running.get(el);
    if (!task) return;
    for (const item of task.nodes) if (item.node.data === item.shown) item.node.data = item.final;
    this.tasks.delete(task);
    this.running.delete(el);
  }

  tick() {
    this.frame = 0;
    const now = performance.now();
    for (const task of this.tasks) {
      countFromPaint(task, now);
      let index = 0, running = false;
      for (const item of task.nodes) {
        let out = '';
        for (let i = 0; i < item.final.length; i++, index++) {
          const ch = item.final[i];
          if (ch < '0' || ch > '9' || (task.keep && task.keep[index]) || now >= task.start + task.span * (0.3 + 0.7 * index / task.count)) {
            out += ch;
            continue;
          }
          running = true;
          out += now < task.start ? ch : String.fromCharCode(48 + Math.floor(Math.random() * 10));
        }
        // the page wrote its own text here, so this run ends and that text stays
        if (item.node.data !== item.shown) {
          running = false;
          break;
        }
        if (item.shown !== out) {
          item.node.data = out;
          item.shown = out;
        }
      }
      if (!running) {
        this.tasks.delete(task);
        this.running.delete(task.el);
      }
    }
    if (this.tasks.size) this.frame = requestAnimationFrame(() => this.tick());
  }

  stop() {
    for (const el of [...this.running.keys()]) this.settle(el);
  }
}
