# Responsywność 320–430px dla sklepu z perfumami — reguły weryfikowalne mechanicznie

*5 równoległych ścieżek badawczych + 2 rundy poprawek, ~45 źródeł, 2026-08-02.*
*Stack: Angular 20.3.23 + @angular/ssr, Taiga UI 4.92, TypeScript 5.9.3, SSR + częściowy prerender.*

Kryterium przyjęcia tezy: cytat ze specyfikacji, dokumentacji producenta albo bezpośrednio pobranej strony.
Tezy oparte na źródłach wtórnych są wydzielone do sekcji „Konwencje bez pokrycia w źródle pierwotnym" i **nie są rekomendacjami**.

---

## TL;DR — cztery rzeczy, które zmieniają decyzje

1. **Żaden próg rozmiaru celu dotykowego nie jest dziś prawnie wiążący w UE.** EAA obowiązuje od 28.06.2025, ale przez zharmonizowaną normę EN 301 549 **v3.2.1**, odsyłającą do **WCAG 2.1**. Tam jedyne kryterium rozmiaru celu to SC 2.5.5 (44 px) na poziomie **AAA** — nieobowiązkowym. SC 2.5.8 (24 px, AA) pojawia się dopiero w WCAG 2.2. 24 px to przygotowanie na przyszłość, nie zgodność prawna.
2. **`dvh` nie psuje CLS.** Specyfikacja Layout Instability API: *„An excluding input is any event from an input device which signals a user's active interaction with the document, **or any event which directly changes the size of the viewport**"*. Chowanie paska adresu zmienia rozmiar viewportu → excluding input → shift w oknie 500 ms ma `hadRecentInput = true` → **wykluczony z CLS**. Jank przy `dvh` jest realny (WebKit bug 266835), ale to problem wizualny, nie pozycja w Search Console.
3. **Reguła „gutter 16px" nie ma pokrycia w źródle pierwotnym.** HIG Layout w surowym JSON-ie Apple nie zawiera ani 16pt, ani 44pt — jedyne liczby to specyfikacje tvOS. Material dokumentuje breakpoint compact (<600dp), ale nie wartość marginesu.
4. **Nie buduj lintera pod „za mały tekst" jako sygnał SEO.** Raport Mobile Usability w Search Console i test „text too small to read" zostały wycofane 1 grudnia 2023, a aktualna lista sygnałów Page Experience Google'a nie wymienia rozmiaru tekstu. Mały tekst to dziś ryzyko konwersji, nie osobna kara SEO.

---

## 1. Skale spacingu

### 4px pozostaje bazą — potwierdzone w trzech systemach

| System | Baza | Wartości |
|---|---|---|
| Tailwind | `--spacing: 4px`; każde utility = `calc(var(--spacing) * n)` | pobrane z tailwindcss.com/docs/padding |
| IBM Carbon | *„using multiples of two, four, and eight"* | `spacing-01…13` = 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160 px |
| Shopify Polaris | `space-025` = 1px, `space-050` = 2px, dalej wielokrotności 4 | pobrane z polaris-react.shopify.com/tokens/space |

Carbon i Polaris jako jedyne schodzą poniżej 4px — wyłącznie dla włosowych kresek i odstępów przy ikonach.

### Sekcja vs wnętrze komponentu

Carbon mówi wprost: *„Use the spacing scale when building individual components"* — co implikuje drugą skalę dla układu strony. Polaris pokazuje ten podział wartościami semantycznymi: `--p-space-button-group-gap: 8px`, `--p-space-card-gap: 16px` wewnątrz komponentu, a jego własny komponent `Layout` operuje w paśmie `space-600`–`space-1000` (24–40px) dla odstępów sekcji.

**Granica 16px jest przełomem semantycznym.** Poniżej — grupowanie wewnątrz komponentu. Powyżej — separacja sekcji. Daje to twardą asercję: żaden `gap` wewnątrz pojedynczej karty produktu nie powinien przekraczać 16px, bo zacznie czytać się jako podział.

### Stałe vs clamp/vw

Utopia generuje `clamp()` między biegunami **320px i 1240px**, w formacie `clamp(1.125rem, 1.0739rem + 0.2273vw, 1.25rem)` — granice w `rem`, tylko nachylenie w `vw`. To nie kosmetyka: web.dev/articles/min-max-clamp ostrzega, że zaciśnięcie `max` może złamać **WCAG 1.4.4** (blokuje skalowanie przy zoomie 200%). Granice w `px` to dokładnie ten błąd.

