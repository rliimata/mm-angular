import { Injectable } from '@angular/core';
import { decodeEntities, swapTitle } from '../core/format.util';
import { Movie, LookupRow } from '../core/models';
import { getSupabase } from '../core/supabase.client';
import { mediaFormatShort } from './ownership.service';

export type MovieSearchMode = 'text' | 'recent' | 'topRated' | 'rated' | 'owned' | 'watchlist';

export interface MovieListItem extends Movie {
  FinnishTitle?: string | null;
  VersionLabel?: string | null;
  FormatLabels?: string[];
  AvgScore?: number | null;
  MyScoreId?: number | null;
}

export interface MovieSearchResult {
  rows: MovieListItem[];
  count: number;
}

export interface MovieDetails {
  movie: Movie;
  text: string | null;
  trivia: string[];
  categories: string[];
  countries: string[];
  sounds: string[];
  aka: { Title: string; Language: string }[];
  roles: { PersonId: number; RoleId: number; Sequence: number; Name: string; Role: string }[];
  awards: { Award: string; PersonId: number | null; PersonName: string | null }[];
  related: { MovieId: number; Title: string; Year: number | null; Relation: string }[];
  version: string;
  ratio: string;
  distribution: string;
  language: string;
  currency: string;
}

@Injectable({ providedIn: 'root' })
export class MovieService {
  async search(opts: {
    query: string;
    mode: MovieSearchMode;
    userId?: number | null;
    categoryId?: number | null;
    countryId?: number | null;
    soundId?: number | null;
    page: number;
    pageSize: number;
  }): Promise<MovieSearchResult> {
    const { query, mode, userId, categoryId, countryId, soundId, page, pageSize } = opts;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (mode === 'rated' || mode === 'owned' || mode === 'watchlist') {
      if (!userId) {
        return { rows: [], count: 0 };
      }

      if (mode === 'rated') {
        const { data: links, error, count } = await getSupabase()
          .from('UserLink')
          .select('MovieId, ScoreId', { count: 'exact' })
          .eq('UserId', userId)
          .gt('ScoreId', 0);
        if (error) {
          throw error;
        }
        const linkRows = (links as { MovieId: number; ScoreId: number | null }[]) ?? [];
        if (!linkRows.length) {
          return { rows: [], count: 0 };
        }
        const { data: movies, error: mErr } = await getSupabase()
          .from('Movie')
          .select('Id, Title, Year, DistributionId, TitleLanguageId, VersionId')
          .in(
            'Id',
            linkRows.map((r) => r.MovieId)
          );
        if (mErr) {
          throw mErr;
        }
        const linkMap = new Map(linkRows.map((r) => [r.MovieId, r]));
        const rows: MovieListItem[] = ((movies as Movie[]) ?? [])
          .map((m) => ({ ...m, MyScoreId: linkMap.get(m.Id)?.ScoreId ?? null }))
          .sort((a, b) => a.Title.localeCompare(b.Title) || (a.Year ?? 0) - (b.Year ?? 0));
        const pageRows = await this.enrichListItems(rows.slice(from, to + 1));
        return { rows: pageRows, count: count ?? rows.length };
      }

      if (mode === 'watchlist') {
        const { data: links, error, count } = await getSupabase()
          .from('Watchlist')
          .select('MovieId', { count: 'exact' })
          .eq('UserId', userId);
        if (error) {
          throw error;
        }
        const movieIds = ((links as { MovieId: number }[]) ?? []).map((r) => r.MovieId);
        if (!movieIds.length) {
          return { rows: [], count: 0 };
        }
        const { data: movies, error: mErr } = await getSupabase()
          .from('Movie')
          .select('Id, Title, Year, DistributionId, TitleLanguageId, VersionId')
          .in('Id', movieIds);
        if (mErr) {
          throw mErr;
        }
        const rows: MovieListItem[] = ((movies as Movie[]) ?? []).sort(
          (a, b) => a.Title.localeCompare(b.Title) || (a.Year ?? 0) - (b.Year ?? 0)
        );
        const pageRows = await this.enrichListItems(rows.slice(from, to + 1));
        return { rows: pageRows, count: count ?? rows.length };
      }

      // owned via Ownership → OwnershipMovie (+ formats)
      const { data: ownerships, error: oErr } = await getSupabase()
        .from('Ownership')
        .select('Id')
        .eq('UserId', userId);
      if (oErr) {
        throw oErr;
      }
      const ownershipIds = ((ownerships as { Id: number }[]) ?? []).map((o) => o.Id);
      if (!ownershipIds.length) {
        return { rows: [], count: 0 };
      }
      const { data: omRows, error: omErr } = await getSupabase()
        .from('OwnershipMovie')
        .select('Id, MovieId')
        .in('OwnershipId', ownershipIds);
      if (omErr) {
        throw omErr;
      }
      const ownershipMovies = (omRows as { Id: number; MovieId: number }[]) ?? [];
      if (!ownershipMovies.length) {
        return { rows: [], count: 0 };
      }
      const omIds = ownershipMovies.map((r) => r.Id);
      const { data: formats } = await getSupabase()
        .from('OwnershipFormat')
        .select('OwnershipMovieId, MediaFormatId')
        .in('OwnershipMovieId', omIds);
      const formatsByOm = new Map<number, number[]>();
      for (const f of (formats as { OwnershipMovieId: number; MediaFormatId: number }[]) ?? []) {
        const list = formatsByOm.get(f.OwnershipMovieId) ?? [];
        list.push(f.MediaFormatId);
        formatsByOm.set(f.OwnershipMovieId, list);
      }
      const formatsByMovie = new Map<number, Set<number>>();
      for (const om of ownershipMovies) {
        const set = formatsByMovie.get(om.MovieId) ?? new Set<number>();
        for (const fid of formatsByOm.get(om.Id) ?? []) {
          set.add(fid);
        }
        formatsByMovie.set(om.MovieId, set);
      }
      const movieIds = [...formatsByMovie.keys()];
      const { data: movies, error: mErr } = await getSupabase()
        .from('Movie')
        .select('Id, Title, Year, DistributionId, TitleLanguageId, VersionId')
        .in('Id', movieIds);
      if (mErr) {
        throw mErr;
      }
      const rows: MovieListItem[] = ((movies as Movie[]) ?? [])
        .map((m) => ({
          ...m,
          FormatLabels: [...(formatsByMovie.get(m.Id) ?? [])]
            .map((id) => mediaFormatShort(id))
            .filter(Boolean),
        }))
        .sort((a, b) => a.Title.localeCompare(b.Title) || (a.Year ?? 0) - (b.Year ?? 0));
      const pageRows = await this.enrichListItems(rows.slice(from, to + 1));
      return { rows: pageRows, count: movieIds.length };
    }

    if (mode === 'topRated') {
      const { data: scores, error: sErr } = await getSupabase().from('Score').select('Id, Value');
      if (sErr) {
        throw sErr;
      }
      const scoreMap = new Map(((scores as LookupRow[]) ?? []).map((s) => [s.Id, Number(s.Value)]));
      const sum = new Map<number, { total: number; n: number }>();
      const pageSizeFetch = 1000;
      for (let offset = 0; ; offset += pageSizeFetch) {
        const { data: links, error } = await getSupabase()
          .from('UserLink')
          .select('MovieId, ScoreId')
          .gt('ScoreId', 0)
          .range(offset, offset + pageSizeFetch - 1);
        if (error) {
          throw error;
        }
        const batch = (links as { MovieId: number; ScoreId: number }[]) ?? [];
        for (const row of batch) {
          const val = scoreMap.get(row.ScoreId);
          if (val == null || !Number.isFinite(val) || val <= 0) {
            continue;
          }
          const cur = sum.get(row.MovieId) ?? { total: 0, n: 0 };
          cur.total += val;
          cur.n += 1;
          sum.set(row.MovieId, cur);
        }
        if (batch.length < pageSizeFetch) {
          break;
        }
      }
      const ranked = [...sum.entries()]
        .map(([id, s]) => ({ id, avg: s.total / s.n }))
        .sort((a, b) => b.avg - a.avg || a.id - b.id);
      const slice = ranked.slice(from, to + 1);
      if (!slice.length) {
        return { rows: [], count: ranked.length };
      }
      const { data: movies, error: mErr } = await getSupabase()
        .from('Movie')
        .select('Id, Title, Year, DistributionId, TitleLanguageId, VersionId')
        .in(
          'Id',
          slice.map((s) => s.id)
        );
      if (mErr) {
        throw mErr;
      }
      const map = new Map(((movies as Movie[]) ?? []).map((m) => [m.Id, m]));
      const rows: MovieListItem[] = await this.enrichListItems(
        slice.flatMap((s) => {
          const m = map.get(s.id);
          return m ? [{ ...m, AvgScore: Math.round(s.avg * 10) / 10 }] : [];
        })
      );
      return { rows, count: ranked.length };
    }

    let filterIds: number[] | null = null;
    const term = query.trim();
    if (mode === 'text' && term) {
      // Exact title first rank is approximated by sorting later; include AKA + text matches like PHP.
      const [{ data: akaHits }, { data: textHits }, { data: triviaHits }, { data: titleHits }] =
        await Promise.all([
          getSupabase().from('Aka').select('MovieId').ilike('Title', `%${term}%`),
          getSupabase().from('MovieText').select('MovieId').ilike('Text', `%${term}%`),
          getSupabase().from('MovieTrivia').select('MovieId').ilike('Text', `%${term}%`),
          getSupabase().from('Movie').select('Id').ilike('Title', `%${term}%`),
        ]);
      filterIds = [
        ...new Set([
          ...(((titleHits as { Id: number }[]) ?? []).map((r) => r.Id)),
          ...(((akaHits as { MovieId: number }[]) ?? []).map((r) => r.MovieId)),
          ...(((textHits as { MovieId: number }[]) ?? []).map((r) => r.MovieId)),
          ...(((triviaHits as { MovieId: number }[]) ?? []).map((r) => r.MovieId)),
        ]),
      ];
      if (!filterIds.length) {
        return { rows: [], count: 0 };
      }
    }

    if (categoryId) {
      filterIds = await this.linkMovieIds('CategoryLink', 'CategoryId', categoryId, filterIds);
    }
    if (countryId) {
      filterIds = await this.linkMovieIds('CountryLink', 'CountryId', countryId, filterIds);
    }
    if (soundId) {
      filterIds = await this.linkMovieIds('SoundLink', 'SoundId', soundId, filterIds);
    }

    let q = getSupabase()
      .from('Movie')
      .select('Id, Title, Year, DistributionId, TitleLanguageId, VersionId', { count: 'exact' });

    if (mode === 'recent') {
      q = q.order('Id', { ascending: false });
    } else {
      q = q.order('Title', { ascending: true });
    }

    if (filterIds) {
      if (!filterIds.length) {
        return { rows: [], count: 0 };
      }
      q = q.in('Id', filterIds);
    }

    q = q.range(from, to);
    const { data, error, count } = await q;
    if (error) {
      throw error;
    }
    const rows = await this.enrichListItems((data as MovieListItem[]) ?? []);
    return { rows, count: count ?? 0 };
  }

