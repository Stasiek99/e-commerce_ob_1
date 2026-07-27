# Research: fizyczne materiały wysyłkowe (kartony, drukarki, wypełniacze) — Warszawa i okolice

*6 agentów badawczych, ~50 stron/ofert sprawdzonych — stan na 2026-07-02. Ceny orientacyjne,
sprawdź aktualność przed zakupem (rynek detaliczny w Polsce zmienia ceny często).*

Uzupełnienie do `business-operations-launch-guide.md` — ten dokument pokrywa stronę
"co kliknąć w kodzie/AdminJS", ten tutaj pokrywa fizyczną stronę fulfillmentu, której
nie widać z samego repo.

---

## TL;DR

Największa nieoczywista pozycja to **nie kartony czy drukarki, tylko unieruchomienie
flakonu w opakowaniu** — sama folia bąbelkowa bez usztywnienia nie chroni przed
stłuczeniem. Sprzęt (drukarka do faktur + drukarka etykiet) to jednorazowo
**~1250–1900 zł**, materiały startowe na ~100 paczek to **~150–300 zł** (bez dedykowanych
wkładek do butelek) lub **+700–1000 zł** z nimi. Dodatkowo: perfumy formalnie są
towarem ADR (klasa 3, łatwopalne) — w transporcie drogowym krajowym objęte wyjątkiem
LQ, więc bez papierkologii, ale InPost ma w regulaminie wewnętrzną sprzeczność wartą
świadomości.

---

## 1. Kartony wysyłkowe — 0,5–1,1 zł/szt przy 25–100 szt.

Dla rozmiarów pod flakony (150x150x80mm – 250x175x100mm): HeyKapak 0,66–1,09 zł/szt
zależnie od wielkości i ilości progowej.

**Odbiór osobisty w Warszawie (darmowy):**
- Opako.com.pl / Neopak — Nadarzyn, przy Ptak Warsaw Expo (trasa S8)
- Super Opakowania — ul. Kolumbijska 10, przy Makro Bielany; dostawa Warszawa płatna od 44,99 zł

Oferty z Allegro poniżej 0,55 zł/szt to zwykle cieńsza tektura (niższa gramatura,
pojedyncza fala) — przy szkle to fałszywa oszczędność, wyższe ryzyko stłuczenia.

Nie potwierdzono jako aktywnych dostawców z cennikiem: Opakowania.pl, Merx, Panda
Opakowania — mogły zostać przemianowane lub nie są znaczącym graczem w tej niszy,
warto sprawdzić bezpośrednio przed odrzuceniem.

---

## 2. Drukarka WiFi do faktur / dokumentów zamówień — jednorazowo 500–900 zł

| Model | Cena | Uwagi |
|---|---|---|
| **Brother HL-L2400DWE** | ~500–630 zł | WiFi *i* Ethernet (fallback), mono laser, brak skanera. Toner TN-2420 (3000 str.) ~357 zł = ~12 gr/str. |
| **Canon i-SENSYS LBP223dw** | ~875 zł | Najszybsza (33 str./min), najtańszy koszt strony (~0,13 zł), jedyna z Ethernetem *i* WiFi w standardzie |
| Epson EcoTank L3260 | ~799 zł | Atramentowa z tankiem — jeśli chcesz też drukować w kolorze (żadna z powyższych laserówek mono tego nie robi); wolniejsza (~10 str./min) |
| HP Laser MFP 135w/135wg | ~1357 zł (135w) | Droższa, koszt tonera w PLN niepotwierdzony wiarygodnie w tym researchu |

Wszystkie modele WiFi obsługują druk z wielu urządzeń jednocześnie po sieci lokalnej
out-of-the-box — to nie jest funkcja premium wymagająca dedykowanego serwera wydruku.

---

## 3. Drukarka etykiet termicznych (wysyłkowych, 100x150mm) — 250–900 zł

- **Zebra GK420d z drugiej ręki (Allegro/OLX): 700–900 zł** — rekomendowany kompromis.
  Natywny ZPL współpracuje bezpośrednio z InPost/BaseLinker bez renderowania PDF,
  najdłuższa żywotność głowicy. Model wygaszany przez producenta (następca: seria ZD),
  ale mnóstwo egzemplarzy w drugim obiegu po firmach, które zmieniły flotę.
