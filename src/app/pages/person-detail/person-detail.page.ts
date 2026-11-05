import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { confirmAction } from '../../core/confirm.util';
import { formatAppDate } from '../../core/datetime.util';
import { DetailRefreshService } from '../../core/detail-refresh.service';
import { errorMessage } from '../../core/error.util';
import { swapNames } from '../../core/format.util';
import { PersonDetails, PersonService } from '../../data/person.service';
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
  readonly formatDate = formatAppDate;
  readonly swapNames = swapNames;

  private personId = 0;
  private routeSub: Subscription | null = null;
  private refreshSub: Subscription | null = null;

  constructor(
    readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly people: PersonService,
    private readonly detailRefresh: DetailRefreshService
  ) {}

  ngOnInit(): void {
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
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const details = await this.people.getDetails(this.personId);
      this.details.set(details);
      if (!details) {
        this.error.set('Henkilöä ei löytynyt.');
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
