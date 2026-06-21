import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface RawProduct {
  base_code: string;
  name: string;
}

// CPNP (Cosmetic Product Notification Portal) numbers — EC Regulation 1223/2009 Art. 13.
// Blank entries are products the manufacturer hasn't supplied a CPNP number for yet.
const CPNP_RAW = `
080W: 2517264
038M: 2381029
006W: 5040539
157M: 2381050
081W: 5073286
011W: 5040563
052M: 5043797
055W: 2381842
163W: 5652716
042W: 2381828
159W: 3226457
160M:
131W: 4225867
140M: 4573340
119W: 3720369
142U: 4588072
147M
039W: 5041267
116W: 3720351
002M: 2380567
148W:
072U: 5073212
022M: 5040676
133W: 4835817
161W: 5544216
162M: 5544232
028W: 5040784
032M: 5041084
105U: 3227986
062M: 5073076
023W: 2381724
090W: 5073810
003M: 5040501
145W: 5043632
044U: 5043708
068M: 2381055
120W: 3720383
025W:
115W: 3335276
084M: 5073307
027W: 5040768
154W: 2381831
056W: 5043889
040W: 5041291
030M: 5040809
051W: 5043773
136M: 4226286
132W: 4573303
110U: 3204737
054U: 2381038
047W: 5043699
033M: 2381026
020M: 2380630
099U: 5073467
049W: 5043742
031M:
091M: 5073411
021M: 5040666
037M: 5041216
088M: 5073367
078M:
066M:
060M:
015M: 5040623
108M:
071W: 5073195
098W: 5073452
097W: 5073889
082W: 5073299
076W: 5073255
064W: 5073104
057W: 5073051
093W: 5073390
089W: 5073378
135U: 4226193
100U: 5073501
073U: 5073229
114U: 3204740
019W: 5040653
001M: 2380552
070W: 5073182
004M: 5040519
007W: 2381700
018M: 5040637
012M: 5040594
094M: 2588932
153W: 2381826
029W: 5040801
016M: 2380616
069M: 5073168
121W: 4833136
085W: 5073322
079M: 5073265
014W: 5040610
010W: 2381710
048M: 5043731
024W: 5040688
096W: 5073428
086M: 5073340
151W: 2381715
152M: 2380620
061M: 2381044
155U: 2381032
150M: 2380583
156W: 2449244
164M: 5695799
053W: 5043810
067W: 5073147
122W: 3913465
158W: 2517112
026W: 5040748
087M: 5073358
113M: 3139104
127U: 3975785
ASTRAL24:
129U:
144U: 4983870
74M: 5073928
124U: 3879851
IMPERATRIX:
MULTIVERSE:
EVENT23M:
NADIR:
130U: 4011257
75: 5073972
102: 3205629
125: 3999013
126: 3975788
139: 4573290
134U: 4226117
112: 3204723
106: 3206014
138: 4686864
109W: 3204715
111U: 3204719
141U: 4573377
118U: 3748001
146U: 5095190
137U: 4573242
101U: 3205615
128U: 3975780
143U: 4834949
123W: 3978443
EVENT23W:
117U: 3975811
BSF094: 2437947
BSF068: 2383724
BSF061: 2383598
BSF005: 2383010
BSF002: 2382963
BSF001: 2382977
BSF003: 2382994
BSF033: 2383458
BSF080: 3522990
BSF121: 3976568
BSF119: 3976614
BSF042: 2383497
BSF023: 2383165
BSF019: 2383141
BSF007: 2383028
BSF051: 2383526
BSF111:
BSF118:
BSF010: 2383058
BSF016: 2383120
BSF105: 3523482
BSF020: 2383147
BSF055: 2383547
BSF129:
BSF130:
BSF134:
`;

// UFI (Unique Formula Identifier) — CLP Regulation 1272/2008 Annex VIII.
// Used instead of CPNP for non-cosmetic hazardous mixtures (diffusers).
const UFI_RAW = `
COP0016: Y4XV-QAMG-200D-SG8T
COP0001: VHU6-M8V5-F00W-44GA
COP0006: K2J3-093X-A00Q-1WRG
COP0037: X800-G01R-9007-NUKM
COP0026: M7AP-FD40-T002-J1T4
COP0011: YK70-CACQ-600J-WQ0N
COP0034: V300-F0NX-P008-A5EG
COP0021: KPMS-2CV7-X007-P8HY
COP0046: 7H00-003X-600Q-NVAT
COP0031: K500-Y0CA-Y00R-YH0J
COP0043: 1E00-G0EH-W007-YHRR
COP0040: CC00-Y0R4-K00R-965P
`;

function parseMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) {
      map[trimmed] = '';
      continue;
    }
    map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return map;
}

// Mirrors the slugify() used in seed.ts.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ę/g, 'e').replace(/ó/g, 'o').replace(/ś/g, 's')
    .replace(/ł/g, 'l').replace(/ź/g, 'z').replace(/ż/g, 'z').replace(/ć/g, 'c')
    .replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const cpnpMap = parseMap(CPNP_RAW);
  const ufiMap = parseMap(UFI_RAW);
  const raw: RawProduct[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../products/products.json'), 'utf-8'),
  );

  let updated = 0;
  const notFoundInDb: string[] = [];
  const missingBoth: string[] = [];

  for (const p of raw) {
    const code = p.base_code;
    const cpnp = cpnpMap[code];
    const ufi = ufiMap[code];

    if (!cpnp && !ufi) {
      missingBoth.push(`${code} — ${p.name}`);
      continue;
    }

    const slug = `${slugify(p.name)}-${code.toLowerCase()}`;
    const data: { cpnpNotificationNumber?: string; ufiCode?: string } = {};
    if (cpnp) data.cpnpNotificationNumber = cpnp;
    if (ufi) data.ufiCode = ufi;

    const result = await prisma.product.updateMany({ where: { slug }, data });
    if (result.count > 0) {
      console.log(`  ✓ ${code} (${slug}) → ${cpnp ? `CPNP ${cpnp}` : `UFI ${ufi}`}`);
      updated += result.count;
    } else {
      notFoundInDb.push(slug);
    }
  }

  console.log(`\nDone. Updated: ${updated}`);

  if (notFoundInDb.length > 0) {
    console.log(`\nNOT FOUND in DB (${notFoundInDb.length}):`);
    notFoundInDb.forEach((s) => console.log(`  - ${s}`));
  }

  console.log(`\nMissing CPNP/UFI — no number supplied (${missingBoth.length}):`);
  missingBoth.forEach((s) => console.log(`  - ${s}`));
}

if (require.main === module) {
  main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