- Nowa Zebra ZD220d: ~650–700 zł netto — jeśli wolisz gwarancję od zera.
- Tanie chińskie Xprintery (XP-410B/423B/450B): 250–480 zł, reklamowane wprost pod
  InPost/DPD/DHL/GLS i faktycznie działają — ale są anegdotyczne zgłoszenia nagłych
  awarii (fora typu Elektroda). Przy tak niskiej cenie wejścia nawet szybka wymiana na
  drugi egzemplarz wychodzi taniej niż jedna Zebra.
- **Niimbot odpada** — fizycznie nie obsługuje formatu 100x150mm (max ~20-60mm), to
  drukarka do etykietowania produktów/pudełek, nie do listów przewozowych.
- Brother QL-1110NWB (~600–900+ zł) — obsługuje 100x150mm, natywne wsparcie macOS
  (rzadkość w tym segmencie), ale droższa i rzadziej testowana z polskimi panelami
  kurierskimi w dostępnych źródłach.

**Format etykiet u przewoźników:** InPost/UPS generują natywnie ZPL (najlepiej z Zebrą,
bez renderowania); DPD/DHL/GLS generują PDF 100x150 (kompatybilne z każdą drukarką
termiczną ze zwykłym sterownikiem Windows). Zebra Browser Print (druk z przeglądarki
bez sterownika) działa tylko z Zebrą.

**Koszt rolek etykiet 100x150mm:** ~35–55 zł za 1000 sztuk (towar generyczny,
niezależny od marki drukarki). Paleta 800 rolek (~22,70 zł/rolkę) opłacalna dopiero
przy bardzo dużym wolumenie — nieadekwatne dla małego sklepu solo na start.

---

## 4. Materiały wypełniające / zabezpieczające — najbardziej nieoczywista pozycja

Branżowa rekomendacja (spójna w 3 niezależnych źródłach) dla flakonu 100–500g:
**unieruchomienie** (wkładka dopasowana do kształtu) jest ważniejsze niż sama
amortyzacja — ruch flakonu w pudełku to główna przyczyna stłuczeń, nie brak
"miękkości" materiału.

- **Folia bąbelkowa**: 16–65 zł/rolka (20–60cm x 100m). Min. **3 warstwy** wokół
  samego flakonu wg zaleceń branżowych (kurierhub.pl, kartoniki.pl).
- **Dedykowane wkładki tekturowe do butelek** (z otworami na szyjkę/dno, projektowane
  pod wino ale zasada przenosi się na flakony): **7–10 zł/szt przy MOQ ~100 szt**
  (eurokarton.pl, kartony.info) — realnie eliminują ruch, ale MOQ i cena jednostkowa
  mogą być przesadzone na sam start przy "kilkudziesięciu" paczkach/miesiąc.
- **Tańsza droga na start**: arkusze przekładek tekturowych do docięcia samodzielnie
  (1,5–2,9 zł/szt, HeyKapak, format paletowy 1200x800mm) + folia bąbelkowa + wypełnienie
  luk papierem/chipsami.
- **Poduszki powietrzne (airbags)** i system **Geami** (papier w plaster miodu) wymagają
  zakupu/wynajmu dedykowanego dyspensera — cena niepubliczna, wymaga kontaktu
  handlowego (Ranpak/Antalis, Neopak, Harmadon). Prawdopodobnie nieopłacalne przy
  niskim wolumenie solo.
- **Chipsy styropianowe (EPS)/Flo-Pak**: sprzedawane luzem (karton 250L, worek 500L),
  tanie w przeliczeniu na litr, ale słabo dopasowują się punktowo do flakonu — lepsze
  jako dodatkowe wypełnienie niż główna ochrona szkła.

**Szacowany koszt zabezpieczenia jednej paczki** (sam materiał, bez kartonu
zewnętrznego): **1–3 zł/paczkę DIY** (folia + wypełniacz papierowy/chipsy) vs
**7–10 zł/paczkę** z gotową dedykowaną wkładką.

