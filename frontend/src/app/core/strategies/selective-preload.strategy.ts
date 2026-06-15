import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SelectivePreloadStrategy implements PreloadingStrategy {
  preload(route: Route, fn: () => Observable<unknown>): Observable<unknown> {
    return route.data?.['preload'] ? fn() : EMPTY;
  }
}
