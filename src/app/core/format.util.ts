/** NTSC ↔ PAL: same film, 24 fps vs 25 fps (≈4 %). */
export function palMinutesFromNtsc(ntsc: number): number {
  return Math.round((ntsc * 24) / 25);
}

export function ntscMinutesFromPal(pal: number): number {
  return Math.round((pal * 25) / 24);
}

/** Prefer stored NTSC; if missing, derive from legacy PAL. */
export function resolveNtscMinutes(ntsc: number | null | undefined, pal: number | null | undefined): number | null {
  if (ntsc != null && ntsc > 0) {
    return ntsc;
  }
  if (pal != null && pal > 0) {
    return ntscMinutesFromPal(pal);
  }
  return null;
}

export function formatRuntimeMinutes(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) {
    return '';
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) {
    return `${mins}min`;
  }
  return `${hours}h ${mins}min`;
}

/** Decode leftover HTML entities from legacy MySQL/php dumps. */
export function decodeEntities(value: string | null | undefined): string {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    return '';
  }
  const named: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&#039;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&auml;': 'ä',
    '&ouml;': 'ö',
    '&aring;': 'å',
    '&Auml;': 'Ä',
    '&Ouml;': 'Ö',
    '&Aring;': 'Å',
    '&eacute;': 'é',
    '&Eacute;': 'É',
    '&uuml;': 'ü',
    '&Uuml;': 'Ü',
  };
  let s = value;
  for (const [k, v] of Object.entries(named)) {
    s = s.replaceAll(k, v);
    s = s.replaceAll(k.toUpperCase(), v);
  }
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  // Literal escapes left in DB text, e.g. Patch'\s London, Director\'s Cut, "\huonon …"\
  s = s.replace(/'\\s/g, "'s");
  s = s.replace(/\\'/g, "'");
  s = s.replace(/\\"/g, '"');
  s = s.replace(/([A-Za-zÄÖÅäöå])\\'([A-Za-zÄÖÅäöå])/g, "$1'$2");
  s = s.replace(/\\([A-Za-zÄÖÅäöå])/g, '$1');
  s = s.replace(/\\(?![\\nrt])/g, '');
  return s;
}

/** True for placeholder catalog rows ("-", "(uusi)", empty). */
export function isPlaceholderLookup(value: string | number | null | undefined): boolean {
  if (value == null) {
    return true;
  }
  const s = String(value).trim().toLowerCase();
  return !s || s === '-' || s === '(uusi)' || s === 'uusi';
}

/** PHP swap_names: "Last, First" → "First Last" */
export function swapNames(name: string | null | undefined): string {
  const s = decodeEntities(name);
  const i = s.indexOf(',');
  if (i <= 0) {
    return s;
  }
  return `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`.trim();
}

/** PHP swap_title: move leading article from trailing ", The" form. */
export function swapTitle(title: string | null | undefined, titleLanguageId: number | null | undefined): string {
  let str = decodeEntities(title);
  if (!str) {
    return '';
  }
  let articles: string[] = [];
  switch (titleLanguageId) {
    case 1:
      articles = ['The', 'A', 'An'];
      break;
    case 3:
      articles = ['Det', 'Den', 'Ett', 'En', 'De', 'Dom'];
      break;
    case 4:
      articles = ['Il', 'O', 'I', 'La', "L'", 'Le'];
      break;
    case 5:
      articles = ['Las', 'Los', 'El', 'La'];
      break;
    case 6:
      articles = ['Les', 'Un', 'Une', 'La', 'Le', "L'"];
      break;
    case 8:
      articles = ['Das', 'Die', 'Der', 'Ein'];
      break;
    case 13:
      articles = ['Den'];
      break;
    case 15:
      articles = ['De'];
      break;
    case 17:
      articles = ['De', 'En', 'Den'];
      break;
    default:
      articles = [];
  }
  for (const value of articles) {
    const suffix = `, ${value}`;
    if (str.endsWith(suffix)) {
      const base = str.slice(0, str.length - suffix.length);
      if (value.endsWith("'")) {
        str = value + (titleLanguageId === 1 ? base : lcfirst(base));
      } else if (titleLanguageId === 1) {
        str = `${value} ${base}`;
      } else {
        str = `${value} ${lcfirst(base)}`;
      }
      return initCapTitle(str, titleLanguageId);
    }
  }
  // PHP: mid-title ", The - " → "The … - …"
  for (const value of articles) {
    const needle = `, ${value} - `;
    const j = str.indexOf(needle);
    if (j > 0) {
      if (value.endsWith("'")) {
        str = value + str.slice(0, j) + str.slice(j + value.length + 2);
      } else {
        str = `${value} ${str.slice(0, j)}${str.slice(j + value.length + 2)}`;
      }
      return initCapTitle(str, titleLanguageId);
    }
  }
  return initCapTitle(str, titleLanguageId);
}

function lcfirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** InitCap-style person/name helper (word starts uppercase). */
export function initCapName(value: string | null | undefined): string {
  const s = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!s) {
    return '';
  }
  return s.replace(/\S+/g, (w) => {
    if (w.includes('-')) {
      return w
        .split('-')
        .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p))
        .join('-');
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}

export function ageRatingLabel(value: number | null | undefined): string {
  if (value == null || value === 0) {
    return '';
  }
  if (value === 254) {
    return 'Sallittu';
  }
  if (value === 255) {
    return 'Kokonaan kielletty';
  }
  return `K${value}`;
}

/** PHP init_cap: language-aware small-word casing (English uses ucwords). */
function initCapTitle(str: string, titleLanguageId: number | null | undefined): string {
  let ret = str;
  let lowerMid: string[] | null = null;
  let recapAfter: string[] | null = null;

  switch (titleLanguageId) {
    case 1: {
      // PHP ucwords: uppercase first letter of each whitespace-separated word; leave the rest.
      ret = str.replace(/(^|\s)(\S)/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
      lowerMid = [
        ' Of ',
        ' The ',
        ' A ',
        ' An ',
        ' In ',
        ' On ',
        ' And ',
        ' At ',
        ' From ',
        ' To ',
        ' Or ',
        ' By ',
        ' For ',
        ' With ',
        ' Vs. ',
      ];
      recapAfter = ['in ', 'on ', 'the ', 'an ', 'a ', 'at ', 'to ', 'with '];
      break;
    }
    case 2:
      lowerMid = [' Ja ', ' Vs. '];
      break;
    case 3:
      lowerMid = [' Och ', ' Vs. '];
      recapAfter = ['den ', 'det ', 'en ', 'ett '];
      break;
    case 4:
      lowerMid = [' La ', ' Le ', " L'", ' E ', ' Delle ', " Dell'", ' O ', ' Vs. '];
      recapAfter = ['la ', 'il ', 'o ', 'las ', 'los '];
      break;
    case 5:
      lowerMid = [' Y ', ' Las ', ' Les ', ' Los ', ' El ', ' Del ', ' Un ', ' Uno ', ' La ', ' Le ', ' Vs. '];
      recapAfter = ['las ', 'les ', 'los ', 'el ', 'la '];
      break;
    case 6:
      lowerMid = [' Un ', ' Une ', ' La ', ' Le ', " L'", ' Vs. '];
      recapAfter = ['un ', 'une ', 'la ', 'le ', "l'"];
      break;
    case 8:
      lowerMid = [' Das ', ' Der ', ' Vs. '];
      recapAfter = ['das ', 'die ', 'der '];
      break;
    default:
      return str;
  }

  if (lowerMid) {
    for (const value of lowerMid) {
      if (ret.includes(value)) {
        ret = ret.replaceAll(value, value.toLowerCase());
      }
    }
  }
  if (recapAfter) {
    for (const value of recapAfter) {
      const capped = value.charAt(0).toUpperCase() + value.slice(1);
      for (const sep of [': ', ' - ', ' / ']) {
        const from = sep + value;
        const to = sep + capped;
        if (ret.includes(from)) {
          ret = ret.replaceAll(from, to);
        }
      }
    }
  }
  return ret;
}

/** PHP get_distribution shorthand in list titles. */
export function distributionPrefix(distributionId: number | null | undefined): string {
  switch (distributionId) {
    case 1:
      return 'TV/';
    case 2:
      return 'V/';
    default:
      return '';
  }
}


/** Title with optional year in parentheses, e.g. "Alien (1979)". */
export function titleWithYear(
  title: string | null | undefined,
  titleLanguageId: number | null | undefined,
  year: number | null | undefined
): string {
  const main = swapTitle(title, titleLanguageId);
  if (!main) {
    return year ? `(${year})` : '';
  }
  return year ? `${main} (${year})` : main;
}

export function formatMovieListTitle(opts: {
  title: string;
  titleLanguageId: number | null;
  year: number | null;
  distributionId: number | null;
  version?: string | null;
  finnishTitle?: string | null;
}): string {
  const main = swapTitle(opts.title, opts.titleLanguageId);
  const dist = distributionPrefix(opts.distributionId);
  const year = opts.year ? String(opts.year) : '';
  const version = opts.version ? ` - ${opts.version}` : '';
  const finnish = opts.finnishTitle?.trim();
  if (finnish && finnish.toLowerCase() !== main.toLowerCase()) {
    const inside = [finnish, `${dist}${year}`.trim()].filter(Boolean).join(', ');
    return `${main}${version}${inside ? ` (${inside})` : ''}`;
  }
  const inside = `${dist}${year}`.trim();
  return `${main}${version}${inside ? ` (${inside})` : ''}`;
}
