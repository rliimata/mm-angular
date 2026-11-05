import { Injectable } from '@angular/core';
import { UserLink } from '../core/models';
import { getSupabase } from '../core/supabase.client';

@Injectable({ providedIn: 'root' })
export class UserLinkService {
  async getMine(movieId: number, userId: number): Promise<UserLink | null> {
    const { data, error } = await getSupabase()
      .from('UserLink')
      .select('MovieId, UserId, ScoreId, Text')
      .eq('MovieId', movieId)
      .eq('UserId', userId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data as UserLink | null;
  }

  async save(link: UserLink): Promise<void> {
    const { error: delError } = await getSupabase()
      .from('UserLink')
      .delete()
      .eq('MovieId', link.MovieId)
      .eq('UserId', link.UserId);
    if (delError) {
      throw delError;
    }

    const { error } = await getSupabase().from('UserLink').insert({
      MovieId: link.MovieId,
      UserId: link.UserId,
      ScoreId: link.ScoreId,
      Text: link.Text ?? '',
    });
    if (error) {
      throw error;
    }
  }

  async remove(movieId: number, userId: number): Promise<void> {
    const { error } = await getSupabase()
      .from('UserLink')
      .delete()
      .eq('MovieId', movieId)
      .eq('UserId', userId);
    if (error) {
      throw error;
    }
  }

  /** Other users' reviews for a movie (score > 0 or text). */
  async listForMovie(movieId: number): Promise<
    { UserId: number; ScoreId: number | null; Text: string | null; Name: string }[]
  > {
    const { data, error } = await getSupabase()
      .from('UserLink')
      .select('UserId, ScoreId, Text')
      .eq('MovieId', movieId);
    if (error) {
      throw error;
    }
    const rows = (data as UserLink[]) ?? [];
    if (!rows.length) {
      return [];
    }
    const ids = [...new Set(rows.map((r) => r.UserId))];
    const { data: users } = await getSupabase()
      .from('Profile')
      .select('Id, FirstName, LastName')
      .in('Id', ids);
    const map = new Map(
      ((users as { Id: number; FirstName: string; LastName: string }[]) ?? []).map((u) => [
        u.Id,
        [u.FirstName, u.LastName].filter(Boolean).join(' ') || `User ${u.Id}`,
      ])
    );
    return rows.map((r) => ({
      ...r,
      Name: map.get(r.UserId) ?? `User ${r.UserId}`,
    }));
  }
}