**Pełny zestaw zalecany branżowo:** karton wewnętrzny/wkładka dopasowana do kształtu
(unieruchomienie) + min. 3 warstwy folii bąbelkowej wokół szkła + uszczelnienie
nakrętki taśmą/folią stretch przeciw wyciekom + wypełnienie pustych przestrzeni
kartonu zewnętrznego + karton min. 5-warstwowy dla całej przesyłki.

---

## 5. Papier i taśma pakowa — koszty eksploatacyjne, drobne

| Pozycja | Cena |
|---|---|
| Papier A4 (ryza 500 ark., klasa podstawowa) | 15–17 zł brutto |
| Papier A4 (ryza 500 ark., premium/wysoka biel) | 18–20 zł brutto |
| Karton 5 ryz (2500 ark.), hurtowo | ~76 zł (~15,2 zł/ryza) |
| Taśma pakowa 48mm x 60m (pojedynczo) | 1,6–2,3 zł/rolka |
| Taśma pakowa (zgrzewka 6 szt. / karton 36-216 szt.) | spada do ~1,8–1,95 zł/rolka |
| Dyspenser ręczny do taśmy (plastikowy/metalowy) | 11–55 zł |
| Taśma z własnym logo (branded) | od 3,59 zł/rolka netto, ale **MOQ 360 szt.**, matryca jednorazowo ~1000 zł, ~12 dni realizacji |

Taśma z logo — wydatek na później (po ustabilizowaniu wolumenu), nie na sam start.

---

## 6. Ograniczenia przewoźników na wysyłkę perfum — realne ryzyko compliance

Perfumy na bazie alkoholu formalnie są towarem ADR: **UN1266, klasa 3 (ciecz
łatwopalna)**, zwykle grupa pakowania II lub III zależnie od temperatury zapłonu.

**Kluczowe rozróżnienie: transport drogowy krajowy ≠ transport lotniczy.** Dla
transportu drogowego małe detaliczne flakony kwalifikują się pod wyłączenie
**ADR "Limited Quantities" (LQ, ADR 3.4)**:
- brak wymogu doradcy ds. bezpieczeństwa ADR,
- brak rocznego raportowania ADR,
- kierowca nie potrzebuje certyfikacji ADR,
- brak wymogu pełnego dokumentu przewozowego ADR — wystarczy przekazać przewoźnikowi
  łączną wagę brutto,
- limit: **gross mass paczki ≤30 kg** (≤20 kg jeśli paleta zafoliowana taśmą stretch),
- formalnie: paczka powinna nosić oznaczenie **rombu LQ** + strzałki kierunkowe dla
  cieczy, jeśli opakowanie wewnętrzne nie jest samo w sobie szczelnie zamknięte
  i zorientowane. W praktyce mali sprzedawcy rzadko to oznaczają i kurierzy zwykle
  nie sprawdzają pojedynczych detalicznych flakonów — **to szara strefa compliance,
  nie potwierdzona bezpieczna przystań**.

**Per przewoźnik:**
- **InPost — wewnętrzna sprzeczność w regulaminie.** Oficjalna lista zakazanych
  przedmiotów zabrania towarów ADR/LQ i aerozoli (ryzyko wycieku/wybuchu, temperatura
  wnętrza paczkomatu w słońcu >60°C). Jednocześnie własny poradnik InPost wprost
  tłumaczy jak pakować perfumy/kosmetyki w szkle **do 750ml** do Paczkomatu. W praktyce
  pojedyncze detaliczne flakony są tolerowane, ale nie ma tego oficjalnie
  potwierdzonego pisemnie ani rozstrzygniętego wprost przez InPost.
