import { Injectable } from '@angular/core';
import { decodeEntities, titleSortKey, titleWithYear } from '../core/format.util';
import {
  OWNERSHIP_CONTENT_BONUS,
  OWNERSHIP_CONTENT_FEATURE,
  Ownership,
  OwnershipDraft,
  OwnershipFormatDraft,
  OwnershipMovieDraft,
} from '../core/models';
import { getSupabase } from '../core/supabase.client';

/** Best physical format first (UHD → BD → …); Digital Copy last; Feature before Bonus. */
const MEDIA_FORMAT_RANK: Record<number, number> = {
  6: 1, // UHD
  1: 2, // BD
  7: 3, // 3D-BD
  3: 4, // HD-DVD
  2: 5, // DVD
  12: 6, // UMD
  4: 7, // LD
  5: 8, // VHS
  11: 90, // Digital Copy
};

export function compareOwnershipFormats(
  a: { mediaFormatId: number; contentType: number },
  b: { mediaFormatId: number; contentType: number }
): number {
  const digitalA = a.mediaFormatId === 11 ? 1 : 0;
  const digitalB = b.mediaFormatId === 11 ? 1 : 0;
  if (digitalA !== digitalB) {
    return digitalA - digitalB;
  }
  const bonusA = a.contentType === OWNERSHIP_CONTENT_BONUS ? 1 : 0;
  const bonusB = b.contentType === OWNERSHIP_CONTENT_BONUS ? 1 : 0;
  if (bonusA !== bonusB) {
    return bonusA - bonusB;
  }
  const rankA = MEDIA_FORMAT_RANK[a.mediaFormatId] ?? 50 + a.mediaFormatId;
  const rankB = MEDIA_FORMAT_RANK[b.mediaFormatId] ?? 50 + b.mediaFormatId;
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return a.mediaFormatId - b.mediaFormatId;
}

export function sortOwnershipFormats<T extends { mediaFormatId: number; contentType: number }>(
  formats: T[]
): T[] {
  return [...formats].sort(compareOwnershipFormats);
}

export interface OwnershipSummaryFormat {
  mediaFormatId: number;
  label: string;
  /** Displayed aspect ratio for DVD (and similar); null if unset. */
  ratioLabel: string | null;
  /** True when media ratio is Alkuperäinen or equals the movie ratio → green. */
  ratioMatchesOriginal: boolean;
}

export interface OwnershipSummaryMovie {
  Id: number;
  Title: string;
  TitleLanguageId: number | null;
  Year: number | null;
  VersionLabel: string | null;
  formats: OwnershipSummaryFormat[];
  /** @deprecated Prefer formats; kept for callers using short chips. */
  formatIds: number[];
  formatLabels: string[];
}

/** Title + year + optional version, e.g. "Alien (1979) – Director's Cut". */
export function ownershipMovieLabel(m: {
  Title: string;
  TitleLanguageId: number | null;
  Year: number | null;
  VersionLabel?: string | null;
}): string {
  const base = titleWithYear(m.Title, m.TitleLanguageId, m.Year);
  const version = m.VersionLabel?.trim();
  if (!version || version === '-') {
    return base;
  }
  return base ? `${base} – ${version}` : version;
}

/** Sort ownership rows by first movie title with article handling (The/A → …, The). */
export function compareOwnershipSummariesByTitle(a: OwnershipSummary, b: OwnershipSummary): number {
  const keyA = ownershipSummarySortKey(a);
  const keyB = ownershipSummarySortKey(b);
  const cmp = keyA.localeCompare(keyB, 'fi', { sensitivity: 'base' });
  if (cmp !== 0) {
    return cmp;
  }
  return a.Id - b.Id;
}

export function ownershipSummarySortKey(o: OwnershipSummary): string {
  if (o.movies.length) {
    return o.movies
      .map((m) => titleSortKey(m.Title, m.TitleLanguageId))
      .filter(Boolean)
      .join('\u0000');
  }
  return titleSortKey(o.Name, 1);
}

/** Owned-list label: movie title (+ version) and formats only — no ownership type prefix. */
export function ownershipListLabel(o: OwnershipSummary): string {
  const movies = o.movies
    .map((m) => {
      const base = ownershipMovieLabel(m);
      const formats = (m.formatLabels ?? []).filter(Boolean).join('+');
      return formats ? `${base} ${formats}` : base;
    })
    .filter(Boolean);
  if (!movies.length) {
    return o.Name?.trim() || `Omistus #${o.Id}`;
  }
  return movies.join(', ');
}

export interface OwnershipSummary {
  Id: number;
  Name: string;
  Notes: string | null;
  ReleaseRegionId: number | null;
  ReleaseConditionId: number | null;
  ReleasePublisherId: number | null;
  OwnershipTypeId: number | null;
  regionLabel: string;
  conditionLabel: string;
  publisherLabel: string;
  typeLabel: string;
  /** Present subtitle languages for focused formats, e.g. ['FI','EN']. */
  subtitleLabels: string[];
  /** Finnish audio present on focused formats, e.g. ['Puhumme suomea']. */
  audioLabels: string[];
  movieCount: number;
  movies: OwnershipSummaryMovie[];
}

@Injectable({ providedIn: 'root' })
export class OwnershipService {
  async listForUser(
    userId: number,
    page: number,
    pageSize: number
  ): Promise<{ rows: OwnershipSummary[]; count: number }> {
    const ownerships = await this.fetchAllOwnershipRows(userId);
    if (!ownerships.length) {
      return { rows: [], count: 0 };
    }

    // One list row per owned movie (collections appear under each title alphabetically).
    const ownershipIds = ownerships.map((o) => o.Id);
    const ownershipById = new Map(ownerships.map((o) => [o.Id, o]));
    const moviesByOwnership = await this.fetchOwnershipMovieSortIndex(ownershipIds);
    const movieIds = [
      ...new Set(
        [...moviesByOwnership.values()].flatMap((rows) => rows.map((r) => r.MovieId))
      ),
    ];
    const movieMeta = await this.fetchMovieSortMeta(movieIds);

    type ListEntry = { ownershipId: number; movieId: number; key: string };
    const entries: ListEntry[] = [];
    for (const o of ownerships) {
      const linked = moviesByOwnership.get(o.Id) ?? [];
      if (!linked.length) {
        entries.push({
          ownershipId: o.Id,
          movieId: 0,
          key: titleSortKey(o.Name, 1),
        });
        continue;
      }
      for (const r of linked) {
        const meta = movieMeta.get(r.MovieId);
        entries.push({
          ownershipId: o.Id,
          movieId: r.MovieId,
          key: meta
            ? titleSortKey(meta.Title, meta.TitleLanguageId)
            : String(r.MovieId),
        });
      }
    }
    entries.sort(
      (a, b) =>
        a.key.localeCompare(b.key, 'fi', { sensitivity: 'base' }) ||
        a.ownershipId - b.ownershipId ||
        a.movieId - b.movieId
    );

    const from = (page - 1) * pageSize;
    const pageEntries = entries.slice(from, from + pageSize);
    const pageOwnershipIds = [...new Set(pageEntries.map((e) => e.ownershipId))];
    const pageOwnerships = pageOwnershipIds
      .map((id) => ownershipById.get(id))
      .filter((o): o is Ownership => !!o);
    const summaries = await this.buildListSummaries(pageOwnerships, moviesByOwnership);
    const summaryById = new Map(summaries.map((s) => [s.Id, s]));

    const rows: OwnershipSummary[] = [];
    for (const e of pageEntries) {
      const full = summaryById.get(e.ownershipId);
      if (!full) {
        continue;
      }
      if (!e.movieId) {
        rows.push(full);
        continue;
      }
      const movie = full.movies.find((m) => m.Id === e.movieId);
      if (!movie) {
        continue;
      }
      rows.push({
        ...full,
        movies: [movie],
        movieCount: 1,
      });
    }
    return { rows, count: entries.length };
  }

  /**
   * Short format tags for many movies belonging to one user, e.g. movieId → ['BD','DVD'].
   */
  async formatLabelsForUserMovies(
    userId: number,
    movieIds: number[]
  ): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();
    const ids = [...new Set(movieIds.filter((id) => id > 0))];
    if (!userId || !ids.length) {
      return result;
    }