  private async enrichListItems(rows: MovieListItem[]): Promise<MovieListItem[]> {
    if (!rows.length) {
      return rows;
    }
    const ids = rows.map((r) => r.Id);
    const [{ data: akas }, { data: versions }] = await Promise.all([
      getSupabase().from('Aka').select('MovieId, Title, TitleLanguageId').in('MovieId', ids).eq('TitleLanguageId', 2),
      getSupabase().from('Version').select('Id, Value'),
    ]);
    const akaMap = new Map<number, string>();
    for (const a of (akas as { MovieId: number; Title: string; TitleLanguageId: number }[]) ?? []) {
      const movie = rows.find((r) => r.Id === a.MovieId);
      if (movie && a.Title.toLowerCase() !== movie.Title.toLowerCase()) {
        akaMap.set(a.MovieId, swapTitle(a.Title, a.TitleLanguageId));
      }
    }
    const versionMap = new Map(
      ((versions as LookupRow[]) ?? []).map((v) => [v.Id, decodeEntities(String(v.Value))])
    );
    return rows.map((r) => ({
      ...r,
      Title: decodeEntities(r.Title),
      FinnishTitle: akaMap.get(r.Id) ?? null,
      VersionLabel:
        r.VersionId && versionMap.get(r.VersionId) && versionMap.get(r.VersionId) !== '-'
          ? versionMap.get(r.VersionId)!
          : null,
    }));
  }

