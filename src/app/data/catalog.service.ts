import { Injectable } from '@angular/core';
import { getSupabase } from '../core/supabase.client';

export type CatalogTable =
  | 'Category'
  | 'Country'
  | 'Sound'
  | 'Version'
  | 'Ratio'
  | 'Distribution'
  | 'AgeRating'
  | 'DeathReason'
  | 'TitleLanguage';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  async addValue(table: CatalogTable, value: string): Promise<number> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Arvo ei voi olla tyhjä.');
    }
    if (table === 'AgeRating') {
      const n = Number(trimmed.replace(/\D+/g, ''));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error('Ikärajan on oltava positiivinen luku.');
      }
      const { data: existing } = await getSupabase()
        .from('AgeRating')
        .select('Id, Value')
        .eq('Value', n)
        .maybeSingle();
      if (existing) {
        throw new Error(`Ikäraja ${n} on jo olemassa.`);
      }
      const { data, error } = await getSupabase()
        .from('AgeRating')
        .insert({ Value: n })
        .select('Id')
        .single();
      if (error) {
        throw error;
      }
      return (data as { Id: number }).Id;
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

  async isInUse(table: CatalogTable, id: number): Promise<boolean> {
    if (table === 'AgeRating') {
      const { data: row } = await getSupabase().from('AgeRating').select('Value').eq('Id', id).maybeSingle();
      const age = (row as { Value: number } | null)?.Value;
      if (age == null) {
        return false;
      }
      const { count, error } = await getSupabase()
        .from('Movie')
        .select('Id', { count: 'exact', head: true })
        .eq('Age', age);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }

    if (table === 'Country') {
      const checks = [
        { table: 'CountryLink', column: 'CountryId' },
        { table: 'Person', column: 'BirthCountryId' },
        { table: 'Person', column: 'DeathCountryId' },
      ] as const;
      for (const cfg of checks) {
        const { count, error } = await getSupabase()
          .from(cfg.table)
          .select(cfg.column, { count: 'exact', head: true })
          .eq(cfg.column, id);
        if (error) {
          throw error;
        }
        if ((count ?? 0) > 0) {
          return true;
        }
      }
      return false;
    }

    if (table === 'DeathReason') {
      const { count, error } = await getSupabase()
        .from('Person')
        .select('DeathReasonId', { count: 'exact', head: true })
        .eq('DeathReasonId', id);
      if (error) {
        throw error;
      }
      return (count ?? 0) > 0;
    }

    if (table === 'TitleLanguage') {
      for (const cfg of [
        { table: 'Movie', column: 'TitleLanguageId' },
        { table: 'Aka', column: 'TitleLanguageId' },
      ] as const) {
        const { count, error } = await getSupabase()
          .from(cfg.table)
          .select(cfg.column, { count: 'exact', head: true })
          .eq(cfg.column, id);
        if (error) {
          throw error;
        }
        if ((count ?? 0) > 0) {
          return true;
        }
      }
      return false;
    }

    const checks: Record<
      Exclude<CatalogTable, 'AgeRating' | 'Country' | 'DeathReason' | 'TitleLanguage'>,
      { table: string; column: string }
    > = {
      Category: { table: 'CategoryLink', column: 'CategoryId' },
      Sound: { table: 'SoundLink', column: 'SoundId' },
      Version: { table: 'Movie', column: 'VersionId' },
      Ratio: { table: 'Movie', column: 'RatioId' },
      Distribution: { table: 'Movie', column: 'DistributionId' },
    };
    const cfg = checks[table];
    const { count, error } = await getSupabase()
      .from(cfg.table)
      .select(cfg.column, { count: 'exact', head: true })
      .eq(cfg.column, id);
    if (error) {
      throw error;
    }
    return (count ?? 0) > 0;
  }

  async updateValue(table: CatalogTable, id: number, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Arvo ei voi olla tyhjä.');
    }
    if (table === 'AgeRating') {
      const n = Number(trimmed.replace(/\D+/g, ''));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error('Ikärajan on oltava positiivinen luku.');
      }
      const { data: existing } = await getSupabase()
        .from('AgeRating')
        .select('Id, Value')
        .eq('Value', n)
        .neq('Id', id)
        .maybeSingle();
      if (existing) {
        throw new Error(`Ikäraja ${n} on jo olemassa.`);
      }
      const { data, error } = await getSupabase()
        .from('AgeRating')
        .update({ Value: n })
        .eq('Id', id)
        .select('Id')
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        throw new Error('Arvon päivitys estetty tai riviä ei löytynyt.');
      }
      return;
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

  async deleteValue(table: CatalogTable, id: number): Promise<void> {
    if (await this.isInUse(table, id)) {
      throw new Error('Arvoa ei voi poistaa, koska se on käytössä.');
    }
    const { error } = await getSupabase().from(table).delete().eq('Id', id);
    if (error) {
      throw error;
    }
  }
}
