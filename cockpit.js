// cockpit.js - glass cockpit: faint canopy and a holographic flight HUD
import * as THREE from './three.module.js';

const W = 1024, H = 768;
const PW = 2.0, PH = 1.5, DIST = 2.6;   // panel size and distance in meters
const PX = W / PW;                      // pixels per meter on the panel

export function makeCockpit() {
    const g = new THREE.Group();
    // glass bubble: almost invisible, a soft rim and the sun glint
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.6, 32, 16).scale(1, 0.85, 1.35), new THREE.ShaderMaterial({
        uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) } },
        vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
            void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vV; varying vec3 vW;
            void main() {
                float f = 1.0 - abs(dot(vN, vV));
                float rim = pow(f, 4.0) * 0.18;
                float glint = pow(max(dot(reflect(-vV, -vN), uSun), 0.0), 60.0) * 0.25;
                gl_FragColor = vec4(vec3(0.7, 0.85, 1.0) * (rim + glint) + vec3(glint), rim + glint * 0.5 + 0.015);
            }`,
        side: THREE.BackSide, transparent: true, depthWrite: false, fog: false
    }));
    g.add(glass);
    // HUD panel
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending
    }));
    panel.position.z = -DIST;
    panel.renderOrder = 997;
    g.add(panel);
    // light side bars (default) and a bottom bar: fixed parts of the craft, out of the forward view
    const left = barPanel(256, 640, 0.26, 0.65), right = barPanel(256, 640, 0.26, 0.65), bottom = barPanel(1024, 160, 0.9, 0.14);
    left.mesh.position.set(-0.62, -0.16, -0.86);
    right.mesh.position.set(0.62, -0.16, -0.86);
    bottom.mesh.position.set(0, -0.47, -0.95);
    for (const b of [left, right, bottom]) { b.mesh.lookAt(0, 0, 0); g.add(b.mesh); }
    g.visible = false;
    return { group: g, glass, panel, canvas, ctx, tex, t: 0, left, right, bottom, mode: 'sides' };
}

function barPanel(w, h, mw, mh) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending
    }));
    mesh.renderOrder = 997;
    return { canvas, ctx: canvas.getContext('2d'), tex, mesh };
}

function glassBack(x, w, h) {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(90,200,255,0.10)'); g.addColorStop(0.5, 'rgba(90,200,255,0.03)'); g.addColorStop(1, 'rgba(90,200,255,0.10)');
    x.fillStyle = g;
    x.beginPath(); x.roundRect(4, 4, w - 8, h - 8, 18); x.fill();
    x.strokeStyle = 'rgba(140,230,255,0.35)'; x.lineWidth = 3; x.stroke();
}

const COL = 'rgba(140,255,215,0.95)', DIM = 'rgba(140,255,215,0.5)';
function fmtSpeed(v) { return v > 1000 ? (v / 1000).toFixed(1) + ' km/s' : Math.round(v) + ' m/s'; }
function fmtAlt(v) { return v > 5000 ? (v / 1000).toFixed(1) + ' km' : Math.round(v) + ' m'; }
function tagsOf(info) {
    return [info.pulse ? 'PULSE' : '', info.boost ? 'BOOST' : '', info.under ? 'SUBMERGED' : '', info.assist ? 'ASSIST' : '', info.landed ? 'LANDED' : ''].filter(Boolean);
}

function attitude(x, cx, cy, r, pitch, roll) {
    x.save();
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.strokeStyle = DIM; x.lineWidth = 3; x.stroke();
    x.clip();
    x.translate(cx, cy); x.rotate(roll);
    const off = Math.max(-r, Math.min(r, pitch / 0.8 * r));
    x.fillStyle = 'rgba(90,200,255,0.18)'; x.fillRect(-r, off, 2 * r, 2 * r);
    x.strokeStyle = COL; x.lineWidth = 4;
    x.beginPath(); x.moveTo(-r, off); x.lineTo(r, off); x.stroke();
    x.restore();
    x.strokeStyle = COL; x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx - r * 0.6, cy); x.lineTo(cx - r * 0.2, cy); x.lineTo(cx, cy + r * 0.12); x.lineTo(cx + r * 0.2, cy); x.lineTo(cx + r * 0.6, cy); x.stroke();
}

function drawBars(ck, info, pitch, roll, hdg) {
    const tags = tagsOf(info);
    if (ck.mode === 'sides') {
        let x = ck.left.ctx, w = 256, h = 640;
        x.clearRect(0, 0, w, h); glassBack(x, w, h);
        x.textAlign = 'center'; x.fillStyle = DIM; x.font = '600 26px system-ui, sans-serif';
        x.fillText('SPEED', w / 2, 60);
        x.fillStyle = COL; x.font = '700 42px system-ui, sans-serif';
        x.fillText(fmtSpeed(info.speed), w / 2, 112);
        x.strokeStyle = DIM; x.lineWidth = 3; x.strokeRect(w / 2 - 22, 150, 44, 330);
        const t = Math.max(0, Math.min(1, info.throttle));
        x.fillStyle = 'rgba(140,255,215,0.6)'; x.fillRect(w / 2 - 19, 150 + 327 * (1 - t), 38, 327 * t);
        x.font = '600 24px system-ui, sans-serif'; x.fillStyle = COL;
        tags.forEach((s, i) => x.fillText(s, w / 2, 530 + i * 32));
        ck.left.tex.needsUpdate = true;
        x = ck.right.ctx;
        x.clearRect(0, 0, w, h); glassBack(x, w, h);
        x.textAlign = 'center'; x.fillStyle = DIM; x.font = '600 26px system-ui, sans-serif';
        x.fillText(info.inAtmo ? 'ALTITUDE' : 'TO SURFACE', w / 2, 60);
        x.fillStyle = COL; x.font = '700 42px system-ui, sans-serif';
        x.fillText(fmtAlt(info.alt), w / 2, 112);
        if (info.inAtmo) {
            attitude(x, w / 2, 280, 90, pitch, roll);
            x.fillStyle = DIM; x.font = '600 26px system-ui, sans-serif'; x.fillText('HEADING', w / 2, 440);
            x.fillStyle = COL; x.font = '700 40px system-ui, sans-serif'; x.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', w / 2, 488);
        }
        if (info.target) {
            x.fillStyle = 'rgba(255,210,120,0.95)'; x.font = '600 24px system-ui, sans-serif';
            x.fillText(info.target.name, w / 2, 560);
            x.fillText(fmtAlt(info.target.dist), w / 2, 592);
        }
        ck.right.tex.needsUpdate = true;
    } else if (ck.mode === 'bottom') {
        const x = ck.bottom.ctx, w = 1024, h = 160;
        x.clearRect(0, 0, w, h); glassBack(x, w, h);
        x.fillStyle = COL; x.font = '700 44px system-ui, sans-serif';
        x.textAlign = 'left'; x.fillText(fmtSpeed(info.speed), 36, 72);
        x.textAlign = 'right'; x.fillText(fmtAlt(info.alt), w - 36, 72);
        x.fillStyle = DIM; x.font = '600 22px system-ui, sans-serif';
        x.textAlign = 'left'; x.fillText('SPEED', 36, 108);
        x.textAlign = 'right'; x.fillText(info.inAtmo ? 'ALTITUDE' : 'TO SURFACE', w - 36, 108);
        x.strokeStyle = DIM; x.lineWidth = 3; x.strokeRect(300, 46, 424, 22);
        x.fillStyle = 'rgba(140,255,215,0.6)'; x.fillRect(303, 49, 418 * Math.max(0, Math.min(1, info.throttle)), 16);
        x.fillStyle = COL; x.textAlign = 'center'; x.font = '600 24px system-ui, sans-serif';
        x.fillText(tags.join('   '), w / 2, 112);
        ck.bottom.tex.needsUpdate = true;
    }
}

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const _n = new THREE.Vector3();

// info: { q (ship quat), up (planet up), speed, alt, throttle, pulse, assist, planets: [{name, pos, dist}], shipPos, inAtmo, fuel }
export function drawCockpit(ck, info) {
    ck.left.mesh.visible = ck.right.mesh.visible = ck.mode === 'sides';
    ck.bottom.mesh.visible = ck.mode === 'bottom';
    ck.panel.visible = ck.mode !== 'off';
    const full = ck.mode === 'hud';
    const x = ck.ctx;
    x.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const col = 'rgba(120,255,210,0.95)', dim = 'rgba(120,255,210,0.45)';
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 3;
    x.font = '600 26px system-ui, sans-serif';
    x.textAlign = 'center';
    x.shadowColor = 'rgba(80,255,200,0.8)'; x.shadowBlur = 8;
    _f.set(0, 0, -1).applyQuaternion(info.q);
    _r.set(1, 0, 0).applyQuaternion(info.q);
    _u.set(0, 1, 0).applyQuaternion(info.q);
    const pitch0 = Math.asin(Math.max(-1, Math.min(1, _f.dot(info.up))));
    const roll0 = Math.atan2(_r.dot(info.up), _u.dot(info.up));
    let hdg0 = 0;
    {
        const nn = new THREE.Vector3(0, 1, 0).addScaledVector(info.up, -info.up.y);
        if (nn.lengthSq() < 1e-6) nn.set(1, 0, 0);
        nn.normalize();
        const ee = new THREE.Vector3().crossVectors(nn, info.up);
        const fh = _f.clone().addScaledVector(info.up, -_f.dot(info.up));
        hdg0 = (Math.atan2(fh.dot(ee), fh.dot(nn)) * 180 / Math.PI + 360) % 360;
    }
    drawBars(ck, info, pitch0, roll0, hdg0);
    if (!full) {
        // only planet markers on the forward glass, and only out in space
        if (!info.inAtmo) markers(ck, info, x, cx, cy);
        ck.tex.needsUpdate = true;
        return;
    }
    // boresight
    x.beginPath();
    x.arc(cx, cy, 14, 0, 7);
    x.moveTo(cx - 50, cy); x.lineTo(cx - 20, cy);
    x.moveTo(cx + 20, cy); x.lineTo(cx + 50, cy);
    x.moveTo(cx, cy - 14); x.lineTo(cx, cy - 26);
    x.stroke();
    if (info.inAtmo) {
        const pitch = Math.asin(Math.max(-1, Math.min(1, _f.dot(info.up))));
        const roll = Math.atan2(_r.dot(info.up), _u.dot(info.up));
        x.save();
        x.translate(cx, cy);
        x.rotate(roll);
        x.beginPath();
        x.rect(-W * 0.32, -H * 0.36, W * 0.64, H * 0.72);
        x.clip();
        for (let a = -80; a <= 80; a += 10) {
            const da = a * Math.PI / 180 - pitch;
            if (Math.abs(da) > 0.42) continue;
            const y = -Math.tan(da) * DIST * PX;
            const w = a === 0 ? 300 : 110;
            x.strokeStyle = a === 0 ? col : dim;
            x.setLineDash(a < 0 ? [14, 10] : []);
            x.beginPath();
            x.moveTo(-w, y); x.lineTo(-40, y);
            x.moveTo(40, y); x.lineTo(w, y);
            if (a !== 0) { x.moveTo(-w, y); x.lineTo(-w, y + (a > 0 ? 14 : -14)); x.moveTo(w, y); x.lineTo(w, y + (a > 0 ? 14 : -14)); }
            x.stroke();
            if (a !== 0) { x.fillStyle = dim; x.fillText(String(a), -w - 30, y + 9); x.fillText(String(a), w + 30, y + 9); }
        }
        x.setLineDash([]);
        x.restore();
        // heading tape (north = planet +Y axis)
        _n.set(0, 1, 0).addScaledVector(info.up, -info.up.y);
        if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
        _n.normalize();
        const east = _d.crossVectors(_n, info.up);
        const fh = _f.clone().addScaledVector(info.up, -_f.dot(info.up));
        const hdg = (Math.atan2(fh.dot(east), fh.dot(_n)) * 180 / Math.PI + 360) % 360;
        x.fillStyle = col; x.strokeStyle = col;
        x.font = '600 22px system-ui, sans-serif';
        for (let k = -40; k <= 40; k += 5) {
            const hv = Math.round(hdg / 5) * 5 + k;
            const px = cx + (hv - hdg) * 6;
            if (Math.abs(px - cx) > 250) continue;
            const v = ((hv % 360) + 360) % 360;
            x.beginPath(); x.moveTo(px, 40); x.lineTo(px, v % 10 === 0 ? 58 : 50); x.stroke();
            if (v % 30 === 0) x.fillText(v === 0 ? 'N' : v === 90 ? 'E' : v === 180 ? 'S' : v === 270 ? 'W' : String(v), px, 84);
        }
        x.beginPath(); x.moveTo(cx, 34); x.lineTo(cx - 8, 22); x.lineTo(cx + 8, 22); x.closePath(); x.fill();
    }
    // speed (left) and altitude (right)
    x.font = '700 34px system-ui, sans-serif';
    x.textAlign = 'right';
    const spd = info.speed > 1000 ? (info.speed / 1000).toFixed(1) + ' km/s' : Math.round(info.speed) + ' m/s';
    x.fillText(spd, cx - 230, cy + 12);
    x.textAlign = 'left';
    const alt = info.alt > 5000 ? (info.alt / 1000).toFixed(1) + ' km' : Math.round(info.alt) + ' m';
    x.fillText(alt, cx + 230, cy + 12);
    x.font = '500 18px system-ui, sans-serif';
    x.fillStyle = dim;
    x.textAlign = 'right'; x.fillText('SPEED', cx - 230, cy - 26);
    x.textAlign = 'left'; x.fillText(info.inAtmo ? 'ALTITUDE' : 'TO SURFACE', cx + 230, cy - 26);
    // throttle bar
    x.strokeStyle = dim; x.lineWidth = 2;
    x.strokeRect(cx - 300, H - 120, 600, 16);
    x.fillStyle = col;
    x.fillRect(cx - 300, H - 120, 600 * Math.max(0, Math.min(1, info.throttle)), 16);
    x.font = '600 22px system-ui, sans-serif';
    x.textAlign = 'center';
    const tags = [info.pulse ? 'PULSE' : '', info.boost ? 'BOOST' : '', info.assist ? 'ASSIST' : '', info.landed ? 'LANDED' : ''].filter(Boolean).join('   ');
    x.fillText(tags, cx, H - 140);
    markers(ck, info, x, cx, cy);
    x.shadowBlur = 0;
    ck.tex.needsUpdate = true;
}

function markers(ck, info, x, cx, cy) {
    _q.copy(info.q).invert();
    x.font = '600 20px system-ui, sans-serif';
    for (const p of info.planets) {
        _d.copy(p.pos).sub(info.shipPos).applyQuaternion(_q);
        if (_d.z > -1) continue;
        const px = cx + (_d.x / -_d.z) * DIST * PX, py = cy - (_d.y / -_d.z) * DIST * PX;
        if (px < 40 || px > W - 40 || py < 100 || py > H - 160) continue;
        x.strokeStyle = 'rgba(255,210,120,0.9)'; x.fillStyle = 'rgba(255,210,120,0.95)';
        x.beginPath(); x.moveTo(px, py - 12); x.lineTo(px + 12, py); x.lineTo(px, py + 12); x.lineTo(px - 12, py); x.closePath(); x.stroke();
        x.fillText(p.name + '  ' + (p.dist > 1000 ? (p.dist / 1000).toFixed(1) + ' km' : Math.round(p.dist) + ' m'), px, py - 20);
    }
    x.shadowBlur = 0;
    ck.tex.needsUpdate = true;
}
