import { Injectable } from '@angular/core';
import { AppDateTime, Person } from '../core/models';
import { parseAppDateTime } from '../core/datetime.util';
import {
  accentInsensitiveNamePatterns,
  decodeEntities,
  nameMatchesSearchTokens,
  roleSingularLabel,
  searchTokens,
  swapTitle,
} from '../core/format.util';
import { reverseRelationLabel, reverseRelationSortId } from '../core/person-relation.util';
import { getSupabase } from '../core/supabase.client';

export interface PersonSearchResult {
  rows: Person[];
  count: number;
}

export interface PersonDetails {
  person: Person;
  text: string | null;
  trivia: string[];
  birthCountry: string;
  deathCountry: string;
  deathReason: string;
  relations: { PersonId: number; Name: string; Relation: string; RelationId: number; SortId: number; Incoming: boolean }[];
  awards: { MovieId: number; MovieTitle: string; Year: number | null; Award: string }[];
  salaries: {
    MovieId: number;
    MovieTitle: string;
    Year: number | null;
    Salary: number;
    CurrencyId: number;
    Currency: string;
  }[];
  filmography: { MovieId: number; Title: string; Year: number | null; Roles: string[] }[];
}

@Injectable({ providedIn: 'root' })
export class PersonService {
  async countAll(): Promise<number> {
    const { count, error } = await getSupabase()
      .from('Person')
      .select('Id', { count: 'exact', head: true });
    if (error) {
      throw error;
    }
    return count ?? 0;
  }

  async search(query: string, page: number, pageSize: number): Promise<PersonSearchResult> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const term = query.trim();
    if (!term) {
      const { data, error, count } = await getSupabase()
        .from('Person')
        .select('Id, Name, RealName, BirthDate, DeathDate, Gender', { count: 'exact' })
        .order('Name', { ascending: true })
        .range(from, to);
      if (error) {
        throw error;
      }
      return { rows: (data as Person[]) ?? [], count: count ?? 0 };
    }

    const tokens = searchTokens(term);
    if (!tokens.length) {
      return { rows: [], count: 0 };
    }

