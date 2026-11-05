import { NgStyle } from '@angular/common';
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
} from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { LookupRow } from '../core/models';

@Component({
  selector: 'app-multi-check-select',
  standalone: true,
  imports: [NgStyle, FormsModule],
  template: `
    <div class="mcs" [class.open]="open" [class.disabled]="disabled">
      <button type="button" class="mcs-trigger" (click)="toggleOpen($event)" [disabled]="disabled">
        <span class="mcs-values" [class.placeholder]="!selectedLabels.length">
          @if (selectedLabels.length) {
            @for (label of selectedLabels; track $index) {
              <span class="mcs-line">{{ label }}</span>
            }
          } @else {
            {{ placeholder }}
          }
        </span>
        <span class="mcs-caret" aria-hidden="true">▾</span>
      </button>
      @if (open) {
        <div
          class="mcs-panel"
          role="listbox"
          [ngStyle]="panelStyle"
          (mousedown)="$event.stopPropagation()"
          (click)="$event.stopPropagation()"
        >
          <input
            class="mcs-search"
            type="search"
            [(ngModel)]="query"
            placeholder="Hae…"
            autocomplete="off"
            (keydown.escape)="closePanel()"
          />
          @for (opt of filteredOptions; track opt.Id) {
            <div class="mcs-option-row">
              <label class="mcs-option">
                <input
                  type="checkbox"
                  [checked]="isSelected(opt.Id)"
                  (change)="toggleId(opt.Id)"
                  [disabled]="disabled"
                />
                <span>{{ labelFor(opt) }}</span>
              </label>
              @if (allowDelete) {
                <button
                  type="button"
                  class="mcs-delete"
                  (click)="onDelete(opt, $event)"
                  [disabled]="disabled"
                  aria-label="Poista"
                  title="Poista"
                >
                  ×
                </button>
              }
            </div>
          }
          @if (!filteredOptions.length) {
            <div class="mcs-empty">{{ options.length ? 'Ei osumia' : 'Ei vaihtoehtoja' }}</div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 100%;
      }
      .mcs {
        position: relative;
      }
      .mcs-trigger {
        width: 100%;
        min-height: 2.5rem;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;
        padding: var(--mm-field-pad-y, 0.55rem) var(--mm-field-pad-x, 0.75rem);
        border: 1px solid var(--mm-field-border, #d0d8e0);
        border-radius: var(--mm-field-radius, 8px);
        background: var(--mm-field-bg, #fbfcfd);
        color: #111;
        font: inherit;
        text-align: left;
        cursor: pointer;
        box-sizing: border-box;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease,
          background-color 0.15s ease;
      }
      .mcs-trigger:hover {
        border-color: var(--mm-field-border-hover, #aeb9c5);
      }
      .mcs.open .mcs-trigger,
      .mcs-trigger:focus {
        outline: none;
        border-color: var(--mm-accent, #1f4b7a);
        background: #fff;
        box-shadow: 0 0 0 3px var(--mm-accent-soft, rgba(31, 75, 122, 0.14));
      }
      .mcs.disabled .mcs-trigger {
        opacity: 0.65;
        cursor: not-allowed;
      }
      .mcs-values {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        flex-direction: row;
        gap: 0.15rem 0.35rem;
        color: #111;
        line-height: 1.35;
      }
      .mcs-line {
        display: inline;
        white-space: nowrap;
      }
      .mcs-line:not(:last-child)::after {
        content: ',';
      }
      .mcs-values.placeholder {
        color: #111;
        opacity: 0.55;
      }
      .mcs-caret {
        flex: 0 0 auto;
        color: #111;
        font-size: 0.75rem;
        margin-top: 0.2rem;
      }
      .mcs-panel {
        position: fixed;
        z-index: 300;
        max-height: min(18rem, 50vh);
        overflow: auto;
        border: 1px solid #c5ced8;
        border-radius: 6px;
        background: #fff;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
        padding: 0.35rem;
        box-sizing: border-box;
        display: grid;
        gap: 0.25rem;
      }
      .mcs-search {
        width: 100%;
        box-sizing: border-box;
        margin: 0;
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .mcs-option-row {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .mcs-option {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.35rem 0.4rem;
        border-radius: 4px;
        font-size: 0.9rem;
        cursor: pointer;
      }
      .mcs-option:hover {
        background: #f3f6f9;
      }
      .mcs-option input {
        width: auto;
        margin: 0;
        flex: 0 0 auto;
      }
      .mcs-delete {
        flex: 0 0 auto;
        width: 1.6rem;
        height: 1.6rem;
        padding: 0;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: #8b1e1e;
        font-size: 1.15rem;
        line-height: 1;
        cursor: pointer;
      }
      .mcs-delete:hover {
        background: rgba(139, 30, 30, 0.08);
      }
      .mcs-empty {
        padding: 0.5rem;
        color: #777;
        font-size: 0.85rem;
      }
    `,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MultiCheckSelectComponent),
      multi: true,
    },
  ],
})
export class MultiCheckSelectComponent implements ControlValueAccessor, OnInit, OnDestroy {
  @Input() options: LookupRow[] = [];
  @Input() placeholder = 'Valitse…';
  @Input() labelMap: Record<number, string> | null = null;
  @Input() allowDelete = false;
  @Output() deleteOption = new EventEmitter<LookupRow>();

