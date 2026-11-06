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

/** Physical discs first, Digital Copy last; Feature before Bonus Disc. */
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

/** List label with swapped articles; keeps type prefix when present. */
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
  const body = movies.join(', ');
  const type = o.typeLabel?.trim();
  return type ? `${type}: ${body}` : body;
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
    const { data, error } = await getSupabase()
      .from('Ownership')
      .select(
        'Id, UserId, Name, Notes, ReleaseRegionId, ReleaseConditionId, ReleasePublisherId, OwnershipTypeId'
      )
      .eq('UserId', userId);
    if (error) {
      throw error;
    }
    const summaries = await Promise.all(((data as Ownership[]) ?? []).map((o) => this.toSummary(o)));
    summaries.sort(compareOwnershipSummariesByTitle);
    const from = (page - 1) * pageSize;
    return {
      rows: summaries.slice(from, from + pageSize),
      count: summaries.length,
    };
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
      const labels = formatIds.map((id) => mediaFormatShort(id)).filter(Boolean);
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
    if (!draft.movies.length) {
      throw new Error('Omistuksessa pitää olla vähintään yksi elokuva.');
    }
    for (const m of draft.movies) {
      if (!m.formats.length) {
        throw new Error(`Elokuvalla "${m.title}" pitää olla vähintään yksi media.`);
      }
      for (const f of m.formats) {
        if (f.contentType !== OWNERSHIP_CONTENT_FEATURE && f.contentType !== OWNERSHIP_CONTENT_BONUS) {
          throw new Error(`Medialle "${m.title}" pitää valita sisältö (Feature tai Bonus Disc).`);
        }
      }
    }

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
            Sequence: fi + 1,
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
    const { data, error } = await getSupabase().from(table).insert({ Value: trimmed }).select('Id').single();
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
  };
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
