import { Injectable, inject } from '@angular/core';
import { TuiToastService } from '@taiga-ui/kit';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { AppToastComponent, AppToastData } from '../../shared/components/toast/app-toast.component';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly tuiToast = inject(TuiToastService);

  success(message: string, durationMs = 4000): void {
    this.open('success', message, durationMs);
  }

  error(message: string, durationMs = 5000): void {
    this.open('error', message, durationMs);
  }

  info(message: string, durationMs = 4000): void {
    this.open('info', message, durationMs);
  }

  private open(type: AppToastData['type'], message: string, autoClose: number): void {
    this.tuiToast
      .open<AppToastData>(new PolymorpheusComponent(AppToastComponent), {
        autoClose,
        closable: false,
        data: { message, type },
      })
      .subscribe();
  }
}
