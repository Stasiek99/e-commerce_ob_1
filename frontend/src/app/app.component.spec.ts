/**
 * Regression harness for AppComponent runtime recovery behaviours:
 *  1. ChunkLoadError NavigationError handler — reloads on lazy-route chunk failure
 *  2. SwUpdate VERSION_READY handler — shows a toast when a new app version is available
 */

import { DOCUMENT } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NavigationError, NavigationStart, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY, Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { SeoService } from './core/services/seo.service';
import { ToastService } from './core/services/toast.service';

// ---------------------------------------------------------------------------
// Shared stub factories
// ---------------------------------------------------------------------------

const makeRouterStub = (events$: Subject<unknown>) => ({
  events: events$.asObservable(),
  url: '/',
});

const makeSeoStub = () => ({ applyDefaults: jest.fn(), setOrganizationJsonLd: jest.fn() });

const makeToastStub = () => ({ info: jest.fn(), success: jest.fn(), error: jest.fn() });

const makeSwUpdateStub = (
  isEnabled: boolean,
  versionUpdates$: Subject<{ type: string }> = new Subject(),
) => ({
  isEnabled,
  versionUpdates: versionUpdates$.asObservable(),
});

// ---------------------------------------------------------------------------
// Suite 1 — ChunkLoadError NavigationError recovery
// ---------------------------------------------------------------------------

describe('AppComponent — ChunkLoadError NavigationError recovery', () => {
  let routerEvents$: Subject<unknown>;
  let reloadSpy: jest.Mock;

  beforeEach(async () => {
    routerEvents$ = new Subject();
    reloadSpy = jest.fn();

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: Router, useValue: makeRouterStub(routerEvents$) },
        { provide: SeoService, useValue: makeSeoStub() },
        {
          provide: DOCUMENT,
          // Proxy the real document so Angular's DOM renderer still works, but
          // override defaultView so location.reload can be injected as a mock.
          useValue: new Proxy(document, {
            get(target, prop: string) {
              if (prop === 'defaultView') {
                return { location: { reload: reloadSpy } };
              }
              const val = (target as unknown as Record<string, unknown>)[prop];
              return typeof val === 'function' ? (val as () => unknown).bind(target) : val;
            },
          }),
        },
        { provide: SwUpdate, useValue: makeSwUpdateStub(false) },
        { provide: ToastService, useValue: makeToastStub() },
      ],
    })
      .overrideComponent(AppComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();
  });

  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('reloads when NavigationError carries an error with name ChunkLoadError', fakeAsync(() => {
    TestBed.createComponent(AppComponent).detectChanges();

    const err = Object.assign(new Error('Loading chunk 5 failed.'), { name: 'ChunkLoadError' });
    routerEvents$.next(new NavigationError(1, '/products/slug', err));
    tick();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  }));

  it('reloads when NavigationError message contains "chunk"', fakeAsync(() => {
    TestBed.createComponent(AppComponent).detectChanges();

    routerEvents$.next(
      new NavigationError(
        1,
        '/products/slug',
        new Error('Failed to fetch dynamically imported module: chunk-ABCDEF12.js'),
      ),
    );
    tick();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  }));

  it('does NOT reload when NavigationError is unrelated to chunk loading', fakeAsync(() => {
    TestBed.createComponent(AppComponent).detectChanges();

    routerEvents$.next(new NavigationError(1, '/products/slug', new Error('Network error')));
    tick();

    expect(reloadSpy).not.toHaveBeenCalled();
  }));

  it('ignores NavigationStart events entirely', fakeAsync(() => {
    TestBed.createComponent(AppComponent).detectChanges();

    routerEvents$.next(new NavigationStart(1, '/products/slug'));
    tick();

    expect(reloadSpy).not.toHaveBeenCalled();
  }));
});

// ---------------------------------------------------------------------------
// Suite 2 — SwUpdate version reload notification
// ---------------------------------------------------------------------------

