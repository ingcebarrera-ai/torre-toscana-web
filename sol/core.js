// Núcleo de cálculo solar + sombras. Funciona en navegador y en Node.
(function (root) {
  const D2R = Math.PI / 180;
  const SITE = { lat: -17.378, lon: -66.155, tz: -4 }; // Cochabamba, Bolivia (UTC-4, sin horario de verano)

  // Posición del sol (algoritmo NOAA). Devuelve altura y azimut (desde el norte, horario) en grados.
  function sunPos(doy, hourLocal) {
    const g = 2 * Math.PI / 365 * (doy - 1 + (hourLocal - SITE.tz - 12) / 24);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
      - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = hourLocal * 60 + eq + 4 * SITE.lon - 60 * SITE.tz;
    const ha = (tst / 4 - 180) * D2R;
    const lat = SITE.lat * D2R;
    const cz = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
    const alt = Math.asin(Math.max(-1, Math.min(1, cz)));
    let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
    return { alt: alt / D2R, az: ((az / D2R) % 360 + 360) % 360, dec: dec / D2R };
  }
  // Vector unitario hacia el sol: x = este, y = norte, z = arriba
  function sunVec(p) {
    const a = p.alt * D2R, z = p.az * D2R;
    return [Math.sin(z) * Math.cos(a), Math.cos(z) * Math.cos(a), Math.sin(a)];
  }

  // Escena en metros, origen = centro de tu edificio (círculo rojo). Medidas tomadas del mapa (≈0,5 m por píxel).
  function buildScene(o) {
    o = Object.assign({ myFloors: 11, eastFloors: 8, gap: 60, northFloors: 20, southFloors: 30, floorH: 3.0 }, o || {});
    const myH = o.myFloors * o.floorH;
    const gc = -8; // centro del espacio entre torres, alineado con tu edificio (calle Hermógenes Sejas)
    const T = 40.5; // lado de cada torre nueva: 40,5 m ≈ 1640 m²; crecen hacia afuera, el espacio entre ellas no cambia
    return {
      opts: o,
      mine: { name: 'Torre Toscana', x0: -8.6, x1: 8.6, y0: -11, y1: 11, h: myH }, // 17,2 × 22 m ≈ 378 m² (+50 %)
      boxes: [
        { id: 'este', name: 'Edificio vecino (este)', x0: 23.6, x1: 44.6, y0: -10.5, y1: 22,  // 21 × 32,5 m (alargado 30 % hacia el norte), a 15 m
          h: o.eastFloors * o.floorH },
        { id: 'norte', name: 'Torre noroeste', x0: -98.25, x1: -57.75, y0: gc + o.gap / 2, y1: gc + o.gap / 2 + T, h: o.northFloors * o.floorH },
        { id: 'sur', name: 'Torre suroeste', x0: -117.25, x1: -76.75, y0: gc - o.gap / 2 - T, y1: gc - o.gap / 2, h: o.southFloors * o.floorH },
      ],
    };
  }

  function hitBox(p, d, b) {
    let tmin = 1e-4, tmax = 1e9;
    const lo = [b.x0, b.y0, 0], hi = [b.x1, b.y1, b.h];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (p[i] < lo[i] || p[i] > hi[i]) return null; continue; }
      let t1 = (lo[i] - p[i]) / d[i], t2 = (hi[i] - p[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    return tmin;
  }

  const FACES = {
    O: { label: 'Fachada oeste', n: [-1, 0, 0] },
    N: { label: 'Fachada norte', n: [0, 1, 0] },
    E: { label: 'Fachada este', n: [1, 0, 0] },
    S: { label: 'Fachada sur', n: [0, -1, 0] },
  };
  function facePoint(sc, f, z) {
    const m = sc.mine;
    if (f === 'O') return [m.x0 - 0.05, 0, z];
    if (f === 'E') return [m.x1 + 0.05, 0, z];
    if (f === 'N') return [0, m.y1 + 0.05, z];
    return [0, m.y0 - 0.05, z];
  }
  // ¿Le da el sol a ese punto? Devuelve {lit, by} (by = id del edificio que tapa)
  function litAt(sc, f, z, sp) {
    if (sp.alt <= 0.3) return { lit: false, by: 'noche' };
    const d = sunVec(sp), n = FACES[f].n;
    if (d[0] * n[0] + d[1] * n[1] < 0.02) return { lit: false, by: 'orientacion' };
    const p = facePoint(sc, f, z);
    for (const b of sc.boxes) if (hitBox(p, d, b) !== null) return { lit: false, by: b.id };
    return { lit: true };
  }
  // Recorre el día en pasos de 'step' minutos: horas de sol + tramos
  function dayProfile(sc, f, z, doy, step) {
    step = step || 5;
    let mins = 0, spans = [], cur = null;
    for (let t = 5 * 60; t <= 20 * 60; t += step) {
      const r = litAt(sc, f, z, sunPos(doy, t / 60));
      if (r.lit) { mins += step; if (!cur) { cur = [t, t]; spans.push(cur); } cur[1] = t + step; }
      else cur = null;
    }
    return { hours: mins / 60, spans };
  }
  function fmt(t) { const h = Math.floor(t / 60), m = Math.round(t % 60); return h + ':' + String(m).padStart(2, '0'); }

  root.SolarCore = { SITE, sunPos, sunVec, buildScene, litAt, dayProfile, FACES, fmt, hitBox };
})(typeof window !== 'undefined' ? window : globalThis);
