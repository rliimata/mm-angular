import { Component, OnDestroy, OnInit, signal } from '@angular/core';
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

interface RolePick {
  roleId: number;
  personId: number;
  name: string;
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
export class MovieEditPage implements OnInit, OnDestroy {
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

  akaTitle = '';
  akaLangId = 2;
  editingAkaIndex: number | null = null;
  roleQuery: Record<number, string> = {};
  roleHits: Record<number, Person[]> = {};
  private roleSearchTimers: Record<number, ReturnType<typeof setTimeout> | null> = {};
  activeRoleIdForPerson = 1;
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

  catalogAddOpen = false;
  catalogAddTable: CatalogTable | null = null;
  catalogAddValue = '';
  catalogAddError: string | null = null;

  personPreviewOpen = false;
  personPreview: PersonDetails | null = null;
  personPreviewLoading = false;

  newPersonOpen = false;
  newPersonInitialName = '';
  newPersonGender = 0;

  editTab: 'basic' | 'extra' | 'people' = 'basic';

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
    private readonly detailRefresh: DetailRefreshService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.reloadLookups();
    const param =
      this.route.snapshot.paramMap.get('id') ?? this.route.parent?.snapshot.paramMap.get('id');
    if (param && param !== 'new') {
      this.id = Number(param);
      const details = await this.movies.getDetails(this.id);
      if (!details) {
        this.error.set('Elokuvaa ei löytynyt.');
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
    }
  }

  ngOnDestroy(): void {
    for (const timer of Object.values(this.roleSearchTimers)) {
      if (timer) {
        clearTimeout(timer);
      }
    }
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
    this.catalogAddValue = '';
    this.catalogAddError = null;
    this.catalogAddOpen = true;
  }

  closeCatalogAdd(): void {
    this.catalogAddOpen = false;
    this.catalogAddTable = null;
    this.catalogAddValue = '';
    this.catalogAddError = null;
  }

  catalogAddTitle(): string {
    switch (this.catalogAddTable) {
      case 'AgeRating':
        return 'Uusi ikäraja';
      case 'Version':
        return 'Uusi versio';
      case 'Ratio':
        return 'Uusi kuvasuhde';
      case 'Category':
        return 'Uusi genre';
      case 'Country':
        return 'Uusi maa';
      case 'Sound':
        return 'Uusi ääni';
      case 'Distribution':
        return 'Uusi levitys';
      case 'TitleLanguage':
        return 'Uusi kieli';
      default:
        return 'Uusi arvo';
    }
  }

  async saveCatalogAdd(): Promise<void> {
    const table = this.catalogAddTable;
    if (!table) {
      return;
    }
    try {
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
      });
      this.navigateAfterEdit(id, true);
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