describe('AppComponent — SwUpdate version reload notification', () => {
  describe('when SwUpdate is enabled', () => {
    let versionUpdates$: Subject<{ type: string }>;
    let toastStub: ReturnType<typeof makeToastStub>;

    beforeEach(async () => {
      versionUpdates$ = new Subject();
      toastStub = makeToastStub();

      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [
          { provide: Router, useValue: { events: EMPTY, url: '/' } },
          { provide: SeoService, useValue: makeSeoStub() },
          { provide: DOCUMENT, useValue: document },
          { provide: SwUpdate, useValue: makeSwUpdateStub(true, versionUpdates$) },
          { provide: ToastService, useValue: toastStub },
        ],
      })
        .overrideComponent(AppComponent, {
          set: { imports: [], template: '', schemas: [NO_ERRORS_SCHEMA] },
        })
        .compileComponents();
    });

    afterEach(() => {
      jest.clearAllMocks();
      TestBed.resetTestingModule();
    });

    it('shows an info toast when a VERSION_READY event fires', fakeAsync(() => {
      TestBed.createComponent(AppComponent).detectChanges();

      versionUpdates$.next({ type: 'VERSION_READY' });
      tick();

      expect(toastStub.info).toHaveBeenCalledTimes(1);
      expect(toastStub.info).toHaveBeenCalledWith(
        expect.stringContaining('nowa wersja'),
        8000,
      );
    }));

    it('does NOT show a toast for VERSION_DETECTED events', fakeAsync(() => {
      TestBed.createComponent(AppComponent).detectChanges();

      versionUpdates$.next({ type: 'VERSION_DETECTED' });
      tick();

      expect(toastStub.info).not.toHaveBeenCalled();
    }));

    it('does NOT show a toast for VERSION_INSTALLATION_FAILED events', fakeAsync(() => {
      TestBed.createComponent(AppComponent).detectChanges();

      versionUpdates$.next({ type: 'VERSION_INSTALLATION_FAILED' });
      tick();

      expect(toastStub.info).not.toHaveBeenCalled();
    }));
  });

  describe('when SwUpdate is disabled', () => {
    let versionUpdates$: Subject<{ type: string }>;
    let toastStub: ReturnType<typeof makeToastStub>;

    beforeEach(async () => {
      versionUpdates$ = new Subject();
      toastStub = makeToastStub();

      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [
          { provide: Router, useValue: { events: EMPTY, url: '/' } },
          { provide: SeoService, useValue: makeSeoStub() },
          { provide: DOCUMENT, useValue: document },
          { provide: SwUpdate, useValue: makeSwUpdateStub(false, versionUpdates$) },
          { provide: ToastService, useValue: toastStub },
        ],
      })
        .overrideComponent(AppComponent, {
          set: { imports: [], template: '', schemas: [NO_ERRORS_SCHEMA] },
        })
        .compileComponents();
    });

    afterEach(() => {
      jest.clearAllMocks();
      TestBed.resetTestingModule();
    });

    it('does NOT subscribe when SwUpdate.isEnabled is false', fakeAsync(() => {
      TestBed.createComponent(AppComponent).detectChanges();

      versionUpdates$.next({ type: 'VERSION_READY' });
      tick();

      expect(toastStub.info).not.toHaveBeenCalled();
    }));
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Skip-navigation link (WCAG 2.4.1 / EAA)
// ---------------------------------------------------------------------------

describe('AppComponent — skip-navigation link (WCAG 2.4.1)', () => {
  let fixture: ComponentFixture<AppComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: Router, useValue: makeRouterStub(new Subject()) },
        { provide: SeoService, useValue: makeSeoStub() },
        { provide: DOCUMENT, useValue: document },
        { provide: SwUpdate, useValue: makeSwUpdateStub(false) },
        { provide: ToastService, useValue: makeToastStub() },
      ],
    })
      .overrideComponent(AppComponent, {
        set: {
          imports: [],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders a.skip-link with href pointing to #main-content', () => {
    const skipLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a.skip-link');

    expect(skipLink).not.toBeNull();
    expect(skipLink!.getAttribute('href')).toBe('#main-content');
  });

  it('skip link carries the correct Polish label', () => {
    const skipLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a.skip-link');

    expect(skipLink?.textContent?.trim()).toBe('Przejdź do treści');
  });

  it('main element carries id="main-content" so the skip link target resolves', () => {
    const main: HTMLElement | null = fixture.nativeElement.querySelector('main');

    expect(main).not.toBeNull();
    expect(main!.getAttribute('id')).toBe('main-content');
  });

  it('skip link is the first element child of the app shell', () => {
    const appShell: Element | null = fixture.nativeElement.querySelector('tui-root');
    const firstChild = appShell?.firstElementChild;

    expect(firstChild?.tagName.toLowerCase()).toBe('a');
    expect(firstChild?.classList.contains('skip-link')).toBe(true);
  });
});
