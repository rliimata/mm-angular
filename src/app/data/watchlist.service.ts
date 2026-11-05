import { Injectable } from '@angular/core';
import { getSupabase } from '../core/supabase.client';

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  async isOnWatchlist(movieId: number, userId: number): Promise<boolean> {
    const { data, error } = await getSupabase()
      .from('Watchlist')
      .select('MovieId')
      .eq('MovieId', movieId)
      .eq('UserId', userId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return !!data;
  }

  async add(movieId: number, userId: number): Promise<void> {
    const { error } = await getSupabase().from('Watchlist').upsert({
      MovieId: movieId,
      UserId: userId,
    });
    if (error) {
      throw error;
    }
  }

  async remove(movieId: number, userId: number): Promise<void> {
    const { error } = await getSupabase()
      .from('Watchlist')
      .delete()
      .eq('MovieId', movieId)
      .eq('UserId', userId);
    if (error) {
      throw error;
    }
  }

  async listMovieIds(userId: number): Promise<number[]> {
    const { data, error } = await getSupabase().from('Watchlist').select('MovieId').eq('UserId', userId);
    if (error) {
      throw error;
    }
    return ((data as { MovieId: number }[]) ?? []).map((r) => r.MovieId);
  }
}
