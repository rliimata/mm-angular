import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DetailRefreshService } from '../../core/detail-refresh.service';
import { swapNames } from '../../core/format.util';
import { Person } from '../../core/models';
import { MediaImageComponent } from '../../shared/media-image.component';
import { PersonFormComponent } from '../../shared/person-form.component';

@Component({
  selector: 'app-person-edit',
  standalone: true,
  imports: [PersonFormComponent, MediaImageComponent],
  templateUrl: './person-edit.page.html',
  styleUrl: './person-edit.page.scss',
})
export class PersonEditPage implements OnInit {
  id = 0;
  initialName = '';
  gender = 0;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly detailRefresh: DetailRefreshService
  ) {}

  personImageSearchQuery(name: string): string {
    return swapNames(name).trim();
  }

  ngOnInit(): void {
    const param =
      this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    if (param && param !== 'new') {
      this.id = Number(param);
    }
    const q = this.route.snapshot.queryParamMap.get('name');
    if (q) {
      this.initialName = q;
    }
  }

  close(): void {
    this.navigateAfterEdit(this.id || null, false);
  }

  onSaved(person: Person): void {
    this.navigateAfterEdit(person.Id, true);
  }

  private navigateAfterEdit(personId: number | null, saved: boolean): void {
    if (saved && personId) {
      this.detailRefresh.personSaved(personId);
    }
    const ret = this.route.snapshot.queryParamMap.get('return');
    if (ret) {
      void this.router.navigateByUrl(ret);
      return;
    }
    if (personId) {
      void this.router.navigate(['/person', personId]);
      return;
    }
    void this.router.navigateByUrl('/');
  }
}
