# Pre-launch Audit — Ściąga

Kolejność: Blok 1 → 2 → 3 → 4 → 5 → 6. Każdy punkt = przejść ręcznie w przeglądarce + sprawdzić Network tab / logi backendowe.

---

## Blok 1 — Pieniądze (najwyższy priorytet)

- [ ] **1. Checkout end-to-end (zalogowany)** — produkt → koszyk → adres → przewoźnik → przegląd → Stripe → sukces. Sprawdź: `Order=PAID`, `Payment=COMPLETED`, e-mail potwierdzający przyszedł.
- [ ] **2. Checkout end-to-end (gość)** — przez `/checkout/auth-choice` → „Kontynuuj bez logowania". Sprawdź: zamówienie widoczne na `/orders/track` po e-mail + nr zamówienia.
- [ ] **3. Retry payment** — wejdź na `/checkout/failure` z realnym `orderId` w stanie `PENDING_PAYMENT` → „Ponów płatność" → sprawdź czy nowa sesja Stripe powstaje i przekierowuje.
- [ ] **4. Cancel zamówienia PAID** — z `/account/orders/:id` → anuluj → sprawdź czy Stripe naprawdę zwraca środki (nie tylko DB update).
- [ ] **5. Częściowe anulowanie pozycji (`doPartialCancel`)** — „Anuluj wybrane produkty" → sprawdź: endpoint 200, Stripe `partialRefund`, `Order=PARTIALLY_REFUNDED`.
- [ ] **6. Kupon w kasie** — zastosuj kod → sprawdź rabat w Stripe Checkout Session (nie tylko UI). Usuń kupon → cena wraca.
- [ ] **7. Faktura PDF** — „Pobierz fakturę" na zrealizowanym zamówieniu → PDF się pobiera (nie 404/500). Po zwrocie zatwierdzonym przez admina → „Pobierz fakturę korygującą" też działa.

---

## Blok 2 — Tożsamość i Auth

- [ ] **8. Rejestracja → weryfikacja e-mail** — nowe konto → e-mail weryfikacyjny przyszedł → kliknij link → `/auth/verify-email` pokazuje sukces.
- [ ] **9. Forgot password → reset** — wyślij e-mail → kliknij link → nowe hasło → zaloguj się nowym hasłem.
- [ ] **10. Magic link** — wyślij → kliknij link → `/auth/magic-login` przetwarza token i przekierowuje (nie blank page, SSR wyłączone na tej trasie).
- [ ] **11. Google OAuth** — „Zaloguj przez Google" → OAuth → callback `/auth/callback` przekierowuje poprawnie.
- [ ] **12. Token refresh** — zaloguj → poczekaj >15 min (access token wygasa) → wykonaj akcję auth → `errorInterceptor` powinien odświeżyć token i retry automatycznie.

---

## Blok 3 — Konto użytkownika

- [ ] **13. Zarządzanie adresami** — Dodaj (z autouzupełnianiem miasta po kodzie pocztowym) → Ustaw jako domyślny → sprawdź czy pre-wybrany w kasie → Edytuj → Usuń.
- [ ] **14. Zmiana e-mail** — wyślij zmianę → link potwierdzający przyszedł.
- [ ] **15. Zmiana hasła** — zmień → stare hasło przestaje działać.
- [ ] **16. Usunięcie konta (RODO)** — utwórz testowe konto → usuń → sprawdź czy dane znikają z DB.

---

## Blok 4 — Katalog i koszyk

- [ ] **17. Filtry produktów** — zastosuj kilka jednocześnie (kategoria + cena + dostępność) → wyczyść wszystkie → lista wraca do pełnej.
- [ ] **18. Warianty produktu** — przełącz wariant (50ml → 100ml) → cena, stan magazynowy i przycisk „Dodaj" aktualizują się.
- [ ] **19. Stepper ilości — oversell** — ustaw ilość > stan magazynowy → backend blokuje (nie tylko UI).
- [ ] **20. Merge koszyka** — dodaj jako gość → zaloguj się → pozycje z anonimowego koszyka scalone z zalogowanym.

---

## Blok 5 — Dodatkowe feature'y (podejrzane o „fake")
 
- [ ] **22. Powiadomienie o dostępności (wishlist dzwonek)** — kliknij dzwonek na niedostępnym produkcie → backend zapisuje flagę (nie wywala się).
- [ ] **23. „Dodaj wszystko do koszyka" z wishlisty** — 3+ produkty → kliknij → wszystkie w koszyku, stock validation per produkt.
- [ ] **24. Wybór paczkomatu InPost** — kliknij „Wybierz paczkomat" → modal z widgetem się otwiera → po wyborze punkt widoczny w podsumowaniu kasy.
- [ ] **25. Modal DPD (iframe)** — wybierz DPD → „Wybierz punkt DPD" → iframe się ładuje (nie błąd CORS/mixed content).
- [ ] **26. Recenzje produktów** — złóż recenzję (zalogowany, po zakupie) → pojawia się na liście. Kliknij „Pomocne" → licznik rośnie.
- [ ] **27. Zwroty** — prześlij formularz dla zamówienia `DELIVERED` → pojawia się w adminie. Spróbuj po 14 dniach → przycisk submit wyłączony.

---

## Blok 6 — Infrastruktura i edge cases

- [ ] **28. Stripe webhook** — `stripe listen --forward-to localhost:3000/payments/webhook` → zasymuluj `checkout.session.completed` → log backendowy: HMAC ok, status zamówienia zmieniony.
- [ ] **29. Tracking gościa** — `/orders/track` → wpisz e-mail + nr zamówienia → dane wracają.
- [ ] **30. SSR / prerender** — otwórz `/` i `/products` z wyłączonym JS → HTML pre-renderowany (nie blank). Sprawdź `<domena>/sitemap.xml`.
- [ ] **31. Strona `/partnership`** — kliknij wszystkie 6 przycisków CTA → każdy idzie na `/` (nie dead click). Baner ogłoszeń → też `/`.

---

## Szybka tabela priorytetów

| Priorytet | Bloki | Powód |
|---|---|---|
| Teraz | 1, 2 | Pieniądze i auth — crash = brak przychodu |
| Potem | 3, 4 | Core UX konta i koszyka |
| Na końcu | 5, 6 | Potencjalne fake feature'y + infrastruktura |
