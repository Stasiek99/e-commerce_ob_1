import {
  Injectable,
  signal,
  computed,
  inject,
  effect,
  PLATFORM_ID,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { EMPTY, Subject, catchError, debounceTime, switchMap } from "rxjs";
import { environment } from "../../../environments/environment";
import { ToastService } from "./toast.service";
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

const SESSION_KEY = "cart_session_id";

function getOrCreateSessionId(isBrowser: boolean): string {
  if (!isBrowser) return "";
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

@Injectable({ providedIn: "root" })
export class CartService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly toast = inject(ToastService);
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

  // Per-variant Subjects so concurrent updates to different items never cancel
  // each other. Each Subject owns its own debounce + switchMap pipeline; the
  // catchError inside keeps the stream alive after a 400 error so subsequent
  // stepper clicks still fire.
  private readonly updateQueues = new Map<string, Subject<number>>();

  constructor() {
    if (!this.isBrowser) return;
    this.loadCart();
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

  addItem(productVariantId: string, quantity = 1, turnstileToken = "") {
    const headers = turnstileToken
      ? this.sessionHeaders().set("cf-turnstile-response", turnstileToken)
      : this.sessionHeaders();
    return this.http.post<CartDto>(
      `${environment.apiUrl}/cart/items`,
      { productVariantId, quantity },
      { headers },
    );
  }

  updateQuantity(productVariantId: string, quantity: number) {
    // Optimistic update
    this._items.update((items) =>
      items.map((i) =>
        i.productVariantId === productVariantId ? { ...i, quantity } : i,
      ),
    );
    this.getOrCreateUpdateQueue(productVariantId).next(quantity);
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

  mergeWithServer() {
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
    this.updateQueues.forEach((subject) => subject.complete());
    this.updateQueues.clear();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  private getOrCreateUpdateQueue(variantId: string): Subject<number> {
    if (!this.updateQueues.has(variantId)) {
      const subject = new Subject<number>();
      subject
        .pipe(
          debounceTime(400),
          switchMap((qty) =>
            this.http
              .patch(
                `${environment.apiUrl}/cart/items/${variantId}`,
                { quantity: qty },
                { headers: this.sessionHeaders() },
              )
              .pipe(
                catchError(() => {
                  this.toast.error(
                    "Nie udało się zaktualizować ilości. Odśwież stronę.",
                  );
                  return EMPTY;
                }),
              ),
          ),
        )
        .subscribe();
      this.updateQueues.set(variantId, subject);
    }
    return this.updateQueues.get(variantId)!;
  }

  private sessionHeaders(): HttpHeaders {
    return new HttpHeaders({ "x-session-id": this.sessionId });
  }
}
