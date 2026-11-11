import { Injectable } from '@angular/core';
import { getSupabase } from '../core/supabase.client';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  async isOnWishlist(movieId: number, userId: number): Promise<boolean> {
    const { data, error } = await getSupabase()
      .from('Wishlist')
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
    const { error } = await getSupabase().from('Wishlist').upsert({
      MovieId: movieId,
      UserId: userId,
    });
    if (error) {
      throw error;
    }
  }

  async remove(movieId: number, userId: number): Promise<void> {
    const { error } = await getSupabase()
      .from('Wishlist')
      .delete()
      .eq('MovieId', movieId)
      .eq('UserId', userId);
    if (error) {
      throw error;
    }
  }

  async listMovieIds(userId: number): Promise<number[]> {
    const { data, error } = await getSupabase().from('Wishlist').select('MovieId').eq('UserId', userId);
    if (error) {
      throw error;
    }
    return ((data as { MovieId: number }[]) ?? []).map((r) => r.MovieId);
  }
}
