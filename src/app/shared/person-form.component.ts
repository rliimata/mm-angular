import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { confirmAction, showError } from '../core/confirm.util';
import { errorMessage } from '../core/error.util';
import { initCapName, swapNames, swapTitle } from '../core/format.util';
import { LookupRow, Person } from '../core/models';
import { CatalogService, CatalogTable } from '../data/catalog.service';
import { LookupService } from '../data/lookup.service';
import { MovieService } from '../data/movie.service';
import { PersonService } from '../data/person.service';
import { FlexibleDateComponent, FlexibleDateValue } from './flexible-date.component';
import { SearchSelectComponent } from './search-select.component';
import { CatalogAddModal } from '../pages/modals/catalog-add/catalog-add.modal';
import { DigitsOnlyDirective } from './digits-only.directive';

interface PersonLinkDraft {
  personId: number;
  relationId: number;
  name: string;
}

interface SalaryDraft {
  movieId: number;
  movieTitle: string;
  salary: number;
  currencyId: number;
}

@Component({
  selector: 'app-person-form',
  standalone: true,
  imports: [
    FormsModule,
    FlexibleDateComponent,
    SearchSelectComponent,
    CatalogAddModal,
    DigitsOnlyDirective,
  ],
  template: `
    <form id="personEditForm" class="person-form" (ngSubmit)="save()">
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      <label>
        <span class="field-caption">Nimi <span class="req">*</span></span>
        <input [(ngModel)]="name" name="pfName" required (blur)="name = initCap(name)" />
      </label>
      <label>
        Syntymänimi
        <input [(ngModel)]="realName" name="pfRealName" (blur)="realName = initCap(realName)" />
      </label>

      <div class="gender-block">
        <span class="field-caption">Sukupuoli</span>
        <div class="gender-toggle" role="radiogroup" aria-label="Sukupuoli">
          <label class="radio">
            <input type="radio" name="pfGender" [checked]="gender === 0" (change)="setGender(0)" />
            Mies
          </label>
          <label class="radio">
            <input type="radio" name="pfGender" [checked]="gender === 1" (change)="setGender(1)" />
            Nainen
          </label>
        </div>
      </div>

      <section class="life-grid">
        <h3>Syntynyt</h3>
        <div class="field-icons">
          <button
            type="button"
            class="icon-btn icon-clear"
            (click)="birthCountryId = null"
            [disabled]="!birthCountryId"
            aria-label="Tyhjennä"
            title="Tyhjennä"
          ></button>
          <button
            type="button"
            class="icon-btn icon-add"
            (click)="openCatalogAdd('Country', 'birth')"
            aria-label="Lisää maa"
            title="Lisää"
          >
            +
          </button>
          <button
            type="button"
            class="icon-btn icon-edit"
            (click)="openCatalogEdit('Country', birthCountryId, 'birth')"
            [disabled]="!birthCountryId"
            aria-label="Muokkaa maata"
            title="Muokkaa"
          >
            ✎
          </button>
        </div>
        <app-flexible-date [(ngModel)]="birthDate" name="pfBirthDate" />
        <app-search-select
          class="stretch"
          [options]="countries"
          [(ngModel)]="birthCountryId"
          name="pfBirthCountryId"
          placeholder="Maa…"
        />
      </section>

      <section class="life-grid">
        <h3>Kuollut</h3>
        <div class="field-icons">
          <button
            type="button"
            class="icon-btn icon-clear"
            (click)="deathCountryId = null"
            [disabled]="!deathCountryId"
            aria-label="Tyhjennä"
            title="Tyhjennä"
          ></button>
          <button
            type="button"
            class="icon-btn icon-add"
            (click)="openCatalogAdd('Country', 'death')"
            aria-label="Lisää maa"
            title="Lisää"
          >
            +
          </button>
          <button
            type="button"
            class="icon-btn icon-edit"
            (click)="openCatalogEdit('Country', deathCountryId, 'death')"
            [disabled]="!deathCountryId"
            aria-label="Muokkaa maata"
            title="Muokkaa"
          >
            ✎
          </button>
        </div>
        <app-flexible-date [(ngModel)]="deathDate" name="pfDeathDate" />
        <app-search-select
          class="stretch"
          [options]="countries"
          [(ngModel)]="deathCountryId"
          name="pfDeathCountryId"
          placeholder="Maa…"
        />
      </section>

      <div class="labeled-field stretch">
        <div class="field-head">
          <span class="field-caption">Kuolinsyy</span>
          <button
            type="button"
            class="icon-btn icon-clear"
            (click)="deathReasonId = null"
            [disabled]="!deathReasonId"
            aria-label="Tyhjennä"
            title="Tyhjennä"
          ></button>
          <button
            type="button"
            class="icon-btn icon-add"
            (click)="openCatalogAdd('DeathReason')"
            aria-label="Lisää kuolinsyy"
            title="Lisää"
          >
            +
          </button>
          <button
            type="button"
            class="icon-btn icon-edit"
            (click)="openCatalogEdit('DeathReason', deathReasonId)"
            [disabled]="!deathReasonId"
            aria-label="Muokkaa kuolinsyytä"
            title="Muokkaa"
          >
            ✎
          </button>
          <button
            type="button"
            class="icon-btn icon-del"
            (click)="deleteSelectedCatalog('DeathReason')"
            [disabled]="!deathReasonId"
            aria-label="Poista"
            title="Poista"
          >
            ×
          </button>
        </div>
        <app-search-select
          class="stretch"
          [options]="deathReasons"
          [(ngModel)]="deathReasonId"
          name="pfDeathReasonId"
          placeholder="Valitse syy…"
        />
      </div>

      <label>
        Kuvaus
        <textarea rows="2" [(ngModel)]="text" name="pfText"></textarea>
      </label>

      <section class="plain-block">
        <h3>Trivia</h3>
        <ul class="item-list">
          @for (t of triviaItems; track $index) {
            <li>
              <p>{{ t }}</p>
              <button
                type="button"
                class="icon-btn icon-del"
                (click)="removeTrivia($index)"
                aria-label="Poista"
                title="Poista"
              >
                ×
              </button>
            </li>
          }
        </ul>
        <div class="add-row">
          <input
            type="text"
            [(ngModel)]="triviaDraft"
            name="pfTriviaDraft"
            placeholder="Uusi trivia… (Enter)"
            autocomplete="off"
            (keydown.enter)="$event.preventDefault(); addTrivia()"
          />
        </div>
      </section>

      <section class="plain-block">
        <h3>Henkilölinkit</h3>
        <ul class="item-list">
          @for (l of links; track l.personId + '-' + l.relationId + '-' + $index) {
            <li>
              <span
                >{{ relationLabel(l.relationId) }}:
                {{ swapNames(l.name) }}</span
              >
              <button
                type="button"
                class="icon-btn icon-del"
                (click)="removeLink($index)"
                aria-label="Poista"
                title="Poista"
              >
                ×
              </button>
            </li>
          }
        </ul>
        <div class="link-add">
          <app-search-select
            class="stretch"
            [options]="personRelations"
            [(ngModel)]="linkRelationId"
            name="pfLinkRelationId"
            placeholder="Suhde…"
          />
          <input
            [(ngModel)]="linkQuery"
            name="pfLinkQuery"
            placeholder="Hae henkilöä…"
            (ngModelChange)="onLinkQueryInput()"
            autocomplete="off"
          />
        </div>
        @if (linkHits.length) {
          <ul class="hits">
            @for (p of linkHits; track p.Id) {
              <li>
                <span>{{ swapNames(p.Name) }}</span>
                <button
                  type="button"
                  class="icon-btn icon-add"
                  (click)="addLink(p)"
                  aria-label="Lisää"
                  title="Lisää"
                >
                  +
                </button>
              </li>
            }
          </ul>
        }
      </section>

      <section class="plain-block">
        <h3>Palkkiot</h3>
        <ul class="item-list">
          @for (s of salaries; track s.movieId + '-' + $index) {
            <li>
              <span
                >{{ s.movieTitle }}: {{ s.salary }}
                {{ currencyLabel(s.currencyId) }}</span
              >
              <button
                type="button"
                class="icon-btn icon-del"
                (click)="removeSalary($index)"
                aria-label="Poista"
                title="Poista"
              >
                ×
              </button>
            </li>
          }
        </ul>
        <div class="link-add salary-add">
          <input
            type="text"
            inputmode="numeric"
            appDigitsOnly
            [(ngModel)]="salaryAmount"
            name="pfSalaryAmount"
            placeholder="Summa…"
            maxlength="12"
          />
          <app-search-select
            class="stretch"
            [options]="currencies"
            [(ngModel)]="salaryCurrencyId"
            name="pfSalaryCurrencyId"
            placeholder="Valuutta…"
            [searchable]="false"
          />
          <input
            [(ngModel)]="salaryMovieQuery"
            name="pfSalaryMovieQuery"
            placeholder="Hae elokuvaa…"
            (ngModelChange)="onSalaryMovieQueryInput()"
            autocomplete="off"
          />
        </div>
        @if (salaryMovieHits.length) {
          <ul class="hits">
            @for (m of salaryMovieHits; track m.Id) {
              <li>
                <span
                  >{{ swapTitle(m.Title, m.TitleLanguageId) }}@if (m.Year) {
                    ({{ m.Year }})
                  }</span
                >
                <button
                  type="button"
                  class="icon-btn icon-add"
                  (click)="addSalary(m)"
                  aria-label="Lisää"
                  title="Lisää"
                >
                  +
                </button>
              </li>
            }
          </ul>
        }
      </section>

      @if (showFooter) {
        <div class="actions">
          <button type="submit" class="primary" [disabled]="saving() || !canSave()">Tallenna</button>
        </div>
      }
    </form>

    <app-catalog-add-modal
      [open]="catalogAddOpen"
      [title]="catalogAddTitle()"
      [value]="catalogAddValue"
      [error]="catalogAddError"
      (valueChange)="catalogAddValue = $event"
      (save)="saveCatalogAdd()"
      (closed)="closeCatalogAdd()"
    />
  `,
  styles: [
    `
      .person-form {
        --pf-section-gap: 0.75rem;
        --pf-field-gap: 0.35rem;
        display: grid;
        gap: var(--pf-section-gap);
      }
      .life-grid {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-rows: auto auto;
        column-gap: 0.55rem;
        row-gap: var(--pf-field-gap);
        align-items: center;
        width: 100%;
      }
      .life-grid > h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: normal;
        color: #111;
        line-height: 1.7rem;
      }
      .life-grid > .field-icons {
        min-height: 0;
        height: 1.7rem;
      }
      .life-grid > app-search-select {
        width: 100%;
        min-width: 0;
      }
      .plain-block > h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: normal;
        color: #111;
      }
      .gender-block {
        display: grid;
        gap: var(--pf-field-gap);
      }
      .gender-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.85rem;
      }
      .radio {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 1rem;
        color: #111;
        cursor: pointer;
      }
      .radio input {
        width: auto;
        margin: 0;
        accent-color: #1f4b7a;
      }
      .labeled-field {
        display: grid;
        gap: var(--pf-field-gap);
        min-width: 0;
        justify-items: start;
      }
      .labeled-field.stretch {
        width: 100%;
        max-width: none;
        justify-items: stretch;
      }
      .field-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.15rem 0.25rem;
        width: 100%;
        min-height: 1.7rem;
      }
      .field-head .field-caption {
        margin-right: 0.15rem;
      }
      .field-icons {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.15rem 0.25rem;
        min-height: 0;
      }
      .plain-block {
        display: grid;
        gap: var(--pf-field-gap);
        font-size: 1rem;
        color: #111;
      }
      .plain-block input,
      .plain-block select,
      .plain-block textarea {
        font-size: 1rem;
      }
      .item-list,
      .hits {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.3rem;
      }
      .item-list li,
      .hits li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.4rem;
        padding: 0.35rem 0.45rem;
        border: 1px solid #e4e9ef;
        border-radius: 6px;
        background: #fff;
      }
      .item-list p {
        margin: 0;
        white-space: pre-wrap;
        flex: 1;
      }
      .add-row,
      .link-add {
        display: grid;
        gap: var(--pf-field-gap);
      }
      .link-add {
        grid-template-columns: minmax(8rem, 1fr) minmax(0, 1.4fr);
        gap: 0.55rem;
      }
      .salary-add {
        grid-template-columns: 9.5rem minmax(6rem, 8rem) minmax(0, 1fr);
        gap: 0.55rem;
      }
      .link-add > app-search-select,
      .salary-add > app-search-select {
        width: 100%;
        min-width: 0;
      }
      @media (max-width: 560px) {
        .life-grid,
        .link-add,
        .salary-add {
          grid-template-columns: 1fr;
        }
        .life-grid > .field-icons {
          grid-column: 1;
        }
      }
      .icon-btn {
        width: 1.7rem;
        height: 1.7rem;
        padding: 0;
        border: 0;
        border-radius: 4px;
        background: transparent;
        font: inherit;
        font-size: 1rem;
        line-height: 1;
        cursor: pointer;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
      }
      .icon-btn:disabled {
        opacity: 0.28;
        color: #9aa3ad !important;
        filter: grayscale(1);
        cursor: not-allowed;
      }
      .icon-btn.icon-clear {
        color: #8a5a2b;
      }
      .icon-btn.icon-del {
        color: #8b1e1e;
      }
      .icon-btn.icon-add {
        color: #1f4b7a;
      }
      .icon-btn.icon-edit {
        color: #1f4b7a;
        font-size: 1rem;
      }
      .icon-btn:hover:not(:disabled) {
        background: rgba(0, 0, 0, 0.06);
      }
      .actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .primary {
        padding: 0.55rem 0.9rem;
        border: 0;
        border-radius: 4px;
        background: #1f4b7a;
        color: #fff;
        font: inherit;
        cursor: pointer;
      }
      .primary:disabled {
        opacity: 0.45;
        background: #9aabb8;
        color: #f3f5f7;
        cursor: not-allowed;
      }
      .ghost {
        padding: 0.5rem 0.8rem;
        border: 0;
        border-radius: 4px;
        background: #eceff3;
        color: #333;
        font: inherit;
        cursor: pointer;
      }
      .error {
        color: #a40000;
        margin: 0;
      }
      .modal-backdrop.nested {
        position: fixed;
        inset: 0;
        z-index: 60;
        background: rgba(20, 30, 40, 0.4);
        display: grid;
        place-items: center;
        padding: 0.75rem;
      }
      .modal.modal-small {
        width: min(22rem, 100%);
        background: #fff;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        overflow: visible;
      }
      .modal-head,
      .modal-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.7rem 0.85rem;
        border-bottom: 1px solid #e6ebf0;
      }
      .modal-foot {
        border-bottom: 0;
        border-top: 1px solid #e6ebf0;
        justify-content: flex-start;
      }
      .modal-head h2 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }
      .modal-body {
        padding: 0.85rem;
        display: grid;
        gap: 0.55rem;
      }
    `,
  ],
})
export class PersonFormComponent implements OnInit, OnChanges {
  @Input() personId = 0;
  @Input() initialName = '';
  @Input() showCancel = false;
  /** When false, host page should render a sticky modal footer submit. */
  @Input() showFooter = true;
  @Output() saved = new EventEmitter<Person>();
  @Output() cancel = new EventEmitter<void>();
  @Output() genderChange = new EventEmitter<number>();

