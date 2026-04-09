import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TuiRoot } from '@taiga-ui/core';
import { HeaderComponent } from './shared/components/header/header.component';
import { FooterComponent } from './shared/components/footer/footer.component';
import { ToastComponent } from './shared/components/toast/toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TuiRoot, HeaderComponent, FooterComponent, ToastComponent],
  template: `
    <tui-root>
      <app-header />
      <main>
        <router-outlet />
      </main>
      <app-footer />
      <app-toast />
    </tui-root>
  `,
  styles: [`
    main {
      min-height: calc(100vh - 64px - 120px);
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 0 16px;
    }
  `],
})
export class AppComponent {}
