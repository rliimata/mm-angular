import { Injectable, computed, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { AppUser } from './models';
import { getSupabase } from './supabase.client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSig = signal<Session | null>(null);
  private readonly profileSig = signal<AppUser | null>(null);
  private readonly readySig = signal(false);

  readonly session = this.sessionSig.asReadonly();
  readonly profile = this.profileSig.asReadonly();
  readonly ready = this.readySig.asReadonly();
  readonly isLoggedIn = computed(() => !!this.sessionSig());
  readonly isSuperUser = computed(() => this.profileSig()?.SuperUser === 1);
  readonly displayName = computed(() => {
    const p = this.profileSig();
    if (!p) {
      return '';
    }
    return [p.FirstName, p.LastName].filter(Boolean).join(' ') || p.Email;
  });

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    this.sessionSig.set(data.session);
    if (data.session?.user) {
      await this.loadProfile(data.session.user);
    }
    this.readySig.set(true);

    supabase.auth.onAuthStateChange((_event, session) => {
      this.sessionSig.set(session);
      if (session?.user) {
        void this.loadProfile(session.user);
      } else {
        this.profileSig.set(null);
      }
    });
  }

  private async loadProfile(user: User): Promise<string | null> {
    // Use Profile view — PostgREST + reserved table name "User" is unreliable.
    const { data, error } = await getSupabase()
      .from('Profile')
      .select('Id, Email, FirstName, LastName, SuperUser, AuthUserId, LastLogin')
      .eq('AuthUserId', user.id)
      .maybeSingle();

    if (error) {
      console.error('Profiilin haku epäonnistui', error);
      this.profileSig.set(null);
      return error.message;
    }
    this.profileSig.set((data as AppUser) ?? null);
    return null;
  }

  async signIn(email: string, password: string): Promise<{ error: string | null }> {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) {
      return { error: error.message };
    }
    const { data } = await getSupabase().auth.getSession();
    this.sessionSig.set(data.session);
    if (data.session?.user) {
      const profileError = await this.loadProfile(data.session.user);
      if (profileError) {
        await this.signOut();
        return { error: `Profiilin haku epäonnistui: ${profileError}` };
      }
      if (!this.profileSig()) {
        await this.signOut();
        return {
          error:
            'Kirjautuminen onnistui, mutta profiilia ei ole linkitetty. Liitä AuthUserId User-tauluun.',
        };
      }
      await getSupabase()
        .from('Profile')
        .update({ LastLogin: this.nowComposite() })
        .eq('AuthUserId', data.session.user.id);
    }
    return { error: null };
  }

  async signOut(): Promise<void> {
    await getSupabase().auth.signOut();
    this.sessionSig.set(null);
    this.profileSig.set(null);
  }

  async changePassword(newPassword: string): Promise<{ error: string | null }> {
    const trimmed = newPassword.trim();
    if (trimmed.length < 6) {
      return { error: 'Salasanan on oltava vähintään 6 merkkiä.' };
    }
    const { error } = await getSupabase().auth.updateUser({ password: trimmed });
    return { error: error?.message ?? null };
  }

  /** Composite datetime for LastLogin column. */
  private nowComposite(): string {
    const n = new Date();
    return `(${n.getFullYear()},${n.getMonth() + 1},${n.getDate()},${n.getHours()},${n.getMinutes()},${n.getSeconds()},0)`;
  }
}
