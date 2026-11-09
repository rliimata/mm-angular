/** Lowercase + strip accents/apostrophes/punctuation so "Joffé"≈"joffe", "chan-wook"≈"chan wook". */
export function foldSearchText(value: string): string {
  return decodeEntities(value)
    // NFKC folds fullwidth letters; NFKD + mark strip drops û/é → u/e.
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[''`´′’ʻʼ]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchTokens(term: string): string[] {
  return foldSearchText(term)
    .split(/\s+/)
    .map((t) => t.replace(/[%_]/g, ''))
    .filter((t) => t.length > 0);
}

/**
 * Postgres ILIKE probes (use only with `.ilike()`, never inside `.or()` strings).
 * Vowels → `_` so "yugi" → "%y_g_%" matches precomposed "Yûgi".
 */
export function accentInsensitiveNamePatterns(token: string): string[] {
  const folded = foldSearchText(token).replace(/[%_]/g, '');
  const raw = decodeEntities(token)
    .trim()
    .replace(/[%_]/g, '');
  const patterns: string[] = [];
  const add = (p: string) => {
    if (p && p !== '%%' && p !== '%' && !patterns.includes(p)) {
      patterns.push(p);
    }
  };
  if (folded) {
    const flex = [...folded]
      .map((ch) => ('aeiou'.includes(ch) ? '_' : ch))
      .join('');
    if ([...flex].some((c) => c !== '_')) {
      add(`%${flex}%`);
      // "Last, First" storage: match given name after comma (Shokei, Yûgi).
      add(`%, ${flex}%`);
      add(`%,${flex}%`);
    }
    // "yugi" → "%y%g%i%" (Unicode + HTML-entity spellings)
    const consonants = [...folded].filter((c) => !'aeiou'.includes(c));
    const last = folded[folded.length - 1] ?? '';
    if (consonants.length >= 2) {
      const gap = consonants.join('%');
      if (last && !gap.endsWith(last)) {
        add(`%${gap}%${last}%`);
      } else {
        add(`%${gap}%`);
      }
    }
    add(`%${folded}%`);
  }
  if (raw && raw.toLowerCase() !== folded) {
    add(`%${raw}%`);
    add(`%, ${raw}%`);
  }
  return patterns;
}

/**
 * Case-insensitive regex for PostgREST `imatch`: vowels become optional `.?`
 * so "yugi" → ".*y.?g.?i.*" matches both "yugi" and precomposed "Yûgi".
 */
export function accentInsensitiveNameRegex(token: string): string {
  const folded = foldSearchText(token).replace(/[^a-z0-9]/g, '');
  if (!folded) {
    return '';
  }
  const body = [...folded]
    .map((ch) => ('aeiou'.includes(ch) ? '.?' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return `.*${body}.*`;
}

/** True when every query token is a prefix of some folded word in the name. */
export function nameMatchesSearchTokens(
  name: string | null | undefined,
  tokens: string[]
): boolean {
  if (!name || !tokens.length) {
    return false;
  }
  const parts = foldSearchText(name).split(/\s+/).filter(Boolean);
  return tokens.every((token) => {
    const needle = foldSearchText(token);
    return needle.length > 0 && parts.some((p) => p.startsWith(needle));
  });
}

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
    '&ucirc;': 'û',
    '&Ucirc;': 'Û',
    '&ocirc;': 'ô',
    '&Ocirc;': 'Ô',
    '&acirc;': 'â',
    '&icirc;': 'î',
    '&ecirc;': 'ê',
    '&agrave;': 'à',
    '&egrave;': 'è',
    '&igrave;': 'ì',
    '&ograve;': 'ò',
    '&ugrave;': 'ù',
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
  // Drop remaining stray backslashes (incl. trailing \ after <br />\n in reviews).
  // Keep real escape sequences only when followed by another backslash.
  s = s.replace(/\\(?!\\)/g, '');
  return s;
}

/** Person filmography: Role catalog plurals/collectives → singular job title. */
export function roleSingularLabel(value: string | number | null | undefined): string {
  const raw = decodeEntities(String(value ?? '')).trim();
  if (!raw) {
    return '';
  }
  const key = raw.toLowerCase();
  const map: Record<string, string> = {
    ohjaus: 'Ohjaaja',
    näyttelijät: 'Näyttelijä',
    'n&auml;yttelij&auml;t': 'Näyttelijä',
    käsikirjoitus: 'Käsikirjoittaja',
    'k&auml;sikirjoitus': 'Käsikirjoittaja',
    musiikki: 'Säveltäjä',
  };
  return map[key] ?? raw;
}

/** True for placeholder catalog rows ("-", "(uusi)", empty). */
export function isPlaceholderLookup(value: string | number | null | undefined): boolean {
  if (value == null) {
    return true;
  }
  const s = String(value).trim().toLowerCase();
  // Do not treat plain "Uusi" as placeholder — ReleaseCondition/MediaCondition use it.
  return !s || s === '-' || s === '(uusi)';
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

/** Leading/trailing articles by TitleLanguageId (same sets as PHP swap_title). */
export function titleArticles(titleLanguageId: number | null | undefined): string[] {
  switch (titleLanguageId) {
    case 1:
      return ['The', 'A', 'An'];
    case 3:
      return ['Det', 'Den', 'Ett', 'En', 'De', 'Dom'];
    case 4:
      return ['Il', 'O', 'I', 'La', "L'", 'Le'];
    case 5:
      return ['Las', 'Los', 'El', 'La'];
    case 6:
      return ['Les', 'Un', 'Une', 'La', 'Le', "L'"];
    case 8:
      return ['Das', 'Die', 'Der', 'Ein'];
    case 13:
      return ['Den'];
    case 15:
      return ['De'];
    case 17:
      return ['De', 'En', 'Den'];
    default:
      return [];
  }
}

/**
 * Alphabetical sort key: "The Matrix" / "Matrix, The" → "matrix, the"
 * so leading articles do not dominate A–Z order.
 */
export function titleSortKey(
  title: string | null | undefined,
  titleLanguageId?: number | null
): string {
  let s = decodeEntities(title).trim();
  if (!s) {
    return '';
  }
  const lang = titleLanguageId != null && titleLanguageId > 0 ? titleLanguageId : 1;
  const articles = titleArticles(lang);
  // Prefer display form first, then move leading article to the end for sorting.
  s = swapTitle(s, lang);
  for (const value of articles) {
    if (value.endsWith("'")) {
      if (s.toLocaleLowerCase('fi').startsWith(value.toLocaleLowerCase('fi'))) {
        s = `${s.slice(value.length)}, ${value}`;
        break;
      }
    } else {
      const prefix = `${value} `;
      if (s.toLocaleLowerCase('fi').startsWith(prefix.toLocaleLowerCase('fi'))) {
        s = `${s.slice(prefix.length)}, ${value}`;
        break;
      }
    }
  }
  return s.toLocaleLowerCase('fi');
}

/** PHP swap_title: move leading article from trailing ", The" form. */
export function swapTitle(title: string | null | undefined, titleLanguageId: number | null | undefined): string {
  let str = decodeEntities(title);
  if (!str) {
    return '';
  }
  const articles = titleArticles(titleLanguageId);
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

/** Official age-rating badge image under /system, or null when none matches. */
export function ageRatingImageSrc(value: number | string | null | undefined): string | null {
  if (value == null || value === '') {
    return null;
  }
  const age = Number(value);
  if (!Number.isFinite(age) || age === 0) {
    return null;
  }
  const fileByAge: Record<number, string> = {
    7: '7.png',
    12: '12.png',
    16: '16.png',
    18: '18.png',
    254: 'S.png',
  };
  const file = fileByAge[age];
  return file ? `/system/${file}` : null;
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


/** Title with optional year in parentheses, e.g. "Alien (1979)" or "Alien (TV/2014)". */
export function titleWithYear(
  title: string | null | undefined,
  titleLanguageId: number | null | undefined,
  year: number | null | undefined,
  distributionId?: number | null
): string {
  const main = swapTitle(title, titleLanguageId);
  const yearPart = year ? `${distributionPrefix(distributionId)}${year}` : '';
  if (!main) {
    return yearPart ? `(${yearPart})` : '';
  }
  return yearPart ? `${main} (${yearPart})` : main;
}

/** Display label for a movie version, e.g. "Director's Cut-versio". */
export function versionDisplayLabel(version: string | null | undefined): string {
  const v = version?.trim() ?? '';
  if (!v || v === '-') {
    return '';
  }
  if (/versio$/i.test(v)) {
    return v;
  }
  return `${v}-versio`;
}

export type MovieListTitleParts = {
  main: string;
  version: string;
  paren: string;
};

/** Split list title so the version can be styled brown (PHP `.version`). */
export function formatMovieListTitleParts(opts: {
  title: string;
  titleLanguageId: number | null;
  year: number | null;
  distributionId: number | null;
  version?: string | null;
  finnishTitle?: string | null;
}): MovieListTitleParts {
  const main = swapTitle(opts.title, opts.titleLanguageId);
  const dist = distributionPrefix(opts.distributionId);
  const year = opts.year ? String(opts.year) : '';
  const version = opts.version?.trim() && opts.version !== '-' ? opts.version.trim() : '';
  const finnish = opts.finnishTitle?.trim();
  let paren = '';
  if (finnish && finnish.toLowerCase() !== main.toLowerCase()) {
    paren = [finnish, `${dist}${year}`.trim()].filter(Boolean).join(', ');
  } else {
    paren = `${dist}${year}`.trim();
  }
  return { main, version, paren };
}

export function formatMovieListTitle(opts: {
  title: string;
  titleLanguageId: number | null;
  year: number | null;
  distributionId: number | null;
  version?: string | null;
  finnishTitle?: string | null;
}): string {
  const { main, version, paren } = formatMovieListTitleParts(opts);
  const ver = version ? ` - ${version}` : '';
  return `${main}${ver}${paren ? ` (${paren})` : ''}`;
}