  name = '';
  realName = '';
  gender = 0;
  birthDate: FlexibleDateValue = { year: 0, month: 0, day: 0 };
  deathDate: FlexibleDateValue = { year: 0, month: 0, day: 0 };
  birthCountryId: number | null = null;
  deathCountryId: number | null = null;
  deathReasonId: number | null = null;
  text = '';
  triviaItems: string[] = [];
  triviaDraft = '';
  links: PersonLinkDraft[] = [];
  linkRelationId = 0;
  linkQuery = '';
  linkHits: Person[] = [];
  private linkSearchTimer: ReturnType<typeof setTimeout> | null = null;

  salaries: SalaryDraft[] = [];
  salaryAmount = '';
  salaryCurrencyId: number | null = null;
  salaryMovieQuery = '';
  salaryMovieHits: { Id: number; Title: string; Year: number | null; TitleLanguageId: number | null }[] =
    [];
  private salaryMovieTimer: ReturnType<typeof setTimeout> | null = null;

  countries: LookupRow[] = [];
  deathReasons: LookupRow[] = [];
  personRelations: LookupRow[] = [];
  currencies: LookupRow[] = [];

  catalogAddOpen = false;
  catalogAddTable: 'Country' | 'DeathReason' | null = null;
  catalogAddTarget: 'birth' | 'death' | null = null;
  catalogAddValue = '';
  catalogAddError: string | null = null;
  catalogEditId: number | null = null;

  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly initCap = initCapName;
  readonly swapNames = swapNames;
  readonly swapTitle = swapTitle;