  private async linkMovieIds(
    table: 'CategoryLink' | 'CountryLink' | 'SoundLink',
    column: string,
    id: number,
    current: number[] | null
  ): Promise<number[]> {
    const { data, error } = await getSupabase().from(table).select('MovieId').eq(column, id);
    if (error) {
      throw error;
    }
    const ids = ((data as { MovieId: number }[]) ?? []).map((r) => r.MovieId);
    if (!current) {
      return ids;
    }
    const set = new Set(ids);
    return current.filter((x) => set.has(x));
  }

  async getDetails(id: number): Promise<MovieDetails | null> {
    const movie = await this.getById(id);
    if (!movie) {
      return null;
    }

    const [
      text,
      trivia,
      categoryLinks,
      countryLinks,
      soundLinks,
      akaRows,
      roles,
      awardLinks,
      movieLinks,
      versions,
      ratios,
      distributions,
      languages,
      currencies,
      categories,
      countries,
      sounds,
      awards,
      relations,
      titleLangs,
    ] = await Promise.all([
      this.getText(id),
      this.getTrivia(id),
      getSupabase().from('CategoryLink').select('CategoryId, Sequence').eq('MovieId', id).order('Sequence'),
      getSupabase().from('CountryLink').select('CountryId, Sequence').eq('MovieId', id).order('Sequence'),
      getSupabase().from('SoundLink').select('SoundId, Sequence').eq('MovieId', id).order('Sequence'),
      getSupabase().from('Aka').select('Title, TitleLanguageId').eq('MovieId', id),
      this.getRoles(id),
      getSupabase().from('AwardLink').select('PersonId, AwardId').eq('MovieId', id),
      getSupabase().from('MovieLink').select('DestinationId, RelationId').eq('SourceId', id),
      getSupabase().from('Version').select('Id, Value'),
      getSupabase().from('Ratio').select('Id, Value'),
      getSupabase().from('Distribution').select('Id, Value'),
      getSupabase().from('TitleLanguage').select('Id, Value'),
      getSupabase().from('Currency').select('Id, Value'),
      getSupabase().from('Category').select('Id, Value'),
      getSupabase().from('Country').select('Id, Value'),
      getSupabase().from('Sound').select('Id, Value'),
      getSupabase().from('Award').select('Id, Value'),
      getSupabase().from('MovieRelation').select('Id, Value'),
      getSupabase().from('TitleLanguage').select('Id, Value'),
    ]);

    const mapVal = (rows: LookupRow[] | null, idv: number | null | undefined) => {
      if (idv == null) return '';
      const v = (rows ?? []).find((r) => r.Id === idv)?.Value;
      return v == null || v === '-' ? '' : decodeEntities(String(v));
    };

    const catMap = new Map(
      ((categories.data as LookupRow[]) ?? []).map((r) => [r.Id, decodeEntities(String(r.Value))])
    );
    const countryMap = new Map(
      ((countries.data as LookupRow[]) ?? []).map((r) => [r.Id, decodeEntities(String(r.Value))])
    );
    const soundMap = new Map(
      ((sounds.data as LookupRow[]) ?? []).map((r) => [r.Id, decodeEntities(String(r.Value))])
    );
    const langMap = new Map(
      ((titleLangs.data as LookupRow[]) ?? []).map((r) => [r.Id, decodeEntities(String(r.Value))])
    );
    const awardMap = new Map(
      ((awards.data as LookupRow[]) ?? []).map((r) => [r.Id, decodeEntities(String(r.Value))])
    );
    const relMap = new Map(
      ((relations.data as LookupRow[]) ?? []).map((r) => [r.Id, decodeEntities(String(r.Value))])
    );

    const awardRows = (awardLinks.data as { PersonId: number | null; AwardId: number }[]) ?? [];
    const personIds = [...new Set(awardRows.map((a) => a.PersonId).filter((x): x is number => x != null))];
    let personMap = new Map<number, string>();
    if (personIds.length) {
      const { data: people } = await getSupabase().from('Person').select('Id, Name').in('Id', personIds);
      personMap = new Map(((people as { Id: number; Name: string }[]) ?? []).map((p) => [p.Id, p.Name]));
    }

    const relatedRows = (movieLinks.data as { DestinationId: number; RelationId: number }[]) ?? [];
    let related: MovieDetails['related'] = [];
    if (relatedRows.length) {
      const { data: movies } = await getSupabase()
        .from('Movie')
        .select('Id, Title, Year, TitleLanguageId')
        .in(
          'Id',
          relatedRows.map((r) => r.DestinationId)
        );
      const movieMap = new Map(((movies as Movie[]) ?? []).map((m) => [m.Id, m]));
      related = relatedRows.map((r) => {
        const m = movieMap.get(r.DestinationId);
        return {
          MovieId: r.DestinationId,
          Title: m ? swapTitle(m.Title, m.TitleLanguageId) : `#${r.DestinationId}`,
          Year: m?.Year ?? null,
          Relation: relMap.get(r.RelationId) ?? String(r.RelationId),
        };
      });
    }

    return {
      movie,
      text,
      trivia,
      categories: ((categoryLinks.data as { CategoryId: number }[]) ?? [])
        .map((r) => catMap.get(r.CategoryId) ?? '')
        .filter((x) => x && x !== '-'),
      countries: ((countryLinks.data as { CountryId: number }[]) ?? [])
        .map((r) => countryMap.get(r.CountryId) ?? '')
        .filter((x) => x && x !== '-'),
      sounds: ((soundLinks.data as { SoundId: number }[]) ?? [])
        .map((r) => soundMap.get(r.SoundId) ?? '')
        .filter((x) => x && x !== '-'),
      aka: ((akaRows.data as { Title: string; TitleLanguageId: number }[]) ?? []).map((a) => ({
        Title: swapTitle(a.Title, a.TitleLanguageId),
        Language: langMap.get(a.TitleLanguageId) ?? '',
      })),
      roles,
      awards: awardRows.map((a) => ({
        Award: awardMap.get(a.AwardId) ?? String(a.AwardId),
        PersonId: a.PersonId,
        PersonName: a.PersonId != null ? personMap.get(a.PersonId) ?? null : null,
      })),
      related,
      version: mapVal(versions.data as LookupRow[], movie.VersionId),
      ratio: mapVal(ratios.data as LookupRow[], movie.RatioId),
      distribution: mapVal(distributions.data as LookupRow[], movie.DistributionId),
      language: mapVal(languages.data as LookupRow[], movie.TitleLanguageId),
      currency: mapVal(currencies.data as LookupRow[], movie.CurrencyId),
    };
  }

