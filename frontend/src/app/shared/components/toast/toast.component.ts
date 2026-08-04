import { Component, inject } from "@angular/core";
import { ToastService } from "../../../core/services/toast.service";

@Component({
  selector: "app-toast",
  standalone: true,
  template: `
    <div class="toast-container" aria-live="polite" aria-atomic="false">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="toast toast--{{ toast.type }}"
          [attr.role]="toast.type === 'error' ? 'alert' : 'status'"
          (click)="toastService.dismiss(toast.id)"
          [attr.aria-label]="toast.message + ' (kliknij, aby zamknąć)'"
        >
          {{ toast.message }}
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .toast {
        padding: 12px 20px;
        border-radius: var(--radius-md);
        font-size: 14px;
        cursor: pointer;
        box-shadow: var(--shadow-md);
        max-width: 360px;
        animation: slideIn 0.2s ease;
      }
      .toast--success {
        background: #16a34a;
        color: white;
      }
      .toast--error {
        background: #dc2626;
        color: white;
      }
      .toast--info {
        background: var(--color-primary);
        color: white;
      }
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class ToastComponent {
  readonly toastService = inject(ToastService);
}
