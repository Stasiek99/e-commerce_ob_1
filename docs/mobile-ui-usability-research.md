# Użyteczność i czytelność interfejsów mobilnych — przegląd literatury

**Data:** 2026-08-02
**Zakres:** rozmiar celu dotykowego, czytelność na małych ekranach, białe znaki, spójność wizualna, konwersja w m-commerce
**Cel:** oddzielić dowody empiryczne od konwencji branżowych przed decyzjami projektowymi w warstwie mobilnej sklepu

## Nota metodologiczna

Źródła: PubMed (E-utilities) + literatura HCI (ACM CHI / MobileHCI / UIST, Ergonomics, Human Factors, Journal of Vision), której PubMed nie indeksuje.

Poziom weryfikacji, bo ma znaczenie przy ocenie jakości dowodu:

- **Pełny tekst:** Parhi, Karlson & Bederson (MobileHCI '06)
- **Pełne abstrakty (PubMed):** Ergonomics 36161546, Perceptual & Motor Skills 40440033, Human Factors 22768644, Ergonomics 36762820
- **Poziom snippetu wyszukiwania** — oznaczone niżej jako `[snippet]`. Nie weryfikowano metodologii w pełnym tekście.

Surowe wyniki PubMed (2 zapytania, 76 rekordów) były zapisane w katalogu tymczasowym sesji i **nie są trwałe** — w razie potrzeby zapytania do odtworzenia:

```
(touchscreen OR "touch screen" OR smartphone) AND ("target size" OR "button size" OR Fitts) AND (error OR accuracy OR performance)
("font size" OR "text size" OR typography OR legibility) AND ("reading speed" OR comprehension OR readability) AND (smartphone OR "mobile device" OR "small screen" OR display)
```

---

## 1. Rozmiar celu dotykowego a wskaźnik błędów

### Badanie referencyjne: Parhi, Karlson & Bederson (MobileHCI '06)

Źródło liczby 9,2 mm, którą cytuje cała branża. Cytowania są zwykle zniekształcone, więc szczegóły poniżej pochodzą z pełnego tekstu.

**Metoda:** N=20 (17M/3K), wszyscy praworęczni, średnia wieku 25,7. HP iPAQ h4155, ekran 8,9 cm, 240×320, dot pitch 0,24 mm. Obsługa jedną ręką, kciukiem, **na stojąco w bezruchu**. Dwie fazy: cele dyskretne (pojedyncze kliknięcie) i seryjne (klawiatura numeryczna).

**Błędy — cele dyskretne:**

| Rozmiar | Błędy |
|---|---|
| 3,8 mm | 29,9% |
| 5,8 mm | 12,9% |
| 7,7 mm | 5,0% |
| 9,6 mm | 2,8% |
| 11,5 mm | 1,6% |

**Błędy — zadania seryjne** (5,8 / 7,7 / 9,6 / 11,5 / 13,4 mm): 16,5% / 8,3% / 5,0% / 5,0% / 3,5%.

**Obserwacja gubiona w cytowaniach:** prędkość rosła istotnie przy *każdym* zwiększeniu celu (aż do 11,5 mm), ale **wskaźnik błędów przestawał się poprawiać istotnie powyżej 9,6 mm** (dyskretne) i 7,7 mm (seryjne). Rekomendacja 9,2/9,6 mm to punkt, powyżej którego rośnie tylko szybkość, nie dokładność.

**Efekty pozycji na ekranie** — najbardziej praktyczna część, prawie nigdy nie cytowana:

- W fazie dyskretnej **brak** głównego efektu lokalizacji na błędy, ale rozrzut trafień był większy w rogach. Minimalny prostokąt obejmujący 95% trafień w najgorszej lokalizacji: **9,1 × 8,9 mm**.
- Subiektywnie najmniejszy komfortowy cel: centrum **6,0 mm**, NW **7,7 mm**, SW **7,6 mm**, SE **7,5 mm**. Rogi wymagają ~25% większego celu na ten sam komfort.
- **Systematyczne przesunięcie trafień:** w dolnym rzędzie trafienia lądują *powyżej* środka celu, w prawej kolumnie *na prawo* od środka. Autorzy explicite rekomendują, by cele przy prawej krawędzi (dla praworęcznych) rozciągać **aż do krawędzi ekranu**.

**Ograniczenia podane przez autorów:** N=20, tylko praworęczni, PDA a nie smartfon (inny chwyt), w bezruchu (nie w chodzie), wiek 19–42, brak osób starszych.

### Potwierdzenie w dużej skali: Henze, Rukzio & Boll (MobileHCI '11) `[snippet]`

Gra opublikowana w Android Market: **91 731 instalacji, ~120 mln zdarzeń dotykowych**. Wyznaczono wskaźniki błędu dla różnych rozmiarów celów i lokalizacji na ekranie; pokazano, że **pozycje dotknięć są systematycznie przesunięte** — replikacja skewu Parhiego na próbie ~4600× większej, w warunkach terenowych.

**Najmocniejszy dowód w całym zestawieniu.** Ograniczenie: samoselekcja (gracze w grę zręcznościową ≠ populacja), brak danych demograficznych.

### Prawo Fittsa dla dotyku — kwalifikacja

Klasyczne Fittsa (`MT = a + b·log₂(A/W+1)`) **nie przenosi się czysto na palec**:

- Parhi: w fazie dyskretnej model dobrze tłumaczył czasy, ale zakres ID był wąski — autorzy **odmawiają podania oficjalnych wartości a i b**. W fazie seryjnej ID było stałe między warunkami, a wydajność mimo to rosła z rozmiarem klawisza — **jawna niezgodność z Fittsem**. Hipoteza autorów: użytkownik zmienia postawę kciuka, żeby trafić w cel mniejszy niż opuszka.
- Ergonomics 2022 (PMID 36161546), **N=104** (57M/47K), ikony 50/80/110/140 rpx, matryca 4×7: wyniki „częściowo zgodne z prawem Fittsa". MT rosło przy zmniejszaniu ikony, **ale efekt znikał powyżej 110 rpx**. Ikony o tej samej odległości poziomej miały różne MT — obsługa jednoręczna ogranicza klikanie po stronie kciuka. Mężczyźni klikali szybciej niż kobiety.
- Formalna poprawka: **FFitts / Finger-Fitts Law** (Bi & Zhai, UIST) — dodaje składową rozkładu dotknięć. Model 2D dopasowuje się dobrze, gdy W definiuje się jako **mniejszy wymiar** celu. `[snippet]`

**Wniosek:** Fitts działa jako model prędkości, nie błędów, i tylko w ograniczonym zakresie. Dla błędów właściwym modelem jest rozkład trafień (2-SD bounding box), nie ID.

### Zasięg kciuka i chwyt

- **Bergström-Lehtovirta & Oulasvirta, CHI '14** (nie 2011) — model predykcyjny obszaru osiągalnego kciukiem jako funkcja kwadratowa rozmiaru urządzenia, rozmiaru dłoni i pozycji palca wskazującego z tyłu. Solidna biomechanika, ale dotyczy **zasięgu**, nie błędów ani konwersji. `[snippet]`
- **Chwyt dwuręczny vs jednoręczny** (PMID 26360191): +9% effective index of performance, −7% MT, +4% precyzji (wszystkie p<0,05). Interfejs projektowany pod jedną rękę traci ~7–9% wydajności motorycznej z definicji.
- **Częstotliwość chwytów — dowód słaby.** Cytowane wszędzie „49% jedną ręką / 36% cradle / 15% dwa kciuki" to **Hoober 2013 — obserwacja 1333 osób w UX Matters / A List Apart, nierecenzowana**, sprzed ery telefonów 6,7". „Thumb zone heat mapy" to grafika ilustracyjna wyprowadzona z tego, nie mapa wskaźników błędów.

### Wiek — silny i duży efekt

**Perceptual and Motor Skills 2025 (PMID 40440033), N=220** (110 osób 18–35, 110 osób 65+), 4 rozmiary przycisku × 4 pozycje:

- Wiek istotnie wpływa i na czas, i na błędy.
- Młodzi: rozmiar przycisku wpływał na czas; **pozycja i kontrast — nie**.
- Starsi: najlepsze wyniki przy **16 mm**, przyciski **u góry lub po prawej**.

16 mm to ~74% więcej niż 9,2 mm — największa udokumentowana rozbieżność między populacjami w tym obszarze.

**Human Factors 2012 (PMID 22768644), N=52** (23 z zaburzeniami motoryki precyzyjnej, 14 z zaburzeniami motoryki dużej, 15 bez): rozmiar przycisku (10–30 mm) wpływał na charakterystykę dotknięcia, **odstęp (1 vs 3 mm) — nie**. Grupa z zaburzeniami motoryki dużej: dwell time +60%/+129%, impuls +98%/+167%.

---

## 2. Czytelność na małych ekranach

### Rozmiar czcionki — mocna podstawa psychofizyczna

**Legge & Bigelow, Journal of Vision 2011** (przegląd, PMID 21828237):

> Zakres „fluent print size" — w którym czytanie odbywa się z **maksymalną prędkością** — rozciąga się na **czynnik 10** w kątowej wysokości x-height: od **0,2° do 2°**. Przy dystansie 40 cm to fizyczne x-height od **1,4 mm (≈4 pt) do 14 mm (≈40 pt)**.

**Konsekwencja ignorowana przez branżę:** powyżej critical print size (~0,2°) prędkość czytania **osiąga plateau**. Zwiększenie fontu z 16 px na 18 px nie przyspiesza czytania osoby normowidzącej, o ile jest już powyżej progu. Wartość dużego fontu leży gdzie indziej: margines bezpieczeństwa dla gorszego wzroku, warunków oświetlenia i zmiennego dystansu trzymania telefonu.

**Luka:** dystans jest tu kluczową zmienną (telefon 25–30 cm ≠ zakładane 40 cm), a **nie znaleziono badania mierzącego rzeczywisty rozkład dystansu trzymania telefonu podczas zakupów**.

### Wiek — dowód umiarkowanie mocny, ale rozproszony

- **Frontiers in Psychology 2022 (PMC9376262)** — „How to design font size for older adults: A systematic literature review with a mobile device". Przegląd systematyczny na urządzeniach mobilnych, oparty o psychofizykę. Najbliższe rzetelnego dowodu.
- **Bernard & Chaparro** — 14 pt czytelniejsze niż 12 pt dla starszych; 12 pt szeryfowe czytane istotnie wolniej niż 14 pt; preferencja istotnie dla 14 pt. `[snippet]` **Uwaga: publikacje SURL Wichita State / proceedings HFES, próby rzędu 20–30 osób.**
- **Optometry & Vision Science** — „Effect of font size and glare on computer tasks in young and older adults": prędkość rośnie z rozmiarem druku przy **stałym** dystansie, ale przy swobodnej postawie użytkownicy kompensują dystansem, więc efekt fontu częściowo znika. Istotny konfundator w większości badań mobilnych.
- **Ergonomics** — legibility znaków koreańskich: wiek (20- vs 60-latkowie) × dystans × typ wyświetlacza × kontrast; istotne efekty główne wieku we wszystkich konfiguracjach.

### Kontrast — praktyka najsłabiej uzasadniona

Empiryka kolorów jest przyzwoita: **Applied Ergonomics**, „The impact of color combinations on the legibility of text presented on LCDs" — **N=308**, 56 kombinacji tekst × tło. Rzadko duża próba jak na typografię.

Ale **liczba 4,5:1 z WCAG nie pochodzi z badania czytania**. Wyprowadzenie:

1. 3:1 jako minimum dla obserwatora normowidzącego — przyjęte ze standardu ANSI
2. Obserwacja (Arditi & Faye), że ostrość 20/40 wiąże się z utratą wrażliwości na kontrast o czynnik ~1,5
3. **3 × 1,5 = 4,5**

To arytmetyka, nie eksperyment. Krytyka jest podnoszona w samej grupie roboczej W3C (`w3c/wcag` discussion #3853): mnożenie ostrości przez wrażliwość na kontrast nie ma jasnej podstawy, sam Arditi nigdy nie proponował 4,5:1, a jego abstrakt z 2007 sugerował 7:1. Formuła luminancji względnej sRGB **zawodzi w okolicach czerni** — 4,5:1 potrafi być praktycznie nieczytelne przy ciemnych kolorach. Stąd prace nad **APCA** (model supra-threshold pod wyświetlacze samoświecące, uwzględniający grubość i rozmiar fontu).

**Wniosek praktyczny:** 4,5:1 jest wymogiem prawnym (EAA/WCAG) — trzymać. Ale nie traktować jako optimum percepcyjnego; przy ciemnym motywie i cienkich fontach realnie nie wystarcza.

### Długość linii — najsłabszy punkt całego zestawu

Reguła **45–75 znaków** pochodzi od **Bringhursta („The Elements of Typographic Style")** — norma typograficzna, nie wynik eksperymentu.

Empiria jest wewnętrznie sprzeczna:

- Dyson & Haselgrove: ~55 znaków/linię wspiera efektywne czytanie przy prędkości normalnej i szybkiej
- Inne badania ekranowe: **~100 znaków/linię daje najwyższą prędkość**, ale preferowane jest 45–72. Klasyczna dysocjacja prędkość↔preferencja
- Przegląd „Optimal Line Length in Reading" (Visible Language 2005) — konkluzja w praktyce „to zależy"

**Krytyczna luka:** całość tej literatury to **monitory desktopowe i druk**. Telefon przy 16 px i szerokości 390 px daje ~35–45 znaków w linii — **poniżej dolnego końca wszystkich badanych zakresów**. Nie znaleziono badania mierzącego prędkość czytania przy 35 vs 45 vs 55 znaków na fizycznym telefonie. Wszystko, co branża mówi o długości linii na mobile, to ekstrapolacja z desktopu.

---

## 3. Białe znaki i grupowanie percepcyjne

**Najsłabiej udowodniony obszar z całej piątki, a jednocześnie ten, o którym branża mówi najpewniej.**

### Co faktycznie pokazano

**Chaparro, Baker, Shaikh et al. — „Reading Online Text: A Comparison of Four White Space Layouts"** (Usability News). Manipulacja: marginesy × interlinia, 4 warunki.

- Tekst z marginesami czytany **wolniej**, ale **z lepszym zrozumieniem** niż bez marginesów
- **Interlinia nie wpłynęła na wydajność czytania** — tylko na preferencję
- Satysfakcja wyższa przy marginesach `[snippet]`

**Drugie badanie tej samej grupy** — układ „enhanced" (nagłówki, wcięcia, rozmieszczenie rysunków) vs „poor":

| Miara | Enhanced | Poor | Istotność |
|---|---|---|---|
| Prędkość czytania | 185,60 WPM (SD 47,22) | 183,38 WPM (SD 51,36) | **n.s.** |
| Zrozumienie (/8) | 5,32 (SD 0,99) | 5,08 (SD 1,31) | **n.s.** |
| Satysfakcja z układu | 5,50 | 3,25 | istotna |
| Preferencja | 90% | 10% | istotna |

N=20 studentów, teksty ~800 słów. Konkluzja autorów: „jak odporni są czytelnicy na źle sformatowany tekst online".

### Rozbieżność z tym, co się powtarza

Krążąca po blogach agencyjnych liczba **„Wichita State: białe znaki poprawiają zrozumienie o 20%" — nie znaleziono jej w żadnej publikacji SURL**. Realne wyniki to albo brak istotności, albo *wolniejsze* czytanie przy lepszym zrozumieniu (trade-off, nie darmowy zysk).

Dodatkowo **Usability News to biuletyn Wichita State, nie czasopismo recenzowane**. Próby N≈20. Poziom dowodu: „wskazówka", nie „ustalenie".

### Co jest mocniejsze

- **Goldberg & Kotval** — dobrze zorganizowane grupowanie funkcjonalne daje **krótsze ścieżki skanowania** (eye tracking). Metryka okulomotoryczna, nie wydajnościowa: krótsza ścieżka ≠ szybsze zadanie. `[snippet]`
- **PMC11435723** — eye tracking, kolejność układu a złożoność interfejsu; nowsze, ale dashboardy, nie mobile commerce
- **Prawa Gestalt** (bliskość, wspólny los) mają stuletnią podstawę. Dowodzą, że *odstęp tworzy percepcyjne grupy* — nie że *większy padding poprawia konwersję*. Ten przeskok robi branża, nie literatura.

**Uczciwa konkluzja:** grupowanie przez odstęp jest dobrze ugruntowane percepcyjnie. Twierdzenie, że *więcej* białej przestrzeni mierzalnie poprawia skanowanie i wykrywanie hierarchii na małym ekranie — **nieudowodnione**. Na mobile dochodzi odwrotny koszt: whitespace kupuje się scrollem, a tego trade-offu nie zmierzył nikt.

---

## 4. Spójność wizualna a obciążenie poznawcze

### Dowód umiarkowany, kierunkowo pozytywny, ale na innych zmiennych niż się reklamuje

- **Ozok & Salvendy, Ergonomics 2000, 43(4):443–460** — „Measuring consistency of web page design and its effects on performance and satisfaction". Ustalenie: **niespójność fizyczna zwiększa liczbę błędów użytkownika**. Najczęściej cytowany dowód empiryczny. `[snippet]` Uwaga: web sprzed 25 lat, zadania nawigacyjne, desktop.
- **Mendel & Pak (HFES 2009)** — „The Effect of Interface Consistency and Cognitive Load on User Performance in an Information Search Task". Adresuje pytanie bezpośrednio, ale to proceedings konferencyjny, mała próba. `[snippet]`

### Silniejszy dowód dotyczy pierwszego wrażenia, nie prędkości przetwarzania

- **Reinecke, Yeh, Miratrix et al., CHI 2013** — **N=548, 450 stron WWW**, ekspozycja **500 ms**. Modele obliczeniowe złożoności wizualnej i kolorowości + zmienne demograficzne (wiek, wykształcenie) tłumaczą **~połowę wariancji** ocen estetycznych. Duża, dobrze wykonana praca.
- **Tuch et al., IJHCS 2012** — rola złożoności wizualnej i **prototypowości**: strony wysoko prototypowe („wyglądające jak inne strony tej kategorii") oceniane jako bardziej atrakcyjne; efekty wykrywalne przy **50 ms, a nawet 17 ms**. `[snippet]`

**Ale co to naprawdę mierzy:** zmienna zależna to **ocena estetyczna / atrakcyjność**, nie czas zadania i nie obciążenie poznawcze mierzone obiektywnie. Łańcuch „spójność → processing fluency → niższy cognitive load → szybsze zadanie → wyższa konwersja" ma solidny pierwszy człon i **spekulatywne pozostałe trzy**.

### Kontrprzykład

**Kalbach & Bosenick (Journal of Digital Information, 2003)** — **N=64**, nawigacja po lewej vs po prawej, czas wykonania 5 zadań. Hipoteza, że lewa nawigacja (kanoniczna konwencja) będzie szybsza — **niepotwierdzona, brak istotnej różnicy**.

Jedna z najsilniejszych konwencji układu w historii webu nie ma mierzalnego efektu na wydajność. Sugeruje, że „spójność" działa przez adaptację użytkownika w ciągu sekund, a nie przez trwały koszt poznawczy.

---

## 5. Konwersja w m-commerce a czynniki UI

**Twardych danych prawie nie ma.**

### Najlepsze, co istnieje

**Google / Deloitte / 55, „Milliseconds Make Millions" (2020):**

- **37 marek** (retail, travel, lead gen), Europa + USA
- **>30 mln sesji**
- Czasy ładowania mobile monitorowane godzina po godzinie przez 30 dni (koniec 2019), zestawiane w czasie rzeczywistym z metrykami przychodowymi z analityki każdej marki
- Wynik: poprawa czasu ładowania o **0,1 s** → retail: **konwersja +8,4%, AOV +9,2%**; travel: konwersja +10,1%, AOV +1,9%; luksus: odsłony/sesję +8,6%; lead gen: bounce rate −8,3%

**Dlaczego to nie jest RCT:**

- Badanie **komisjonowane przez Google**, który ma bezpośredni interes w tezie „szybkość = pieniądze"
- Design **obserwacyjny/korelacyjny** — porównuje wolniejsze i szybsze godziny/sesje, nie randomizuje. Ładowanie koreluje z jakością sieci, typem urządzenia i porą dnia; wszystkie trzy niezależnie korelują z zamożnością i intencją zakupową. **Konfundowanie prawdopodobne i nieskorygowane.**
- Poziom ufności **90%**, nie standardowy 95%
- Ekstrapolacja „0,1 s → +8,4%, więc 1 s → +84%" jest nieuprawniona

To wciąż najlepsze dostępne dane i rząd wielkości jest wiarygodny — ale z rygorem badania branżowego.

### Czego brakuje

Nie znaleziono **żadnego** recenzowanego badania randomizującego czynnik UI (rozmiar celu, font, whitespace, spójność) i mierzącego **rzeczywistą konwersję** w m-commerce. Literatura akademicka o m-commerce to niemal wyłącznie:

- modele akceptacji technologii (TAM/UTAUT) — zmienna zależna to **deklarowana intencja zakupu**, nie zakup
- ankiety samoopisowe
- małe badania laboratoryjne z zadaniami symulowanymi

Korelacja intencji z zachowaniem w e-commerce jest notorycznie słaba. **Ta literatura jest bezużyteczna do decyzji projektowych.**

Dane Baymard Institute (formularze checkout, porzucenia koszyka) są metodologicznie lepsze niż typowe case study — duże próby, jawna metodologia — ale nadal komercyjne, nierecenzowane, głównie obserwacyjne/ankietowe.

---

## Gdzie praktyka branżowa rozjeżdża się z dowodami

### 1. 44×44 — liczba bez badania za sobą

Źródła cytowane przez **sam W3C** w „Understanding SC 2.5.5":

- **MIT Touch Lab**, „Human Fingertips to Investigate the Mechanics of Tactile Sense" — antropometria opuszki, **nie badanie interfejsu**
- Parhi/Karlson/Bederson (UMD) — czyli 9,2 mm
- **Wytyczne Apple, Google i Microsoftu**

Czyli **44×44 pochodzi z iOS Human Interface Guidelines**, a WCAG cytuje wytyczne producentów jako uzasadnienie normy dostępności. Cyrkularne. Apple nigdy nie opublikowało badania stojącego za 44 pt.

Przelicznik: 44 CSS px ≈ **9–11,6 mm** fizycznie (zależnie od urządzenia i obsługi viewportu); Material 48dp ≈ **~9 mm** wg dokumentacji Google. Obie liczby są zbieżne z Parhim lub od niego bezpieczniejsze — branżowa reguła jest przypadkowo dobra, ale jej rodowód to konwencja, nie pomiar.

### 2. WCAG 2.2 obniżyło minimum poniżej progu empirycznego

Najostrzejsza rozbieżność w całym materiale:

| Norma | Wymóg | ≈ fizycznie | Błąd wg Parhiego |
|---|---|---|---|
| WCAG 2.1 SC 2.5.5 (**AAA**) | 44×44 CSS px | ~9–11,6 mm | ~1,6–2,8% |
| WCAG 2.2 SC 2.5.8 (**AA**) | **24×24 CSS px** | ~5–6,4 mm | **~10–13%** |

Poziom **AA** — ten, który realnie egzekwuje EAA i większość audytów — dopuszcza cele, przy których dane empiryczne przewidują **rząd 10% błędnych dotknięć**. Obniżenie było decyzją o wykonalności wdrożeniowej (plus furtka „Spacing": cel podwymiarowy przechodzi, jeśli okrąg 24 px wokół niego nie przecina innego celu), nie wynikiem nowych badań.

**Zgodność z AA ≠ interfejs użyteczny dotykiem. 24 px to sufit prawny, nie cel projektowy.**

### 3. „Thumb zone" ma słabszą podstawę niż sugerują infografiki

Recenzowane: **model zasięgu** kciuka (Bergström-Lehtovirta & Oulasvirta, CHI '14) i **przewaga chwytu dwuręcznego** (+9% IP). Nierecenzowane: rozkład chwytów 49/36/15% (Hoober 2013, obserwacja uliczna, era telefonów 4") oraz same heat mapy — wizualizacja zasięgu, **nie mapa wskaźników błędów**.

Zmierzona wersja tej samej wiedzy pochodzi z Parhiego i jest bardziej użyteczna: **rogi wymagają ~25% większych celów niż centrum** (7,5–7,7 mm vs 6,0 mm), a trafienia w dolnym rzędzie systematycznie lądują *powyżej* celu.

### 4. 45–75 znaków na linię nie ma waloru empirycznego na mobile

Bringhurst to estetyka typograficzna. Empiria daje ~55 znaków dla efektywności i ~100 dla samej prędkości, przy jawnej dysocjacji prędkość/preferencja — **wszystko na desktopie**. Telefon wymusza ~35–45 znaków, poniżej całego badanego zakresu. Reguła jest nieoperacyjna na mobile i nie ma czym jej zastąpić.

### 5. „Whitespace poprawia zrozumienie o X%" — brak źródła

Realne wyniki: albo n.s., albo *wolniejsze* czytanie przy lepszym zrozumieniu. Interlinia nie wpłynęła na wydajność w ogóle. Solidnie udokumentowany efekt białej przestrzeni to **satysfakcja i preferencja** (5,50 vs 3,25; 90% vs 10%), nie wydajność.

To nie argument przeciw whitespace — to argument za uzasadnianiem go preferencją i postrzeganą jakością (co w e-commerce przekłada się na zaufanie), a nie fikcyjnymi zyskami wydajnościowymi.

### 6. Większy font nie przyspiesza czytania powyżej progu

Plateau prędkości powyżej critical print size (~0,2°) to jedno z najlepiej ugruntowanych ustaleń w vision science. Realny zysk z większego fontu to margines na gorszy wzrok, gorsze oświetlenie i większy dystans trzymania — i ten argument jest wystarczający.

### 7. Brak dowodu na przełożenie któregokolwiek czynnika na konwersję

Jedyny czynnik UI z twardymi danymi przychodowymi w m-commerce to **szybkość ładowania**, i to z badania obserwacyjnego komisjonowanego przez zainteresowaną stronę. Dla rozmiaru celu, fontu, whitespace i spójności — **zero danych konwersyjnych**.

---

## Ranking siły dowodów

| Twierdzenie | Siła | Podstawa |
|---|---|---|
| Cele <7 mm dramatycznie podnoszą błędy dotknięcia | **Mocna** | Parhi N=20 (pełny tekst) + Henze ~120 mln dotknięć |
| Pozycje dotknięć systematycznie przesunięte, zależnie od strefy ekranu | **Mocna** | Parhi + Henze, dwa niezależne poziomy skali |
| Powyżej ~9,6 mm rośnie prędkość, nie dokładność | **Umiarkowana→mocna** | Parhi, wyraźna post-hoc, ale N=20 |
| Prędkość czytania osiąga plateau powyżej critical print size | **Mocna** | Legge & Bigelow, dekady psychofizyki |
| Starsi potrzebują istotnie większych celów i fontów | **Mocna** | N=220 (2025), N=52 (HF 2012), przegląd systematyczny 2022 |
| Fitts przenosi się na dotyk tylko częściowo; wymaga FFitts | **Umiarkowana→mocna** | Parhi (jawna niezgodność), Ergonomics N=104, Bi & Zhai |
| Pierwsze wrażenie w 17–500 ms zależy od złożoności/prototypowości | **Umiarkowana→mocna** | Reinecke N=548/450 stron, Tuch IJHCS 2012 |
| Kombinacja kolorów tekst/tło wpływa na czytelność | **Umiarkowana** | Applied Ergonomics N=308, ale LCD desktop |
| Szybkość ładowania mobile wpływa na konwersję | **Umiarkowana** | 30 mln sesji, ale obserwacyjne, komisjonowane, 90% CI |
| Niespójność interfejsu zwiększa błędy | **Umiarkowana→słaba** | Ozok & Salvendy 2000 — web sprzed 25 lat, desktop |
| Marginesy poprawiają zrozumienie kosztem prędkości | **Słaba** | Usability News, nierecenzowane, N≈20 |
| Interlinia wpływa na wydajność czytania | **Brak dowodu / negatywny** | Ta sama praca: n.s., wpływ tylko na preferencję |
| Optymalna długość linii na mobile | **Brak dowodu** | Cała literatura desktop/druk |
| Spójny układ sekcji przyspiesza wykonanie zadania | **Słaba / kontrprzykład** | Kalbach & Bosenick N=64: brak różnicy |
| 44×44 jako próg | **Brak podstawy badawczej** | W3C cytuje Apple/Google + antropometrię palca |
| 4,5:1 jako próg kontrastu | **Wyprowadzenie arytmetyczne** | 3:1 (ANSI) × 1,5 (Arditi & Faye); kwestionowane w W3C |
| Rozkłady chwytu 49/36/15% | **Nierecenzowane** | Hoober 2013, era telefonów 4" |
| Whitespace/font/rozmiar celu → konwersja | **Brak jakichkolwiek danych** | — |

---

## Implikacje dla sklepu

1. **Cele ≥9,6 mm dla akcji krytycznych** (dodaj do koszyka, checkout), w rogach i przy dolnej krawędzi więcej. Uzasadnienie: przy 5,8 mm zmierzono 12,9% błędów, a sticky CTA siedzi w najgorszej strefie ekranu. WCAG AA (24 px) nie jest tu punktem odniesienia. Sticky „Dodaj do koszyka" — nominalne 44 px + padding rozszerzający strefę trafienia w dół, **do fizycznej krawędzi** (rekomendacja Parhiego dla celów przykrawędziowych).

2. **Font: przekroczyć próg z zapasem i przestać o tym myśleć.** 16–17 px body na mobile jest bezpiecznie powyżej critical print size dla normowidzących i daje margines dla 65+. Powyżej tego nie kupuje się prędkości czytania, tylko odporność na zmienny dystans trzymania i gorszy wzrok. Nie mieszać tych dwóch uzasadnień.

3. **Whitespace i spójność uzasadniać zaufaniem, nie wydajnością.** Dowód na wpływ na prędkość/zrozumienie jest słaby lub zerowy. Dowód na wpływ na **ocenę estetyczną w 500 ms**, która następnie zmienia postrzeganą użyteczność i wiarygodność, jest mocny (Reinecke, N=548). W e-commerce to właściwa ścieżka przyczynowa i akurat ta z najlepszym poparciem.

---

## Źródła

**Rozmiar celu dotykowego**
- Parhi, Karlson & Bederson — [Target Size Study for One-Handed Thumb Use on Small Touchscreen Devices (MobileHCI '06)](https://www.microsoft.com/en-us/research/wp-content/uploads/2006/01/parhi-mobileHCI06.pdf) · [ACM DL](https://dl.acm.org/doi/10.1145/1152215.1152260) · [HCIL tech report](http://www.cs.umd.edu/hcil/trs/2006-11/2006-11.htm)
- Henze, Rukzio & Boll — [100,000,000 Taps (MobileHCI '11)](https://nhenze.net/uploads/100000000-Taps-Analysis-and-Improvement-of-Touch-Performance-in-the-Large.pdf) · [ACM DL](https://dl.acm.org/doi/pdf/10.1145/2037373.2037395)
- [Finger-Based Pointing Performance on Mobile Touchscreen Devices: Fitts' Law Fits (Springer)](https://link.springer.com/chapter/10.1007/978-3-319-20678-3_31)
- Bergström-Lehtovirta & Oulasvirta — [Modeling the Functional Area of the Thumb (CHI '14)](https://dl.acm.org/doi/10.1145/2556288.2557354)
- [Two-handed grip on a mobile phone affords greater thumb motor performance (PubMed 26360191)](https://pubmed.ncbi.nlm.nih.gov/26360191/)
- [Effect of icon size, icon position and sex on clicking motion — Ergonomics (PubMed 36161546)](https://pubmed.ncbi.nlm.nih.gov/36161546/)
- [Effects of Button Size and Position on Elderly Users — Perceptual and Motor Skills (PubMed 40440033)](https://pubmed.ncbi.nlm.nih.gov/40440033/)
- [Effect of touch screen button size and spacing on touch characteristics — Human Factors (PubMed 22768644)](https://pubmed.ncbi.nlm.nih.gov/22768644/)
- [Influence of size and location of buttons on large touch screens — Ergonomics (PubMed 36762820)](https://pubmed.ncbi.nlm.nih.gov/36762820/)

**Czytelność**
- Legge & Bigelow — [Does print size matter for reading? (Journal of Vision 2011)](https://jov.arvojournals.org/article.aspx?articleid=2191906) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/21828237/) · [PDF](https://graphicdesign-research.com/images/LeggeBiglow-2011.pdf)
- [How to design font size for older adults: systematic literature review (PMC9376262)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9376262/)
- Bernard & Chaparro — [The Effect of Age and Font Size on Reading Text on Handheld Computers](https://link.springer.com/chapter/10.1007/11555261_23)
- [The effect of typeface and font size on reading text on a tablet computer (W4A '19)](https://dl.acm.org/doi/10.1145/3315002.3317568)
- [Optimal Line Length in Reading — A Literature Review (Visible Language 2005)](https://journals.uc.edu/index.php/vl/article/view/5765) · [ERIC](https://eric.ed.gov/?id=EJ749012)

**Białe znaki**
- Chaparro, Baker, Shaikh et al. — [Reading Online Text: A Comparison of Four White Space Layouts](https://portfolio.erau.edu/en/publications/reading-online-text-a-comparison-of-four-white-space-layouts/)
- [Reading Online Text with a Poor Layout: Is Performance Worse? (podsumowanie z pełnymi statystykami)](https://researchinuserexperience.wordpress.com/2005/02/13/reading-online-text-with-a-poor-layout-is-performance-worse/)
- [The Effects of Layout Order on Interface Complexity: An Eye-Tracking Study (PMC11435723)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11435723/)

**Spójność i pierwsze wrażenie**
- Reinecke et al. — [Predicting users' first impressions of website aesthetics (CHI 2013)](https://dl.acm.org/doi/10.1145/2470654.2481281)
- Tuch et al. — [The role of visual complexity and prototypicality (IJHCS 70:11)](https://dl.acm.org/doi/10.1016/j.ijhcs.2012.06.003)
- Ozok & Salvendy — [Measuring consistency of web page design (Ergonomics 43:4, PubMed 10801079)](https://pubmed.ncbi.nlm.nih.gov/10801079/)
- Mendel & Pak — [The Effect of Interface Consistency and Cognitive Load (HFES 2009)](https://journals.sagepub.com/doi/10.1177/154193120905302206)
- Kalbach & Bosenick — [Web Page Layout: Left- vs Right-justified Site Navigation Menus (JoDI 2003)](https://journals.tdl.org/jodi/index.php/jodi/article/view/94/93)

**Standardy**
- W3C — [Understanding SC 2.5.5: Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html) · [Technique C44](https://www.w3.org/WAI/WCAG22/Techniques/css/C44.html) · [SC 2.5.8 Target Size (Minimum)](https://wcag22aa.org/new-criteria/target-size/)
- W3C — [Understanding SC 1.4.3: Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) · [w3c/wcag discussion #3853](https://github.com/w3c/wcag/discussions/3853) · [APCA easy intro](https://git.apcacontrast.com/documentation/APCAeasyIntro)

**Konwersja**
- Google / Deloitte / 55 — [Milliseconds Make Millions (raport PDF)](https://www.thinkwithgoogle.com/_qs/documents/9757/Milliseconds_Make_Millions_report_hQYAbZJ.pdf) · [web.dev case study](https://web.dev/case-studies/milliseconds-make-millions) · [Deloitte](https://deloitte.com/ie/en/services/consulting/research/milliseconds-make-millions.html)
- Hoober — [How We Hold Our Gadgets (A List Apart, nierecenzowane)](https://alistapart.com/article/how-we-hold-our-gadgets/)
