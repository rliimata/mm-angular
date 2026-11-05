import { Component, forwardRef } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { DigitsOnlyDirective } from './digits-only.directive';

export interface FlexibleDateValue {
  year: number;
  month: number;
  day: number;
}

@Component({
  selector: 'app-flexible-date',
  standalone: true,
  imports: [FormsModule, DigitsOnlyDirective],
  template: `
    <div class="fd" [class.disabled]="disabled">
      <input
        class="fd-part fd-day"
        type="text"
        inputmode="numeric"
        maxlength="2"
        appDigitsOnly
        [ngModel]="dayText"
        (ngModelChange)="onDay($event)"
        [ngModelOptions]="{ standalone: true }"
        placeholder="pp"
        [disabled]="disabled"
        aria-label="Päivä"
        title="Päivä (valinnainen)"
      />
      <span class="fd-sep" aria-hidden="true">.</span>
      <input
        class="fd-part fd-month"
        type="text"
        inputmode="numeric"
        maxlength="2"
        appDigitsOnly
        [ngModel]="monthText"
        (ngModelChange)="onMonth($event)"
        [ngModelOptions]="{ standalone: true }"
        placeholder="kk"
        [disabled]="disabled"
        aria-label="Kuukausi"
        title="Kuukausi (valinnainen)"
      />
      <span class="fd-sep" aria-hidden="true">.</span>
      <input
        class="fd-part fd-year"
        type="text"
        inputmode="numeric"
        maxlength="4"
        appDigitsOnly
        [ngModel]="yearText"
        (ngModelChange)="onYear($event)"
        [ngModelOptions]="{ standalone: true }"
        placeholder="vvvv"
        [disabled]="disabled"
        aria-label="Vuosi"
        title="Vuosi"
      />
      @if (yearText || monthText || dayText) {
        <button
          type="button"
          class="fd-clear"
          (click)="clear()"
          [disabled]="disabled"
          aria-label="Tyhjennä"
          title="Tyhjennä"
        >
          −
        </button>
      }
    </div>
  `,
  styles: [
    `
      .fd {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        padding: 0;
        border: 0;
        background: transparent;
        width: fit-content;
        max-width: 100%;
        box-shadow: none;
      }
      .fd.disabled {
        opacity: 0.6;
      }
      .fd-part {
        border: 0 !important;
        background: transparent !important;
        padding: 0.2rem 0.1rem !important;
        font: inherit;
        font-variant-numeric: tabular-nums;
        text-align: center;
        box-sizing: border-box;
        box-shadow: none !important;
        border-radius: 4px;
      }
      .fd-part:hover,
      .fd-part:focus {
        outline: none !important;
        border: 0 !important;
        box-shadow: none !important;
        background: #eef3f8 !important;
      }
      .fd-day,
      .fd-month {
        width: 2.4ch !important;
        min-width: 2.4ch !important;
        max-width: 2.4ch !important;
      }
      .fd-year {
        width: 4.4ch !important;
        min-width: 4.4ch !important;
        max-width: 4.4ch !important;
      }
      .fd-sep {
        color: #888;
        user-select: none;
      }
      .fd-clear {
        width: 1.4rem;
        height: 1.4rem;
        margin-left: 0.15rem;
        padding: 0;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: #8a5a2b;
        font: inherit;
        font-size: 1.05rem;
        line-height: 1;
        cursor: pointer;
        display: grid;
        place-items: center;
      }
      .fd-clear:hover:not(:disabled) {
        background: rgba(0, 0, 0, 0.05);
      }
      .fd-clear:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FlexibleDateComponent),
      multi: true,
    },
  ],
})
export class FlexibleDateComponent implements ControlValueAccessor {
  dayText = '';
  monthText = '';
  yearText = '';
  disabled = false;

  private onChange: (v: FlexibleDateValue) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: FlexibleDateValue | null): void {
    const next = value ?? { year: 0, month: 0, day: 0 };
    this.dayText = next.day > 0 ? String(next.day) : '';
    this.monthText = next.month > 0 ? String(next.month) : '';
    this.yearText = next.year > 0 ? String(next.year) : '';
  }

  registerOnChange(fn: (v: FlexibleDateValue) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onDay(raw: string): void {
    this.dayText = digits(raw, 2);
    this.emit();
  }

  onMonth(raw: string): void {
    this.monthText = digits(raw, 2);
    this.emit();
  }

  onYear(raw: string): void {
    this.yearText = digits(raw, 4);
    this.emit();
  }

  clear(): void {
    this.dayText = '';
    this.monthText = '';
    this.yearText = '';
    this.emit();
  }

  private emit(): void {
    const year = this.yearText ? Number(this.yearText) : 0;
    let month = this.monthText ? Number(this.monthText) : 0;
    let day = this.dayText ? Number(this.dayText) : 0;
    if (month < 0 || month > 12) {
      month = 0;
    }
    if (day < 0 || day > 31) {
      day = 0;
    }
    // Year-only: ignore orphan day/month without year.
    if (!year) {
      this.onChange({ year: 0, month: 0, day: 0 });
    } else if (!month) {
      this.onChange({ year, month: 0, day: 0 });
    } else {
      this.onChange({ year, month, day: day || 0 });
    }
    this.onTouched();
  }
}

function digits(raw: string, max: number): string {
  return raw.replace(/\D+/g, '').slice(0, max);
}
