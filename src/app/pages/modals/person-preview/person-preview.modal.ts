import { Component, EventEmitter, Input, Output } from '@angular/core';
import { PersonDetails } from '../../../data/person.service';
import { formatAppDate } from '../../../core/datetime.util';
import { swapNames } from '../../../core/format.util';

@Component({
  selector: 'app-person-preview-modal',
  standalone: true,
  templateUrl: './person-preview.modal.html',
  styleUrl: './person-preview.modal.scss',
})
export class PersonPreviewModal {
  @Input({ required: true }) open = false;
  @Input() loading = false;
  @Input() preview: PersonDetails | null = null;

  @Output() readonly confirm = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly swapNames = swapNames;

  title(): string {
    return this.preview ? swapNames(this.preview.person.Name) : 'Vahvista henkilö';
  }

  birthLabel(): string {
    if (!this.preview) {
      return '';
    }
    const date = formatAppDate(this.preview.person.BirthDate);
    const country = this.preview.birthCountry;
    if (!date && !country) {
      return '';
    }
    return `s. ${[date, country].filter(Boolean).join(' ')}`.trim();
  }
}
