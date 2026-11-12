import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/auth.service';
import { getSupabase } from '../core/supabase.client';

@Injectable({ providedIn: 'root' })
export class UserAdminService {
  constructor(private readonly auth: AuthService) {}

  async createUser(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ id: number; email: string }> {
    if (!this.auth.isSuperUser()) {
      throw new Error('Vain ylläpitäjä voi luoda käyttäjiä.');
    }

    const {
      data: { session },
    } = await getSupabase().auth.getSession();
    if (!session?.access_token) {
      throw new Error('Kirjautuminen vaaditaan.');
    }

    const res = await fetch(environment.usersCreateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
      }),
    });

    const text = await res.text();
    let json: { error?: string; id?: number; email?: string } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      /* plain text */
    }
    if (!res.ok || json.id == null) {
      throw new Error(json.error || text || `Käyttäjän luonti epäonnistui (${res.status})`);
    }
    return { id: json.id, email: json.email || input.email };
  }
}