    // Home search: Name only. DB probes are accent-blind; fold filter is authoritative.
    const nameHits = await this.fetchPersonsByNameTokens(
      tokens,
      'Id, Name, RealName, BirthDate, DeathDate, Gender',
      500
    );
    const rows = nameHits
      .filter((p) => nameMatchesSearchTokens(p.Name, tokens))
      .sort((a, b) => a.Name.localeCompare(b.Name, 'fi', { sensitivity: 'base' }));
    return { rows: rows.slice(from, to + 1), count: rows.length };
  }

  /**
   * Name search: each query token must be a prefix of some word in Name
   * ("baldw" → Baldwin; "man" does not match Hoffman). RealName ignored.
   * Accents optional: "yugi" finds "Yûgi", "joffe" finds "Joffé".
   */
  async searchNameExact(query: string, limit = 30): Promise<Person[]> {
    const tokens = searchTokens(query);
    if (!tokens.length) {
      return [];
    }
    const rows = await this.fetchPersonsByNameTokens(
      tokens,
      'Id, Name, RealName, BirthDate, DeathDate, Gender, BirthCountryId',
      Math.max(200, limit * 10)
    );
    return rows.filter((p) => nameMatchesSearchTokens(p.Name, tokens)).slice(0, limit);
  }

  /**
   * Fetch Name candidates with accent-blind ILIKE probes, then rely on
   * nameMatchesSearchTokens for precise AND across all tokens.
   *
   * IMPORTANT: never put patterns like `%y%g%` into `.or("Name.ilike.%y%g%")`.
   * PostgREST splits or()-values on `.`, so those probes break silently and
   * "yugi" never matches "Yûgi". Always use `.ilike('Name', pattern)` per probe.
   */
  private async fetchPersonsByNameTokens(
    tokens: string[],
    select: string,
    limit: number
  ): Promise<Person[]> {
    // One selective token for DB; client AND-filters all tokens afterward.
    const primary = [...tokens].sort((a, b) => {
      const fa = a.replace(/[^a-z0-9]/gi, '');
      const fb = b.replace(/[^a-z0-9]/gi, '');
      const ca = [...fa.toLowerCase()].filter((c) => !'aeiou'.includes(c)).length;
      const cb = [...fb.toLowerCase()].filter((c) => !'aeiou'.includes(c)).length;
      return cb - ca || fb.length - fa.length;
    })[0];
    const patterns = accentInsensitiveNamePatterns(primary);
    if (!patterns.length) {
      return [];
    }

    const settled = await Promise.all(
      patterns.map(async (pattern) => {
        const { data, error } = await getSupabase()
          .from('Person')
          .select(select)
          .ilike('Name', pattern)
          .order('Name')
          .limit(limit);
        if (error) {
          throw error;
        }
        return (data as unknown as Person[]) ?? [];
      })
    );

    const byId = new Map<number, Person>();
    for (const rows of settled) {
      for (const row of rows) {
        if (row?.Id != null && row.Name && !byId.has(row.Id)) {
          byId.set(row.Id, row);
        }
      }
    }
    return [...byId.values()];
  }

  async getById(id: number): Promise<Person | null> {
    const { data, error } = await getSupabase().from('Person').select('*').eq('Id', id).maybeSingle();
    if (error) {
      throw error;
    }
    return data as Person | null;
  }

  /** People whose birth month+day match today (year may be present). */
  async listBirthdaysToday(): Promise<Person[]> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    // BirthDate is a composite type — LIKE fails; filter client-side after parse.
    const { data, error } = await getSupabase()
      .from('Person')
      .select('Id, Name, RealName, BirthDate, DeathDate, Gender, BirthCountryId')
      .not('BirthDate', 'is', null);
    if (error) {
      throw error;
    }
    return ((data as Person[]) ?? [])
      .filter((p) => {
        const d = parseAppDateTime(p.BirthDate);
        return !!d && d.month === month && d.day === day;
      })
      .map((p) => ({ ...p, Name: typeof p.Name === 'string' ? p.Name : String(p.Name ?? '') }))
      .sort((a, b) => a.Name.localeCompare(b.Name, 'fi', { sensitivity: 'base' }));
  }

  async getDetails(id: number): Promise<PersonDetails | null> {
    const person = await this.getById(id);
    if (!person) {
      return null;
    }

    const [
      textRes,
      triviaRes,
      countries,
      reasons,
      outLinks,
      inLinks,
      relations,
      awardLinks,
      awards,
      salaryLinks,
      currencies,
      filmography,
    ] = await Promise.all([
      getSupabase().from('PersonText').select('Text').eq('PersonId', id).maybeSingle(),
      getSupabase().from('PersonTrivia').select('Text').eq('PersonId', id),
      getSupabase().from('Country').select('Id, Value'),
      getSupabase().from('DeathReason').select('Id, Value'),
      getSupabase().from('PersonLink').select('DestinationId, RelationId').eq('SourceId', id),
      getSupabase().from('PersonLink').select('SourceId, RelationId').eq('DestinationId', id),
      getSupabase().from('PersonRelation').select('Id, Value'),
      getSupabase().from('AwardLink').select('MovieId, AwardId').eq('PersonId', id),
      getSupabase().from('Award').select('Id, Value'),
      getSupabase().from('SalaryLink').select('MovieId, Year, Salary, CurrencyId').eq('PersonId', id),
      getSupabase().from('Currency').select('Id, Value'),
      this.getFilmography(id),
    ]);

    const countryMap = new Map(((countries.data as { Id: number; Value: string }[]) ?? []).map((c) => [c.Id, c.Value]));
    const reasonMap = new Map(((reasons.data as { Id: number; Value: string }[]) ?? []).map((c) => [c.Id, c.Value]));
    const relMap = new Map(((relations.data as { Id: number; Value: string }[]) ?? []).map((c) => [c.Id, c.Value]));
    const awardMap = new Map(((awards.data as { Id: number; Value: string }[]) ?? []).map((c) => [c.Id, c.Value]));
    const curMap = new Map(((currencies.data as { Id: number; Value: string }[]) ?? []).map((c) => [c.Id, c.Value]));

    const out = (outLinks.data as { DestinationId: number; RelationId: number }[]) ?? [];
    const inn = (inLinks.data as { SourceId: number; RelationId: number }[]) ?? [];
    const relatedIds = [
      ...new Set([...out.map((r) => r.DestinationId), ...inn.map((r) => r.SourceId)]),
    ];
    let personMap = new Map<number, { Name: string; Gender: number }>();
    if (relatedIds.length) {
      const { data: people } = await getSupabase()
        .from('Person')
        .select('Id, Name, Gender')
        .in('Id', relatedIds);
      personMap = new Map(
        ((people as { Id: number; Name: string; Gender: number }[]) ?? []).map((p) => [
          p.Id,
          { Name: p.Name, Gender: p.Gender ?? 0 },
        ])
      );
    }

    const relationList = [
      ...out.map((r) => ({
        PersonId: r.DestinationId,
        Name: personMap.get(r.DestinationId)?.Name ?? `#${r.DestinationId}`,
        Relation: relMap.get(r.RelationId) ?? String(r.RelationId),
        RelationId: r.RelationId,
        SortId: r.RelationId,
        Incoming: false,
      })),
      ...inn.map((r) => {
        const src = personMap.get(r.SourceId);
        const gender = src?.Gender ?? 0;
        const reverse = reverseRelationLabel(r.RelationId, gender);
        return {
          PersonId: r.SourceId,
          Name: src?.Name ?? `#${r.SourceId}`,
          Relation: reverse || relMap.get(r.RelationId) || String(r.RelationId),
          RelationId: r.RelationId,
          SortId: reverseRelationSortId(r.RelationId, gender),
          Incoming: true,
        };
      }),
    ].sort(
      (a, b) => a.SortId - b.SortId || a.Name.localeCompare(b.Name, 'fi', { sensitivity: 'base' })
    );

    const aRows = (awardLinks.data as { MovieId: number; AwardId: number }[]) ?? [];
    let awardList: PersonDetails['awards'] = [];
    if (aRows.length) {
      const { data: movies } = await getSupabase()
        .from('Movie')
        .select('Id, Title, Year, TitleLanguageId')
        .in(
          'Id',
          aRows.map((a) => a.MovieId)
        );
      const movieMap = new Map(
        (
          (movies as { Id: number; Title: string; Year: number | null; TitleLanguageId: number | null }[]) ??
          []
        ).map((m) => [m.Id, m])
      );
      awardList = aRows.map((a) => {
        const m = movieMap.get(a.MovieId);
        return {
          MovieId: a.MovieId,
          MovieTitle: m ? swapTitle(m.Title, m.TitleLanguageId) : `#${a.MovieId}`,
          Year: m?.Year ?? null,
          Award: awardMap.get(a.AwardId) ?? String(a.AwardId),
        };
      });
    }

    const sRows = (salaryLinks.data as { MovieId: number; Year: number | null; Salary: number; CurrencyId: number }[]) ?? [];
    let salaryList: PersonDetails['salaries'] = [];
    if (sRows.length) {
      const { data: movies } = await getSupabase()
        .from('Movie')
        .select('Id, Title, Year, TitleLanguageId')
        .in(
          'Id',
          sRows.map((s) => s.MovieId)
        );
      const movieMap = new Map(
        (
          (movies as { Id: number; Title: string; Year: number | null; TitleLanguageId: number | null }[]) ??
          []
        ).map((m) => [m.Id, m])
      );
      salaryList = sRows.map((s) => {
        const m = movieMap.get(s.MovieId);
        return {
          MovieId: s.MovieId,
          MovieTitle: m ? swapTitle(m.Title, m.TitleLanguageId) : `#${s.MovieId}`,
          Year: s.Year ?? m?.Year ?? null,
          Salary: s.Salary,
          CurrencyId: s.CurrencyId,
          Currency: curMap.get(s.CurrencyId) ?? '',
        };
      });
    }

    const label = (map: Map<number, string>, id: number | null | undefined) => {
      if (id == null || id === 0) return '';
      const v = map.get(id);
      return !v || v === '-' ? '' : v;
    };

    return {
      person,
      text: decodeEntities((textRes.data as { Text: string } | null)?.Text ?? null) || null,
      trivia: ((triviaRes.data as { Text: string }[]) ?? [])
        .map((t) => decodeEntities(t.Text))
        .filter(Boolean),
      birthCountry: label(countryMap, person.BirthCountryId),
      deathCountry: label(countryMap, person.DeathCountryId),
      deathReason: label(reasonMap, person.DeathReasonId),
      relations: relationList,
      awards: awardList,
      salaries: salaryList,
      filmography,
    };
  }

  async getFilmography(personId: number): Promise<
    { MovieId: number; Title: string; Year: number | null; Roles: string[] }[]
  > {
    const { data: links, error } = await getSupabase()
      .from('RoleLink')
      .select('MovieId, RoleId, Sequence')
      .eq('PersonId', personId)
      .order('MovieId');
    if (error) {
      throw error;
    }
    const rows = (links as { MovieId: number; RoleId: number; Sequence: number }[]) ?? [];
    if (!rows.length) {
      return [];
    }

    const movieIds = [...new Set(rows.map((r) => r.MovieId))];
    const roleIds = [...new Set(rows.map((r) => r.RoleId))];

    const [{ data: movies }, { data: roles }] = await Promise.all([
      getSupabase().from('Movie').select('Id, Title, Year, TitleLanguageId, VersionId').in('Id', movieIds),
      getSupabase().from('Role').select('Id, Value').in('Id', roleIds),
    ]);

    const movieMap = new Map(
      (
        (movies as {
          Id: number;
          Title: string;
          Year: number | null;
          TitleLanguageId: number | null;
          VersionId: number | null;
        }[]) ?? []
      )
        .filter((m) => m.VersionId == null || m.VersionId === 0)
        .map((m) => [m.Id, m])
    );
    const roleMap = new Map(((roles as { Id: number; Value: string }[]) ?? []).map((r) => [r.Id, r.Value]));

    type Agg = {
      MovieId: number;
      Title: string;
      Year: number | null;
      roles: { id: number; name: string }[];
    };
    const byMovie = new Map<number, Agg>();
    for (const r of rows) {
      const m = movieMap.get(r.MovieId);
      if (!m) {
        continue;
      }
      let entry = byMovie.get(r.MovieId);
      if (!entry) {
        entry = {
          MovieId: r.MovieId,
          Title: swapTitle(m.Title, m.TitleLanguageId),
          Year: m.Year ?? null,
          roles: [],
        };
        byMovie.set(r.MovieId, entry);
      }
      if (!entry.roles.some((x) => x.id === r.RoleId)) {
        entry.roles.push({ id: r.RoleId, name: roleMap.get(r.RoleId) ?? String(r.RoleId) });
      }
    }

    return [...byMovie.values()]
      .map((e) => ({
        MovieId: e.MovieId,
        Title: e.Title,
        Year: e.Year,
        Roles: e.roles
          .sort((a, b) => a.id - b.id)
          .map((x) => roleSingularLabel(x.name)),
      }))
      .sort((a, b) => (b.Year ?? 0) - (a.Year ?? 0) || a.Title.localeCompare(b.Title, 'fi'));
  }

  toComposite(parts: { year: number; month: number; day: number } | null): string | null {
    if (!parts || (!parts.year && !parts.month && !parts.day)) {
      return null;
    }
    return `(${parts.year},${parts.month},${parts.day},0,0,0,0)`;
  }

  fromComposite(value: Person['BirthDate']): { year: number; month: number; day: number } {
    const d = parseAppDateTime(value as AppDateTime | string | null);
    return { year: d?.year ?? 0, month: d?.month ?? 0, day: d?.day ?? 0 };
  }

  async savePerson(
    person: Partial<Person> & { Name: string },
    text: string | null,
    extras?: {
      trivia?: string[];
      links?: { personId: number; relationId: number }[];
      salaries?: { movieId: number; salary: number; currencyId: number }[];
    }
  ): Promise<number> {
    if (person.Id) {
      const { Id, ...rest } = person;
      const { error } = await getSupabase().from('Person').update(rest).eq('Id', Id);
      if (error) {
        throw error;
      }
      await this.replaceText(Id, text);
      if (extras?.trivia) {
        await this.replaceTrivia(Id, extras.trivia);
      }
      if (extras?.links) {
        await this.replaceLinks(Id, extras.links);
      }
      if (extras?.salaries) {
        await this.replaceSalaries(Id, extras.salaries);
      }
      return Id;
    }
    const { data, error } = await getSupabase().from('Person').insert(person).select('Id').single();
    if (error) {
      throw error;
    }
    const id = (data as { Id: number }).Id;
    await this.replaceText(id, text);
    if (extras?.trivia) {
      await this.replaceTrivia(id, extras.trivia);
    }
    if (extras?.links) {
      await this.replaceLinks(id, extras.links);
    }
    if (extras?.salaries) {
      await this.replaceSalaries(id, extras.salaries);
    }
    return id;
  }

  private async replaceText(personId: number, text: string | null): Promise<void> {
    await getSupabase().from('PersonText').delete().eq('PersonId', personId);
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      return;
    }
    const html = trimmed.replace(/\n/g, '<br />\n');
    const { error } = await getSupabase().from('PersonText').insert({ PersonId: personId, Text: html });
    if (error) {
      throw error;
    }
  }

  private async replaceTrivia(personId: number, items: string[]): Promise<void> {
    await getSupabase().from('PersonTrivia').delete().eq('PersonId', personId);
    const rows = items
      .map((t) => t.trim())
      .filter(Boolean)
      .map((Text) => ({ PersonId: personId, Text: Text.replace(/\n/g, '<br />\n') }));
    if (!rows.length) {
      return;
    }
    const { error } = await getSupabase().from('PersonTrivia').insert(rows);
    if (error) {
      throw error;
    }
  }

  private async replaceLinks(
    personId: number,
    links: { personId: number; relationId: number }[]
  ): Promise<void> {
    await getSupabase().from('PersonLink').delete().eq('SourceId', personId);
    const rows = links
      .filter((l) => l.personId > 0 && l.relationId > 0 && l.personId !== personId)
      .map((l) => ({
        SourceId: personId,
        DestinationId: l.personId,
        RelationId: l.relationId,
      }));
    if (!rows.length) {
      return;
    }
    const { error } = await getSupabase().from('PersonLink').insert(rows);
    if (error) {
      throw error;
    }
  }

  private async replaceSalaries(
    personId: number,
    salaries: { movieId: number; salary: number; currencyId: number }[]
  ): Promise<void> {
    await getSupabase().from('SalaryLink').delete().eq('PersonId', personId);
    const rows = salaries
      .filter((s) => s.movieId > 0 && s.salary > 0 && s.currencyId > 0)
      .map((s) => ({
        PersonId: personId,
        MovieId: s.movieId,
        Salary: s.salary,
        CurrencyId: s.currencyId,
        Year: null as number | null,
      }));
    if (!rows.length) {
      return;
    }
    const { error } = await getSupabase().from('SalaryLink').insert(rows);
    if (error) {
      throw error;
    }
  }

  async deletePerson(id: number): Promise<void> {
    for (const [table, col] of [
      ['PersonText', 'PersonId'],
      ['PersonTrivia', 'PersonId'],
      ['PersonLink', 'SourceId'],
      ['AwardLink', 'PersonId'],
      ['SalaryLink', 'PersonId'],
      ['RoleLink', 'PersonId'],
    ] as const) {
      await getSupabase().from(table).delete().eq(col, id);
    }
    await getSupabase().from('PersonLink').delete().eq('DestinationId', id);
    const { error } = await getSupabase().from('Person').delete().eq('Id', id);
    if (error) {
      throw error;
    }
  }
}

