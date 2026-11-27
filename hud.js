// hud.js - one canvas HUD used as DOM overlay (desktop) and as a grabbable panel (VR)
import * as THREE from './three.module.js';

const W = 1024, H = 640;

export function makeHud() {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.id = 'hud';
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.6), mat);
    mesh.renderOrder = 999;
    return { canvas, ctx, tex, mesh, rects: [], hover: null };
}

function bar(ctx, x, y, w, label, v, color) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x, y, w, 16);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, v)), 16);
    ctx.fillStyle = '#fff';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(label + ' ' + Math.round(v * 100) + '%', x + w + 12, y + 14);
}

function panel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(8,14,24,0.72)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,90,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

export function drawHud(hud, info) {
    const ctx = hud.ctx;
    ctx.clearRect(0, 0, W, H);
    const top = info.menu ? 260 : 250;
    panel(ctx, 8, 8, W - 16, top);
    ctx.fillStyle = '#ffd27a';
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.fillText(info.title, 28, 50);
    ctx.fillStyle = '#cfe3ff';
    ctx.font = '500 20px system-ui, sans-serif';
    ctx.fillText(info.sub, 28, 80);
    let y = 100;
    for (const b of info.bars) {
        bar(ctx, 28, y, 280, b.label, b.v, b.color);
        y += 26;
    }
    ctx.fillStyle = '#fff';
    ctx.font = '600 21px system-ui, sans-serif';
    ctx.fillText(info.inv, 28, y + 20);
    // right column: messages
    ctx.font = '500 18px system-ui, sans-serif';
    let my = 46;
    for (const m of info.msgs) {
        ctx.fillStyle = 'rgba(180,255,200,' + Math.min(1, m.t / 1.5).toFixed(2) + ')';
        ctx.fillText(m.text, 520, my, 480);
        my += 25;
    }
    if (info.prompt) {
        ctx.fillStyle = '#ffe9a8';
        ctx.font = '700 26px system-ui, sans-serif';
        ctx.fillText(info.prompt, 28, top - 14);
    }
    hud.rects = [];
    if (info.menu) {
        panel(ctx, 8, top + 16, W - 16, H - top - 24);
        const cols = 2, bw = (W - 64) / cols, bh = 46;
        info.buttons.forEach((b, i) => {
            const x = 24 + (i % cols) * (bw + 16), yy = top + 28 + Math.floor(i / cols) * (bh + 8);
            const sel = info.sel === i || hud.hover === b.id;
            ctx.fillStyle = !b.enabled ? 'rgba(255,255,255,0.06)' : sel ? 'rgba(255,170,60,0.85)' : 'rgba(255,255,255,0.16)';
            ctx.beginPath();
            ctx.roundRect(x, yy, bw - 16, bh, 10);
            ctx.fill();
            ctx.fillStyle = b.enabled ? (sel ? '#1a1206' : '#fff') : '#888';
            ctx.font = '600 21px system-ui, sans-serif';
            ctx.fillText(b.label, x + 14, yy + 31);
            hud.rects.push({ id: b.id, x, y: yy, w: bw - 16, h: bh, enabled: b.enabled });
        });
    }
    hud.tex.needsUpdate = true;
}

// x,y in canvas pixels
export function hudHit(hud, x, y) {
    for (const r of hud.rects) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.enabled ? r.id : null;
    }
    return null;
}

export const HUD_W = W, HUD_H = H;