  sortedLookups(rows: LookupRow[], selectedId: number | null | undefined): LookupRow[] {
    const selected = selectedId != null && selectedId > 0 ? new Set([selectedId]) : new Set<number>();
    const sel = rows.filter((r) => selected.has(r.Id));
    const rest = rows
      .filter((r) => !selected.has(r.Id))
      .sort((a, b) => String(a.Value).localeCompare(String(b.Value), 'fi', { sensitivity: 'base' }));
    return [...sel, ...rest];
  }

  constructor(
    private readonly people: PersonService,
    private readonly movies: MovieService,
    private readonly lookups: LookupService,
    private readonly catalog: CatalogService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.reloadLookups();
    this.linkRelationId = this.personRelations[0]?.Id ?? 0;
    if (this.salaryCurrencyId == null) {
      this.salaryCurrencyId = this.currencies[0]?.Id ?? null;
    }
    await this.load();
  }

  private async reloadLookups(): Promise<void> {
    const [countries, deathReasons, personRelations, currencies] = await Promise.all([
      this.lookups.get('Country'),
      this.lookups.get('DeathReason'),
      this.lookups.get('PersonRelation'),
      this.lookups.get('Currency'),
    ]);
    this.countries = countries;
    this.deathReasons = deathReasons;
    this.personRelations = personRelations;
    this.currencies = currencies.filter((c) => c.Id !== 0);
  }