Twórcy Utopii rozróżniają pary sąsiednie (`s → m`) dla odstępów wewnątrz komponentu i pary wieloskokowe (`xs → 3xl`) dla marginesów sekcji, które mają agresywnie kompresować się na małym ekranie.

**Rekomendacja: dla 320–430px fluid spacing nie jest potrzebny.** To jeden kubełek szerokości — Material traktuje całe <600dp jako jedną klasę `compact` (potwierdzone bezpośrednio na developer.android.com: compact <600dp, medium 600–839, expanded 840–1199, large 1200–1599, extra-large ≥1600). Fluid ma sens dopiero na przejściu telefon → desktop. Jeśli go użyjesz — granice w `rem`.

---

## 2. Typografia

### Normatywne (W3C, cytaty ze specyfikacji)

| Kryterium | Liczba | Treść |
|---|---|---|
| **1.4.10 Reflow** (AA) | **320 CSS px** | *„...without requiring scrolling in two dimensions for: Vertical scrolling content at a width equivalent to 320 CSS pixels"* |
| **1.4.4 Resize Text** (AA) | **200%** | *„text can be resized without assistive technology up to 200 percent without loss of content or functionality"* — obejmuje **kontrolki i etykiety**, nie tylko tekst ciągły (F80 = nazwana porażka dla kontrolek formularza) |
| **1.4.12 Text Spacing** (AA) | 1.5× / 2× / 0.12em / 0.16em | Test **narzuceniem przez użytkownika**, nie audyt Twoich domyślnych wartości |
| **F94** | — | `font-size` w samym `vw` — **binarna porażka**, bez oceny proporcji |
| **F104** | — | Porażka 1.4.12 zilustrowana **przycięciem pionowym**: *„the bottom portion of the words 'Your Needs' is cut off in a heading"* |

**F104 jest bezpośrednio istotne dla polskiego.** Własny przykład W3C to obcięcie dolnej części tekstu — dokładnie ten mechanizm, który zjada ogonki w „ą" i „ę" przy ciasnym `line-height` z `overflow: hidden`. Mozilla Bugzilla #1406552 niezależnie potwierdza, że `overflow: hidden` potrafi obciąć podrysy nawet przy nominalnie bezpiecznych wysokościach linii. To nie jest już domysł — ma pokrycie w dwóch źródłach, choć żadne nie odnosi się do polskiego wprost.

Praktycznie: karty produktu z tytułem przyciętym do stałej wysokości w px są kandydatem numer jeden. Sprawdź na nazwach nut („Wanilia Madagaskarska", „Drzewo sandałowe").

**WCAG nigdzie nie narzuca minimalnego rozmiaru w px.** Narzuca skalowalność.

### Korekta, którą trzeba znać: 2× i 2,5× to granice w przeciwnych kierunkach

MDN (dokumentacja `clamp()`) mówi: *„make sure that the maximum allowed value is a relative length unit that is no less than **twice** the minimum allowed value"*, powołując się na WCAG 1.4. Przykład MDN to `clamp(1rem, 2.5vw, 2rem)` — dokładnie 2,0×.

Smashing mówi: `max ÷ min` **≤ 2,5**.

To **nie są konkurencyjne liczby do wyboru** — to ograniczenia z dwóch stron:
- **max/min ≥ 2** (MDN, uzasadnienie normatywne): żeby tekst mógł się podwoić przy zoomie 200%.
- **max/min ≤ 2,5** (Smashing, heurystyka): żeby nie przestrzelić przy skrajnych szerokościach.

**Okno robocze: 2 ≤ max/min ≤ 2,5.** Dolna granica jest osadzona w MDN i WCAG 1.4.4; górna to heurystyka jednego autora, potwierdzona niezależnymi testami Adriana Roselliego, ale nie liczba W3C. Sprawdzone bezpośrednio: **żaden dokument W3C nie podaje liczbowej proporcji dla `clamp()`** — F94 jest binarne, nie jest testem proporcji.

### Skala MD3 — z oficjalnych tokenów, nie z m3.material.io

`m3.material.io` jest SPA i nie daje się pobrać. Liczby pochodzą z `material-components/material-web`, plik `_md-sys-typescale.scss` (root 16px):

| Rola | font-size | line-height | lh/fs |
|---|---|---|---|
| Display L / M / S | 57 / 45 / 36 px | 64 / 52 / 44 px | 1.12 / 1.16 / 1.22 |
| Headline L / M / S | 32 / 28 / 24 px | 40 / 36 / 32 px | 1.25 / 1.29 / 1.33 |
| Title L / M | 22 / 16 px | 28 / 24 px | 1.27 / 1.50 |
| Body L / M / S | 16 / 14 / 12 px | 24 / 20 / 16 px | 1.50 / 1.43 / 1.33 |
| Label L | 14 px | 20 px | 1.43 |

