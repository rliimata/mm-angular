import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { confirmAction, showError } from '../../core/confirm.util';
import { formatAppDate } from '../../core/datetime.util';
import { DetailRefreshService } from '../../core/detail-refresh.service';
import { errorMessage } from '../../core/error.util';
import {
  ageRatingLabel,
  decodeEntities,
  ntscMinutesFromPal,
  palMinutesFromNtsc,
  resolveNtscMinutes,
  swapNames,
  swapTitle,
} from '../../core/format.util';
import { PageTitleService } from '../../core/page-title.service';
import { isPhoneViewport } from '../../core/viewport.util';
import { LookupRow, Movie, Person } from '../../core/models';
import { CatalogService, CatalogTable } from '../../data/catalog.service';
import { LookupService } from '../../data/lookup.service';
import { MovieService } from '../../data/movie.service';
import { PersonDetails, PersonService } from '../../data/person.service';
import { getSupabase } from '../../core/supabase.client';
import { DigitsOnlyDirective } from '../../shared/digits-only.directive';
import { MediaImageComponent } from '../../shared/media-image.component';
import { MultiCheckSelectComponent } from '../../shared/multi-check-select.component';
import { PersonFormComponent } from '../../shared/person-form.component';
import { SearchSelectComponent } from '../../shared/search-select.component';
import { CatalogAddModal } from '../modals/catalog-add/catalog-add.modal';
import { PersonPreviewModal } from '../modals/person-preview/person-preview.modal';

type TitleMatch = { Id: number; Title: string; Year: number | null; Directors: string[] };

interface RolePick {
  roleId: number;
  personId: number;
  name: string;
}

interface AwardPick {
  awardId: number;
  awardLabel: string;
  personId: number | null;
  personName: string | null;
}

interface MovieLinkPick {
  destinationId: number;
  relationId: number;
  title: string;
  year: number | null;
  relationLabel: string;
}

