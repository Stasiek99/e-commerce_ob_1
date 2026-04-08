import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  success(message: string, durationMs = 4000) {
    this.add({ type: 'success', message }, durationMs);
  }

  error(message: string, durationMs = 5000) {
    this.add({ type: 'error', message }, durationMs);
  }

  info(message: string, durationMs = 4000) {
    this.add({ type: 'info', message }, durationMs);
  }

  dismiss(id: string) {
    this._toasts.update((toasts) => toasts.filter((t) => t.id !== id));
  }

  private add(toast: Omit<Toast, 'id'>, durationMs: number) {
    const id = crypto.randomUUID();
    this._toasts.update((toasts) => [...toasts, { ...toast, id }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }
}
