// Keyboard and mouse state for Solmar Bay. The game polls `keys` each frame;
// menus read the edge-triggered `pressed` set and the mouse click queue.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since the last frame (edge triggered)
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.clicked = false; // a mouse click since the last frame
    this.wheel = 0;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        this.pressed.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.clicked = true;
      }
    });
    window.addEventListener('mouseup', () => { this.mouseDown = false; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.wheel += e.deltaY; }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  /** WASD or arrow-key movement axis, -1..1 on each axis. */
  moveAxis() {
    let x = 0;
    let y = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyW') || this.down('ArrowUp')) y -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y += 1;
    return { x, y };
  }

  /** Clear the edge-triggered state at the end of a frame. */
  endFrame() {
    this.pressed.clear();
    this.clicked = false;
    this.wheel = 0;
  }
}
