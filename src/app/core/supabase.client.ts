import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!environment.supabaseAnonKey || environment.supabaseAnonKey.startsWith('REPLACE_')) {
      console.warn('Aseta supabaseAnonKey tiedostoon src/environments/environment.development.ts');
    }
    client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
