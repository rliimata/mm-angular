import { Injectable } from '@angular/core';
import { decodeEntities, isPlaceholderLookup } from '../core/format.util';
import { LookupRow } from '../core/models';
import { getSupabase } from '../core/supabase.client';

type LookupTable =
  | 'Version'
  | 'Ratio'
  | 'Distribution'
  | 'TitleLanguage'
  | 'Currency'
  | 'Category'
  | 'Country'
  | 'Sound'
  | 'Score'
  | 'MediaFormat'
  | 'ReleaseAudio'
  | 'ReleaseSubtitle'
  | 'ReleaseRegion'
  | 'ReleasePicture'
  | 'ReleaseCondition'
  | 'MediaCondition'
  | 'MediaRatio'
  | 'MediaContent'
  | 'ReleasePublisher'
  | 'OwnershipType'
  | 'AgeRating'
  | 'Award'
  | 'MovieRelation'
  | 'PersonRelation'
  | 'DeathReason'
  | 'Role';

@Injectable({ providedIn: 'root' })
export class LookupService {
  private readonly cache = new Map<string, LookupRow[]>();

  async get(table: LookupTable): Promise<LookupRow[]> {
    const hit = this.cache.get(table);
    if (hit) {
      return hit;
    }
    const { data, error } = await getSupabase().from(table).select('Id, Value').order('Id');
    if (error) {
      throw error;
    }
    let rows = ((data as LookupRow[]) ?? [])
      .map((r) => ({
        ...r,
        Value: typeof r.Value === 'string' ? decodeEntities(r.Value) : r.Value,
      }))
      .filter((r) => (keepsZeroId(table) || r.Id !== 0) && !isPlaceholderLookup(r.Value));
    // Keep natural Id order for lists with an intentional sequence.
    if (!preservesIdOrder(table)) {
      rows = [...rows].sort((a, b) =>
        String(a.Value).localeCompare(String(b.Value), 'fi', { sensitivity: 'base' })
      );
    }
    this.cache.set(table, rows);
    return rows;
  }

  label(rows: LookupRow[], id: number | null | undefined): string {
    if (id == null) {
      return '';
    }
    const row = rows.find((r) => r.Id === id);
    const v = row?.Value;
    if (v == null || isPlaceholderLookup(v)) {
      return '';
    }
    return decodeEntities(String(v));
  }

  /** Invalidate cache after inserting catalog values (ReleaseAudio/Subtitle). */
  invalidate(table: LookupTable): void {
    this.cache.delete(table);
  }
}

/** Distribution Id 0 = Elokuvateatteri (real value, not a placeholder). */
function keepsZeroId(table: LookupTable): boolean {
  return table === 'Distribution';
}

function preservesIdOrder(table: LookupTable): boolean {
  return (
    table === 'Role' ||
    table === 'Distribution' ||
    table === 'Score' ||
    table === 'AgeRating' ||
    table === 'MediaFormat' ||
    table === 'ReleaseCondition' ||
    table === 'MediaCondition' ||
    table === 'MediaContent'
  );
}
