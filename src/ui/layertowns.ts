import type { Settlement } from '../sim/state';

/** The towns of one layer, drawn in that layer's view: a small house in the realm's colour (or gold), with its name. */
export function drawLayerTowns(g: CanvasRenderingContext2D, towns: Settlement[], at: (x: number, y: number, c: number) => [number, number], copies: number[], colour: (st: Settlement) => string = () => '#f3d27a'): void {
  g.save();
  for (const st of towns) {
    if (st.ruined) continue;
    for (const c of copies) {
      const [x, y] = at(st.x, st.y, c);
      const r = 5 + Math.min(3, Math.sqrt(st.pop) / 10);
      g.beginPath();
      g.moveTo(x - r, y + r * 0.8);
      g.lineTo(x - r, y - r * 0.2);
      g.lineTo(x, y - r);
      g.lineTo(x + r, y - r * 0.2);
      g.lineTo(x + r, y + r * 0.8);
      g.closePath();
      g.fillStyle = colour(st);
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.stroke();
      g.font = '600 11px system-ui, sans-serif';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.fillStyle = '#fff';
      g.strokeText(st.name, x + r + 4, y + 4);
      g.fillText(st.name, x + r + 4, y + 4);
    }
  }
  g.restore();
}