- **DPD**: dozwolone krajowo "pod warunkiem prawidłowego zapakowania" (szczelne
  zamknięcie, zabezpieczenie przed wyciekiem) dla zwykłych ilości detalicznych. Prawdziwy
  ładunek klasyfikowany ADR wymaga osobnej pisemnej umowy ("Warunki Szczególne
  Umowne") — zwykły list przewozowy nie wystarcza.
- **GLS**: niezablokowane całkowicie, ale wymaga **wcześniejszego kontaktu z obsługą
  klienta** przed wysyłką.
- **DHL**: ogólny zakaz cieczy łatwopalnych/żrących w regulaminie; zasady podążają za
  IATA (lotniczy) i ADR (drogowy) zależnie od usługi; zaleca bezpośredni kontakt dla
  kosmetyków na bazie alkoholu. Brak publikowanego wyjątku specyficznego dla perfum.

**Konsekwencje niezgłoszenia/naruszenia** (spójne w ToS InPost/DPD/GLS): kara umowna,
konfiskata paczki, brak odszkodowania za szkodę na samej przesyłce, odpowiedzialność
nadawcy za szkody wyrządzone innym paczkom/personelowi sortowni, możliwe zawieszenie
konta/rozwiązanie umowy, a dla towarów faktycznie poza limitem LQ — potencjalna
odpowiedzialność karna z ustawy o przewozie towarów niebezpiecznych.

**Praktyczna rekomendacja:** traktuj perfumy jako UN1266/klasa 3/wyłączenie LQ dla
krajowego transportu drogowego (bez doradcy ADR, bez oznakowania placard, bez
specjalnego listu przewozowego), ale: (a) pakuj wg wytycznych danego przewoźnika
dot. kosmetyków/szkła (szczelny worek, podwójne pudełko, ≤750ml na paczkę wg własnego
limitu InPost), (b) nie przekraczaj 30 kg brutto/paczka, (c) rozważ tanie oznaczenie
rombem LQ + strzałkami "góra/dół" jako tanią polisę na wypadek sporu/konfiskaty,
(d) przy większym wolumenie uzyskaj pisemne potwierdzenie od opiekuna handlowego
GLS/DPD — "warunkowa akceptacja po kontakcie" był powtarzającym się motywem powyżej
tokenowych ilości detalicznych.

---

## 7. Rekomendowana lista zakupów na start

| Pozycja | Rekomendacja | Koszt |
|---|---|---|
| Drukarka do faktur | Brother HL-L2400DWE | ~550–630 zł |
| Drukarka etykiet | Zebra GK420d (używana) | ~700–900 zł |
| Kartony (100 szt.) | HeyKapak/Opako, odbiór Warszawa | ~70–110 zł |
| Folia bąbelkowa (1-2 rolki) | top-opakowania.pl | ~50–100 zł |
| Wypełniacz/przekładki (docinane) | HeyKapak arkusze | ~50–100 zł |
| Taśma pakowa + dyspenser | pakeo.pl + Allegro | ~30–50 zł |
| Papier A4 (1 ryza) | profibiuro.pl | ~15–20 zł |
| Etykiety termiczne (1 rolka 300szt) | t-pack.pl | ~14 zł |
| **Razem (sprzęt + start materiałów)** | | **~1500–1900 zł** |

Dedykowane wkładki na butelki (7–10 zł/szt) warto odłożyć do momentu, aż będzie znany
realny wskaźnik reklamacji/stłuczeń — na start folia + docinana przekładka powinna
wystarczyć taniej.

---

## Zastrzeżenia i luki w researchu

- Dokładne progi ml/limity ilościowe dla UN1266 w ramach LQ nie zostały potwierdzone
  z pierwotnej tabeli ADR (źródła PDF były niedostępne do odczytu w trakcie researchu)
  — traktuj jako orientacyjne, zweryfikuj przy większym wolumenie.
- Opakowania.pl, Merx, Panda Opakowania nie zostały potwierdzone jako aktywni
  dostawcy z cennikiem — mogły zostać przemianowane, warto sprawdzić bezpośrednio.
- Koszt tonera do HP Laser MFP 135w/135wg nie został wiarygodnie potwierdzony w PLN
  (źródła głównie niemieckie/serbskie).
- Ceny dyspenserów do systemu Geami i pompek do poduszek powietrznych nie są publiczne
  — wymagają bezpośredniego kontaktu z dostawcą.
- Brak jednej "oficjalnej" pisemnej wypowiedzi InPost/DPD/GLS/DHL wprost
  rozstrzygającej "czy trzeba pisać ŁATWOPALNE na pudełku z EDT" — wnioski o
  praktycznej tolerancji są wywnioskowane z przyległych zasad i komentarzy
  forum/blogów branżowych, nie z jednoznacznej polityki przewoźnika.