**Korekta założenia z pytania:** MD3 **nie jest** skalą modularną o stałej proporcji. Kroki się wahają (Display L→M ≈ 1,267; Headline S→Title L ≈ 1,09; Title M i Body L zbiegają się dokładnie na 16px). Proporcje 1.2 / 1.25 / 1.333 to konwencja Utopii i typografii klasycznej — **nie cytuj MD3 jako dowodu na konkretną proporcję.**

Widać za to prawidłowość użyteczną jako reguła: **im większy stopień, tym ciaśniejszy line-height** — od 1,50 dla tekstu ciągłego do 1,12 dla Display Large.

### 16px na inputach — status: empiryczne

Sprawdzone pozytywnie: Apple ani WebKit **nigdzie tego nie dokumentują**. Artykuł WebKit najczęściej cytowany jako źródło (webkit.org/blog/5611, „More Responsive Tapping on iOS") dotyczy opóźnienia 350ms i `touch-action` — **nie wspomina o font-size ani o zoomie**. Brak wpisu w Bugzilli.

Zachowanie jest powszechnie odtwarzalne i kosztowne w skutkach (zoom przy wejściu w pole w checkoucie), więc regułę warto egzekwować — ale jako quirk przeglądarki weryfikowany na realnym iOS, nie jako cytowalny wymóg.

### Długość linii

Klasyczny zakres 45–75 znaków (Bringhurst), cel ~66 (Butterick) — **typografia druku, nie stanowisko W3C ani MDN**. Na 320–375px przy 16px mieści się realnie 30–40 znaków, więc `max-width: 65ch` jest ograniczeniem wyłącznie desktopowym. Poniżej ~480px wiąże sama szerokość ekranu i nie ma czego egzekwować.

Dla polskiego: **nie znaleziono żadnego źródła** — pierwotnego ani praktycznego — dotyczącego długości linii dla tekstu z diakrytykami. Ogólna obserwacja branży DTP (polski dłuższy o ~10–30% od angielskiego) nie jest badaniem typograficznym. Każda korekta liczby znaków pod polski byłaby Twoim założeniem; oznacz je w kodzie jako takie.

### SEO — jedna rzecz do wykreślenia z planu

Aktualna dokumentacja Page Experience Google'a wymienia: Core Web Vitals, HTTPS, wyświetlanie mobilne, gęstość reklam, interstitiale, rozróżnialność treści. **Rozmiaru tekstu ani czytelności tam nie ma.** Raport Mobile Usability i test „text too small to read" wycofano 1.12.2023.

*Data wycofania opiera się na zbieżnych źródłach wtórnych cytujących Google — oryginalny wpis blogowy nie dał się pobrać.*

### LCP a fonty

web.dev/optimize-lcp: *„If the LCP element is a text block, web-font loading is the usual bottleneck."* Jeśli LCP to nagłówek — `font-display: swap` (nie `auto`/`block`) + `<link rel="preload" as="font">`. Sam `swap` nie eliminuje CLS; web.dev wskazuje `preload` + `font-display: optional` jako gwarancję zerowego skoku, kosztem czasem niewykorzystania webfonta na wolnym łączu.

---

## 3. Cele dotykowe — sekcja z najważniejszym wynikiem

### Stan prawny (dla sklepu w PL to jest właściwa rama, nie ADA)

- Zharmonizowana norma: **EN 301 549 v3.2.1** (Dz.U. UE, sierpień 2021) → **WCAG 2.1**.
- **WCAG 2.1 na poziomie AA nie zawiera żadnego kryterium rozmiaru celu.** SC 2.5.5 (44×44) jest **AAA**. SC 2.5.8 (24×24, AA) **nie istnieje w WCAG 2.1**.
- **Wniosek: EAA, mimo obowiązywania od 28.06.2025, nie nakłada dziś żadnego progu rozmiaru celu.**
- EN 301 549 **v4.1.1** (WCAG 2.2 → 2.5.8 na AA) jest w draftcie; v4.1.0 do konsultacji w listopadzie 2025, publikacja w Dz.U. spodziewana ~październik 2026. *Data z raportowania firm compliance'owych, nie z datowanego zobowiązania KE.*
- ADA (nieistotne dla PL, istotne przy sprzedaży do US): reguła DOJ dla Title II cytuje **WCAG 2.1 AA** — ten sam wniosek.
- App Store Review Guidelines **nie zawierają żadnego liczbowego wymogu** rozmiaru celu; 44pt żyje wyłącznie w HIG jako wytyczna projektowa.

### Cztery progi

| Próg | Źródło | Status |
|---|---|---|
| **24×24 CSS px** | WCAG 2.2 SC 2.5.8, **AA** | Nie obowiązuje w UE dziś; niemal na pewno od v4.1.1 |
| **44×44 CSS px** | WCAG 2.1 SC 2.5.5 (**AAA**) + Apple HIG | AAA = nieobowiązkowe |
| **48×48 dp** | Google: *„at least 48x48dp, separated by 8dp of space or more"* (≈9mm) | Wytyczna platformowa |
| **48 px + 25% nakładania** | Lighthouse „Tap targets…" | Heurystyka **SEO/mobile-friendliness**, inna matematyka niż 2.5.8 |

**Jednostki nie wymagają przeliczania.** CSS px, pt i dp są praktycznie równoważne w viewporcie mobilnym. W Playwright mierzysz `getBoundingClientRect()` i **nie mnożysz przez DPR**.

### Wyjątek „Spacing" — geometria

Cytat normatywny: *„Undersized targets (those less than 24 by 24 CSS pixels) are positioned so that if a 24 CSS pixel diameter circle is centered on the bounding box of each, the circles do not intersect another target or the circle for another undersized target."*

Przykłady z dokumentu Understanding:
- sześć przycisków 24×24 → **pass**
- sześć 20×20 z odstępem 4px → **pass**
- sześć 20×20 bez odstępu → **fail**
- 16px wysokości, ≥24px szerokości, margines pionowy 4px, brak sąsiadów góra/dół → **pass**
- dwa rzędy 16px z przerwą 1px → **fail**

**SC 2.5.5 (44px) nie ma wyjątku spacing** — tam wymagane jest pełne 44×44, bez alternatywy „mniejszy, ale rozstawiony".

```js
const MIN = 24, R = 12;
function passes(t, all) {
  const b = t.box();
  if (b.width >= MIN && b.height >= MIN) return 'PASS';
  if (isExempt(t)) return 'PASS(exempt)';       // Inline | UA-control | Essential | Equivalent
  const c = { x: b.x + b.width/2, y: b.y + b.height/2 };
  for (const o of all) {
    if (o === t) continue;
    const ob = o.box();
    if (ob.width < MIN || ob.height < MIN) {     // okrąg vs okrąg
      const oc = { x: ob.x + ob.width/2, y: ob.y + ob.height/2 };
      if (Math.hypot(c.x-oc.x, c.y-oc.y) < 2*R) return 'FAIL';
    } else {                                     // okrąg vs prostokąt
      const px = Math.min(Math.max(c.x, ob.x), ob.x + ob.width);
      const py = Math.min(Math.max(c.y, ob.y), ob.y + ob.height);
      if (Math.hypot(c.x-px, c.y-py) < R) return 'FAIL';
    }
  }
  return 'PASS(spacing)';
}
```

**Nie pisz tego ręcznie** — `axe-core` implementuje regułę `target-size` dokładnie tak. Haczyk: jest **domyślnie wyłączona**, trzeba jawnie włączyć tag `wcag22aa`.

Wyjątków Equivalent / Essential / User Agent Control **nie da się zautomatyzować** — potrzebna allowlista (`<input type="date">` z natywnym renderowaniem, linki w akapicie).

### Rekomendacja

**48×48 px** dla nowych elementów interaktywnych (add-to-cart, steppery ilości, strzałki karuzeli) + **8px minimalnej przerwy**. Jedna liczba zdejmuje: 2.5.8 AA, 2.5.5 AAA, Apple HIG, Material i audyt Lighthouse. Przy 320px mieści się 6 takich celów w rzędzie.

**Osobno sprawdź Taiga UI** — komponenty z `size="s"` mogą schodzić poniżej progu. To konfiguracja biblioteki, nie Twój CSS; audyt geometryczny złapie to jako naruszenie bez wskazania przyczyny.

---

## 4. Jednostki viewport

### Definicje (CSS Values and Units Level 4, normatywnie)

- `sv*` — *„the viewport sized assuming any UA interfaces that are dynamically expanded and retracted to be **expanded**"* (pasek widoczny, najmniej miejsca)
- `lv*` — *„...to be **retracted**"* — zachowanie starego `vh`
- `dv*` — *„sized with dynamic consideration"*, klamrowane na żywo

Zawsze `100svh ≤ 100dvh ≤ 100lvh`. Na desktopie identyczne.

### Dlaczego `100vh` to błąd

Blog inżynierski Chrome: przy chowaniu paska `vh` przelicza się wraz z widoczną wysokością, a ICB historycznie też. Element wyliczony jako `100vh` w stanie „pasek schowany" jest wyższy niż realnie widoczny obszar przy pierwszym renderze → treść ucięta. **Stary `vh` jest liczony względem rozmiaru, który zmienia się w trakcie animacji chromu.**

### Wsparcie (MDN BCD + caniuse, pobrane bezpośrednio)

Chrome/Edge 108, Firefox 101, Safari 15.4, Samsung Internet 21. Globalnie **92,52%**. `standard_track: true`, brak flag eksperymentalnych.

*Daty „Baseline: widely available, czerwiec 2025" nie potwierdza żadne źródło pierwotne — ani BCD, ani dataset `web-features` nie mają takiego pola. Krążąca data jest prawdopodobnie wyliczeniem z reguły 30 miesięcy.*

### `dvh` a CLS — rozstrzygnięcie

Specyfikacja Layout Instability API definiuje excluding input jako *„any event from an input device which signals a user's active interaction with the document, **or any event which directly changes the size of the viewport**"*, a `hadRecentInput` jest `true`, gdy `lastInputTime` jest bliżej niż 500 ms.

Łańcuch: chowanie paska = zmiana rozmiaru viewportu = excluding input → shift w oknie 500 ms → `hadRecentInput = true` → **wykluczony z CLS**.

**Konsekwencja:** nie uzasadniaj `svh` argumentem „poprawi Core Web Vitals" — nie poprawi. Uzasadniaj tym, że **eliminuje widoczne szarpnięcie** (WebKit bug 266835 przeciw Safari 17: elementy z `dvh` nie zmieniają rozmiaru aż do zakończenia przewijania, szczególnie źle ze `scroll-snap`).

*web.dev w prozie milczy o zmianie rozmiaru viewportu — mówi tylko o oknie 500 ms po interakcji. Autorytatywne jest brzmienie specyfikacji.*

### `safe-area-inset` — co jest w specyfikacji, a co nie

Draft CSS Environment Variables Level 1 **nie wspomina o `viewport-fit=cover`** ani nie ogranicza niezerowych wartości do `fixed`/`sticky`. Mówi tylko, że na ekranach prostokątnych insety *„must all be zero"*.

**Wymóg `viewport-fit=cover` to rozszerzenie WebKit/Apple**, udokumentowane na blogu WebKit (kanał producenta): bez niego Safari letterboxuje stronę, a `env()` zwraca zera. Czyli `env(safe-area-inset-*)` bez `viewport-fit=cover` to **martwy kod**.

Częsty błąd: dodanie `viewport-fit=cover` **bez** kompensacyjnego paddingu — wtedy sticky add-to-cart ląduje pod home indicatorem.

```css
.add-to-cart-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
}
```

Wysokość samego paska w `px`/`rem`, **nigdy w jednostkach viewport**.

### SSR

`svh`/`lvh`/`dvh` rozwiązuje silnik CSS przy layoutcie, nie JavaScript. **Nie wymagają hydratacji ani `afterNextRender`** i są poprawne przy pierwszym renderze — w przeciwieństwie do hacka `--vh` z `window.innerHeight`, który przy Angular SSR + prerenderze łamie gwarancję pierwszego paintu. Jeśli taki hack jest w kodzie — do usunięcia.

---

## 5. Wzorce układu

### Jedna kolumna vs siatka — czego NIE da się potwierdzić

**Nie istnieje publiczna liczba Baymard dla rozkładu 1 vs 2 vs 3 kolumny na mobile.** Ten podział jest za paywallem Baymard Premium. Blogi cytujące „Baymard mówi 2 kolumny" nie prowadzą do żadnego publicznego źródła. Nie koduj tego jako reguły bez własnych danych A/B.

Co Baymard publikuje liczbowo (19 użytkowników, 8 branż, 700+ problemów → 83 wytyczne; benchmark 335 sklepów US/EU, 70 ważonych wytycznych, 11 000+ ocen):
- **78%** sklepów mobilnych ma Product List UX „mediocre or worse" (desktop: 58%)
- **80%** nie pokazuje 3+ miniatur w wynikach
- porzucenia: **17–33%** przy dobrej liście vs **67–90%** przy złej — nawet 4×

Karuzele: **33%** sklepów ma karuzelę na stronie głównej, **46%** z nich ma błędy użyteczności. Wymogi Baymard dla mobile: brak autorotacji (na dotyku nie ma hovera do zatrzymania), obsługa swipe, tekst jako tekst a nie wypalony w obrazku, ładowanie <1s. NN/g: animowana treść dostaje **27%** uwagi w badaniu okulograficznym.

### Obrazy o różnych proporcjach

- `object-fit: cover` przycina do wypełnienia; `contain` daje letterbox; **`fill` (wartość początkowa!) rozciąga i łamie proporcje**; `scale-down` = mniejsze z `none`/`contain`. Baseline od stycznia 2020.
- `aspect-ratio` przyjmuje `auto && <ratio>`: dla `<img>` znaczy „użyj proporcji jako placeholdera, przełącz na intrinsic po załadowaniu" — `img { aspect-ratio: 3/2 auto; }`. Baseline od września 2021.
- Wzorzec web.dev przeciw CLS: **zawsze `width`/`height` na `<img>`** + `img { width: 100%; height: auto; }`, żeby przeglądarka zarezerwowała pudełko **przed** pobraniem pliku.

Dla katalogu perfum: wymuś stały `aspect-ratio` na kontenerze karty. Wybór `contain` (letterbox, nie przycina flakonu) vs `cover` (pełne wypełnienie, ryzyko ucięcia) jest decyzją produktową — **ale stały kontener jest bezdyskusyjny**, to on chroni CLS.

### Core Web Vitals — aktualne progi (75. percentyl)

| Metryka | Dobry | Wymaga poprawy | Słaby |
|---|---|---|---|
| **LCP** | ≤ 2,5 s | 2,5–4,0 s | > 4,0 s |
| **CLS** | ≤ 0,1 | 0,1–0,25 | > 0,25 |
| **INP** | ≤ 200 ms | 200–500 ms | > 500 ms |

INP zastąpiło FID **12 marca 2024**. Metodologia CLS (okna sesyjne, max 5s, przerwa 1s) zmieniła się 2 czerwca 2021 — **żadnych zmian w 2025/2026**.

Dla siatki produktów LCP to niemal zawsze pierwszy/największy obraz nad zgięciem:
- `fetchpriority="high"` na obrazie LCP — udokumentowany case study **2,6 s → 1,9 s**
- wprost z web.dev: *„Don't lazy-load images that are likely to be in-viewport when the page loads, especially LCP images"* — przeglądarka nie zaplanuje pobrania, dopóki nie zna pozycji obrazu

### Container queries vs media queries

`@container` — **Baseline: widely available od lutego 2023**; caniuse **92,6%**, od Chrome 106 / Edge 106 / Firefox 110 / Safari 16.0.

MDN wprost: media queries reagują na **viewport**, container queries na **rozmiar kontenera-przodka** — ten sam komponent zachowuje się tak samo niezależnie od miejsca wstawienia.

Jednostki: `cqw`, `cqh`, `cqi`, `cqb`, `cqmin`/`cqmax`. **Bez kontenera degradują do jednostek small-viewport (`sv*`)** — nie wybuchają, ale dają inny wynik niż zamierzony.

**Media queries nie są legacy.** Podział jest funkcjonalny: układ strony (ile kolumn, czy sidebar istnieje) → `@media`. Komponent w wielu kontekstach (karta produktu w siatce vs w sliderze „podobne" vs pełna szerokość) → `@container`.

`@container` to czysta reguła CSS bez API JS, więc działa przy pierwszym paincie w SSR tak samo jak `@media`. *Wniosek z deklaratywnej natury reguły — żadne źródło nie stwierdza tego wprost dla SSR.*

---

## Reguły do skryptu audytowego

### Grep / stylelint (statyczne, zero-koszt w CI)

| # | Reguła | Źródło |
|---|---|---|
| 1 | Żadnego `\b\d+vh\b` — tylko `svh`/`dvh`/`lvh` | Chrome DevRel, CSS Values 4 |
| 2 | `min-height`, nie `height`, z jednostkami viewport | konwencja |
| 3 | `font-size` nigdy w samym `vw` — tylko w `clamp()` z członem `rem` | **WCAG F94** |
| 4 | Granice `clamp()` w `rem`, nie `px`; **2 ≤ max/min ≤ 2,5** | MDN (dolna), Smashing (górna) |
| 5 | Jest `env(safe-area-inset` → `index.html` musi mieć `viewport-fit=cover` | WebKit blog |
| 6 | Każdy `position: fixed` z `bottom: 0` zawiera `env(safe-area-inset-bottom)` | WebKit blog |
| 7 | Brak `--vh` liczonego z `window.innerHeight` | wymóg SSR |
| 8 | Brak `!important` na `line-height`/`letter-spacing`/`word-spacing` | WCAG 1.4.12 |
| 9 | Padding/margin/gap = wielokrotność 4px (wyjątek: tokeny 1–2px) | Tailwind, Carbon, Polaris |
| 10 | Brak `font-display: auto\|block` na foncie elementu LCP | web.dev/optimize-lcp |

### Playwright (geometryczne, przy 320 / 375 / 430px)

| # | Reguła | Źródło |
|---|---|---|
| 11 | `documentElement.scrollWidth <= clientWidth` na każdej trasie | **WCAG 1.4.10** (320px normatywnie) |
| 12 | Każdy `<img>`: `width`+`height` **albo** computed `aspect-ratio !== auto` | web.dev/optimize-cls |
| 13 | Pierwszy obraz nad zgięciem: `fetchpriority="high"`, bez `loading="lazy"` | web.dev/fetch-priority |
| 14 | Każdy obraz poniżej pierwszego ekranu: `loading="lazy"` | web.dev |
| 15 | `<input>`/`<select>`/`<textarea>`: computed `font-size >= 16px` | empiryczne (Apple nie dokumentuje) |
| 16 | Cele interaktywne ≥ 48×48px, przerwa ≥ 8px | Google a11y + Lighthouse |
| 17 | Cele < 24×24px: test okręgu 24px (pseudokod wyżej) | **WCAG 2.2 SC 2.5.8** |
| 18 | Żaden `gap` wewnątrz jednej karty > 16px | Polaris, Carbon |
| 19 | `padding-block` sekcji przy 375px w paśmie 24–48px | Polaris `space-600`–`space-1000` |
| 20 | Karuzela nie jest jedyną drogą do produktu | Baymard |
| 21 | Brak autorotacji karuzeli < 768px | Baymard |

### Test wstrzyknięciem (WCAG 1.4.12 + F104)

Wstrzyknij `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important }` + `margin-bottom: 2em` na akapity, potem porównaj `scrollHeight` vs `clientHeight` dla kontenerów o stałej wysokości. Każde przycięcie = naruszenie. **Uruchom na polskich nazwach nut** — to test, który złapie zjedzone ogonki.

### axe-core

Uruchom z tagiem `wcag22aa` — **reguła `target-size` jest domyślnie wyłączona**.

### Lighthouse / CrUX

LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms na 75. percentylu.

---

## Konwencje bez pokrycia w źródle pierwotnym

Nie są rekomendacjami.

1. **Gutter strony = 16px.** Apple HIG Layout (surowy JSON) nie zawiera tej liczby; jedyne liczby to tvOS (insety 60/80pt, odstępy siatki 40pt). Material dokumentuje breakpoint compact, nie margines. `systemMinimumLayoutMargins` zwraca 404 pod sprawdzonym URL-em.
2. **„2 kolumny to standard mobile."** Paywall Baymard Premium.
3. **„Lista dla produktów specyfikacyjnych, siatka dla wizualnych."** Kierunkowo zgodne z praktyką, brak publicznej liczby.
4. **`clamp()` max/min ≤ 2,5.** Smashing + testy Roselliego, nie W3C. (Dolna granica 2× **ma** oparcie w MDN.)
5. **16px na inputach iOS.** Odtwarzalne, pozytywnie sprawdzone jako nieudokumentowane przez Apple/WebKit.
6. **8px przerwy jako uniwersalna reguła.** To wytyczna Androida; WCAG używa okręgu 24px, nie płaskiej przerwy.
7. **`env(safe-area-*)` niezerowe tylko dla `fixed`/`sticky`.** Specyfikacja milczy. Zweryfikuj na urządzeniu.
8. **Carbon ma osobną skalę „layout".** Pobrany plik źródłowy zawiera tylko skalę komponentową.
9. **Data Baseline dla `dvh`/`svh`.** Brak pola z datą w BCD i `web-features`.
10. **Publikacja EN 301 549 v4.1.1 ~X 2026.** Raportowanie compliance'owe, nie zobowiązanie KE.
11. **Długość linii dla polskiego.** Zero źródeł. Obserwacja „polski dłuższy o 10–30%" pochodzi z branży DTP, nie z badań typograficznych.
12. **Pełna tabela Dynamic Type Apple.** Strona HIG nieosiągalna; potwierdzone tylko Body/Headline 17pt i minimum 11pt dla Caption 2.
13. **`@container` bezpieczne w SSR.** Wniosek z deklaratywnej natury CSS.
14. **Statyczny `clamp()` nie powoduje CLS.** Wniosek z mechaniki metryki; realne ryzyko to spacing liczony w JS po hydratacji i podmiana fontu.
15. **Data wycofania Mobile Usability (1.12.2023).** Zbieżne źródła wtórne cytujące Google, oryginalny wpis niedostępny.

---

## Tabela weryfikacji

| Teza | Status |
|---|---|
| EN 301 549 v3.2.1 → WCAG 2.1 → brak kryterium rozmiaru celu na AA | **HIGH** — źródło KE |
| Zmiana rozmiaru viewportu = excluding input → wykluczona z CLS | **HIGH** — cytat ze specyfikacji, 2 niezależne pobrania |
| Treść SC 2.5.8 + 5 wyjątków + geometria okręgu + przykłady liczbowe | **HIGH** — w3c/wcag + Understanding |
| SC 2.5.5 nie ma wyjątku spacing | **HIGH** — Understanding + issue #3714 |
| WCAG 1.4.10 = 320px; 1.4.12 = 1.5/2/0.12/0.16; F94; F104 | **HIGH** — dokumenty W3C |
| Skala Carbon (2…160px), Tailwind 4px, tokeny Polaris | **HIGH** — pobrane bezpośrednio |
| Skala typograficzna MD3 (57…11px + line-heights) | **HIGH** — oficjalne tokeny GitHub |
| MD3 **nie jest** skalą o stałej proporcji | **HIGH** — wyliczone z tokenów |
| Material compact < 600dp | **HIGH** — developer.android.com |
| Definicje sv/lv/dv, wsparcie, 92,52% | **HIGH** — CSS Values 4 + MDN BCD + caniuse |
| `viewport-fit=cover` wymagane dla `env()` | **HIGH** — blog WebKit (producent) |
| MDN: max ≥ 2× min dla `clamp()` font-size | **HIGH** — MDN |
| Brak liczbowej proporcji `clamp()` w dokumentach W3C | **HIGH** — sprawdzone pozytywnie |
| Apple/WebKit nie dokumentują progu 16px | **MEDIUM** — brak dowodu to nie dowód braku |
| Progi LCP/CLS/INP, data INP, `fetchpriority` 2,6→1,9 s | **HIGH** — web.dev |
| `@container` Baseline luty 2023, 92,6% | **HIGH** — MDN + caniuse |
| Statystyki Baymard (78/80/33/46%, 17–33 vs 67–90) | **HIGH** — publiczne strony Baymard |
| Jank `dvh` w Safari 17 | **HIGH** — WebKit Bugzilla 266835 |
| F104 + Bugzilla 1406552 jako podstawa ryzyka przycięcia podrysów | **HIGH** — W3C + Mozilla |
| Rozdział skali komponentowej/sekcyjnej | **MEDIUM** — Polaris tak, Carbon częściowo |
| Pasmo 24–48px dla padding sekcji | **MEDIUM** — interwał, jedno źródło |
| Rozmiar tekstu nie jest sygnałem Page Experience | **MEDIUM** — lista Google potwierdzona, data wycofania wtórna |
| Data EN 301 549 v4.1.1 | **MEDIUM** — źródła wtórne |
| Gutter 16px | **LOW** — weryfikacja nieudana |
| Rozkład kolumn na mobile wg Baymard | **LOW** — paywall |
| Typografia specyficzna dla polskiego | **LOW** — brak źródeł |

---

## Kolejność wdrożenia

1. **Reguły 1–10 (grep/stylelint)** — statyczne, do CI od razu, zero fałszywych trafień. Repo ma precedens z flat configiem ESLint.
2. **Reguła 11 (Reflow 320px)** — jedna asercja, twardy wymóg normatywny, złapie najwięcej realnych błędów.
3. **Reguły 12–14 (obrazy/CWV)** — bezpośrednio dotykają LCP i CLS.
4. **Test wstrzyknięciem 1.4.12 na polskich nazwach nut** — jedyny test celujący w konkretne ryzyko tego katalogu.
5. **Reguła 17 + axe z `wcag22aa`** — przygotowanie na EN 301 549 v4.1.1. Nie pilne prawnie, tanie teraz, drogie przy audycie później.
6. **Ręcznie:** zoom 200%/500% na kluczowych `clamp()`, rozmiary komponentów Taiga UI, weryfikacja ogonków na realnym iOS.
