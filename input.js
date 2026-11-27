// input.js - keyboard, mouse, gamepad and WebXR controllers into one frame input
export function makeInput(dom) {
    const s = { keys: new Set(), pressed: new Set(), mdx: 0, mdy: 0, mouseL: false, mouseLP: false, locked: false,
        pad: {}, xr: { left: {}, right: {} }, turnLatch: false, dom };
    addEventListener('keydown', e => {
        if (!e.repeat) s.pressed.add(e.code);
        s.keys.add(e.code);
        if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', e => s.keys.delete(e.code));
    addEventListener('blur', () => s.keys.clear());
    addEventListener('mousemove', e => {
        if (!s.locked) return;
        s.mdx += e.movementX; s.mdy += e.movementY;
    });
    dom.addEventListener('mousedown', e => {
        if (e.button === 0) { s.mouseL = true; s.mouseLP = true; }
    });
    addEventListener('mouseup', e => { if (e.button === 0) s.mouseL = false; });
    document.addEventListener('pointerlockchange', () => { s.locked = document.pointerLockElement === dom; });
    return s;
}

function blank() {
    return { mx: 0, my: 0, lookX: 0, lookY: 0, turn: 0, snap: 0, jet: false, sprint: false, fire: false, fireP: false,
        scanP: false, interactP: false, menuP: false, throttle: 0, pitch: 0, yaw: 0, roll: 0, boost: false, pulse: false,
        up: false, down: false, selUp: false, selDown: false, selectP: false, cancelP: false };
}

const dz = v => Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85;

export function readDesktop(s) {
    const I = blank();
    const k = c => s.keys.has(c), p = c => s.pressed.has(c);
    I.mx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    I.my = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    I.lookX = s.mdx * 0.0022; I.lookY = s.mdy * 0.0022;
    I.jet = k('Space'); I.sprint = k('ShiftLeft') || k('ShiftRight');
    I.fire = s.mouseL && s.locked; I.fireP = s.mouseLP && s.locked;
    I.scanP = p('KeyF') || p('KeyC');
    I.interactP = p('KeyE');
    I.menuP = p('Tab') || p('KeyM');
    I.throttle = I.my;
    I.roll = -I.mx;
    I.yaw = (k('KeyQ') ? 1 : 0) - (k('KeyZ') ? 1 : 0);
    I.pitch = (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0);
    I.boost = I.sprint;
    I.pulse = k('Space');
    I.selUp = p('ArrowUp'); I.selDown = p('ArrowDown'); I.selectP = p('Enter');
    I.cancelP = p('Escape');
    // gamepad (e.g. Stadia controller in Bluetooth mode)
    const gp = (navigator.getGamepads ? navigator.getGamepads() : []).find(g => g && g.mapping === 'standard');
    if (gp) {
        const b = i => gp.buttons[i] && gp.buttons[i].pressed;
        const bp = i => b(i) && !s.pad[i];
        const ax = i => dz(gp.axes[i] || 0);
        I.mx += ax(0); I.my -= ax(1);
        I.lookX += ax(2) * 0.045; I.lookY += ax(3) * 0.045;
        I.jet = I.jet || b(0); I.sprint = I.sprint || b(10);
        const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
        I.fire = I.fire || rt > 0.4; I.fireP = I.fireP || (rt > 0.4 && !s.pad.rt);
        I.scanP = I.scanP || bp(2);
        I.interactP = I.interactP || bp(1);
        I.menuP = I.menuP || bp(9) || bp(3);
        const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
        I.throttle = Math.max(-1, Math.min(1, I.throttle + lt - (b(4) ? 0.6 : 0)));
        I.yaw -= ax(0);
        I.pitch += ax(1);
        I.roll -= ax(2);
        I.boost = I.boost || b(0);
        I.pulse = I.pulse || b(5);
        I.selUp = I.selUp || bp(12); I.selDown = I.selDown || bp(13); I.selectP = I.selectP || bp(0);
        I.pad = true;
        for (let i = 0; i < gp.buttons.length; i++) s.pad[i] = b(i);
        s.pad.rt = rt > 0.4;
    }
    return I;
}

// XR: Quest Touch controllers via xr-standard mapping
export function readXR(s, session, mode, opts) {
    const I = blank();
    const now = { left: null, right: null };
    for (const src of session.inputSources) {
        if (src.gamepad && (src.handedness === 'left' || src.handedness === 'right')) now[src.handedness] = src.gamepad;
    }
    const L = now.left, R = now.right;
    const btn = (g, i) => !!(g && g.buttons[i] && g.buttons[i].pressed);
    const val = (g, i) => (g && g.buttons[i]) ? g.buttons[i].value : 0;
    const axis = (g, i) => g ? dz(g.axes[i] || 0) : 0;
    const edge = (hand, g, i) => btn(g, i) && !s.xr[hand][i];
    const lx = axis(L, 2), ly = axis(L, 3), rx = axis(R, 2), ry = axis(R, 3);
    I.mx = lx; I.my = -ly;
    I.sprint = btn(L, 3);
    I.jet = btn(R, 4);
    I.fire = val(R, 0) > 0.5;
    I.fireP = I.fire && !s.xr.right.t;
    I.scanP = edge('left', L, 4);
    I.interactP = edge('right', R, 5);
    I.menuP = edge('left', L, 5);
    I.selectP = I.fireP;
    // turning
    if (opts.snap) {
        if (Math.abs(rx) > 0.7 && !s.turnLatch) { I.snap = Math.sign(rx); s.turnLatch = true; }
        if (Math.abs(rx) < 0.3) s.turnLatch = false;
    } else I.turn = rx;
    // ship
    I.throttle = Math.max(val(L, 0), -ly > 0 ? -ly : 0) - (ly > 0 ? ly : 0);
    I.yaw = -lx;
    I.pitch = ry;
    I.roll = -rx;
    I.boost = btn(R, 4);
    I.pulse = btn(L, 4);
    I.gripL = btn(L, 1); I.gripR = btn(R, 1);
    I.gripLP = edge('left', L, 1); I.gripRP = edge('right', R, 1);
    for (const hand of ['left', 'right']) {
        const g = now[hand];
        s.xr[hand] = {};
        if (g) for (let i = 0; i < g.buttons.length; i++) s.xr[hand][i] = g.buttons[i].pressed;
    }
    s.xr.right.t = I.fire;
    I.xr = true;
    return I;
}

export function endFrame(s) {
    s.pressed.clear();
    s.mdx = 0; s.mdy = 0;
    s.mouseLP = false;
}
