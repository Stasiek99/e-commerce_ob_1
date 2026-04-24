import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TuiIcon } from '@taiga-ui/core';
import { TuiToast } from '@taiga-ui/kit';
import { injectContext } from '@taiga-ui/polymorpheus';

export type AppToastType = 'success' | 'error' | 'info';

export interface AppToastData {
  message: string;
  type: AppToastType;
}

const ICONS: Record<AppToastType, string> = {
  success: '@tui.check-circle',
  error: '@tui.circle-x',
  info: '@tui.info',
};

const COLORS: Record<AppToastType, string> = {
  success: 'var(--tui-status-positive)',
  error: 'var(--tui-status-negative)',
  info: 'var(--tui-status-info)',
};

@Component({
  standalone: true,
  imports: [TuiIcon, TuiToast],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div tuiToast>
      <tui-icon [icon]="icon" [style.color]="color" />
      {{ context.data.message }}
    </div>
  `,
})
export class AppToastComponent {
  protected readonly context = injectContext<{ data: AppToastData }>();
  protected readonly icon = ICONS[this.context.data.type];
  protected readonly color = COLORS[this.context.data.type];
}
