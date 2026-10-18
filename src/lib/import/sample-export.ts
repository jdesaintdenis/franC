// Builds docs/samples/sample-export.csv: a fully synthetic export in the real bank's format.
// Deterministic (fixed seed) so the committed file can be checked against this script. Merchants,
// amounts and references are invented; nothing here comes from a real export (SPEC §85).
const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

const SEED = 70; // if the self-check below fails after a change, try 71, 72...
const MONTHS = ["2025-07", "2025-08", "2025-09"] as const;

interface Row {
  booking: string; // ISO
  operation: string; // ISO
  short: string;
  raw: string;
  ref: string;
  info: string;
  type: string;
  category: string;
  subcategory: string;
  cents: number; // negative = debit
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ddmmyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
const euros = (cents: number) => {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
};

export function buildSampleExport(): string {
  const rand = mulberry32(SEED);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const cents = (minEuros: number, maxEuros: number) => int(Math.round(minEuros * 100), Math.round(maxEuros * 100));
  const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");
  const prlvRef = (mid = "G") => `${digits(7)}${mid}${digits(8)}`;
  const virRef = () => `${digits(7)}IN${digits(7)}`;
  const uuid = () => {
    const b = Array.from({ length: 16 }, () => int(0, 255));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  const rows: Row[] = [];
  const same = (iso: string) => ({ booking: iso, operation: iso });
  const direct = (iso: string, short: string, raw: string, type: string, cat: string, sub: string, amount: number, mid = "G", info?: string): Row => {
    const ref = prlvRef(mid);
    return { ...same(iso), short, raw, ref, info: info ?? `${ref}-`, type, category: cat, subcategory: sub, cents: amount };
  };
  const NEW_IN = ["A categoriser - rentree d'argent", "Virement recu - a categoriser"] as const;
  const day = (m: string, d: number) => `${m}-${String(d).padStart(2, "0")}`;

  [...MONTHS].reverse().forEach((m) => {
    const i = MONTHS.indexOf(m);
    const mm = m.slice(5);
    const dd = (jul: number, aug: number, sep: number) => day(m, [jul, aug, sep][i]);
    rows.push(
      direct(dd(30, 29, 30), "HORIZON TELECOM", "PRLV HORIZON TELECOM", "Prelevement", "Logement - maison", "Internet et telephonie", [-3999, -3999, -4299][i]),
      direct(dd(30, 29, 30), "ATELIER LUMEN SAS", "VIR SEPA ATELIER LUMEN SAS", "Virement recu", NEW_IN[0], NEW_IN[1], [284317, 284317, 289640][i], "K", `SALAIRE ${mm}/2025 ATELIER LUMEN`),
    );
    if (i === 2) {
      rows.push({ booking: "2025-09-30", operation: "2025-09-29", short: "RETRAIT D'ESPECES", raw: "RETRAIT DAB 29-09-10001-200001", ref: "", info: "", type: "Retrait d'especes", category: "A categoriser - sortie d'argent", subcategory: "Retrait d'especes - a categoriser", cents: -6000 });
    }
    rows.push(
      { ...same(dd(30, 29, 30)), short: "VIR. VERS LIVRET EPARGNE", raw: "VIR. VERS LIVRET EPARGNE", ref: virRef(), info: "", type: "Virement", category: "Transaction exclue", subcategory: "Virement interne", cents: -25000 },
      direct(day(m, 5), "VOLTA ENERGIE", "PRLV VOLTA ENERGIE CLIENTS", "Prelevement", "Logement - maison", "Energie eau, gaz, electricite, fioul", -8400),
      direct(day(m, 5), "CAISSE AIDE FAMILLE", "VIR SEPA CAISSE AIDE FAMILLE", "Virement recu", NEW_IN[0], NEW_IN[1], 9850, "K", `AIDE FAMILLE ${mm}/2025`),
      { ...same(day(m, 6)), short: "ECHEANCE DE CREDIT", raw: `ECH PRET 100001A DU 06/${mm}/25`, ref: "", info: "", type: "Pret", category: "Banque et assurances", subcategory: "Credit", cents: -41250 },
      { ...same(day(m, 6)), short: "ECHEANCE DE CREDIT", raw: `ECH PRET 100002B DU 06/${mm}/25`, ref: "", info: "", type: "Pret", category: "Banque et assurances", subcategory: "Credit", cents: -5820 },
      direct(day(m, 8), "REGIE DES EAUX DU VAL", "PRLV REGIE DES EAUX DU VAL", "Prelevement", "Logement - maison", "Energie eau, gaz, electricite, fioul", -3140),
      direct(day(m, 8), "MUTUELLE DU VAL", "PRLV MUTUELLE DU VAL", "Prelevement", "Banque et assurances", "Banque et assurance - autre", -2790),
      direct(day(m, 10), "CLUB FORME PLUS", "PRLV CLUB FORME PLUS", "Prelevement", "Loisirs et vacances", "Sport, Gym et Equipement", -2900),
      { booking: day(m, 13), operation: day(m, 12), short: "STREAMBOX", raw: `CB STREAMBOX FACT ${ddmmyy(day(m, 12))}`, ref: uuid(), info: "", type: "Carte bancaire", category: "Loisirs et vacances", subcategory: "Video, Musique et jeux", cents: -1349 },
      direct(day(m, 15), "IMPOTS", "PRLV TRESOR PUBLIC PRELEVEMENT", "Prelevement", "Impots et taxes", "Impots et taxes - autre", -9600),
      { ...same(day(m, 17)), short: "COTISATION CARTE", raw: "COTISATION CARTE", ref: "", info: "", type: "Frais bancaires", category: "Banque et assurances", subcategory: "Frais bancaires", cents: -290 },
    );
  });

  // Two identical same-day pairs: they exercise occurrence indexes in the dedupe hash.
  const pair = (short: string, stem: string, op: string, booking: string, amount: number, cat: string, sub: string) => {
    for (let k = 0; k < 2; k++) {
      rows.push({ booking, operation: op, short, raw: `CB ${stem} FACT ${ddmmyy(op)}`, ref: uuid(), info: "", type: "Carte bancaire", category: cat, subcategory: sub, cents: amount });
    }
  };
  pair("LAVERIE DES TILLEULS", "LAVERIE DES TILL", "2025-09-09", "2025-09-10", -650, "Shopping et services", "Shopping et services - autre");
  pair("BRASSERIE DES QUAIS", "BRASSERIE DES QUA", "2025-09-05", "2025-09-08", -2430, "Alimentation", "Restaurant");

  const MERCHANTS: [string, string, string, string, number, number, number][] = [
    ["BOULANGERIE DES LILAS", "BOULANGERIE DES L", "Alimentation", "Alimentation - autre", 8, 1.2, 7.8],
    ["MARCHE PLUS", "MARCHE PLUS", "Alimentation", "Hyper/supermarche", 5, 12, 140],
    ["EPICERIE DU COIN", "EPICERIE DU COIN", "Alimentation", "Hyper/supermarche", 3, 4, 25],
    ["PRIMEUR DES HALLES", "PRIMEUR DES HALL", "Alimentation", "Hyper/supermarche", 2, 6, 22],
    ["PIZZERIA BELLA", "PIZZERIA BELLA", "Alimentation", "Restaurant", 2, 18, 45],
    ["BRASSERIE DES QUAIS", "BRASSERIE DES QUA", "Alimentation", "Restaurant", 1, 20, 60],
    ["SNACK DU PORT", "SNACK DU PORT", "Alimentation", "Restauration rapide", 3, 6, 18],
    ["CINEMA ETOILE", "CINEMA ETOILE", "Loisirs et vacances", "Expo, musee, cinema", 1, 9, 25],
    ["STATION ROUTE 9", "STATION ROUTE 9", "Transports", "Carburant", 2, 30, 70],
    ["PEAGE AUTOROUTE", "AUTOROUTE A99 NORD", "Transports", "Peage et Stationnement", 1, 3, 15],
    ["LIBRAIRIE DES ARTS", "LIBRAIRIE DES ART", "Loisirs et vacances", "Livres, Magazines", 1, 8, 30],
    ["JARDINERIE VERTE", "JARDINERIE VERTE", "Logement - maison", "Ameublement et appareil", 1, 10, 60],
    ["ANIMAUX ET CIE", "ANIMAUX ET CIE", "Shopping et services", "Animaux domestiques", 1, 15, 40],
    ["PARKING CENTRE", "PARKING CENTRE", "A categoriser - sortie d'argent", "Paiement CB - a categoriser", 1, 2, 8],
  ];
  for (const m of MONTHS) {
    for (const [short, stem, cat, sub, count, min, max] of MERCHANTS) {
      for (let k = 0; k < count; k++) {
        const operation = day(m, int(1, 28));
        rows.push({ booking: addDays(operation, int(1, 2)), operation, short, raw: `CB ${stem} FACT ${ddmmyy(operation)}`, ref: uuid(), info: "", type: "Carte bancaire", category: cat, subcategory: sub, cents: -cents(min, max) });
      }
    }
  }

  // Array.prototype.sort is stable: same-day rows keep the order they were built in.
  rows.sort((a, b) => (a.booking < b.booking ? 1 : a.booking > b.booking ? -1 : 0));

  const seen = new Map<string, number>();
  for (const r of rows) seen.set(`${r.operation}|${r.raw}|${r.cents}`, (seen.get(`${r.operation}|${r.raw}|${r.cents}`) ?? 0) + 1);
  const dupes = [...seen.values()].filter((n) => n > 1);
  if (rows.length !== 140 || dupes.length !== 2 || dupes.some((n) => n !== 2)) {
    throw new Error(`sample: expected 140 rows and exactly two identical pairs, got ${rows.length} rows and ${dupes.length} repeated keys; try another SEED`);
  }

  const lines = rows.map((r) =>
    [
      dmy(r.booking), r.short, r.raw, r.ref, r.info, r.type, r.category, r.subcategory,
      r.cents < 0 ? `-${euros(r.cents)}` : "",
      r.cents > 0 ? `+${euros(r.cents)}` : "",
      dmy(r.operation), dmy(r.booking), "0",
    ].join(";"),
  );
  return `${[HEADER, ...lines].join("\r\n")}\r\n`;
}
