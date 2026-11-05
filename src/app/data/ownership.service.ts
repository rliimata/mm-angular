import { Injectable } from '@angular/core';
import { titleWithYear } from '../core/format.util';
import { Ownership, OwnershipDraft, OwnershipFormatDraft, OwnershipMovieDraft } from '../core/models';
import { getSupabase } from '../core/supabase.client';

export interface OwnershipSummaryMovie {
  Id: number;
  Title: string;
  TitleLanguageId: number | null;
  Year: number | null;
  formatLabels: string[];
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
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await getSupabase()
      .from('Ownership')
      .select(
        'Id, UserId, Name, Notes, ReleaseRegionId, ReleaseConditionId, ReleasePublisherId, OwnershipTypeId',
        { count: 'exact' }
      )
      .eq('UserId', userId)
      .order('Name')
      .range(from, to);
    if (error) {
      throw error;
    }
    const rows = (data as Ownership[]) ?? [];
    return {
      rows: await Promise.all(rows.map((o) => this.toSummary(o))),
      count: count ?? rows.length,
    };
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

    return Promise.all(rows.map((o) => this.toSummary(o)));
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
      { Title: string; TitleLanguageId: number | null; Year: number | null; RatioId: number | null }
    >();
    if (movieIds.length) {
      const { data: titles } = await getSupabase()
        .from('Movie')
        .select('Id, Title, TitleLanguageId, Year, RatioId')
        .in('Id', movieIds);
      for (const t of
        (titles as {
          Id: number;
          Title: string;
          TitleLanguageId: number | null;
          Year: number | null;
          RatioId: number | null;
        }[]) ?? []) {
        titleMap.set(t.Id, t);
      }
    }

