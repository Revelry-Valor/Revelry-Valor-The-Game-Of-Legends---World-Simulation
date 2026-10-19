// Turn the world data line of a pasted climate report back into a world file:
//   node scripts/decode-report.mjs report.txt world.json
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [, , input, output = 'world.json'] = process.argv;
const text = readFileSync(input, 'utf8');
const gz = text.match(/RVW1\.gz:([A-Za-z0-9+/=\s]+)/);
const plain = text.match(/RVW1\.json:(\{[\s\S]*\})/);
let json;
if (gz) json = gunzipSync(Buffer.from(gz[1].replace(/\s+/g, ''), 'base64')).toString('utf8');
else if (plain) json = plain[1];
else throw new Error('No world data (RVW1) found in the report.');
const world = JSON.parse(json);
writeFileSync(output, JSON.stringify(world));
console.log(`Wrote ${output}: ${world.surface.strokes.length} strokes, ${world.settings.widthKm} × ${world.settings.heightKm} km.`);
