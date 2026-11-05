import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-catalog-add-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './catalog-add.modal.html',
  styleUrl: './catalog-add.modal.scss',
})
export class CatalogAddModal {
  @Input({ required: true }) open = false;
  @Input() title = 'Uusi arvo';
  @Input() value = '';
  @Input() error: string | null = null;
  @Input() saving = false;

  @Output() readonly valueChange = new EventEmitter<string>();
  @Output() readonly save = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();

  onValue(v: string): void {
    this.valueChange.emit(v);
  }
}