@Component({
  selector: 'app-movie-edit',
  standalone: true,
  imports: [
    FormsModule,
    DigitsOnlyDirective,
    MultiCheckSelectComponent,
    PersonFormComponent,
    MediaImageComponent,
    SearchSelectComponent,
    CatalogAddModal,
    PersonPreviewModal,
  ],
  templateUrl: './movie-edit.page.html',
  styleUrl: './movie-edit.page.scss',
})
export class MovieEditPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('awardPersonInput') private awardPersonInput?: ElementRef<HTMLInputElement>;
  @ViewChild('movieLinkInput') private movieLinkInput?: ElementRef<HTMLInputElement>;

  id = 0;
  title = '';
  yearText = '';
  versionId: number | null = 0;
  ratioId: number | null = 0;
  distributionId: number | null = 0;
  titleLanguageId: number | null = 1;
  age: number | null = null;
  runtimeMinutes: number | null = null;
  runtimeUnit: 'ntsc' | 'pal' = 'pal';
  budgetText = '';
  currencyId: number | null = 0;
  text = '';
  triviaItems: string[] = [];
  triviaDraft = '';

  categoryIds: number[] = [];
  countryIds: number[] = [];
  soundIds: number[] = [];
  aka: { title: string; titleLanguageId: number }[] = [];
  roles: RolePick[] = [];
  awardItems: AwardPick[] = [];
  movieLinkItems: MovieLinkPick[] = [];

  akaTitle = '';
  akaLangId = 2;
  editingAkaIndex: number | null = null;
  roleQuery: Record<number, string> = {};
  roleHits: Record<number, Person[]> = {};
  private roleSearchTimers: Record<number, ReturnType<typeof setTimeout> | null> = {};
  activeRoleIdForPerson = 1;

  awardIdDraft: number | null = null;
  awardPersonQuery = '';
  awardPersonHits: Person[] = [];
  private awardPersonTimer: ReturnType<typeof setTimeout> | null = null;

  movieLinkRelationId: number | null = null;
  movieLinkQuery = '';
  movieLinkHits: { Id: number; Title: string; Year: number | null; TitleLanguageId: number | null }[] =
    [];
  private movieLinkTimer: ReturnType<typeof setTimeout> | null = null;
  dragRoleId: number | null = null;
  dragFromIndex: number | null = null;
  dragOverRoleId: number | null = null;
  dragOverIndex: number | null = null;

  versions: LookupRow[] = [];
  ratios: LookupRow[] = [];
  distributions: LookupRow[] = [];
  languages: LookupRow[] = [];
  currencies: LookupRow[] = [];
  categories: LookupRow[] = [];
  countries: LookupRow[] = [];
  sounds: LookupRow[] = [];
  roleTypes: LookupRow[] = [];
  ageRatings: LookupRow[] = [];
  awards: LookupRow[] = [];
  movieRelations: LookupRow[] = [];

  catalogAddOpen = false;
  catalogAddTable: CatalogTable | null = null;
  catalogAddValue = '';
  catalogAddError: string | null = null;
  /** When set, catalog modal renames this id instead of inserting. */
  catalogEditId: number | null = null;

  personPreviewOpen = false;
  personPreview: PersonDetails | null = null;
  personPreviewLoading = false;

  newPersonOpen = false;
  newPersonInitialName = '';
  newPersonGender = 0;

  editTab: 'basic' | 'extra' | 'people' = 'basic';

  titleMatchOpen = false;
  titleMatches: TitleMatch[] = [];
  private titleCheckedFor = '';

  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly swapNames = swapNames;
  readonly swapTitle = swapTitle;
  readonly decode = decodeEntities;
  readonly formatDate = formatAppDate;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly movies: MovieService,
    private readonly people: PersonService,
    private readonly lookups: LookupService,
    private readonly catalog: CatalogService,
    private readonly detailRefresh: DetailRefreshService,
    private readonly pageTitle: PageTitleService
  ) {}

  async ngOnInit(): Promise<void> {
    if (isPhoneViewport()) {
      const param =
        this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
      if (param && param !== 'new') {
        void this.router.navigate(['/movie', param]);
      } else {
        void this.router.navigateByUrl('/');
      }
      return;
    }
    await this.reloadLookups();
    const param =
      this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    if (param && param !== 'new') {
      this.id = Number(param);
      const details = await this.movies.getDetails(this.id);
      if (!details) {
        this.error.set('Elokuvaa ei löytynyt.');
        this.pageTitle.set('Muokkaa elokuvaa');
        return;
      }
      this.apply(details.movie);
      this.text = (details.text ?? '').replace(/<br\s*\/?>/gi, '\n');
      this.triviaItems = details.trivia.map((t) => t.replace(/<br\s*\/?>/gi, '\n'));
      await this.loadLinkIds(this.id);
      this.roles = details.roles.map((r) => ({
        roleId: r.RoleId,
        personId: r.PersonId,
        name: r.Name,
      }));
      this.awardItems = details.awards.map((a) => ({
        awardId: a.AwardId,
        awardLabel: a.Award,
        personId: a.PersonId,
        personName: a.PersonName,
      }));
      this.movieLinkItems = details.related
        .filter((r) => !r.Incoming)
        .map((r) => ({
          destinationId: r.MovieId,
          relationId: r.RelationId,
          title: r.Title,
          year: r.Year,
          relationLabel: r.Relation,
        }));
      this.pageTitle.set(swapTitle(this.title, this.titleLanguageId) || 'Muokkaa elokuvaa');
    } else {
      this.pageTitle.set('Uusi elokuva');
    }
  }

  ngAfterViewInit(): void {
    if (!this.id) {
      setTimeout(() => this.titleInput?.nativeElement.focus(), 0);
    }
  }

  ngOnDestroy(): void {
    for (const timer of Object.values(this.roleSearchTimers)) {
      if (timer) {
        clearTimeout(timer);
      }
    }
    if (this.awardPersonTimer) {
      clearTimeout(this.awardPersonTimer);
    }
    if (this.movieLinkTimer) {
      clearTimeout(this.movieLinkTimer);
    }
  }

  onAwardSelected(): void {
    if (!this.awardIdDraft) {
      return;
    }
    setTimeout(() => this.awardPersonInput?.nativeElement.focus(), 0);
  }

  onAwardPersonQueryInput(): void {
    if (this.awardPersonTimer) {
      clearTimeout(this.awardPersonTimer);
    }
    this.awardPersonTimer = setTimeout(() => void this.searchAwardPeople(), 250);
  }

  async searchAwardPeople(): Promise<void> {
    const q = this.awardPersonQuery.trim();
    if (q.length < 2) {
      this.awardPersonHits = [];
      return;
    }
    this.awardPersonHits = await this.people.searchNameExact(q, 20);
  }

  addAward(person: Person | null = null): void {
    if (!this.awardIdDraft) {
      return;
    }
    const award = this.awards.find((a) => a.Id === this.awardIdDraft);
    if (!award) {
      return;
    }
    const personId = person?.Id ?? null;
    if (
      this.awardItems.some(
        (a) => a.awardId === award.Id && (a.personId ?? null) === (personId ?? null)
      )
    ) {
      return;
    }
    this.awardItems = [
      ...this.awardItems,
      {
        awardId: award.Id,
        awardLabel: String(award.Value),
        personId,
        personName: person ? swapNames(person.Name) : null,
      },
    ];
    this.awardIdDraft = null;
    this.awardPersonQuery = '';
    this.awardPersonHits = [];
  }

  removeAward(i: number): void {
    this.awardItems = this.awardItems.filter((_, idx) => idx !== i);
  }

  awardItemLabel(a: AwardPick): string {
    return a.personName ? `${a.awardLabel}: ${a.personName}` : a.awardLabel;
  }

  movieLinkItemLabel(l: MovieLinkPick): string {
    const year = l.year ? ` (${l.year})` : '';
    return `${l.relationLabel}: ${l.title}${year}`;
  }

  onMovieLinkRelationSelected(): void {
    if (!this.movieLinkRelationId) {
      return;
    }
    setTimeout(() => this.movieLinkInput?.nativeElement.focus(), 0);
  }

  onMovieLinkQueryInput(): void {
    if (this.movieLinkTimer) {
      clearTimeout(this.movieLinkTimer);
    }
    this.movieLinkTimer = setTimeout(() => void this.searchMovieLinks(), 250);
  }

  async searchMovieLinks(): Promise<void> {
    const q = this.movieLinkQuery.trim();
    if (q.length < 2) {
      this.movieLinkHits = [];
      return;
    }
    const res = await this.movies.search({
      query: q,
      mode: 'text',
      page: 1,
      pageSize: 20,
    });
    const existing = new Set(this.movieLinkItems.map((l) => l.destinationId));
    this.movieLinkHits = res.rows
      .filter((m) => m.Id !== this.id && !existing.has(m.Id))
      .map((m) => ({
        Id: m.Id,
        Title: m.Title,
        Year: m.Year,
        TitleLanguageId: m.TitleLanguageId,
      }));
  }

  addMovieLink(m: { Id: number; Title: string; Year: number | null; TitleLanguageId: number | null }): void {
    if (!this.movieLinkRelationId) {
      return;
    }
    const relation = this.movieRelations.find((r) => r.Id === this.movieLinkRelationId);
    if (!relation) {
      return;
    }
    if (this.movieLinkItems.some((l) => l.destinationId === m.Id && l.relationId === relation.Id)) {
      return;
    }
    this.movieLinkItems = [
      ...this.movieLinkItems,
      {
        destinationId: m.Id,
        relationId: relation.Id,
        title: swapTitle(m.Title, m.TitleLanguageId),
        year: m.Year,
        relationLabel: String(relation.Value),
      },
    ];
    this.movieLinkRelationId = null;
    this.movieLinkQuery = '';
    this.movieLinkHits = [];
  }

  removeMovieLink(i: number): void {
    this.movieLinkItems = this.movieLinkItems.filter((_, idx) => idx !== i);
  }

  private async reloadLookups(): Promise<void> {
    const [
      versions,
      ratios,
      distributions,
      languages,
      currencies,
      categories,
      countries,
      sounds,
      roles,
      ages,
      awards,
      movieRelations,
    ] = await Promise.all([
      this.lookups.get('Version'),
      this.lookups.get('Ratio'),
      this.lookups.get('Distribution'),
      this.lookups.get('TitleLanguage'),
      this.lookups.get('Currency'),
      this.lookups.get('Category'),
      this.lookups.get('Country'),
      this.lookups.get('Sound'),
      this.lookups.get('Role'),
      this.lookups.get('AgeRating'),
      this.lookups.get('Award'),
      this.lookups.get('MovieRelation'),
    ]);
    this.versions = this.sortAlpha(versions.filter((r) => r.Id !== 0));
    this.ratios = this.sortAlpha(ratios.filter((r) => r.Id !== 0));
    this.distributions = this.sortAlpha(distributions.filter((r) => r.Id !== 65535));
    this.languages = languages;
    this.currencies = currencies;
    this.categories = this.sortAlpha(categories.filter((c) => c.Id !== 0));
    this.countries = this.sortAlpha(countries.filter((c) => c.Id !== 0));
    this.sounds = this.sortAlpha(sounds.filter((c) => c.Id !== 0));
    this.roleTypes = roles;
    this.awards = this.sortAlpha(awards.filter((r) => r.Id !== 0));
    this.movieRelations = this.sortAlpha(movieRelations.filter((r) => r.Id !== 0));
    this.ageRatings = [...ages].sort((a, b) =>
      this.ageLabel(Number(a.Value)).localeCompare(this.ageLabel(Number(b.Value)), 'fi', {
        sensitivity: 'base',
      })
    );
  }

  private sortAlpha(rows: LookupRow[]): LookupRow[] {
    return [...rows].sort((a, b) =>
      String(a.Value).localeCompare(String(b.Value), 'fi', { sensitivity: 'base' })
    );
  }

  sortedLookups(rows: LookupRow[], selectedId: number | null | undefined): LookupRow[] {
    const selected = selectedId != null && selectedId > 0 ? [selectedId] : [];
    return this.sortSelectedFirst(rows, selected);
  }

  sortedAgeRatings(): LookupRow[] {
    const selected =
      this.age == null ? [] : this.ageRatings.filter((r) => Number(r.Value) === this.age).map((r) => r.Id);
    return this.sortSelectedFirst(this.ageRatings, selected, (r) => this.ageLabel(Number(r.Value)));
  }

  private sortSelectedFirst(
    rows: LookupRow[],
    selectedIds: number[],
    labelFn: (r: LookupRow) => string = (r) => String(r.Value)
  ): LookupRow[] {
    const selected = new Set(selectedIds);
    const sel = rows.filter((r) => selected.has(r.Id));
    const rest = rows
      .filter((r) => !selected.has(r.Id))
      .sort((a, b) => labelFn(a).localeCompare(labelFn(b), 'fi', { sensitivity: 'base' }));
    return [...sel, ...rest];
  }

  ageLabel(value: number | null | undefined): string {
    return ageRatingLabel(value) || '-';
  }

  ageValue(row: LookupRow): number {
    return Number(row.Value);
  }

  ageSelectOptions(): LookupRow[] {
    return this.sortedAgeRatings().map((r) => {
      const value = this.ageValue(r);
      return { Id: value, Value: this.ageLabel(value) };
    });
  }

  close(): void {
    // No save → parent detail stays mounted; do not request a reload.
    void this.navigateAfterEdit(this.id || null, false);
  }

  async onTitleBlur(): Promise<void> {
    if (this.id) {
      return;
    }
    const trimmed = this.title.trim();
    if (!trimmed || trimmed.toLowerCase() === this.titleCheckedFor) {
      return;
    }
    this.titleCheckedFor = trimmed.toLowerCase();
    try {
      const hits = await this.movies.findExactTitleMatches(trimmed);
      if (!hits.length) {
        return;
      }
      this.titleMatches = hits;
      this.titleMatchOpen = true;
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    }
  }

  closeTitleMatches(): void {
    this.titleMatchOpen = false;
    this.titleMatches = [];
  }

  selectExistingTitleMatch(movieId: number): void {
    this.closeTitleMatches();
    void this.router.navigate(['/movie', movieId, 'edit']);
  }

  titleMatchDirectors(m: TitleMatch): string {
    return m.Directors.length ? m.Directors.join(', ') : '—';
  }

  private navigateAfterEdit(movieId: number | null, saved: boolean): void {
    if (saved && movieId) {
      this.detailRefresh.movieSaved(movieId);
    }
    const ret = this.route.snapshot.queryParamMap.get('return');
    if (ret) {
      void this.router.navigateByUrl(ret);
      return;
    }
    if (movieId) {
      void this.router.navigate(['/movie', movieId]);
      return;
    }
    void this.router.navigateByUrl('/');
  }

  private apply(m: Movie): void {
    this.title = decodeEntities(m.Title);
    this.yearText = m.Year != null ? String(m.Year) : '';
    this.versionId = m.VersionId && m.VersionId > 0 ? m.VersionId : null;
    this.ratioId = m.RatioId && m.RatioId > 0 ? m.RatioId : null;
    this.distributionId =
      m.DistributionId != null && m.DistributionId !== 65535 ? m.DistributionId : null;
    this.titleLanguageId = m.TitleLanguageId && m.TitleLanguageId > 0 ? m.TitleLanguageId : null;
    this.age = m.Age != null && m.Age !== 0 ? m.Age : null;
    const ntsc = resolveNtscMinutes(m.Ntsc, m.Pal);
    this.runtimeUnit = 'pal';
    this.runtimeMinutes = ntsc != null ? palMinutesFromNtsc(ntsc) : null;
    this.budgetText = m.Budget != null && m.Budget > 0 ? String(m.Budget) : '';
    this.currencyId = m.CurrencyId && m.CurrencyId > 0 ? m.CurrencyId : null;
  }

  clearSelect(field: 'age' | 'versionId' | 'ratioId' | 'currencyId' | 'distributionId'): void {
    if (field === 'age') {
      this.age = null;
      return;
    }
    this[field] = null;
  }

  private async loadLinkIds(movieId: number): Promise<void> {
    const [cats, countries, sounds, aka] = await Promise.all([
      getSupabase().from('CategoryLink').select('CategoryId').eq('MovieId', movieId).order('Sequence'),
      getSupabase().from('CountryLink').select('CountryId').eq('MovieId', movieId).order('Sequence'),
      getSupabase().from('SoundLink').select('SoundId').eq('MovieId', movieId).order('Sequence'),
      getSupabase().from('Aka').select('Title, TitleLanguageId').eq('MovieId', movieId),
    ]);
    this.categoryIds = ((cats.data as { CategoryId: number }[]) ?? []).map((r) => r.CategoryId);
    this.countryIds = ((countries.data as { CountryId: number }[]) ?? []).map((r) => r.CountryId);
    this.soundIds = ((sounds.data as { SoundId: number }[]) ?? []).map((r) => r.SoundId);
    this.aka = ((aka.data as { Title: string; TitleLanguageId: number }[]) ?? []).map((a) => ({
      title: decodeEntities(a.Title),
      titleLanguageId: a.TitleLanguageId,
    }));
  }

  labelOf(rows: LookupRow[], id: number): string {
    return this.lookups.label(rows, id);
  }

  /** PHP movie find_img query: swapped title + year + version + poster */
  imageSearchQuery(): string {
    const parts = [
      swapTitle(this.title, this.titleLanguageId).replace(/\s+/g, ' ').trim(),
      this.yearText.trim(),
    ];
    if (this.versionId) {
      const v = this.labelOf(this.versions, this.versionId).trim();
      if (v) {
        parts.push(v);
      }
    }
    parts.push('poster');
    return parts.filter(Boolean).join(' ');
  }

  get runtimeText(): string {
    return this.runtimeMinutes == null ? '' : String(this.runtimeMinutes);
  }

  onRuntimeText(raw: string): void {
    const cleaned = raw.replace(/\D+/g, '').slice(0, 4);
    this.runtimeMinutes = cleaned ? Number(cleaned) : null;
  }

  setRuntimeUnit(unit: 'ntsc' | 'pal'): void {
    if (unit === this.runtimeUnit) {
      return;
    }
    if (this.runtimeMinutes != null && this.runtimeMinutes > 0) {
      this.runtimeMinutes =
        unit === 'pal'
          ? palMinutesFromNtsc(this.runtimeMinutes)
          : ntscMinutesFromPal(this.runtimeMinutes);
    }
    this.runtimeUnit = unit;
  }

  private runtimeAsNtsc(): number | null {
    if (this.runtimeMinutes == null || this.runtimeMinutes <= 0) {
      return null;
    }
    return this.runtimeUnit === 'pal'
      ? ntscMinutesFromPal(this.runtimeMinutes)
      : this.runtimeMinutes;
  }

  roleLabel(value: string | number): string {
    return this.decode(String(value));
  }

  openCatalogAdd(table: CatalogTable): void {
    this.catalogAddTable = table;
    this.catalogEditId = null;
    this.catalogAddValue = '';
    this.catalogAddError = null;
    this.catalogAddOpen = true;
  }

  selectedAgeRatingId(): number | null {
    const row = this.ageRatings.find((r) => Number(r.Value) === this.age);
    return row?.Id ?? null;
  }

  openCatalogEdit(table: CatalogTable, id: number | null): void {
    if (id == null) {
      return;
    }
    const label = this.currentCatalogLabel(table, id);
    if (!label) {
      return;
    }
    this.catalogAddTable = table;
    this.catalogEditId = id;
    this.catalogAddValue = label;
    this.catalogAddError = null;
    this.catalogAddOpen = true;
  }

  private currentCatalogLabel(table: CatalogTable, id: number): string {
    if (table === 'AgeRating') {
      const row = this.ageRatings.find((r) => r.Id === id || Number(r.Value) === this.age);
      return row != null ? String(row.Value) : String(this.age ?? '');
    }
    const rows =
      table === 'Version'
        ? this.versions
        : table === 'Ratio'
          ? this.ratios
          : table === 'Distribution'
            ? this.distributions
            : table === 'TitleLanguage'
              ? this.languages
              : table === 'Category'
                ? this.categories
                : table === 'Country'
                  ? this.countries
                  : table === 'Sound'
                    ? this.sounds
                    : [];
    const hit = rows.find((r) => r.Id === id);
    return hit != null ? String(hit.Value) : '';
  }

  closeCatalogAdd(): void {
    this.catalogAddOpen = false;
    this.catalogAddTable = null;
    this.catalogEditId = null;
    this.catalogAddValue = '';
    this.catalogAddError = null;
  }

  catalogAddTitle(): string {
    const edit = this.catalogEditId != null;
    switch (this.catalogAddTable) {
      case 'AgeRating':
        return edit ? 'Muokkaa ikärajaa' : 'Uusi ikäraja';
      case 'Version':
        return edit ? 'Muokkaa versiota' : 'Uusi versio';
      case 'Ratio':
        return edit ? 'Muokkaa kuvasuhdetta' : 'Uusi kuvasuhde';
      case 'Category':
        return edit ? 'Muokkaa genreä' : 'Uusi genre';
      case 'Country':
        return edit ? 'Muokkaa maata' : 'Uusi maa';
      case 'Sound':
        return edit ? 'Muokkaa ääntä' : 'Uusi ääni';
      case 'Distribution':
        return edit ? 'Muokkaa levitystä' : 'Uusi levitys';
      case 'TitleLanguage':
        return edit ? 'Muokkaa kieltä' : 'Uusi kieli';
      case 'Award':
        return edit ? 'Muokkaa palkintoa' : 'Uusi palkinto';
      case 'MovieRelation':
        return edit ? 'Muokkaa elokuvasuhdetta' : 'Uusi elokuvasuhde';
      default:
        return edit ? 'Muokkaa arvoa' : 'Uusi arvo';
    }
  }

  async saveCatalogAdd(): Promise<void> {
    const table = this.catalogAddTable;
    if (!table) {
      return;
    }
    try {
      if (this.catalogEditId != null) {
        await this.catalog.updateValue(table, this.catalogEditId, this.catalogAddValue);
        this.lookups.invalidate(table);
        await this.reloadLookups();
        if (table === 'AgeRating') {
          const row = this.ageRatings.find((r) => r.Id === this.catalogEditId);
          this.age = row ? Number(row.Value) : Number(this.catalogAddValue.replace(/\D+/g, '')) || null;
        }
        this.closeCatalogAdd();
        return;
      }
      const id = await this.catalog.addValue(table, this.catalogAddValue);
      this.lookups.invalidate(table);
      await this.reloadLookups();
      if (table === 'AgeRating') {
        const row = this.ageRatings.find((r) => r.Id === id);
        this.age = row ? Number(row.Value) : Number(this.catalogAddValue.replace(/\D+/g, '')) || null;
      } else if (table === 'Version') {
        this.versionId = id;
      } else if (table === 'Ratio') {
        this.ratioId = id;
      } else if (table === 'Category' && !this.categoryIds.includes(id)) {
        this.categoryIds = [...this.categoryIds, id];
      } else if (table === 'Country' && !this.countryIds.includes(id)) {
        this.countryIds = [...this.countryIds, id];
      } else if (table === 'Sound' && !this.soundIds.includes(id)) {
        this.soundIds = [...this.soundIds, id];
      } else if (table === 'Distribution') {
        this.distributionId = id;
      } else if (table === 'TitleLanguage') {
        this.titleLanguageId = id;
      } else if (table === 'Award') {
        this.awardIdDraft = id;
        this.onAwardSelected();
      } else if (table === 'MovieRelation') {
        this.movieLinkRelationId = id;
        this.onMovieLinkRelationSelected();
      }
      this.closeCatalogAdd();
    } catch (e: unknown) {
      this.catalogAddError = errorMessage(e);
    }
  }

  async deleteCatalogOption(table: CatalogTable, opt: LookupRow): Promise<void> {
    if (!(await confirmAction(`Poistetaanko "${opt.Value}" valintalistasta?`))) {
      return;
    }
    try {
      await this.catalog.deleteValue(table, opt.Id);
      this.lookups.invalidate(table);
      if (table === 'AgeRating' && this.age === Number(opt.Value)) {
        this.age = null;
      }
      if (table === 'Version' && this.versionId === opt.Id) {
        this.versionId = null;
      }
      if (table === 'Ratio' && this.ratioId === opt.Id) {
        this.ratioId = null;
      }
      if (table === 'Category') {
        this.categoryIds = this.categoryIds.filter((id) => id !== opt.Id);
      }
      if (table === 'Country') {
        this.countryIds = this.countryIds.filter((id) => id !== opt.Id);
      }
      if (table === 'Sound') {
        this.soundIds = this.soundIds.filter((id) => id !== opt.Id);
      }
      await this.reloadLookups();
    } catch (e: unknown) {
      await showError(errorMessage(e));
    }
  }

  async deleteSelectedCatalog(table: 'Version' | 'Ratio' | 'AgeRating'): Promise<void> {
    if (table === 'AgeRating') {
      const opt = this.ageRatings.find((r) => Number(r.Value) === this.age);
      if (!opt) {
        return;
      }
      await this.deleteCatalogOption(table, opt);
      return;
    }
    const id = table === 'Version' ? this.versionId : this.ratioId;
    const rows = table === 'Version' ? this.versions : this.ratios;
    const opt = rows.find((r) => r.Id === id);
    if (!opt) {
      return;
    }
    await this.deleteCatalogOption(table, opt);
  }

  addAka(): void {
    const t = this.akaTitle.trim();
    if (!t) {
      return;
    }
    if (this.editingAkaIndex != null) {
      this.aka = this.aka.map((a, i) =>
        i === this.editingAkaIndex ? { title: t, titleLanguageId: this.akaLangId } : a
      );
      this.editingAkaIndex = null;
    } else {
      this.aka = [...this.aka, { title: t, titleLanguageId: this.akaLangId }];
    }
    this.akaTitle = '';
  }

  editAka(i: number): void {
    const a = this.aka[i];
    if (!a) {
      return;
    }
    this.editingAkaIndex = i;
    this.akaTitle = a.title;
    this.akaLangId = a.titleLanguageId;
  }

  cancelAkaEdit(): void {
    this.editingAkaIndex = null;
    this.akaTitle = '';
  }

  async removeAka(i: number): Promise<void> {
    if (!(await confirmAction('Poistetaanko tämä AKA-nimi?'))) {
      return;
    }
    if (this.editingAkaIndex === i) {
      this.cancelAkaEdit();
    } else if (this.editingAkaIndex != null && this.editingAkaIndex > i) {
      this.editingAkaIndex -= 1;
    }
    this.aka = this.aka.filter((_, idx) => idx !== i);
  }

  addTrivia(): void {
    const t = this.triviaDraft.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) {
      return;
    }
    this.triviaItems = [...this.triviaItems, t];
    this.triviaDraft = '';
  }

  async removeTrivia(i: number): Promise<void> {
    if (!(await confirmAction('Poistetaanko tämä trivia?'))) {
      return;
    }
    this.triviaItems = this.triviaItems.filter((_, idx) => idx !== i);
  }

  onRoleQueryInput(roleId: number, value: string): void {
    this.roleQuery[roleId] = value;
    const existing = this.roleSearchTimers[roleId];
    if (existing) {
      clearTimeout(existing);
    }
    this.roleSearchTimers[roleId] = setTimeout(() => void this.searchPeopleForRole(roleId), 250);
  }

  async searchPeopleForRole(roleId: number): Promise<void> {
    const q = (this.roleQuery[roleId] || '').trim();
    if (q.length < 2) {
      this.roleHits = { ...this.roleHits, [roleId]: [] };
      return;
    }
    const hits = await this.people.searchNameExact(q, 30);
    this.roleHits = { ...this.roleHits, [roleId]: hits };
  }

  async openPersonPreview(p: Person, roleId: number): Promise<void> {
    this.activeRoleIdForPerson = roleId;
    this.personPreviewOpen = true;
    this.personPreview = null;
    this.personPreviewLoading = true;
    try {
      this.personPreview = await this.people.getDetails(p.Id);
    } finally {
      this.personPreviewLoading = false;
    }
  }

  closePersonPreview(): void {
    this.personPreviewOpen = false;
    this.personPreview = null;
  }

  confirmPersonFromPreview(): void {
    const p = this.personPreview?.person;
    if (!p) {
      return;
    }
    this.addPerson(p, this.activeRoleIdForPerson);
    this.closePersonPreview();
  }

  addPerson(p: Person, roleId: number): void {
    if (this.roles.some((r) => r.personId === p.Id && r.roleId === roleId)) {
      return;
    }
    this.roles = [...this.roles, { roleId, personId: p.Id, name: decodeEntities(p.Name) }];
    this.roleQuery[roleId] = '';
    this.roleHits = { ...this.roleHits, [roleId]: [] };
  }

  openNewPerson(roleId: number): void {
    this.activeRoleIdForPerson = roleId;
    this.newPersonInitialName = (this.roleQuery[roleId] || '').trim();
    this.newPersonGender = 0;
    this.newPersonOpen = true;
  }

  closeNewPerson(): void {
    this.newPersonOpen = false;
    this.newPersonInitialName = '';
    this.newPersonGender = 0;
  }

  onPersonFormSaved(person: Person): void {
    this.addPerson(person, this.activeRoleIdForPerson);
    this.closeNewPerson();
  }

  removeRole(personId: number, roleId: number): void {
    this.roles = this.roles.filter((r) => !(r.personId === personId && r.roleId === roleId));
  }

  rolesFor(roleId: number): RolePick[] {
    return this.roles.filter((r) => r.roleId === roleId);
  }

  onRoleDragStart(roleId: number, index: number, event: DragEvent): void {
    this.dragRoleId = roleId;
    this.dragFromIndex = index;
    event.dataTransfer?.setData('text/plain', `${roleId}:${index}`);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onRoleDragEnd(): void {
    this.dragRoleId = null;
    this.dragFromIndex = null;
    this.dragOverRoleId = null;
    this.dragOverIndex = null;
  }

  onRoleDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onChipDragOver(roleId: number, index: number, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverRoleId = roleId;
    this.dragOverIndex = index;
  }

  onRoleDrop(roleId: number, event: DragEvent): void {
    event.preventDefault();
    if (this.dragRoleId !== roleId || this.dragFromIndex == null) {
      this.onRoleDragEnd();
      return;
    }
    const list = this.rolesFor(roleId);
    this.reorderRole(roleId, this.dragFromIndex, list.length - 1);
    this.onRoleDragEnd();
  }

  onChipDrop(roleId: number, toIndex: number, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.dragRoleId !== roleId || this.dragFromIndex == null) {
      this.onRoleDragEnd();
      return;
    }
    this.reorderRole(roleId, this.dragFromIndex, toIndex);
    this.onRoleDragEnd();
  }

  private reorderRole(roleId: number, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) {
      return;
    }
    const group = this.rolesFor(roleId);
    if (fromIndex < 0 || fromIndex >= group.length || toIndex < 0 || toIndex >= group.length) {
      return;
    }
    const moved = group[fromIndex];
    const nextGroup = [...group];
    nextGroup.splice(fromIndex, 1);
    nextGroup.splice(toIndex, 0, moved);
    const others = this.roles.filter((r) => r.roleId !== roleId);
    this.roles = [...others, ...nextGroup];
  }

  personBirthLabel(p: PersonDetails | null): string {
    if (!p) {
      return '';
    }
    const d = this.formatDate(p.person.BirthDate);
    const country = p.birthCountry;
    return [d, country].filter(Boolean).join(', ');
  }

  canSave(): boolean {
    return !!this.title.trim() && !!this.yearText.trim() && !!this.titleLanguageId;
  }

  async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const year = this.yearText.trim() ? Number(this.yearText) : null;
      const budgetRaw = this.budgetText.trim() ? Number(this.budgetText) : null;
      const budget = budgetRaw != null && Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null;
      const fk = (id: number | null | undefined) => (id != null && id > 0 ? id : null);
      const payload: Partial<Movie> & { Title: string } = {
        Title: this.title.trim(),
        Year: year != null && Number.isFinite(year) ? year : null,
        VersionId: fk(this.versionId),
        RatioId: fk(this.ratioId),
        DistributionId:
          this.distributionId != null && this.distributionId !== 65535 ? this.distributionId : null,
        TitleLanguageId: fk(this.titleLanguageId),
        Age: this.age != null && this.age > 0 ? this.age : null,
        Ntsc: this.runtimeAsNtsc(),
        Pal: null,
        Budget: budget,
        CurrencyId: fk(this.currencyId),
      };
      if (this.id) {
        payload.Id = this.id;
      }
      const id = await this.movies.saveMovie(payload, this.text, {
        categoryIds: this.categoryIds,
        countryIds: this.countryIds,
        soundIds: this.soundIds,
        roles: this.roles.map((r) => ({ roleId: r.roleId, personId: r.personId })),
        aka: this.aka,
        trivia: this.triviaItems.map((t) => t.trim()).filter(Boolean),
        awards: this.awardItems.map((a) => ({
          awardId: a.awardId,
          personId: a.personId,
        })),
        movieLinks: this.movieLinkItems.map((l) => ({
          destinationId: l.destinationId,
          relationId: l.relationId,
        })),
      });
      this.navigateAfterEdit(id, true);
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