  openCatalogAdd(table: 'Country' | 'DeathReason', target: 'birth' | 'death' | null = null): void {
    this.catalogAddTable = table;
    this.catalogAddTarget = target;
    this.catalogEditId = null;
    this.catalogAddValue = '';
    this.catalogAddError = null;
    this.catalogAddOpen = true;
  }

  openCatalogEdit(
    table: 'Country' | 'DeathReason',
    id: number | null,
    target: 'birth' | 'death' | null = null
  ): void {
    if (id == null) {
      return;
    }
    const rows = table === 'DeathReason' ? this.deathReasons : this.countries;
    const opt = rows.find((r) => r.Id === id);
    if (!opt) {
      return;
    }
    this.catalogAddTable = table;
    this.catalogAddTarget = target;
    this.catalogEditId = id;
    this.catalogAddValue = String(opt.Value);
    this.catalogAddError = null;
    this.catalogAddOpen = true;
  }

  closeCatalogAdd(): void {
    this.catalogAddOpen = false;
    this.catalogAddTable = null;
    this.catalogAddTarget = null;
    this.catalogEditId = null;
    this.catalogAddValue = '';
    this.catalogAddError = null;
  }

  catalogAddTitle(): string {
    const edit = this.catalogEditId != null;
    if (this.catalogAddTable === 'DeathReason') {
      return edit ? 'Muokkaa kuolinsyytä' : 'Uusi kuolinsyy';
    }
    return edit ? 'Muokkaa maata' : 'Uusi maa';
  }