    const { data: omRows, error: omErr } = await getSupabase()
      .from('OwnershipMovie')
      .select('Id, MovieId, OwnershipId')
      .in('MovieId', ids);
    if (omErr) {
      throw omErr;
    }
    const allOm = (omRows as { Id: number; MovieId: number; OwnershipId: number }[]) ?? [];
    if (!allOm.length) {
      return result;
    }

    const ownershipIds = [...new Set(allOm.map((r) => r.OwnershipId))];
    const { data: ownerships, error: oErr } = await getSupabase()
      .from('Ownership')
      .select('Id')
      .eq('UserId', userId)
      .in('Id', ownershipIds);
    if (oErr) {
      throw oErr;
    }
    const userOwnershipIds = new Set(((ownerships as { Id: number }[]) ?? []).map((o) => o.Id));
    if (!userOwnershipIds.size) {
      return result;
    }

    const ownershipMovies = allOm.filter((r) => userOwnershipIds.has(r.OwnershipId));
    if (!ownershipMovies.length) {
      return result;
    }

    const omIds = ownershipMovies.map((r) => r.Id);
    const { data: formats, error: fErr } = await getSupabase()
      .from('OwnershipFormat')
      .select('OwnershipMovieId, MediaFormatId')
      .in('OwnershipMovieId', omIds);
    if (fErr) {
      throw fErr;
    }

    const formatsByOm = new Map<number, number[]>();
    for (const f of (formats as { OwnershipMovieId: number; MediaFormatId: number }[]) ?? []) {
      const list = formatsByOm.get(f.OwnershipMovieId) ?? [];
      if (!list.includes(f.MediaFormatId)) {
        list.push(f.MediaFormatId);
      }
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

    for (const [movieId, set] of formatsByMovie) {
      const labels = [...set]
        .sort((a, b) =>
          compareOwnershipFormats(
            { mediaFormatId: a, contentType: OWNERSHIP_CONTENT_FEATURE },
            { mediaFormatId: b, contentType: OWNERSHIP_CONTENT_FEATURE }
          )
        )
        .map((id) => mediaFormatShort(id))
        .filter(Boolean);
      if (labels.length) {
        result.set(movieId, labels);
      }
    }
    return result;
  }

  /** Batch light summaries for ownership list (no N+1 catalog fetches). */
  private async buildListSummaries(
    ownerships: Ownership[],
    moviesByOwnership: Map<number, { MovieId: number; Sequence: number }[]>
  ): Promise<OwnershipSummary[]> {
    if (!ownerships.length) {
      return [];
    }
    const ownershipIds = ownerships.map((o) => o.Id);
    const typeIds = [
      ...new Set(ownerships.map((o) => o.OwnershipTypeId).filter((id): id is number => id != null && id > 0)),
    ];
    const pageMovieIds = [
      ...new Set(
        ownershipIds.flatMap((id) => (moviesByOwnership.get(id) ?? []).map((r) => r.MovieId))
      ),
    ];

    const omIds: number[] = [];
    const omByOwnership = new Map<number, { Id: number; MovieId: number; Sequence: number }[]>();
    if (ownershipIds.length) {
      const chunkSize = 200;
      for (let i = 0; i < ownershipIds.length; i += chunkSize) {
        const chunk = ownershipIds.slice(i, i + chunkSize);
        const { data, error } = await getSupabase()
          .from('OwnershipMovie')
          .select('Id, OwnershipId, MovieId, Sequence')
          .in('OwnershipId', chunk)
          .order('Sequence');
        if (error) {
          throw error;
        }
        for (const row of
          (data as { Id: number; OwnershipId: number; MovieId: number; Sequence: number }[]) ??
            []) {
          omIds.push(row.Id);
          const list = omByOwnership.get(row.OwnershipId) ?? [];
          list.push({ Id: row.Id, MovieId: row.MovieId, Sequence: row.Sequence });
          omByOwnership.set(row.OwnershipId, list);
        }
      }
    }

    const formatsByOm = new Map<number, number[]>();
    if (omIds.length) {
      const chunkSize = 200;
      for (let i = 0; i < omIds.length; i += chunkSize) {
        const chunk = omIds.slice(i, i + chunkSize);
        const { data, error } = await getSupabase()
          .from('OwnershipFormat')
          .select('OwnershipMovieId, MediaFormatId, Sequence')
          .in('OwnershipMovieId', chunk)
          .order('Sequence');
        if (error) {
          throw error;
        }
        for (const f of
          (data as { OwnershipMovieId: number; MediaFormatId: number }[]) ?? []) {
          const list = formatsByOm.get(f.OwnershipMovieId) ?? [];
          if (!list.includes(f.MediaFormatId)) {
            list.push(f.MediaFormatId);
          }
          formatsByOm.set(f.OwnershipMovieId, list);
        }
      }
    }

    const movieMeta = new Map<
      number,
      {
        Title: string;
        TitleLanguageId: number | null;
        Year: number | null;
        VersionId: number | null;
      }
    >();
    if (pageMovieIds.length) {
      const chunkSize = 200;
      for (let i = 0; i < pageMovieIds.length; i += chunkSize) {
        const chunk = pageMovieIds.slice(i, i + chunkSize);
        const { data, error } = await getSupabase()
          .from('Movie')
          .select('Id, Title, TitleLanguageId, Year, VersionId')
          .in('Id', chunk);
        if (error) {
          throw error;
        }
        for (const m of
          (data as {
            Id: number;
            Title: string;
            TitleLanguageId: number | null;
            Year: number | null;
            VersionId: number | null;
          }[]) ?? []) {
          movieMeta.set(m.Id, {
            Title: decodeEntities(m.Title),
            TitleLanguageId: m.TitleLanguageId,
            Year: m.Year,
            VersionId: m.VersionId,
          });
        }
      }
    }

    const versionMap = new Map<number, string>();
    const { data: versions } = await getSupabase().from('Version').select('Id, Value');
    for (const v of (versions as { Id: number; Value: string }[]) ?? []) {
      const label = decodeEntities(String(v.Value));
      if (label && label !== '-') {
        versionMap.set(v.Id, label);
      }
    }

    const typeMap = new Map<number, string>();
    if (typeIds.length) {
      const { data: types } = await getSupabase().from('OwnershipType').select('Id, Value').in('Id', typeIds);
      for (const t of (types as { Id: number; Value: string }[]) ?? []) {
        const label = decodeEntities(String(t.Value));
        if (label && label !== '-') {
          typeMap.set(t.Id, label);
        }
      }
    }

    return ownerships.map((o) => {
      const omRows = (omByOwnership.get(o.Id) ?? [])
        .slice()
        .sort((a, b) => a.Sequence - b.Sequence);
      const movies = omRows.map((om) => {
        const meta = movieMeta.get(om.MovieId);
        const formatIds = formatsByOm.get(om.Id) ?? [];
        const formatLabels = formatIds.map((id) => mediaFormatShort(id)).filter(Boolean);
        return {
          Id: om.MovieId,
          Title: meta?.Title ?? `#${om.MovieId}`,
          TitleLanguageId: meta?.TitleLanguageId ?? null,
          Year: meta?.Year ?? null,
          VersionLabel:
            meta?.VersionId && versionMap.get(meta.VersionId)
              ? versionMap.get(meta.VersionId)!
              : null,
          formats: formatIds.map((id) => ({
            mediaFormatId: id,
            label: mediaFormatShort(id) || String(id),
            ratioLabel: null,
            ratioMatchesOriginal: false,
          })),
          formatIds,
          formatLabels,
        };
      });
      return {
        Id: o.Id,
        Name: o.Name ?? '',
        Notes: o.Notes,
        ReleaseRegionId: o.ReleaseRegionId,
        ReleaseConditionId: o.ReleaseConditionId,
        ReleasePublisherId: o.ReleasePublisherId,
        OwnershipTypeId: o.OwnershipTypeId,
        regionLabel: '',
        conditionLabel: '',
        publisherLabel: '',
        typeLabel: o.OwnershipTypeId ? typeMap.get(o.OwnershipTypeId) ?? '' : '',
        subtitleLabels: [],
        audioLabels: [],
        movieCount: movies.length,
        movies,
      };
    });
  }

