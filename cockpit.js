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
    g.visible = false;
    return { group: g, glass, panel, canvas, ctx, tex, t: 0 };
}

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const _n = new THREE.Vector3();

// info: { q (ship quat), up (planet up), speed, alt, throttle, pulse, assist, planets: [{name, pos, dist}], shipPos, inAtmo, fuel }
export function drawCockpit(ck, info) {
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
    // planet markers
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