  async saveCatalogAdd(): Promise<void> {
    const table = this.catalogAddTable;
    if (!table) {
      return;
    }
    try {
      if (this.catalogEditId != null) {
        await this.catalog.updateValue(table as CatalogTable, this.catalogEditId, this.catalogAddValue);
        this.lookups.invalidate(table);
        await this.reloadLookups();
        this.closeCatalogAdd();
        return;
      }
      const id = await this.catalog.addValue(table as CatalogTable, this.catalogAddValue);
      this.lookups.invalidate(table);
      await this.reloadLookups();
      if (table === 'Country') {
        if (this.catalogAddTarget === 'death') {
          this.deathCountryId = id;
        } else {
          this.birthCountryId = id;
        }
      } else {
        this.deathReasonId = id;
      }
      this.closeCatalogAdd();
    } catch (e: unknown) {
      this.catalogAddError = errorMessage(e);
    }
  }

  async deleteSelectedCatalog(
    table: 'Country' | 'DeathReason',
    target: 'birth' | 'death' | null = null
  ): Promise<void> {
    const id =
      table === 'DeathReason'
        ? this.deathReasonId
        : target === 'death'
          ? this.deathCountryId
          : this.birthCountryId;
    const rows = table === 'DeathReason' ? this.deathReasons : this.countries;
    const opt = rows.find((r) => r.Id === id);
    if (!opt) {
      return;
    }
    if (!(await confirmAction(`Poistetaanko "${opt.Value}" valintalistasta?`))) {
      return;
    }
    try {
      await this.catalog.deleteValue(table, opt.Id);
      this.lookups.invalidate(table);
      if (table === 'DeathReason' && this.deathReasonId === opt.Id) {
        this.deathReasonId = null;
      }
      if (table === 'Country') {
        if (this.birthCountryId === opt.Id) {
          this.birthCountryId = null;
        }
        if (this.deathCountryId === opt.Id) {
          this.deathCountryId = null;
        }
      }
      await this.reloadLookups();
    } catch (e: unknown) {
      await showError(errorMessage(e));
    }
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['personId'] && !changes['personId'].firstChange) {
      await this.load();
    }
    if (changes['initialName'] && this.personId === 0 && this.initialName) {
      this.name = initCapName(this.initialName);
    }
  }

  relationLabel(id: number): string {
    return this.lookups.label(this.personRelations, id) || String(id);
  }

  setGender(value: number): void {
    this.gender = value;
    this.genderChange.emit(value);
  }

  addTrivia(): void {
    const t = this.triviaDraft.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) {
      return;
    }
    this.triviaItems = [...this.triviaItems, t];
    this.triviaDraft = '';
  }

  removeTrivia(i: number): void {
    this.triviaItems = this.triviaItems.filter((_, idx) => idx !== i);
  }

  onLinkQueryInput(): void {
    if (this.linkSearchTimer) {
      clearTimeout(this.linkSearchTimer);
    }
    this.linkSearchTimer = setTimeout(() => void this.searchLinkPeople(), 250);
  }

  async searchLinkPeople(): Promise<void> {
    const q = this.linkQuery.trim();
    if (q.length < 2) {
      this.linkHits = [];
      return;
    }
    const hits = await this.people.searchNameExact(q, 20);
    this.linkHits = hits.filter((p) => p.Id !== this.personId);
  }

  addLink(p: Person): void {
    if (!this.linkRelationId) {
      return;
    }
    if (this.links.some((l) => l.personId === p.Id && l.relationId === this.linkRelationId)) {
      return;
    }
    this.links = [
      ...this.links,
      { personId: p.Id, relationId: this.linkRelationId, name: p.Name },
    ];
    this.linkQuery = '';
    this.linkHits = [];
  }

  removeLink(i: number): void {
    this.links = this.links.filter((_, idx) => idx !== i);
  }

  currencyLabel(id: number): string {
    return this.lookups.label(this.currencies, id) || '';
  }

  onSalaryMovieQueryInput(): void {
    if (this.salaryMovieTimer) {
      clearTimeout(this.salaryMovieTimer);
    }
    this.salaryMovieTimer = setTimeout(() => void this.searchSalaryMovies(), 250);
  }

  async searchSalaryMovies(): Promise<void> {
    const q = this.salaryMovieQuery.trim();
    if (q.length < 2) {
      this.salaryMovieHits = [];
      return;
    }
    const res = await this.movies.search({
      query: q,
      mode: 'text',
      page: 1,
      pageSize: 20,
    });
    const existing = new Set(this.salaries.map((s) => s.movieId));
    this.salaryMovieHits = res.rows
      .filter((m) => !existing.has(m.Id))
      .map((m) => ({
        Id: m.Id,
        Title: m.Title,
        Year: m.Year,
        TitleLanguageId: m.TitleLanguageId,
      }));
  }

  addSalary(m: {
    Id: number;
    Title: string;
    Year: number | null;
    TitleLanguageId: number | null;
  }): void {
    const amount = Number(this.salaryAmount.replace(/\D+/g, ''));
    if (!Number.isFinite(amount) || amount <= 0 || !this.salaryCurrencyId) {
      return;
    }
    if (this.salaries.some((s) => s.movieId === m.Id)) {
      return;
    }
    this.salaries = [
      ...this.salaries,
      {
        movieId: m.Id,
        movieTitle: swapTitle(m.Title, m.TitleLanguageId),
        salary: amount,
        currencyId: this.salaryCurrencyId,
      },
    ];
    this.salaryAmount = '';
    this.salaryMovieQuery = '';
    this.salaryMovieHits = [];
  }

  removeSalary(i: number): void {
    this.salaries = this.salaries.filter((_, idx) => idx !== i);
  }

  private async load(): Promise<void> {
    if (!this.personId) {
      this.name = initCapName(this.initialName);
      this.realName = '';
      this.setGender(0);
      this.birthDate = { year: 0, month: 0, day: 0 };
      this.deathDate = { year: 0, month: 0, day: 0 };
      this.birthCountryId = null;
      this.deathCountryId = null;
      this.deathReasonId = null;
      this.text = '';
      this.triviaItems = [];
      this.triviaDraft = '';
      this.links = [];
      this.salaries = [];
      return;
    }
    const details = await this.people.getDetails(this.personId);
    if (!details) {
      this.error.set('Henkilöä ei löytynyt.');
      return;
    }
    const p = details.person;
    this.name = p.Name;
    this.realName = p.RealName ?? '';
    this.setGender(p.Gender ?? 0);
    this.birthCountryId = p.BirthCountryId && p.BirthCountryId > 0 ? p.BirthCountryId : null;
    this.deathCountryId = p.DeathCountryId && p.DeathCountryId > 0 ? p.DeathCountryId : null;
    this.deathReasonId = p.DeathReasonId && p.DeathReasonId > 0 ? p.DeathReasonId : null;
    this.birthDate = this.people.fromComposite(p.BirthDate);
    this.deathDate = this.people.fromComposite(p.DeathDate);
    this.text = (details.text ?? '').replace(/<br\s*\/?>/gi, '\n');
    this.triviaItems = details.trivia.map((t) => t.replace(/<br\s*\/?>/gi, '\n'));
    this.links = details.relations
      .filter((r) => !r.Incoming)
      .map((r) => ({
        personId: r.PersonId,
        relationId: r.RelationId,
        name: r.Name,
      }));
    this.salaries = details.salaries.map((s) => ({
      movieId: s.MovieId,
      movieTitle: s.MovieTitle,
      salary: s.Salary,
      currencyId: s.CurrencyId,
    }));
  }

  canSave(): boolean {
    return !!initCapName(this.name);
  }

  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    const name = initCapName(this.name);
    this.saving.set(true);
    this.error.set(null);
    try {
      const payload: Partial<Person> & { Name: string } = {
        Name: name,
        RealName: initCapName(this.realName) || '',
        Gender: this.gender,
        BirthCountryId: this.birthCountryId,
        DeathCountryId: this.deathCountryId,
        DeathReasonId: this.deathReasonId,
        BirthDate: this.people.toComposite(this.birthDate) as Person['BirthDate'],
        DeathDate: this.people.toComposite(this.deathDate) as Person['DeathDate'],
      };
      if (this.personId) {
        payload.Id = this.personId;
      }
      const id = await this.people.savePerson(payload, this.text, {
        trivia: this.triviaItems,
        links: this.links.map((l) => ({ personId: l.personId, relationId: l.relationId })),
        salaries: this.salaries.map((s) => ({
          movieId: s.movieId,
          salary: s.salary,
          currencyId: s.currencyId,
        })),
      });
      this.saved.emit({
        Id: id,
        Name: name,
        RealName: initCapName(this.realName) || null,
        BirthCountryId: this.birthCountryId,
        DeathCountryId: this.deathCountryId,
        DeathReasonId: this.deathReasonId,
        Type: 0,
        Gender: this.gender,
        BirthDate: payload.BirthDate ?? null,
        DeathDate: payload.DeathDate ?? null,
      });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.saving.set(false);
    }
  }
}
