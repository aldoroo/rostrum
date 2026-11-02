/* Words written letter by letter with a hot point at the head
   A highlight hides unwritten letters, so layout and DOM stay untouched
   A highlight leaves the text shadow visible, so the element's glow is off during writing and fades back in after
   A task is {root, nodes: [{node, size}], total, span, start} */
import {reducedMotion} from './util.js';

const MOST_NODES = 400;
const GLOW_MS = 300;
// an icon or a colour swatch takes its turn among the letters as if it were two of them, what is larger than this is not an icon
const MARK_SIZE = 2;
const MARK_MOST_AREA = 3600;

/* a frame that lays out a lot is long, so a task counts its time from when it is painted, the second frame from now */
export function countFromPaint(task, now) {
  if (!task.framesLeft) return;
  task.start += now - task.laidAt;
  task.laidAt = now;
  task.framesLeft--;
}

/* what gets written, in reading order, text nodes and small elements with no words of their own */
export function writtenItems(el, out = []) {
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      if (child.data.trim()) out.push({node: child, size: child.data.length});
      continue;
    }
    if (child.nodeType !== 1 || child.matches('style,script,br,input,template')) continue;
    if (child.firstChild && !child.matches('svg,img,canvas')) {
      writtenItems(child, out);
      continue;
    }
    const {width, height} = child.getBoundingClientRect();
    if (width * height > 0 && width * height <= MARK_MOST_AREA) out.push({mark: child, size: MARK_SIZE});
  }
  return out;
}

export function textNodes(el) {
  const nodes = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  /** @type {any} */
  let n;
  while ((n = walker.nextNode())) if (n.data.trim()) nodes.push(n);
  return nodes;
}

export class Writing {
  constructor() {
    this.tasks = new Set();
    this.frame = 0;
    this.writtenIn = new Map();
    this.drawnState = -1;
  }

  get available() {
    return !reducedMotion() && !!window.Highlight && !!CSS.highlights;
  }

  /* writes the words of a popup starting now */
  write(root, span) {
    if (!this.available) return;
    for (const task of this.tasks) if (task.root === root) this.finish(task);
    const nodes = writtenItems(root).slice(0, MOST_NODES);
    const total = nodes.reduce((sum, item) => sum + item.size, 0);
    if (total) this.schedule([{root, nodes, total, span, start: performance.now()}]);
  }

  /* hides the words before this frame is painted, so nothing shows all its words for a moment */
  schedule(tasks) {
    this.drawnState = -1;
    for (const task of tasks) {
      this.tasks.add(task);
      task.parents = new Set(task.nodes.filter(item => item.node).map(item => item.node.parentElement));
      for (const parent of task.parents) {
        this.writtenIn.set(parent, (this.writtenIn.get(parent) || 0) + 1);
        parent.classList.add('rostrum-unwritten');
      }
    }
    cancelAnimationFrame(this.frame);
    this.tick();
    const laid = performance.now();
    for (const task of tasks) Object.assign(task, {laidAt: laid, framesLeft: 2});
  }

  finish(task) {
    this.tasks.delete(task);
    for (const {mark} of task.nodes) if (mark) mark.classList.remove('rostrum-unwritten-mark');
    for (const parent of task.parents) {
      const left = this.writtenIn.get(parent) - 1;
      if (left) {
        this.writtenIn.set(parent, left);
        continue;
      }
      this.writtenIn.delete(parent);
      parent.classList.remove('rostrum-unwritten');
      if (parent.isConnected && !reducedMotion() && getComputedStyle(parent).textShadow !== 'none') parent.animate([{textShadow: 'none'}, {}], {duration: GLOW_MS, easing: 'ease-out'});
    }
  }

  tick() {
    this.frame = 0;
    const now = performance.now(), hidden = [], hot = [];
    let state = 0;
    for (const task of [...this.tasks]) {
      countFromPaint(task, now);
      const progress = (now - task.start) / task.span;
      if (progress >= 1 || !task.root.isConnected || task.nodes.some(item => (item.mark ? !item.mark.isConnected : !item.node.isConnected || item.node.length !== item.size))) this.finish(task);
      else state += Math.floor(task.total * Math.max(0, progress));
    }
    state = state * 1024 + this.tasks.size;
    // setting a highlight repaints the whole page, so it is skipped when nothing changed since the last one
    if (state === this.drawnState) {
      if (this.tasks.size) this.frame = requestAnimationFrame(() => this.tick());
      return;
    }
    this.drawnState = state;
    for (const task of this.tasks) {
      let left = Math.floor(task.total * Math.max(0, (now - task.start) / task.span));
      task.head = null;
      for (const item of task.nodes) {
        const written = left >= item.size;
        if (item.mark) item.mark.classList.toggle('rostrum-unwritten-mark', !written);
        if (written) {
          left -= item.size;
          continue;
        }
        if (!task.head) task.head = item.node || item.mark;
        if (item.mark) {
          left = 0;
          continue;
        }
        // a static range, because the browser updates a live one on every later change of the page
        hidden.push(new StaticRange({startContainer: item.node, startOffset: left, endContainer: item.node, endOffset: item.size}));
        if (left > 0) hot.push(new StaticRange({startContainer: item.node, startOffset: Math.max(0, left - 2), endContainer: item.node, endOffset: left}));
        left = 0;
      }
    }
    CSS.highlights.set('rostrum-hidden', new Highlight(...hidden));
    CSS.highlights.set('rostrum-hot', new Highlight(...hot));
    if (this.tasks.size) this.frame = requestAnimationFrame(() => this.tick());
  }

  /* where the writing of this root stands right now, so the blur around the words can rise with it */
  headOf(root) {
    for (const task of this.tasks) if (task.root === root) return task.head;
    return null;
  }

  stop() {
    cancelAnimationFrame(this.frame);
    for (const task of this.tasks) this.finish(task);
    if (window.Highlight && CSS.highlights) {
      CSS.highlights.delete('rostrum-hidden');
      CSS.highlights.delete('rostrum-hot');
    }
  }
}
