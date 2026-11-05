import { Injectable } from '@angular/core';
import { AppDateTime, Person } from '../core/models';
import { parseAppDateTime } from '../core/datetime.util';
import { decodeEntities, swapTitle } from '../core/format.util';
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
  salaries: { MovieId: number; MovieTitle: string; Year: number | null; Salary: number; Currency: string }[];
  filmography: { MovieId: number; Title: string; Year: number | null; Role: string }[];
}

@Injectable({ providedIn: 'root' })
export class PersonService {
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

    const tokens = term
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/^[,.]+|[,.]+$/g, ''))
      .filter((t) => t.length > 0);
    const primary = (tokens[0] ?? '').replace(/[%_,]/g, '');
    if (!primary) {
      return { rows: [], count: 0 };
    }

    const [{ data: nameHits }, { data: textHits }, { data: triviaHits }] = await Promise.all([
      getSupabase()
        .from('Person')
        .select('Id, Name, RealName, BirthDate, DeathDate, Gender')
        .or(`Name.ilike.%${primary}%,RealName.ilike.%${primary}%`)
        .order('Name')
        .limit(500),
      getSupabase().from('PersonText').select('PersonId').ilike('Text', `%${term}%`).limit(200),
      getSupabase().from('PersonTrivia').select('PersonId').ilike('Text', `%${term}%`).limit(200),
    ]);

    const nameMatched = ((nameHits as Person[]) ?? []).filter((p) =>
      tokens.every(
        (t) => nameHasTokenPrefix(p.Name, t) || nameHasTokenPrefix(p.RealName, t)
      )
    );
    const extraIds = [
      ...new Set([
        ...(((textHits as { PersonId: number }[]) ?? []).map((r) => r.PersonId)),
        ...(((triviaHits as { PersonId: number }[]) ?? []).map((r) => r.PersonId)),
      ]),
    ].filter((id) => !nameMatched.some((p) => p.Id === id));

    let extraPeople: Person[] = [];
    if (extraIds.length) {
      const { data, error } = await getSupabase()
        .from('Person')
        .select('Id, Name, RealName, BirthDate, DeathDate, Gender')
        .in('Id', extraIds);
      if (error) {
        throw error;
      }
      extraPeople = (data as Person[]) ?? [];
    }

    const rows = [...nameMatched, ...extraPeople].sort((a, b) =>
      a.Name.localeCompare(b.Name, 'fi', { sensitivity: 'base' })
    );
    return { rows: rows.slice(from, to + 1), count: rows.length };
  }

  /**
   * Name search: each query token must be a prefix of some word in Name
   * ("baldw" → Baldwin; "man" does not match Hoffman). RealName ignored.
   */
  async searchNameExact(query: string, limit = 30): Promise<Person[]> {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/^[,.]+|[,.]+$/g, ''))
      .filter((t) => t.length > 0);
    if (!tokens.length) {
      return [];
    }
    const primary = tokens[0].replace(/[%_,]/g, '');
    if (!primary) {
      return [];
    }
    const { data, error } = await getSupabase()
      .from('Person')
      .select('Id, Name, RealName, BirthDate, DeathDate, Gender, BirthCountryId')
      .ilike('Name', `%${primary}%`)
      .order('Name')
      .limit(200);
    if (error) {
      throw error;
    }
    return ((data as Person[]) ?? [])
      .filter((p) => tokens.every((t) => nameHasTokenPrefix(p.Name, t)))
      .slice(0, limit);
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
    { MovieId: number; Title: string; Year: number | null; Role: string }[]
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
        Role: e.roles
          .sort((a, b) => a.id - b.id)
          .map((x) => x.name)
          .join(', '),
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

function nameHasTokenPrefix(name: string | null | undefined, token: string): boolean {
  if (!name) {
    return false;
  }
  const needle = token.toLowerCase();
  const parts = name
    .toLowerCase()
    .split(/[^a-z0-9àáâäåæçèéêëìíîïñòóôöøùúûüýÿß]+/i)
    .filter(Boolean);
  return parts.some((p) => p.startsWith(needle));
}
