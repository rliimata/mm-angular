import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { confirmAction } from '../../core/confirm.util';
import { formatAppDate, parseAppDateTime } from '../../core/datetime.util';
import { DetailRefreshService } from '../../core/detail-refresh.service';
import { errorMessage } from '../../core/error.util';
import { swapNames } from '../../core/format.util';
import { PageTitleService } from '../../core/page-title.service';
import { AppDateTime } from '../../core/models';
import { PHONE_MEDIA_QUERY } from '../../core/viewport.util';
import { OwnershipService } from '../../data/ownership.service';
import { PersonDetails, PersonService } from '../../data/person.service';
import { ListPreviewItem, ListPreviewService } from '../../shared/list-preview.service';
import { MediaImageComponent } from '../../shared/media-image.component';

@Component({
  selector: 'app-person-detail',
  standalone: true,
  imports: [RouterLink, MediaImageComponent],
  templateUrl: './person-detail.page.html',
  styleUrl: './person-detail.page.scss',
})
export class PersonDetailPage implements OnInit, OnDestroy {
  readonly details = signal<PersonDetails | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly isCompact = signal(false);
  readonly ownershipByMovie = signal<Map<number, string[]>>(new Map());
  readonly swapNames = swapNames;

  private personId = 0;
  private routeSub: Subscription | null = null;
  private refreshSub: Subscription | null = null;
  private compactMq: MediaQueryList | null = null;
  private compactListener: ((ev: MediaQueryListEvent) => void) | null = null;

  constructor(
    readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly people: PersonService,
    private readonly ownershipApi: OwnershipService,
    private readonly detailRefresh: DetailRefreshService,
    private readonly pageTitle: PageTitleService,
    private readonly listPreview: ListPreviewService
  ) {}

  ownershipLabel(movieId: number): string {
    const labels = this.ownershipByMovie().get(movieId);
    return labels?.length ? labels.join(', ') : '';
  }

  /** All unique movies linked to this person (filmography + awards + salaries). */
  allMoviesPreviewItems(): ListPreviewItem[] {
    const seen = new Set<number>();
    const items: ListPreviewItem[] = [];
    const push = (id: number) => {
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      items.push({ kind: 'movie', id });
    };
    for (const f of this.details()?.filmography ?? []) {
      push(f.MovieId);
    }
    for (const a of this.details()?.awards ?? []) {
      push(a.MovieId);
    }
    for (const s of this.details()?.salaries ?? []) {
      push(s.MovieId);
    }
    return items;
  }

  openMoviesPreview(): void {
    const items = this.allMoviesPreviewItems();
    if (!items.length) {
      return;
    }
    this.listPreview.show(items);
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.compactMq = window.matchMedia(PHONE_MEDIA_QUERY);
      this.compactListener = (ev) => this.isCompact.set(ev.matches);
      this.isCompact.set(this.compactMq.matches);
      this.compactMq.addEventListener('change', this.compactListener);
    }
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const nextId = Number(params.get('id'));
      if (!nextId || nextId === this.personId) {
        return;
      }
      this.personId = nextId;
      this.refreshSub?.unsubscribe();
      this.refreshSub = this.detailRefresh.onPerson(nextId).subscribe(() => {
        void this.load();
      });
      void this.load();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    if (this.compactMq && this.compactListener) {
      this.compactMq.removeEventListener('change', this.compactListener);
    }
  }

  /** Person dates without leading zeros: 1.1.2006 */
  formatDate(value: AppDateTime | string | null | undefined): string {
    const raw = formatAppDate(value);
    if (!raw) {
      return '';
    }
    return raw.replace(/^0(\d)\./, '$1.').replace(/\.0(\d)\./, '.$1.');
  }

  isDeceased(details: PersonDetails): boolean {
    const death = parseAppDateTime(details.person.DeathDate);
    return !!(death && death.year > 0);
  }

  /** Living: "(80v)". Deceased age uses deathAgePrefix(). */
  livingAgeLabel(details: PersonDetails): string {
    if (this.isDeceased(details)) {
      return '';
    }
    const years = this.ageYears(details);
    return years == null ? '' : `(${years}v)`;
  }

  /** e.g. "Kuolleessaan 80v" */
  deathAgePrefix(details: PersonDetails): string {
    if (!this.isDeceased(details)) {
      return '';
    }
    const years = this.ageYears(details);
    return years == null ? '' : `Kuolleessaan ${years}v`;
  }

  /** Death cause in lowercase for the detail line. */
  deathReasonLabel(details: PersonDetails): string {
    if (!this.isDeceased(details)) {
      return '';
    }
    return details.deathReason?.trim().toLocaleLowerCase('fi') ?? '';
  }

  datePlace(
    dateValue: AppDateTime | string | null | undefined,
    place: string | null | undefined
  ): string {
    const date = this.formatDate(dateValue);
    const loc = (place ?? '').trim();
    return [date, loc].filter(Boolean).join(' ');
  }

  private ageYears(details: PersonDetails): number | null {
    const birth = parseAppDateTime(details.person.BirthDate);
    if (!birth || birth.year <= 0) {
      return null;
    }
    const death = parseAppDateTime(details.person.DeathDate);
    const end =
      death && death.year > 0
        ? death
        : {
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            day: new Date().getDate(),
            hour: 0,
            minute: 0,
            second: 0,
            millisecond: 0,
          };
    const years = this.ageBetween(birth, end);
    return years == null || years < 0 ? null : years;
  }

  private ageBetween(from: AppDateTime, to: AppDateTime): number | null {
    if (!from.year || !to.year) {
      return null;
    }
    let years = to.year - from.year;
    const fromMonth = from.month > 0 ? from.month : 1;
    const fromDay = from.day > 0 ? from.day : 1;
    const toMonth = to.month > 0 ? to.month : 12;
    const toDay = to.day > 0 ? to.day : 28;
    if (toMonth < fromMonth || (toMonth === fromMonth && toDay < fromDay)) {
      years -= 1;
    }
    return years;
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.ownershipByMovie.set(new Map());
    try {
      const details = await this.people.getDetails(this.personId);
      this.details.set(details);
      if (!details) {
        this.error.set('Henkilöä ei löytynyt.');
        this.pageTitle.set('Haku');
      } else {
        this.pageTitle.set(swapNames(details.person.Name));
        const userId = this.auth.profile()?.Id ?? null;
        if (userId && details.filmography.length) {
          const map = await this.ownershipApi.formatLabelsForUserMovies(
            userId,
            details.filmography.map((f) => f.MovieId)
          );
          this.ownershipByMovie.set(map);
        }
      }
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async deletePerson(): Promise<void> {
    if (!(await confirmAction('Poistetaanko henkilö pysyvästi?'))) {
      return;
    }
    await this.people.deletePerson(this.personId);
    await this.router.navigateByUrl('/');
  }

  formatSalary(n: number): string {
    return n.toLocaleString('fi-FI');
  }
}