  async getById(id: number): Promise<Movie | null> {
    const { data, error } = await getSupabase().from('Movie').select('*').eq('Id', id).maybeSingle();
    if (error) {
      throw error;
    }
    return data as Movie | null;
  }

  async getText(movieId: number): Promise<string | null> {
    const { data, error } = await getSupabase()
      .from('MovieText')
      .select('Text')
      .eq('MovieId', movieId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const raw = (data as { Text: string } | null)?.Text ?? null;
    return raw ? decodeEntities(raw) : null;
  }

  async getTrivia(movieId: number): Promise<string[]> {
    const { data, error } = await getSupabase().from('MovieTrivia').select('Text').eq('MovieId', movieId);
    if (error) {
      throw error;
    }
    return ((data as { Text: string }[]) ?? []).map((r) => decodeEntities(r.Text)).filter(Boolean);
  }

  async getRoles(movieId: number): Promise<
    { PersonId: number; RoleId: number; Sequence: number; Name: string; Role: string }[]
  > {
    const { data: links, error } = await getSupabase()
      .from('RoleLink')
      .select('PersonId, RoleId, Sequence')
      .eq('MovieId', movieId)
      .order('RoleId')
      .order('Sequence');
    if (error) {
      throw error;
    }
    const rows = (links as { PersonId: number; RoleId: number; Sequence: number }[]) ?? [];
    if (!rows.length) {
      return [];
    }
    const personIds = [...new Set(rows.map((r) => r.PersonId))];
    const roleIds = [...new Set(rows.map((r) => r.RoleId))];
    const [{ data: people }, { data: roles }] = await Promise.all([
      getSupabase().from('Person').select('Id, Name').in('Id', personIds),
      getSupabase().from('Role').select('Id, Value').in('Id', roleIds),
    ]);
    const personMap = new Map(((people as { Id: number; Name: string }[]) ?? []).map((p) => [p.Id, p.Name]));
    const roleMap = new Map(((roles as LookupRow[]) ?? []).map((r) => [r.Id, String(r.Value)]));
    return rows.map((r) => ({
      ...r,
      Name: decodeEntities(personMap.get(r.PersonId) ?? `#${r.PersonId}`),
      Role: decodeEntities(roleMap.get(r.RoleId) ?? String(r.RoleId)),
    }));
  }

  async saveMovie(
    movie: Partial<Movie> & { Title: string },
    text: string | null,
    links?: {
      categoryIds?: number[];
      countryIds?: number[];
      soundIds?: number[];
      roles?: { roleId: number; personId: number }[];
      aka?: { title: string; titleLanguageId: number }[];
      trivia?: string[];
    }
  ): Promise<number> {
    let id: number;
    if (movie.Id) {
      const { Id, ...rest } = movie;
      const { error } = await getSupabase().from('Movie').update(rest).eq('Id', Id);
      if (error) {
        throw error;
      }
      id = Id;
    } else {
      const { data, error } = await getSupabase().from('Movie').insert(movie).select('Id').single();
      if (error) {
        throw error;
      }
      id = (data as { Id: number }).Id;
    }
    await this.replaceText(id, text);
    if (links) {
      await this.replaceLinks(id, links);
    }
    return id;
  }

  private async replaceLinks(
    movieId: number,
    links: {
      categoryIds?: number[];
      countryIds?: number[];
      soundIds?: number[];
      roles?: { roleId: number; personId: number }[];
      aka?: { title: string; titleLanguageId: number }[];
      trivia?: string[];
    }
  ): Promise<void> {
    if (links.categoryIds) {
      await getSupabase().from('CategoryLink').delete().eq('MovieId', movieId);
      if (links.categoryIds.length) {
        await getSupabase()
          .from('CategoryLink')
          .insert(links.categoryIds.map((CategoryId, i) => ({ MovieId: movieId, CategoryId, Sequence: i + 1 })));
      }
    }
    if (links.countryIds) {
      await getSupabase().from('CountryLink').delete().eq('MovieId', movieId);
      if (links.countryIds.length) {
        await getSupabase()
          .from('CountryLink')
          .insert(links.countryIds.map((CountryId, i) => ({ MovieId: movieId, CountryId, Sequence: i + 1 })));
      }
    }
    if (links.soundIds) {
      await getSupabase().from('SoundLink').delete().eq('MovieId', movieId);
      if (links.soundIds.length) {
        await getSupabase()
          .from('SoundLink')
          .insert(links.soundIds.map((SoundId, i) => ({ MovieId: movieId, SoundId, Sequence: i + 1 })));
      }
    }
    if (links.roles) {
      await getSupabase().from('RoleLink').delete().eq('MovieId', movieId);
      if (links.roles.length) {
        const seq = new Map<number, number>();
        await getSupabase()
          .from('RoleLink')
          .insert(
            links.roles.map((r) => {
              const s = (seq.get(r.roleId) ?? 0) + 1;
              seq.set(r.roleId, s);
              return { MovieId: movieId, PersonId: r.personId, RoleId: r.roleId, Sequence: s };
            })
          );
      }
    }
    if (links.aka) {
      await getSupabase().from('Aka').delete().eq('MovieId', movieId);
      if (links.aka.length) {
        await getSupabase()
          .from('Aka')
          .insert(
            links.aka.map((a) => ({
              MovieId: movieId,
              Title: a.title,
              TitleLanguageId: a.titleLanguageId,
            }))
          );
      }
    }
    if (links.trivia) {
      await getSupabase().from('MovieTrivia').delete().eq('MovieId', movieId);
      const items = links.trivia.map((t) => t.trim()).filter(Boolean);
      if (items.length) {
        await getSupabase()
          .from('MovieTrivia')
          .insert(items.map((Text) => ({ MovieId: movieId, Text: Text.replace(/\n/g, '<br />\n') })));
      }
    }
  }

  private async replaceText(movieId: number, text: string | null): Promise<void> {
    await getSupabase().from('MovieText').delete().eq('MovieId', movieId);
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      return;
    }
    const html = trimmed.replace(/\n/g, '<br />\n');
    const { error } = await getSupabase().from('MovieText').insert({ MovieId: movieId, Text: html });
    if (error) {
      throw error;
    }
  }

