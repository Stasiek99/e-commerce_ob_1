import { Injectable, signal, computed, inject, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { debounceTime, Subject, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
export interface CartItemDto {
  id: string;
  productVariantId: string;
  quantity: number;
  productName: string;
  variantLabel: string;
  priceInCents: number;
  imageUrl?: string | null;
  slug: string;
  sku: string;
  stock: number;
}

export interface CartDto {
  id: string;
  items: CartItemDto[];
  itemCount: number;
  totalInCents: number;
}

const SESSION_KEY = 'cart_session_id';

function getOrCreateSessionId(isBrowser: boolean): string {
  if (!isBrowser) return '';
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly _items = signal<CartItemDto[]>([]);
  private readonly _cartId = signal<string | null>(null);
  private readonly sessionId = getOrCreateSessionId(this.isBrowser);

  readonly items = this._items.asReadonly();
  readonly cartId = this._cartId.asReadonly();
  readonly itemCount = computed(() =>
    this._items().reduce((sum, i) => sum + i.quantity, 0),
  );
  readonly totalInCents = computed(() =>
    this._items().reduce((sum, i) => sum + i.priceInCents * i.quantity, 0),
  );

  private readonly updateQueue = new Subject<{ variantId: string; qty: number }>();

  constructor() {
    if (!this.isBrowser) return;

    this.loadCart();

    // Debounced quantity updates to avoid hammering the server
    this.updateQueue
      .pipe(
        debounceTime(400),
        switchMap(({ variantId, qty }) =>
          this.http.patch(
            `${environment.apiUrl}/cart/items/${variantId}`,
            { quantity: qty },
            { headers: this.sessionHeaders() },
          ),
        ),
      )
      .subscribe();
  }

  loadCart() {
    this.http
      .get<CartDto>(`${environment.apiUrl}/cart`, {
        headers: this.sessionHeaders(),
      })
      .subscribe({
        next: (cart) => {
          this._cartId.set(cart.id);
          this._items.set(cart.items);
        },
        error: () => {},
      });
  }

  addItem(productVariantId: string, quantity = 1) {
    return this.http
      .post<CartDto>(
        `${environment.apiUrl}/cart/items`,
        { productVariantId, quantity },
        { headers: this.sessionHeaders() },
      )
      .pipe(
        // tap is not imported but we handle via subscribe at call site
      );
  }

  updateQuantity(productVariantId: string, quantity: number) {
    // Optimistic update
    this._items.update((items) =>
      items.map((i) =>
        i.productVariantId === productVariantId ? { ...i, quantity } : i,
      ),
    );
    this.updateQueue.next({ variantId: productVariantId, qty: quantity });
  }

  removeItem(productVariantId: string) {
    this._items.update((items) =>
      items.filter((i) => i.productVariantId !== productVariantId),
    );
    return this.http.delete<CartDto>(
      `${environment.apiUrl}/cart/items/${productVariantId}`,
      { headers: this.sessionHeaders() },
    );
  }

  mergeWithServer(userId: string) {
    return this.http.post<void>(
      `${environment.apiUrl}/cart/merge`,
      {},
      { headers: this.sessionHeaders() },
    );
  }

  refreshFromServer(cart: CartDto) {
    this._cartId.set(cart.id);
    this._items.set(cart.items);
  }

  clear() {
    this._items.set([]);
    this._cartId.set(null);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  private sessionHeaders(): HttpHeaders {
    return new HttpHeaders({ 'x-session-id': this.sessionId });
  }
}