  private async fetchAllOwnershipRows(userId: number): Promise<Ownership[]> {
    const pageSizeFetch = 1000;
    const rows: Ownership[] = [];
    for (let offset = 0; ; offset += pageSizeFetch) {
      const { data, error } = await getSupabase()
        .from('Ownership')
        .select(
          'Id, UserId, Name, Notes, ReleaseRegionId, ReleaseConditionId, ReleasePublisherId, OwnershipTypeId'
        )
        .eq('UserId', userId)
        .order('Id')
        .range(offset, offset + pageSizeFetch - 1);
      if (error) {
        throw error;
      }
      const batch = (data as Ownership[]) ?? [];
      rows.push(...batch);
      if (batch.length < pageSizeFetch) {
        break;
      }
    }
    return rows;
  }

  private async fetchOwnershipMovieSortIndex(
    ownershipIds: number[]
  ): Promise<Map<number, { MovieId: number; Sequence: number }[]>> {
    const result = new Map<number, { MovieId: number; Sequence: number }[]>();
    const chunkSize = 200;
    for (let i = 0; i < ownershipIds.length; i += chunkSize) {
      const chunk = ownershipIds.slice(i, i + chunkSize);
      const { data, error } = await getSupabase()
        .from('OwnershipMovie')
        .select('OwnershipId, MovieId, Sequence')
        .in('OwnershipId', chunk);
      if (error) {
        throw error;
      }
      for (const row of
        (data as { OwnershipId: number; MovieId: number; Sequence: number }[]) ?? []) {
        const list = result.get(row.OwnershipId) ?? [];
        list.push({ MovieId: row.MovieId, Sequence: row.Sequence });
        result.set(row.OwnershipId, list);
      }
    }
    return result;
  }

  private async fetchMovieSortMeta(
    movieIds: number[]
  ): Promise<Map<number, { Title: string; TitleLanguageId: number | null }>> {
    const result = new Map<number, { Title: string; TitleLanguageId: number | null }>();
    if (!movieIds.length) {
      return result;
    }
    const chunkSize = 200;
    for (let i = 0; i < movieIds.length; i += chunkSize) {
      const chunk = movieIds.slice(i, i + chunkSize);
      const { data, error } = await getSupabase()
        .from('Movie')
        .select('Id, Title, TitleLanguageId')
        .in('Id', chunk);
      if (error) {
        throw error;
      }
      for (const m of
        (data as { Id: number; Title: string; TitleLanguageId: number | null }[]) ?? []) {
        result.set(m.Id, {
          Title: decodeEntities(m.Title),
          TitleLanguageId: m.TitleLanguageId,
        });
      }
    }
    return result;
  }

  /**
   * Random unrated owned movie id for Arvonta, or null if none.
   * Only loads ids — no ownership summary hydration.
   */
  async pickRandomShelfMovieId(userId: number): Promise<number | null> {
    const ids = await this.listShelfUnratedMovieIds(userId);
    if (!ids.length) {
      return null;
    }
    return ids[Math.floor(Math.random() * ids.length)] ?? null;
  }

  private async listShelfUnratedMovieIds(userId: number): Promise<number[]> {
    const { data: ownerships, error: oErr } = await getSupabase()
      .from('Ownership')
      .select('Id')
      .eq('UserId', userId);
    if (oErr) {
      throw oErr;
    }
    const ownershipIds = ((ownerships as { Id: number }[]) ?? []).map((o) => o.Id);
    if (!ownershipIds.length) {
      return [];
    }
    const { data: omRows, error: omErr } = await getSupabase()
      .from('OwnershipMovie')
      .select('MovieId')
      .in('OwnershipId', ownershipIds);
    if (omErr) {
      throw omErr;
    }
    const movieIds = [...new Set(((omRows as { MovieId: number }[]) ?? []).map((l) => l.MovieId))];
    if (!movieIds.length) {
      return [];
    }
    const rated = new Set<number>();
    const { data: scores, error: sErr } = await getSupabase()
      .from('UserLink')
      .select('MovieId')
      .eq('UserId', userId)
      .in('MovieId', movieIds)
      .gt('ScoreId', 0);
    if (sErr) {
      throw sErr;
    }
    for (const row of (scores as { MovieId: number }[]) ?? []) {
      rated.add(row.MovieId);
    }
    return movieIds.filter((id) => !rated.has(id));
  }

  /**
   * Short format tags per user for a movie, e.g. "BD+DVD".
   * Aggregates all ownerships the user has that include this movie.
   */
  async formatLabelsByUserForMovie(
    movieId: number,
    userIds: number[]
  ): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    const ids = [...new Set(userIds.filter((id) => id > 0))];
    if (!ids.length) {
      return result;
    }

    const { data: links, error } = await getSupabase()
      .from('OwnershipMovie')
      .select('Id, OwnershipId')
      .eq('MovieId', movieId);
    if (error) {
      throw error;
    }
    const omRows = (links as { Id: number; OwnershipId: number }[]) ?? [];
    if (!omRows.length) {
      return result;
    }

    const ownershipIds = [...new Set(omRows.map((r) => r.OwnershipId))];
    const { data: ownerships, error: oErr } = await getSupabase()
      .from('Ownership')
      .select('Id, UserId')
      .in('Id', ownershipIds)
      .in('UserId', ids);
    if (oErr) {
      throw oErr;
    }
    const ownershipUser = new Map(
      ((ownerships as { Id: number; UserId: number }[]) ?? []).map((o) => [o.Id, o.UserId])
    );
    if (!ownershipUser.size) {
      return result;
    }

    const relevantOm = omRows.filter((r) => ownershipUser.has(r.OwnershipId));
    const omIds = relevantOm.map((r) => r.Id);
    if (!omIds.length) {
      return result;
    }

    const { data: formats, error: fErr } = await getSupabase()
      .from('OwnershipFormat')
      .select('OwnershipMovieId, MediaFormatId, Sequence')
      .in('OwnershipMovieId', omIds)
      .order('Sequence');
    if (fErr) {
      throw fErr;
    }

    const omToUser = new Map(relevantOm.map((r) => [r.Id, ownershipUser.get(r.OwnershipId)!]));
    const userFormats = new Map<number, number[]>();
    for (const f of (formats as { OwnershipMovieId: number; MediaFormatId: number }[]) ?? []) {
      const userId = omToUser.get(f.OwnershipMovieId);
      if (userId == null) {
        continue;
      }
      const list = userFormats.get(userId) ?? [];
      if (!list.includes(f.MediaFormatId)) {
        list.push(f.MediaFormatId);
      }
      userFormats.set(userId, list);
    }

