import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  forwardRef,
  signal,
} from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { LookupRow } from '../core/models';

@Component({
  selector: 'app-search-select',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="ss" [class.open]="open()" [class.disabled]="disabled">
      <button type="button" class="ss-trigger" (click)="toggleOpen($event)" [disabled]="disabled">
        <span class="ss-value" [class.placeholder]="!selectedLabel()">{{ selectedLabel() || placeholder }}</span>
        <span class="ss-caret" aria-hidden="true">▾</span>
      </button>
      @if (open()) {
        <div class="ss-panel" role="listbox" (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()">
          @if (searchable) {
            <input
              class="ss-search"
              type="search"
              [(ngModel)]="query"
              (ngModelChange)="onQuery()"
              placeholder="Hae…"
              autocomplete="off"
              (keydown.escape)="closePanel()"
            />
          }
          <div class="ss-list">
            @for (opt of filteredOptions(); track opt.Id) {
              <button
                type="button"
                class="ss-option"
                [class.active]="opt.Id === value"
                (click)="pick(opt.Id)"
              >
                {{ labelFor(opt) }}
              </button>
            } @empty {
              <div class="ss-empty">Ei osumia</div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: fit-content;
      min-width: 7.5rem;
      max-width: 100%;
    }
    :host(.stretch) {
      width: 100%;
    }
    :host(.compact) {
      min-width: 4.25rem;
    }
    .ss {
      position: relative;
      width: fit-content;
      min-width: 7.5rem;
      max-width: 100%;
    }
    :host(.stretch) .ss {
      width: 100%;
    }
    :host(.compact) .ss {
      min-width: 4.25rem;
    }
    .ss-trigger {
      width: max-content;
      min-width: 7.5rem;
      max-width: 100%;
      min-height: 2.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: var(--mm-field-pad-y, 0.55rem) var(--mm-field-pad-x, 0.75rem);
      border: 1px solid var(--mm-field-border, #d0d8e0);
      border-radius: var(--mm-field-radius, 8px);
      background: var(--mm-field-bg, #fbfcfd);
      color: #111;
      font: inherit;
      font-weight: 400;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
    }
    :host(.stretch) .ss-trigger {
      width: 100%;
    }
    :host(.compact) .ss-trigger {
      min-width: 4.25rem;
      padding-left: 0.45rem;
      padding-right: 0.45rem;
    }
    .ss.open .ss-trigger,
    .ss-trigger:focus {
      outline: none;
      border-color: var(--mm-accent, #1f4b7a);
      background: #fff;
      box-shadow: 0 0 0 3px var(--mm-accent-soft, rgba(31, 75, 122, 0.14));
    }
    .ss.disabled .ss-trigger {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .ss-value {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #111;
    }
    .ss-value.placeholder {
      color: #111;
      opacity: 0.55;
    }
    .ss-caret {
      color: #111;
      font-size: 0.75rem;
    }
    .ss-panel {
      position: absolute;
      z-index: 200;
      top: calc(100% + 4px);
      left: 0;
      min-width: 100%;
      width: max-content;
      max-width: min(24rem, 90vw);
      display: grid;
      gap: 0.35rem;
      padding: 0.45rem;
      border: 1px solid #c5ced8;
      border-radius: 6px;
      background: #fff;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
    }
    .ss-search {
      width: 100%;
      box-sizing: border-box;
      margin: 0;
    }
    .ss-list {
      max-height: min(14rem, 40vh);
      overflow: auto;
      display: grid;
      gap: 0.1rem;
    }
    .ss-option {
      width: 100%;
      text-align: left;
      padding: 0.4rem 0.5rem;
      border: 0;
      border-radius: 4px;
      background: #f3f6f9;
      color: #111;
      font: inherit;
      cursor: pointer;
    }
    .ss-option:hover,
    .ss-option.active {
      background: #1f4b7a;
      color: #fff;
    }
    .ss-empty {
      padding: 0.45rem;
      color: #777;
      font-size: 0.9rem;
    }
  `,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SearchSelectComponent),
      multi: true,
    },
  ],
})
export class SearchSelectComponent implements ControlValueAccessor, OnInit, OnDestroy {
  @Input() options: LookupRow[] = [];
  @Input() placeholder = 'Valitse…';
  @Input() labelMap: Record<number, string> | null = null;
  @Input() searchable = true;
  @Output() readonly opened = new EventEmitter<void>();

  readonly open = signal(false);
  readonly filteredOptions = signal<LookupRow[]>([]);
  query = '';
  value: number | null = null;
  disabled = false;

  private onChange: (v: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private readonly onDocPointer = (event: Event) => this.handleOutside(event);

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    document.addEventListener('pointerdown', this.onDocPointer, true);
    this.refreshFilter();
  }

  ngOnDestroy(): void {
    document.removeEventListener('pointerdown', this.onDocPointer, true);
  }

  selectedLabel(): string {
    if (this.value == null) {
      return '';
    }
    const opt = this.options.find((o) => o.Id === this.value);
    return opt ? this.labelFor(opt) : '';
  }

  labelFor(opt: LookupRow): string {
    return this.labelMap?.[opt.Id] ?? String(opt.Value);
  }

  toggleOpen(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.disabled) {
      return;
    }
    if (this.open()) {
      this.closePanel();
    } else {
      this.query = '';
      this.refreshFilter();
      this.open.set(true);
      this.opened.emit();
      if (this.searchable) {
        queueMicrotask(() => {
          const input = this.host.nativeElement.querySelector('.ss-search') as HTMLInputElement | null;
          input?.focus();
        });
      }
    }
  }

  closePanel(): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    this.onTouched();
  }

  onQuery(): void {
    this.refreshFilter();
  }

  pick(id: number): void {
    this.value = id;
    this.onChange(id);
    this.onTouched();
    this.closePanel();
  }

  writeValue(value: number | null): void {
    // Allow Id 0 (e.g. Distribution Elokuvateatteri). Only null means empty.
    this.value = value == null ? null : value;
  }

  registerOnChange(fn: (v: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  private refreshFilter(): void {
    const q = this.query.trim().toLowerCase();
    const selected = this.value;
    const rows = [...this.options].sort((a, b) => {
      if (a.Id === selected) {
        return -1;
      }
      if (b.Id === selected) {
        return 1;
      }
      return this.labelFor(a).localeCompare(this.labelFor(b), 'fi', { sensitivity: 'base' });
    });
    this.filteredOptions.set(
      q ? rows.filter((o) => this.labelFor(o).toLowerCase().includes(q)) : rows
    );
  }

  private handleOutside(event: Event): void {
    if (!this.open()) {
      return;
    }
    const target = event.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) {
      return;
    }
    this.closePanel();
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    this.closePanel();
  }
}