  async deleteMovie(id: number): Promise<void> {
    // Dependent rows first (no FKs in schema)
    const { data: omRows } = await getSupabase().from('OwnershipMovie').select('Id').eq('MovieId', id);
    const omIds = ((omRows as { Id: number }[]) ?? []).map((r) => r.Id);
    if (omIds.length) {
      const { data: formats } = await getSupabase()
        .from('OwnershipFormat')
        .select('Id')
        .in('OwnershipMovieId', omIds);
      const formatIds = ((formats as { Id: number }[]) ?? []).map((f) => f.Id);
      if (formatIds.length) {
        await getSupabase().from('OwnershipFormatAudio').delete().in('OwnershipFormatId', formatIds);
        await getSupabase().from('OwnershipFormatSubtitle').delete().in('OwnershipFormatId', formatIds);
        await getSupabase().from('OwnershipFormat').delete().in('Id', formatIds);
      }
      await getSupabase().from('OwnershipMovie').delete().eq('MovieId', id);
    }
    await getSupabase().from('Watchlist').delete().eq('MovieId', id);

    const tables = [
      'Aka',
      'AwardLink',
      'CategoryLink',
      'CountryLink',
      'SoundLink',
      'RoleLink',
      'MovieLink',
      'MovieText',
      'MovieTrivia',
      'UserLink',
      'SalaryLink',
    ] as const;
    for (const t of tables) {
      if (t === 'MovieLink') {
        await getSupabase().from('MovieLink').delete().or(`SourceId.eq.${id},DestinationId.eq.${id}`);
      } else if (t === 'SalaryLink') {
        await getSupabase().from('SalaryLink').delete().eq('MovieId', id);
      } else {
        await getSupabase().from(t).delete().eq('MovieId', id);
      }
    }
    const { error } = await getSupabase().from('Movie').delete().eq('Id', id);
    if (error) {
      throw error;
    }
  }
}