    const draftMovies: OwnershipMovieDraft[] = [];
    for (const om of omRows) {
      const { data: formats, error: fErr } = await getSupabase()
        .from('OwnershipFormat')
        .select('Id, MediaFormatId, Sequence, RatioId, Anamorphic')
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
          Anamorphic: boolean | null;
        }[]) ?? []) {
        const { data: subs } = await getSupabase()
          .from('OwnershipFormatSubtitle')
          .select('ReleaseSubtitleId')
          .eq('OwnershipFormatId', f.Id);
        formatDrafts.push({
          mediaFormatId: f.MediaFormatId,
          ratioId: f.RatioId != null && f.RatioId > 0 ? f.RatioId : null,
          anamorphic: !!f.Anamorphic,
          subtitleIds: ((subs as { ReleaseSubtitleId: number }[]) ?? []).map((s) => s.ReleaseSubtitleId),
        });
      }

      const meta = titleMap.get(om.MovieId);
      draftMovies.push({
        movieId: om.MovieId,
        title: meta?.Title ?? `#${om.MovieId}`,
        titleLanguageId: meta?.TitleLanguageId ?? null,
        year: meta?.Year ?? null,
        ratioId: meta?.RatioId != null && meta.RatioId > 0 ? meta.RatioId : null,
        formatIds: formatDrafts.map((f) => f.mediaFormatId),
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
        throw new Error(`Elokuvalla "${m.title}" pitää olla vähintään yksi formaatti.`);
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

      for (let fi = 0; fi < m.formats.length; fi++) {
        const f = m.formats[fi];
        const { data: fData, error: fErr } = await getSupabase()
          .from('OwnershipFormat')
          .insert({
            OwnershipMovieId: omId,
            MediaFormatId: f.mediaFormatId,
            Sequence: fi + 1,
            RatioId: fk(f.ratioId),
            Anamorphic: !!f.anamorphic,
          })
          .select('Id')
          .single();
        if (fErr) {
          throw fErr;
        }
        const formatId = (fData as { Id: number }).Id;
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
            subtitleIds: [...f.subtitleIds],
          })),
          formatIds: [...movie.formatIds],
        });
        continue;
      }
      for (const format of movie.formats) {
        const same = existing.formats.find((f) => f.mediaFormatId === format.mediaFormatId);
        if (!same) {
          existing.formats.push({
            ...format,
            subtitleIds: [...format.subtitleIds],
          });
        } else {
          same.subtitleIds = [...new Set([...same.subtitleIds, ...format.subtitleIds])];
          if (!same.ratioId && format.ratioId) {
            same.ratioId = format.ratioId;
          }
          same.anamorphic = same.anamorphic || format.anamorphic;
        }
      }
      existing.formatIds = existing.formats.map((f) => f.mediaFormatId);
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
      const title = titleWithYear(m.title, m.titleLanguageId, m.year) || m.title;
      const formats = m.formats
        .map((f) => mediaFormatShort(f.mediaFormatId) || String(f.mediaFormatId))
        .filter(Boolean)
        .join('+');
      return `${title}${formats ? ` ${formats}` : ''}`.trim();
    });
    const body = parts.filter(Boolean).join(', ');
    return typeLabel ? `${typeLabel}: ${body}` : body || 'Omistus';
  }

  async addCatalogValue(
    table:
      | 'ReleaseAudio'
      | 'ReleaseSubtitle'
      | 'ReleasePicture'
      | 'ReleaseRegion'
      | 'ReleasePublisher'
      | 'OwnershipType'
      | 'Ratio',
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
      | 'Ratio',
    id: number
  ): Promise<boolean> {
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
      const [{ count: fmtCount, error: fmtErr }, { count: movieCount, error: movieErr }] =
        await Promise.all([
          getSupabase()
            .from('OwnershipFormat')
            .select('Id', { count: 'exact', head: true })
            .eq('RatioId', id),
          getSupabase().from('Movie').select('Id', { count: 'exact', head: true }).eq('RatioId', id),
        ]);
      if (fmtErr) {
        throw fmtErr;
      }
      if (movieErr) {
        throw movieErr;
      }
      return (fmtCount ?? 0) > 0 || (movieCount ?? 0) > 0;
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
      | 'Ratio',
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

  private async toSummary(o: Ownership): Promise<OwnershipSummary> {
    const { data: movies } = await getSupabase()
      .from('OwnershipMovie')
      .select('Id, MovieId, Sequence')
      .eq('OwnershipId', o.Id)
      .order('Sequence');
    const omRows = (movies as { Id: number; MovieId: number; Sequence: number }[]) ?? [];
    const omIds = omRows.map((m) => m.Id);
    const movieIds = omRows.map((m) => m.MovieId);
    const formatsByOm = new Map<number, number[]>();
    if (omIds.length) {
      const { data: formats } = await getSupabase()
        .from('OwnershipFormat')
        .select('OwnershipMovieId, MediaFormatId, Sequence')
        .in('OwnershipMovieId', omIds)
        .order('Sequence');
      for (const f of
        (formats as { OwnershipMovieId: number; MediaFormatId: number; Sequence: number }[]) ?? []) {
        const list = formatsByOm.get(f.OwnershipMovieId) ?? [];
        if (!list.includes(f.MediaFormatId)) {
          list.push(f.MediaFormatId);
        }
        formatsByOm.set(f.OwnershipMovieId, list);
      }
    }
    const [
      { data: regions },
      { data: conditions },
      { data: publishers },
      { data: types },
      { data: titles },
    ] = await Promise.all([
      getSupabase().from('ReleaseRegion').select('Id, Value'),
      getSupabase().from('ReleaseCondition').select('Id, Value'),
      getSupabase().from('ReleasePublisher').select('Id, Value'),
      getSupabase().from('OwnershipType').select('Id, Value'),
      movieIds.length
        ? getSupabase()
            .from('Movie')
            .select('Id, Title, TitleLanguageId, Year')
            .in('Id', movieIds)
        : Promise.resolve({
            data: [] as {
              Id: number;
              Title: string;
              TitleLanguageId: number | null;
              Year: number | null;
            }[],
          }),
    ]);
    const regionMap = new Map(
      ((regions as { Id: number; Value: string }[]) ?? []).map((r) => [
        r.Id,
        releaseRegionLabel(r.Value),
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
    const titleMap = new Map(
      (
        (titles as {
          Id: number;
          Title: string;
          TitleLanguageId: number | null;
          Year: number | null;
        }[]) ?? []
      ).map((t) => [t.Id, t])
    );
    const summaryMovies: OwnershipSummaryMovie[] = omRows.map((om) => {
      const meta = titleMap.get(om.MovieId);
      const formatIds = formatsByOm.get(om.Id) ?? [];
      return {
        Id: om.MovieId,
        Title: meta?.Title ?? `#${om.MovieId}`,
        TitleLanguageId: meta?.TitleLanguageId ?? null,
        Year: meta?.Year ?? null,
        formatLabels: formatIds.map((id) => mediaFormatShort(id) || String(id)),
      };
    });
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