    for (const [userId, formatIds] of userFormats) {
      const labels = [...formatIds]
        .sort((a, b) =>
          compareOwnershipFormats(
            { mediaFormatId: a, contentType: OWNERSHIP_CONTENT_FEATURE },
            { mediaFormatId: b, contentType: OWNERSHIP_CONTENT_FEATURE }
          )
        )
        .map((id) => mediaFormatShort(id))
        .filter(Boolean);
      if (labels.length) {
        result.set(userId, labels.join('+'));
      }
    }
    return result;
  }

  async listForMovie(movieId: number, userId: number): Promise<OwnershipSummary[]> {
    const { data: links, error } = await getSupabase()
      .from('OwnershipMovie')
      .select('OwnershipId')
      .eq('MovieId', movieId);
    if (error) {
      throw error;
    }
    const ownershipIds = [
      ...new Set(((links as { OwnershipId: number }[]) ?? []).map((r) => r.OwnershipId)),
    ];
    if (!ownershipIds.length) {
      return [];
    }

    const { data: ownerships, error: oErr } = await getSupabase()
      .from('Ownership')
      .select(
        'Id, UserId, Name, Notes, ReleaseRegionId, ReleaseConditionId, ReleasePublisherId, OwnershipTypeId'
      )
      .eq('UserId', userId)
      .in('Id', ownershipIds)
      .order('Name');
    if (oErr) {
      throw oErr;
    }
    const rows = (ownerships as Ownership[]) ?? [];
    if (!rows.length) {
      return [];
    }

    const summaries = await Promise.all(rows.map((o) => this.toSummary(o, movieId)));
    return summaries.filter((s) => s.movies.length > 0);
  }

  async getDraft(ownershipId: number): Promise<OwnershipDraft | null> {
    const { data: ownership, error } = await getSupabase()
      .from('Ownership')
      .select(
        'Id, UserId, Name, Notes, ReleaseRegionId, ReleaseConditionId, ReleasePublisherId, OwnershipTypeId'
      )
      .eq('Id', ownershipId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!ownership) {
      return null;
    }

    const { data: movies, error: mErr } = await getSupabase()
      .from('OwnershipMovie')
      .select('Id, MovieId, Sequence')
      .eq('OwnershipId', ownershipId)
      .order('Sequence');
    if (mErr) {
      throw mErr;
    }
    const omRows = (movies as { Id: number; MovieId: number; Sequence: number }[]) ?? [];
    const movieIds = omRows.map((m) => m.MovieId);
    const titleMap = new Map<
      number,
      {
        Title: string;
        TitleLanguageId: number | null;
        Year: number | null;
        RatioId: number | null;
        VersionId: number | null;
      }
    >();
    let versionMap = new Map<number, string>();
    if (movieIds.length) {
      const [{ data: titles }, { data: versions }] = await Promise.all([
        getSupabase()
          .from('Movie')
          .select('Id, Title, TitleLanguageId, Year, RatioId, VersionId')
          .in('Id', movieIds),
        getSupabase().from('Version').select('Id, Value'),
      ]);
      versionMap = new Map(
        ((versions as { Id: number; Value: string }[]) ?? []).map((v) => [
          v.Id,
          decodeEntities(String(v.Value)),
        ])
      );
      for (const t of
        (titles as {
          Id: number;
          Title: string;
          TitleLanguageId: number | null;
          Year: number | null;
          RatioId: number | null;
          VersionId: number | null;
        }[]) ?? []) {
        titleMap.set(t.Id, t);
      }
    }

    const draftMovies: OwnershipMovieDraft[] = [];
    for (const om of omRows) {
      const { data: formats, error: fErr } = await getSupabase()
        .from('OwnershipFormat')
        .select('Id, MediaFormatId, Sequence, RatioId, ContentType, MediaConditionId')
        .eq('OwnershipMovieId', om.Id)
        .order('Sequence');
      if (fErr) {
        throw fErr;
      }

      const formatDrafts: OwnershipFormatDraft[] = [];
      for (const f of
        (formats as {
          Id: number;
          MediaFormatId: number;
          Sequence: number;
          RatioId: number | null;
          ContentType: number | null;
          MediaConditionId: number | null;
        }[]) ?? []) {
        const [{ data: subs }, { data: audios }] = await Promise.all([
          getSupabase()
            .from('OwnershipFormatSubtitle')
            .select('ReleaseSubtitleId')
            .eq('OwnershipFormatId', f.Id),
          getSupabase()
            .from('OwnershipFormatAudio')
            .select('ReleaseAudioId')
            .eq('OwnershipFormatId', f.Id),
        ]);
        const contentRaw = f.ContentType ?? 0;
        const mediaConditionId =
          f.MediaConditionId != null && f.MediaConditionId > 0 ? f.MediaConditionId : null;
        formatDrafts.push({
          key: newFormatKey(),
          mediaFormatId: f.MediaFormatId,
          ratioId: f.RatioId != null && f.RatioId > 0 ? f.RatioId : null,
          contentType: contentRaw > 0 ? contentRaw : OWNERSHIP_CONTENT_FEATURE,
          mediaConditionId,
          digitalHasDisc: isDigitalCopy(f.MediaFormatId)
            ? mediaConditionId != null
            : undefined,
          audioIds: ((audios as { ReleaseAudioId: number }[]) ?? []).map((a) => a.ReleaseAudioId),
          subtitleIds: ((subs as { ReleaseSubtitleId: number }[]) ?? []).map((s) => s.ReleaseSubtitleId),
          linkedMovieIds: [],
          mediaGroupId: f.Sequence > 0 ? f.Sequence : undefined,
        });
      }
      formatDrafts.sort(compareOwnershipFormats);

      const meta = titleMap.get(om.MovieId);
      const versionRaw =
        meta?.VersionId != null && meta.VersionId > 0 ? versionMap.get(meta.VersionId) : null;
      draftMovies.push({
        movieId: om.MovieId,
        title: meta?.Title ?? `#${om.MovieId}`,
        titleLanguageId: meta?.TitleLanguageId ?? null,
        year: meta?.Year ?? null,
        ratioId: meta?.RatioId != null && meta.RatioId > 0 ? meta.RatioId : null,
        versionLabel: versionRaw && versionRaw !== '-' ? versionRaw : null,
        formats: formatDrafts,
      });
    }

    mergeSharedOwnershipFormats(draftMovies);

    const o = ownership as Ownership;
    const fk = (id: number | null | undefined) => (id != null && id > 0 ? id : null);
    return {
      id: o.Id,
      name: o.Name,
      notes: o.Notes ?? '',
      releaseRegionId: fk(o.ReleaseRegionId),
      releaseConditionId: fk(o.ReleaseConditionId),
      releasePublisherId: fk(o.ReleasePublisherId),
      ownershipTypeId: fk(o.OwnershipTypeId),
      movies: draftMovies,
    };
  }

  async save(userId: number, draft: OwnershipDraft): Promise<number> {
    const movies = prepareOwnershipMoviesForSave(draft.movies);
    if (!movies.length) {
      throw new Error('Omistuksessa pitää olla vähintään yksi elokuva.');
    }
    for (const m of movies) {
      if (!m.formats.length) {
        throw new Error(`Elokuvalla "${m.title}" pitää olla vähintään yksi media.`);
      }
      for (const f of m.formats) {
        if (f.contentType !== OWNERSHIP_CONTENT_FEATURE && f.contentType !== OWNERSHIP_CONTENT_BONUS) {
          throw new Error(`Medialle "${m.title}" pitää valita sisältö (Feature tai Bonus Disc).`);
        }
      }
    }
    draft = { ...draft, movies };

    const fk = (id: number | null | undefined) => (id != null && id > 0 ? id : null);
    let ownershipId = draft.id;
    const autoName = await this.buildOwnershipName(draft);
    const payload = {
      Name: autoName.slice(0, 500),
      Notes: draft.notes.trim() || null,
      ReleaseRegionId: fk(draft.releaseRegionId),
      ReleaseConditionId: fk(draft.releaseConditionId),
      ReleasePublisherId: fk(draft.releasePublisherId),
      OwnershipTypeId: fk(draft.ownershipTypeId),
    };
    if (ownershipId) {
      const { error } = await getSupabase()
        .from('Ownership')
        .update(payload)
        .eq('Id', ownershipId)
        .eq('UserId', userId);
      if (error) {
        throw error;
      }
      await this.clearChildren(ownershipId);
    } else {
      const { data, error } = await getSupabase()
        .from('Ownership')
        .insert({ UserId: userId, ...payload })
        .select('Id')
        .single();
      if (error) {
        throw error;
      }
      ownershipId = (data as { Id: number }).Id;
    }

    for (let mi = 0; mi < draft.movies.length; mi++) {
      const m = draft.movies[mi];
      const { data: omData, error: omErr } = await getSupabase()
        .from('OwnershipMovie')
        .insert({
          OwnershipId: ownershipId,
          MovieId: m.movieId,
          Sequence: mi + 1,
        })
        .select('Id')
        .single();
      if (omErr) {
        throw omErr;
      }
      const omId = (omData as { Id: number }).Id;

      const formats = sortOwnershipFormats(m.formats);
      for (let fi = 0; fi < formats.length; fi++) {
        const f = formats[fi];
        const { data: fData, error: fErr } = await getSupabase()
          .from('OwnershipFormat')
          .insert({
            OwnershipMovieId: omId,
            MediaFormatId: f.mediaFormatId,
            Sequence: f.mediaGroupId != null && f.mediaGroupId > 0 ? f.mediaGroupId : fi + 1,
            RatioId: fk(f.ratioId),
            ContentType: f.contentType > 0 ? f.contentType : OWNERSHIP_CONTENT_FEATURE,
            MediaConditionId: fk(
              isDigitalCopy(f.mediaFormatId) && f.digitalHasDisc === false
                ? null
                : f.mediaConditionId
            ),
          })
          .select('Id')
          .single();
        if (fErr) {
          throw fErr;
        }
        const formatId = (fData as { Id: number }).Id;
        if (f.audioIds?.length) {
          const { error } = await getSupabase()
            .from('OwnershipFormatAudio')
            .insert(
              f.audioIds.map((ReleaseAudioId) => ({
                OwnershipFormatId: formatId,
                ReleaseAudioId,
              }))
            );
          if (error) {
            throw error;
          }
        }
        if (f.subtitleIds.length) {
          const { error } = await getSupabase()
            .from('OwnershipFormatSubtitle')
            .insert(
              f.subtitleIds.map((ReleaseSubtitleId) => ({
                OwnershipFormatId: formatId,
                ReleaseSubtitleId,
              }))
            );
          if (error) {
            throw error;
          }
        }
      }
    }

    return ownershipId!;
  }

  /**
   * Merge absorb ownership into keep: move movies/formats in, then delete absorb.
   */
  async merge(userId: number, keepId: number, absorbId: number): Promise<void> {
    if (keepId === absorbId) {
      throw new Error('Valitse kaksi eri omistusta.');
    }
    const [keep, absorb] = await Promise.all([this.getDraft(keepId), this.getDraft(absorbId)]);
    if (!keep || !absorb) {
      throw new Error('Omistusta ei löytynyt.');
    }

    for (const movie of absorb.movies) {
      const existing = keep.movies.find((m) => m.movieId === movie.movieId);
      if (!existing) {
        keep.movies.push({
          ...movie,
          formats: movie.formats.map((f) => ({
            ...f,
            key: newFormatKey(),
            audioIds: [...(f.audioIds ?? [])],
            subtitleIds: [...f.subtitleIds],
          })),
        });
        continue;
      }
      for (const format of movie.formats) {
        const same = existing.formats.find(
          (f) =>
            f.mediaFormatId === format.mediaFormatId && f.contentType === format.contentType
        );
        if (!same) {
          existing.formats.push({
            ...format,
            key: newFormatKey(),
            audioIds: [...(format.audioIds ?? [])],
            subtitleIds: [...format.subtitleIds],
          });
        } else {
          same.audioIds = [...new Set([...(same.audioIds ?? []), ...(format.audioIds ?? [])])];
          same.subtitleIds = [...new Set([...same.subtitleIds, ...format.subtitleIds])];
          if (!same.ratioId && format.ratioId) {
            same.ratioId = format.ratioId;
          }
          if (!same.mediaConditionId && format.mediaConditionId) {
            same.mediaConditionId = format.mediaConditionId;
          }
        }
      }
    }

    const notes = [keep.notes?.trim(), absorb.notes?.trim()].filter(Boolean);
    keep.notes = notes.join('\n');
    if (!keep.ownershipTypeId && absorb.ownershipTypeId) {
      keep.ownershipTypeId = absorb.ownershipTypeId;
    }
    if (!keep.releasePublisherId && absorb.releasePublisherId) {
      keep.releasePublisherId = absorb.releasePublisherId;
    }
    if (!keep.releaseRegionId && absorb.releaseRegionId) {
      keep.releaseRegionId = absorb.releaseRegionId;
    }
    if (!keep.releaseConditionId && absorb.releaseConditionId) {
      keep.releaseConditionId = absorb.releaseConditionId;
    }

    await this.save(userId, keep);
    await this.remove(absorbId, userId);
  }

  async remove(ownershipId: number, userId: number): Promise<void> {
    const { error } = await getSupabase()
      .from('Ownership')
      .delete()
      .eq('Id', ownershipId)
      .eq('UserId', userId);
    if (error) {
      throw error;
    }
  }

  private async buildOwnershipName(draft: OwnershipDraft): Promise<string> {
    if (draft.ownershipTypeId == null) {
      return (
        draft.movies
          .map((m) => titleWithYear(m.title, m.titleLanguageId, m.year) || m.title)
          .filter(Boolean)
          .join(' / ') || 'Omistus'
      );
    }

    let typeLabel = '';
    const { data: typeRow } = await getSupabase()
      .from('OwnershipType')
      .select('Value')
      .eq('Id', draft.ownershipTypeId)
      .maybeSingle();
    typeLabel = ((typeRow as { Value: string } | null)?.Value ?? '').trim();

    const parts = draft.movies.map((m) => {
      const title =
        ownershipMovieLabel({
          Title: m.title,
          TitleLanguageId: m.titleLanguageId,
          Year: m.year,
          VersionLabel: m.versionLabel ?? null,
        }) || m.title;
      const formats = sortOwnershipFormats(m.formats)
        .map((f) => mediaFormatShort(f.mediaFormatId) || String(f.mediaFormatId))
        .filter(Boolean)
        .join('+');
      return `${title}${formats ? ` ${formats}` : ''}`.trim();
    });
    const body = parts.filter(Boolean).join(', ');
    return typeLabel ? `${typeLabel}: ${body}` : body || 'Omistus';
  }

  async updateCatalogValue(
    table:
      | 'ReleaseAudio'
      | 'ReleaseSubtitle'
      | 'ReleasePicture'
      | 'ReleaseRegion'
      | 'ReleasePublisher'
      | 'OwnershipType'
      | 'Ratio'
      | 'MediaRatio'
      | 'MediaContent'
      | 'ReleaseCondition'
      | 'MediaCondition',
    id: number,
    value: string
  ): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Arvo ei voi olla tyhjä.');
    }
    const { data: existing } = await getSupabase().from(table).select('Id, Value').ilike('Value', trimmed);
    const hit = ((existing as { Id: number; Value: string }[]) ?? []).find(
      (r) => r.Id !== id && r.Value.toLowerCase() === trimmed.toLowerCase()
    );
    if (hit) {
      throw new Error(`Arvo "${hit.Value}" on jo olemassa.`);
    }
    const { data, error } = await getSupabase()
      .from(table)
      .update({ Value: trimmed })
      .eq('Id', id)
      .select('Id')
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error('Arvon päivitys estetty tai riviä ei löytynyt.');
    }
  }

  async addCatalogValue(
    table:
      | 'ReleaseAudio'
      | 'ReleaseSubtitle'
      | 'ReleasePicture'
      | 'ReleaseRegion'
      | 'ReleasePublisher'
      | 'OwnershipType'
      | 'Ratio'
      | 'MediaRatio'
      | 'MediaContent'
      | 'ReleaseCondition'
      | 'MediaCondition',
    value: string
  ): Promise<number> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Arvo ei voi olla tyhjä.');
    }
    const { data: existing } = await getSupabase().from(table).select('Id, Value').ilike('Value', trimmed);
    const hit = ((existing as { Id: number; Value: string }[]) ?? []).find(
      (r) => r.Value.toLowerCase() === trimmed.toLowerCase()
    );
    if (hit) {
      throw new Error(`Arvo "${hit.Value}" on jo olemassa.`);
    }
    // Many lookup tables have no identity — allocate like PHP MAX(Id)+1 (skip 65535).
    const { data: maxRows, error: maxErr } = await getSupabase()
      .from(table)
      .select('Id')
      .neq('Id', 65535)
      .order('Id', { ascending: false })
      .limit(1);
    if (maxErr) {
      throw maxErr;
    }
    const nextId = (((maxRows as { Id: number }[]) ?? [])[0]?.Id ?? 0) + 1;
    const { data, error } = await getSupabase()
      .from(table)
      .insert({ Id: nextId, Value: trimmed })
      .select('Id')
      .single();
    if (error) {
      throw error;
    }
    return (data as { Id: number }).Id;
  }

  async isCatalogValueInUse(
    table:
      | 'ReleaseAudio'
      | 'ReleaseSubtitle'
      | 'ReleasePicture'
      | 'ReleaseRegion'
      | 'ReleasePublisher'
      | 'OwnershipType'
      | 'Ratio'
      | 'MediaRatio'
      | 'MediaContent'
      | 'ReleaseCondition'
      | 'MediaCondition',
    id: number
  ): Promise<boolean> {
    if (table === 'MediaContent') {
      const { count, error } = await getSupabase()
        .from('OwnershipFormat')
        .select('Id', { count: 'exact', head: true })
        .eq('ContentType', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }
    if (table === 'ReleaseAudio') {
      const { count, error } = await getSupabase()
        .from('OwnershipFormatAudio')
        .select('OwnershipFormatId', { count: 'exact', head: true })
        .eq('ReleaseAudioId', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }
    if (table === 'ReleaseSubtitle') {
      const { count, error } = await getSupabase()
        .from('OwnershipFormatSubtitle')
        .select('OwnershipFormatId', { count: 'exact', head: true })
        .eq('ReleaseSubtitleId', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }
    if (table === 'ReleasePicture') {
      const { count, error } = await getSupabase()
        .from('OwnershipFormat')
        .select('Id', { count: 'exact', head: true })
        .eq('ReleasePictureId', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }
    if (table === 'Ratio') {
      const { count, error } = await getSupabase()
        .from('Movie')
        .select('Id', { count: 'exact', head: true })
        .eq('RatioId', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }
    if (table === 'MediaRatio') {
      const { count, error } = await getSupabase()
        .from('OwnershipFormat')
        .select('Id', { count: 'exact', head: true })
        .eq('RatioId', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }
    if (table === 'ReleaseCondition') {
      const { count, error } = await getSupabase()
        .from('Ownership')
        .select('Id', { count: 'exact', head: true })
        .eq('ReleaseConditionId', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }
    if (table === 'MediaCondition') {
      const { count, error } = await getSupabase()
        .from('OwnershipFormat')
        .select('Id', { count: 'exact', head: true })
        .eq('MediaConditionId', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }
    const column =
      table === 'ReleasePublisher'
        ? 'ReleasePublisherId'
        : table === 'OwnershipType'
          ? 'OwnershipTypeId'
          : 'ReleaseRegionId';
    const { count, error } = await getSupabase()
      .from('Ownership')
      .select('Id', { count: 'exact', head: true })
      .eq(column, id);
    if (error) {
      throw error;
    }
    return (count ?? 0) > 0;
  }

  async deleteCatalogValue(
    table:
      | 'ReleaseAudio'
      | 'ReleaseSubtitle'
      | 'ReleasePicture'
      | 'ReleaseRegion'
      | 'ReleasePublisher'
      | 'OwnershipType'
      | 'Ratio'
      | 'MediaRatio'
      | 'MediaContent'
      | 'ReleaseCondition'
      | 'MediaCondition',
    id: number
  ): Promise<void> {
    if (await this.isCatalogValueInUse(table, id)) {
      throw new Error('Arvoa ei voi poistaa, koska se on käytössä.');
    }
    const { error } = await getSupabase().from(table).delete().eq('Id', id);
    if (error) {
      throw error;
    }
  }

  private async clearChildren(ownershipId: number): Promise<void> {
    const { data: movies, error } = await getSupabase()
      .from('OwnershipMovie')
      .select('Id')
      .eq('OwnershipId', ownershipId);
    if (error) {
      throw error;
    }
    const omIds = ((movies as { Id: number }[]) ?? []).map((m) => m.Id);
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
      await getSupabase().from('OwnershipMovie').delete().eq('OwnershipId', ownershipId);
    }
  }

  private async toSummary(o: Ownership, focusMovieId?: number): Promise<OwnershipSummary> {
    const { data: movies } = await getSupabase()
      .from('OwnershipMovie')
      .select('Id, MovieId, Sequence')
      .eq('OwnershipId', o.Id)
      .order('Sequence');
    let omRows = (movies as { Id: number; MovieId: number; Sequence: number }[]) ?? [];
    if (focusMovieId != null) {
      omRows = omRows.filter((m) => m.MovieId === focusMovieId);
    }
    const omIds = omRows.map((m) => m.Id);
    const movieIds = omRows.map((m) => m.MovieId);
    const formatsByOm = new Map<
      number,
      { mediaFormatId: number; contentType: number; ratioId: number | null }[]
    >();
    let ownershipFormatIds: number[] = [];
    if (omIds.length) {
      const { data: formats } = await getSupabase()
        .from('OwnershipFormat')
        .select('Id, OwnershipMovieId, MediaFormatId, ContentType, RatioId, Sequence')
        .in('OwnershipMovieId', omIds)
        .order('Sequence');
      for (const f of
        (formats as {
          Id: number;
          OwnershipMovieId: number;
          MediaFormatId: number;
          ContentType: number | null;
          RatioId: number | null;
          Sequence: number;
        }[]) ?? []) {
        ownershipFormatIds.push(f.Id);
        const list = formatsByOm.get(f.OwnershipMovieId) ?? [];
        list.push({
          mediaFormatId: f.MediaFormatId,
          contentType: f.ContentType != null && f.ContentType > 0 ? f.ContentType : OWNERSHIP_CONTENT_FEATURE,
          ratioId: f.RatioId != null && f.RatioId > 0 ? f.RatioId : null,
        });
        formatsByOm.set(f.OwnershipMovieId, list);
      }
    }
    const [
      { data: regions },
      { data: conditions },
      { data: publishers },
      { data: types },
      { data: titles },
      { data: versions },
      { data: subtitleCatalog },
      { data: audioCatalog },
      { data: formatSubtitles },
      { data: formatAudios },
      { data: mediaRatios },
      { data: movieRatios },
    ] = await Promise.all([
      getSupabase().from('ReleaseRegion').select('Id, Value'),
      getSupabase().from('ReleaseCondition').select('Id, Value'),
      getSupabase().from('ReleasePublisher').select('Id, Value'),
      getSupabase().from('OwnershipType').select('Id, Value'),
      movieIds.length
        ? getSupabase()
            .from('Movie')
            .select('Id, Title, TitleLanguageId, Year, VersionId, RatioId')
            .in('Id', movieIds)
        : Promise.resolve({
            data: [] as {
              Id: number;
              Title: string;
              TitleLanguageId: number | null;
              Year: number | null;
              VersionId: number | null;
              RatioId: number | null;
            }[],
          }),
      getSupabase().from('Version').select('Id, Value'),
      getSupabase().from('ReleaseSubtitle').select('Id, Value'),
      getSupabase().from('ReleaseAudio').select('Id, Value'),
      ownershipFormatIds.length
        ? getSupabase()
            .from('OwnershipFormatSubtitle')
            .select('OwnershipFormatId, ReleaseSubtitleId')
            .in('OwnershipFormatId', ownershipFormatIds)
        : Promise.resolve({
            data: [] as { OwnershipFormatId: number; ReleaseSubtitleId: number }[],
          }),
      ownershipFormatIds.length
        ? getSupabase()
            .from('OwnershipFormatAudio')
            .select('OwnershipFormatId, ReleaseAudioId')
            .in('OwnershipFormatId', ownershipFormatIds)
        : Promise.resolve({
            data: [] as { OwnershipFormatId: number; ReleaseAudioId: number }[],
          }),
      getSupabase().from('MediaRatio').select('Id, Value'),
      getSupabase().from('Ratio').select('Id, Value'),
    ]);
    const regionMap = new Map(
      ((regions as { Id: number; Value: string }[]) ?? []).map((r) => [
        r.Id,
        decodeEntities(String(r.Value)),
      ])
    );
    const conditionMap = new Map(
      ((conditions as { Id: number; Value: string }[]) ?? []).map((c) => [c.Id, c.Value])
    );
    const publisherMap = new Map(
      ((publishers as { Id: number; Value: string }[]) ?? []).map((p) => [p.Id, p.Value])
    );
    const typeMap = new Map(
      ((types as { Id: number; Value: string }[]) ?? []).map((t) => [t.Id, t.Value])
    );
    const versionMap = new Map(
      ((versions as { Id: number; Value: string }[]) ?? []).map((v) => [
        v.Id,
        decodeEntities(String(v.Value)),
      ])
    );
    const titleMap = new Map(
      (
        (titles as {
          Id: number;
          Title: string;
          TitleLanguageId: number | null;
          Year: number | null;
          VersionId: number | null;
          RatioId: number | null;
        }[]) ?? []
      ).map((t) => [t.Id, t])
    );
    const mediaRatioMap = new Map(
      ((mediaRatios as { Id: number; Value: string }[]) ?? []).map((r) => [
        r.Id,
        decodeEntities(String(r.Value)),
      ])
    );
    const movieRatioMap = new Map(
      ((movieRatios as { Id: number; Value: string }[]) ?? []).map((r) => [
        r.Id,
        decodeEntities(String(r.Value)),
      ])
    );
    const summaryMovies: OwnershipSummaryMovie[] = omRows.map((om) => {
      const meta = titleMap.get(om.MovieId);
      const movieRatioRaw =
        meta?.RatioId != null && meta.RatioId > 0 ? movieRatioMap.get(meta.RatioId) ?? null : null;
      const movieRatioLabel = movieRatioRaw && movieRatioRaw !== '-' ? movieRatioRaw : null;
      const sortedFormats = sortOwnershipFormats(formatsByOm.get(om.Id) ?? []);
      const seen = new Set<number>();
      const formats: OwnershipSummaryFormat[] = [];
      for (const f of sortedFormats) {
        if (seen.has(f.mediaFormatId)) {
          continue;
        }
        seen.add(f.mediaFormatId);
        const label = mediaFormatShort(f.mediaFormatId) || String(f.mediaFormatId);
        const mediaRatioRaw =
          f.mediaFormatId === 2 && f.ratioId != null ? mediaRatioMap.get(f.ratioId) ?? null : null;
        const mediaRatioLabel = mediaRatioRaw && mediaRatioRaw !== '-' ? mediaRatioRaw : null;
        const isAlkuperainen =
          !!mediaRatioLabel && mediaRatioLabel.trim().toLowerCase() === 'alkuperäinen';
        const matchesMovieRatio =
          !!mediaRatioLabel &&
          !!movieRatioLabel &&
          mediaRatioLabel.trim().toLowerCase() === movieRatioLabel.trim().toLowerCase();
        const ratioMatchesOriginal = isAlkuperainen || matchesMovieRatio;
        formats.push({
          mediaFormatId: f.mediaFormatId,
          label,
          ratioLabel: isAlkuperainen
            ? movieRatioLabel || mediaRatioLabel
            : mediaRatioLabel,
          ratioMatchesOriginal,
        });
      }
      const versionRaw =
        meta?.VersionId != null && meta.VersionId > 0 ? versionMap.get(meta.VersionId) : null;
      return {
        Id: om.MovieId,
        Title: meta?.Title ?? `#${om.MovieId}`,
        TitleLanguageId: meta?.TitleLanguageId ?? null,
        Year: meta?.Year ?? null,
        VersionLabel: versionRaw && versionRaw !== '-' ? versionRaw : null,
        formats,
        formatIds: formats.map((f) => f.mediaFormatId),
        formatLabels: formats.map((f) => f.label),
      };
    });

    const finnishSubIds = new Set<number>();
    const englishSubIds = new Set<number>();
    for (const row of (subtitleCatalog as { Id: number; Value: string }[]) ?? []) {
      const v = String(row.Value).trim().toLowerCase();
      if (v === 'finnish' || v === 'suomi') {
        finnishSubIds.add(row.Id);
      } else if (v === 'english' || v === 'englanti') {
        englishSubIds.add(row.Id);
      }
    }
    let hasFiSub = false;
    let hasEnSub = false;
    for (const link of
      (formatSubtitles as { OwnershipFormatId: number; ReleaseSubtitleId: number }[]) ?? []) {
      if (finnishSubIds.has(link.ReleaseSubtitleId)) {
        hasFiSub = true;
      }
      if (englishSubIds.has(link.ReleaseSubtitleId)) {
        hasEnSub = true;
      }
    }
    const finnishAudioIds = new Set<number>();
    for (const row of (audioCatalog as { Id: number; Value: string }[]) ?? []) {
      const v = String(row.Value).trim().toLowerCase();
      if (v === 'finnish' || v === 'suomi') {
        finnishAudioIds.add(row.Id);
      }
    }
    let hasFiAudio = false;
    for (const link of
      (formatAudios as { OwnershipFormatId: number; ReleaseAudioId: number }[]) ?? []) {
      if (finnishAudioIds.has(link.ReleaseAudioId)) {
        hasFiAudio = true;
        break;
      }
    }
    const regionRaw =
      o.ReleaseRegionId != null
        ? String(
            ((regions as { Id: number; Value: string }[]) ?? []).find((r) => r.Id === o.ReleaseRegionId)
              ?.Value ?? ''
          )
            .trim()
            .toLowerCase()
        : '';
    const regionImpliesSubs =
      regionRaw === 'suomi' ||
      regionRaw === 'nordic' ||
      regionRaw === 'pohjoismaat';
    // FI if Finnish present; otherwise EN if English present; hide for Suomi/Nordic releases.
    const subtitleLabels =
      regionImpliesSubs ? [] : hasFiSub ? ['FI'] : hasEnSub ? ['EN'] : [];
    const audioLabels = hasFiAudio ? ['Puhumme suomea'] : [];

    return {
      Id: o.Id,
      Name: o.Name,
      Notes: o.Notes,
      ReleaseRegionId: o.ReleaseRegionId,
      ReleaseConditionId: o.ReleaseConditionId,
      ReleasePublisherId: o.ReleasePublisherId,
      OwnershipTypeId: o.OwnershipTypeId,
      regionLabel: o.ReleaseRegionId != null ? regionMap.get(o.ReleaseRegionId) ?? '' : '',
      conditionLabel:
        o.ReleaseConditionId != null ? conditionMap.get(o.ReleaseConditionId) ?? '' : '',
      publisherLabel:
        o.ReleasePublisherId != null ? publisherMap.get(o.ReleasePublisherId) ?? '' : '',
      typeLabel: o.OwnershipTypeId != null ? typeMap.get(o.OwnershipTypeId) ?? '' : '',
      subtitleLabels,
      audioLabels,
      movieCount: omIds.length,
      movies: summaryMovies,
    };
  }
}

/** Short codes for tight UI (title suffixes, list chips). */
export function mediaFormatShort(formatId: number | null | undefined): string {
  const map: Record<number, string> = {
    1: 'BD',
    2: 'DVD',
    3: 'HD-DVD',
    4: 'LD',
    5: 'VHS',
    6: 'UHD',
    7: '3D-BD',
    11: 'DC',
    12: 'UMD',
  };
  if (!formatId) {
    return '';
  }
  return map[formatId] ?? '';
}

/** Full names for ownership edit and other roomy UI. */
export function mediaFormatLong(formatId: number | null | undefined): string {
  const map: Record<number, string> = {
    1: 'Blu-ray',
    2: 'DVD',
    3: 'HD DVD',
    4: 'LaserDisc',
    5: 'VHS',
    6: 'Ultra HD 4K',
    7: '3D Blu-ray',
    11: 'Digital Copy',
    12: 'UMD',
  };
  if (!formatId) {
    return '';
  }
  return map[formatId] ?? mediaFormatShort(formatId);
}

export function newFormatKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isCassette(mediaFormatId: number): boolean {
  return mediaFormatId === 5;
}

export function isDigitalCopy(mediaFormatId: number): boolean {
  return mediaFormatId === 11;
}

export function isDisc(mediaFormatId: number): boolean {
  // Includes Digital Copy (11): may be a physical disc or code-only.
  return [1, 2, 3, 4, 6, 7, 11, 12].includes(mediaFormatId);
}

/** Whether media condition should be collected for this format draft. */
export function needsMediaCondition(format: {
  mediaFormatId: number;
  digitalHasDisc?: boolean;
}): boolean {
  if (isCassette(format.mediaFormatId)) {
    return true;
  }
  if (!isDisc(format.mediaFormatId)) {
    return false;
  }
  if (isDigitalCopy(format.mediaFormatId)) {
    return format.digitalHasDisc !== false;
  }
  return true;
}

export function mediaFormatDiscColor(formatId: number): string {
  const map: Record<number, string> = {
    1: '#1e5a9e',
    2: '#c4a035',
    3: '#6b4c9a',
    4: '#888',
    6: '#2d6a4f',
    7: '#0d7377',
    11: '#1f4b7a',
    12: '#555',
  };
  return map[formatId] ?? '#444';
}

/** Blu-ray / Ultra HD always use fixed media aspect ratio "Alkuperäinen". */
export function isFixedOriginalRatioFormat(mediaFormatId: number): boolean {
  return mediaFormatId === 1 || mediaFormatId === 6 || mediaFormatId === 7;
}

/** OwnershipFormat.Sequence values >= this mark a shared physical medium group. */
export const MEDIA_GROUP_ID_BASE = 1000;

export function emptyOwnershipFormat(
  mediaFormatId: number,
  opts?: { ratioId?: number | null }
): OwnershipFormatDraft {
  return {
    key: newFormatKey(),
    mediaFormatId,
    ratioId: opts?.ratioId ?? null,
    contentType: OWNERSHIP_CONTENT_FEATURE,
    mediaConditionId: null,
    digitalHasDisc: isDigitalCopy(mediaFormatId) ? true : undefined,
    audioIds: [],
    subtitleIds: [],
    linkedMovieIds: [],
  };
}

function ownershipFormatSignature(f: OwnershipFormatDraft): string {
  const aud = [...(f.audioIds ?? [])].sort((a, b) => a - b).join(',');
  const sub = [...(f.subtitleIds ?? [])].sort((a, b) => a - b).join(',');
  return [
    f.mediaFormatId,
    f.contentType,
    f.ratioId ?? 0,
    f.mediaConditionId ?? 0,
    f.digitalHasDisc === false ? 0 : 1,
    aud,
    sub,
  ].join('|');
}

/**
 * Same title + year → likely theatrical / director's cut of one film.
 * Used as fallback merge for older rows without shared mediaGroupId.
 */
function isSameFilmCut(a: OwnershipMovieDraft, b: OwnershipMovieDraft): boolean {
  if (a.movieId === b.movieId) {
    return false;
  }
  const yearA = a.year ?? 0;
  const yearB = b.year ?? 0;
  if (yearA <= 0 || yearB <= 0 || yearA !== yearB) {
    return false;
  }
  const keyA = titleSortKey(a.title, a.titleLanguageId);
  const keyB = titleSortKey(b.title, b.titleLanguageId);
  return keyA.length > 0 && keyA === keyB;
}

/**
 * Merge formats that share a physical medium:
 * 1) same mediaGroupId (persisted Sequence) — cuts or different titles on one disc
 * 2) fallback: identical signature + same-film cut (legacy data)
 */
export function mergeSharedOwnershipFormats(movies: OwnershipMovieDraft[]): void {
  // Pass 1: shared mediaGroupId (>= 1000) across any titles on one disc.
  // Values below 1000 are legacy per-movie Sequence (1..n) and must not merge collections.
  const byGroup = new Map<number, { host: OwnershipMovieDraft; format: OwnershipFormatDraft }>();
  for (const movie of movies) {
    for (let fi = movie.formats.length - 1; fi >= 0; fi--) {
      const format = movie.formats[fi];
      const groupId = format.mediaGroupId ?? 0;
      if (groupId < MEDIA_GROUP_ID_BASE) {
        continue;
      }
      const existing = byGroup.get(groupId);
      if (!existing) {
        format.linkedMovieIds = format.linkedMovieIds ?? [];
        byGroup.set(groupId, { host: movie, format });
        continue;
      }
      if (existing.host.movieId === movie.movieId) {
        continue;
      }
      if (!existing.format.linkedMovieIds) {
        existing.format.linkedMovieIds = [];
      }
      if (!existing.format.linkedMovieIds.includes(movie.movieId)) {
        existing.format.linkedMovieIds.push(movie.movieId);
      }
      movie.formats.splice(fi, 1);
    }
  }

  // Pass 2: legacy same-film cuts with matching signatures (no shared group yet).
  for (let i = 0; i < movies.length; i++) {
    const host = movies[i];
    for (const format of host.formats) {
      format.linkedMovieIds = format.linkedMovieIds ?? [];
      const sig = ownershipFormatSignature(format);
      for (let j = i + 1; j < movies.length; j++) {
        const other = movies[j];
        if (!isSameFilmCut(host, other)) {
          continue;
        }
        const idx = other.formats.findIndex((f) => ownershipFormatSignature(f) === sig);
        if (idx < 0) {
          continue;
        }
        if (!format.linkedMovieIds.includes(other.movieId)) {
          format.linkedMovieIds.push(other.movieId);
        }
        other.formats.splice(idx, 1);
      }
    }
  }
}

/** Assign unique mediaGroupIds, expand links, drop empty satellites. */
export function prepareOwnershipMoviesForSave(movies: OwnershipMovieDraft[]): OwnershipMovieDraft[] {
  const linkedIds = new Set<number>();
  for (const m of movies) {
    for (const f of m.formats) {
      for (const id of f.linkedMovieIds ?? []) {
        if (id > 0) {
          linkedIds.add(id);
        }
      }
    }
  }
  const kept = movies.filter(
    (m) => m.formats.length > 0 || linkedIds.has(m.movieId)
  );
  return expandLinkedOwnershipFormats(kept).filter((m) => m.formats.length > 0);
}

/** Copy shared media onto every linked movie; keep a shared mediaGroupId for reload. */
export function expandLinkedOwnershipFormats(movies: OwnershipMovieDraft[]): OwnershipMovieDraft[] {
  const cloned: OwnershipMovieDraft[] = movies.map((m) => ({
    ...m,
    formats: m.formats.map((f) => ({
      ...f,
      audioIds: [...(f.audioIds ?? [])],
      subtitleIds: [...(f.subtitleIds ?? [])],
      linkedMovieIds: [...(f.linkedMovieIds ?? [])],
    })),
  }));

  let nextGroup = Math.max(
    MEDIA_GROUP_ID_BASE,
    ...cloned.flatMap((m) => m.formats.map((f) => f.mediaGroupId ?? 0)),
    MEDIA_GROUP_ID_BASE - 1
  ) + 1;
  for (const m of cloned) {
    for (const f of m.formats) {
      if (f.mediaGroupId == null || f.mediaGroupId < MEDIA_GROUP_ID_BASE) {
        f.mediaGroupId = nextGroup++;
      }
    }
  }

  const hostSnapshots = cloned.map((host) => ({
    movieId: host.movieId,
    formats: host.formats.map((f) => ({
      format: f,
      links: [...(f.linkedMovieIds ?? [])],
    })),
  }));

  for (const host of hostSnapshots) {
    for (const { format, links } of host.formats) {
      format.linkedMovieIds = [];
      for (const movieId of links) {
        if (movieId === host.movieId) {
          continue;
        }
        const target = cloned.find((m) => m.movieId === movieId);
        if (!target) {
          throw new Error(
            `Elokuvaa ${movieId} ei löytynyt omistuksesta — rastita elokuva medialle uudelleen ja tallenna.`
          );
        }
        const groupId = format.mediaGroupId!;
        const existing = target.formats.find((f) => f.mediaGroupId === groupId);
        if (existing) {
          continue;
        }
        const sig = ownershipFormatSignature(format);
        if (target.formats.some((f) => ownershipFormatSignature(f) === sig && !f.mediaGroupId)) {
          const hit = target.formats.find((f) => ownershipFormatSignature(f) === sig)!;
          hit.mediaGroupId = groupId;
          continue;
        }
        target.formats.push({
          key: newFormatKey(),
          mediaFormatId: format.mediaFormatId,
          ratioId: format.ratioId,
          contentType: format.contentType,
          mediaConditionId: format.mediaConditionId,
          digitalHasDisc: format.digitalHasDisc,
          audioIds: [...(format.audioIds ?? [])],
          subtitleIds: [...(format.subtitleIds ?? [])],
          linkedMovieIds: [],
          mediaGroupId: groupId,
        });
      }
    }
  }
  return cloned;
}

/** Clear Finnish labels for release region codes (and already-migrated names). */
export function releaseRegionLabel(value: string | number | null | undefined): string {
  if (value == null || value === '') {
    return '';
  }
  const key = String(value);
  const map: Record<string, string> = {
    DE: 'Saksa',
    FR: 'Ranska',
    JP: 'Japani',
    UK: 'Britannia',
    US: 'Yhdysvallat',
    Nordic: 'Pohjoismaat',
  };
  return map[key] ?? key;
}
