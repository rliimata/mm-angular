import { Injectable } from '@angular/core';
import { filter, Observable, Subject } from 'rxjs';

/** Notify detail pages to reload after a successful edit save. */
@Injectable({ providedIn: 'root' })
export class DetailRefreshService {
  private readonly movies = new Subject<number>();
  private readonly people = new Subject<number>();

  movieSaved(id: number): void {
    this.movies.next(id);
  }

  personSaved(id: number): void {
    this.people.next(id);
  }

  onMovie(id: number): Observable<number> {
    return this.movies.pipe(filter((x) => x === id));
  }

  onPerson(id: number): Observable<number> {
    return this.people.pipe(filter((x) => x === id));
  }
}