  open = false;
  disabled = false;
  query = '';
  panelStyle: Record<string, string> = {};
  private value: number[] = [];
  private onChange: (v: number[]) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private readonly onDocPointer = (event: Event) => this.handleOutsidePointer(event);
  private readonly onDocKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.open) {
      this.closePanel();
    }
  };

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  private readonly onScroll = (): void => {
    if (this.open) {
      this.positionPanel();
    }
  };

  ngOnInit(): void {
    // Capture phase so modal stopPropagation cannot trap the menu open.
    document.addEventListener('pointerdown', this.onDocPointer, true);
    document.addEventListener('keydown', this.onDocKey, true);
    // Keep fixed panel glued to trigger while modal/page scrolls.
    document.addEventListener('scroll', this.onScroll, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    document.removeEventListener('keydown', this.onDocKey, true);
    document.removeEventListener('scroll', this.onScroll, true);
  }

  get selectedLabels(): string[] {
    return this.value
      .map((id) => {
        const opt = this.options.find((o) => o.Id === id);
        return opt ? this.labelFor(opt) : '';
      })
      .filter(Boolean);
  }

  get sortedOptions(): LookupRow[] {
    const selected = new Set(this.value);
    const sel = this.options.filter((o) => selected.has(o.Id));
    const rest = this.options
      .filter((o) => !selected.has(o.Id))
      .sort((a, b) =>
        this.labelFor(a).localeCompare(this.labelFor(b), 'fi', { sensitivity: 'base' })
      );
    return [...sel, ...rest];
  }

  get filteredOptions(): LookupRow[] {
    const q = this.query.trim().toLowerCase();
    const rows = this.sortedOptions;
    return q ? rows.filter((o) => this.labelFor(o).toLowerCase().includes(q)) : rows;
  }

  labelFor(opt: LookupRow): string {
    return this.labelMap?.[opt.Id] ?? String(opt.Value);
  }

  isSelected(id: number): boolean {
    return this.value.includes(id);
  }

  toggleOpen(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.disabled) {
      return;
    }
    if (this.open) {
      this.closePanel();
    } else {
      this.query = '';
      this.open = true;
      // Position after open so panel exists in layout measurements.
      queueMicrotask(() => {
        this.positionPanel();
        const input = this.host.nativeElement.querySelector('.mcs-search') as HTMLInputElement | null;
        input?.focus();
      });
    }
  }

  closePanel(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.onTouched();
  }

  private handleOutsidePointer(event: Event): void {
    if (!this.open) {
      return;
    }
    const target = event.target as Node | null;
    if (!target) {
      return;
    }
    if (this.host.nativeElement.contains(target)) {
      return;
    }
    this.closePanel();
  }

  private positionPanel(): void {
    const trigger = this.host.nativeElement.querySelector('.mcs-trigger') as HTMLElement | null;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const panelMax = Math.min(224, window.innerHeight * 0.4);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openUp = spaceBelow < Math.min(panelMax, 160) && rect.top > spaceBelow;
    const width = Math.max(rect.width, 180);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    if (openUp) {
      this.panelStyle = {
        top: 'auto',
        bottom: `${window.innerHeight - rect.top + 4}px`,
        left: `${Math.max(8, left)}px`,
        width: `${width}px`,
      };
    } else {
      this.panelStyle = {
        top: `${rect.bottom + 4}px`,
        bottom: 'auto',
        left: `${Math.max(8, left)}px`,
        width: `${width}px`,
      };
    }
  }

  toggleId(id: number): void {
    const next = this.value.includes(id) ? this.value.filter((x) => x !== id) : [...this.value, id];
    this.value = next;
    this.onChange([...next]);
    this.onTouched();
  }

  onDelete(opt: LookupRow, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.deleteOption.emit(opt);
  }

  writeValue(value: number[] | null): void {
    const next = Array.isArray(value) ? value : [];
    if (sameIds(this.value, next)) {
      return;
    }
    this.value = [...next];
  }

  registerOnChange(fn: (v: number[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  @HostListener('window:resize')
  onViewportChange(): void {
    if (this.open) {
      this.positionPanel();
    }
  }
}

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
