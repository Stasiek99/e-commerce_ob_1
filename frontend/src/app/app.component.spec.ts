/**
 * Regression harness for the ChunkLoadError NavigationError handler in AppComponent.
 *
 * Invariant: when the Router emits a NavigationError whose payload is a
 * ChunkLoadError (by name or by message), AppComponent must call
 * document.defaultView.location.reload() to recover silently for the user.
 */

import { DOCUMENT } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NavigationError, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { SeoService } from './core/services/seo.service';

describe('AppComponent — ChunkLoadError NavigationError recovery', () => {
  let routerEvents$: Subject<unknown>;
  let reloadSpy: jest.Mock;

  beforeEach(async () => {
    routerEvents$ = new Subject();
    reloadSpy = jest.fn();

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        {
          provide: Router,
          useValue: { events: routerEvents$.asObservable(), url: '/' },
        },
        {
          provide: SeoService,
          useValue: { applyDefaults: jest.fn() },
        },
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
