# Opisy produktów w sklepie z perfumami — widoczność (SEO) vs. wartość dla użytkownika

*5 równoległych sub-badań, ~30 źródeł łącznie — 2026-08-04*

## TL;DR

Tak, opisy nadal mają sens — ale **nie konkurują z danymi o nutach/rodzinach zapachowych, tylko pełnią inną funkcję**. Dane strukturalne (nuty, rodzina zapachowa, `notesNormalized`) to warstwa skanowalna/filtrowalna — do tego służy fragrance finder. Opis narracyjny to warstwa "symulacji wyobrażeniowej" — kompensuje tzw. "olfactory gap" (zapachu nie da się opisać równie precyzyjnie jak obrazu czy dźwięku), czyli odpowiada na pytanie "jak to będzie pachnieć na mnie/jak się będę czuć", którego żadna tabela atrybutów nie odda. Sephora, Notino i inni liderzy branży trzymają obie warstwy jednocześnie na karcie produktu, nie zamiast siebie.

Pod kątem SEO: unikalny opis nie daje formalnego bonusu rankingowego ani nie jest wymagany do rich snippetu (Google wymaga `offers`/`review`/`aggregateRating`, nie `description`) — ale kopiowanie opisu producenta to **problem selekcji, nie kary**: gdy wiele stron ma identyczny tekst, Google i tak pokaże tylko jedną (zwykle markę lub większego gracza), a wy przegrywacie ten "tie-break". Oryginalny opis to też jedyny sposób złapania długiego ogona zapytań ("perfumy na lato zapach wanilii"), którego surowe tagi nut nie pokryją.

## Kluczowe wnioski

1. **Użytkownicy nie czytają opisów linearnie — skanują (79% skanuje vs. 16% czyta słowo w słowo)** [nngroup.com], ale sięgają po opis selektywnie, gdy brakuje im konkretnej informacji, której obraz/tabela specyfikacji nie dają. Baymard ma wprost udokumentowany przypadek balsamu do ciała, gdzie tester nie potrafił z obrazka wywnioskować zapachu — to 1:1 analogia do perfum [baymard.com/blog/product-images-descriptive-text]. **Confidence: HIGH**

2. **Format "highlights" (krótkie, wypunktowane call-outy) angażuje użytkowników bardziej niż ściana tekstu**, a stosuje go tylko 22% sklepów — realna przewaga konkurencyjna do wykorzystania [baymard.com/blog/structure-descriptions-by-highlights]. **Confidence: MEDIUM**

3. **Duplicate content nie jest karany algorytmicznie, ale przegrywa "selekcję" w wynikach.** Google od 2008 r. (i John Mueller w 2021) potwierdza: kopiowanie opisu producenta samo w sobie nie obniża rankingu, ale gdy wiele stron ma identyczny tekst, Google pokazuje jedną "najlepszą" (zwykle markę) — reszta traci widoczność. Cienka/skopiowana treść produktowa jest jawnie wymieniana jako wzorzec dotknięty Helpful Content Update (2022+) [developers.google.com/search/blog/2008, SEJ/Mueller 2021, wrise.co.uk]. **Confidence: HIGH (brak kary) / MEDIUM (utrata widoczności ma realny wpływ na ruch)**

4. **Pole `description` NIE jest wymagane do kwalifikacji do Product rich snippet** (wymagane: `offers`, `review` lub `aggregateRating`) i **snippet w wynikach wyszukiwania pochodzi głównie z treści strony, nie z meta description ani JSON-LD** [developers.google.com/search/docs/appearance/structured-data/product-snippet, developers.google.com/search/docs/appearance/snippet]. Osobna sprawa to **Google Merchant Center / Google Shopping**, gdzie `description` JEST wymagane, ma twardy limit 1–5000 znaków, ostrzeżenia za "za krótki"/"za długi" tekst i zakaz treści promocyjnych — to inne pole, inne zasady niż opis SEO na stronie [support.google.com/merchants/answer/6324468]. **Confidence: HIGH**

5. **Praktyczna długość: ~300–500 słów oryginalnej treści on-page** dla SEO (nie kopiowanej od producenta); jeśli kiedyś dojdzie feed do Google Shopping, to osobny opis ~500–1000 znaków, inne zasady formatowania [airops.com, godatafeed.com]. **Confidence: MEDIUM**

6. **Konkretny, sensoryczny język zwiększa postrzeganą jakość i intencję zakupu — to nie jest tylko marketingowa maniera, tylko potwierdzony efekt psychologiczny.** Klasyczne badanie Cornell (Wansink) na menu restauracyjnym: opisowe etykiety (np. "chrupiąca panierka" zamiast "kurczak") podniosły sprzedaż o 27% i sprawiły, że to samo danie oceniano jako smaczniejsze — czysty efekt framingu na produkcie trudnym do opisania specyfikacją [foodservicedirector.com]. Badanie JCR 2023 pokazuje, że konkretny język sensoryczny zwiększa **postrzeganą autentyczność** i chęć zakupu [academic.oup.com/jcr]. **Confidence: HIGH** (dla efektu ogólnego), **LOW** (dla twardych % konwersji w e-commerce — te liczby krążące w branżowych blogach, np. "+22% Kiehl's", nie mają możliwego do zweryfikowania źródła pierwotnego).

7. **Ważne zastrzeżenie z tego samego badania Cornell: opis nie może obiecywać więcej niż produkt dostarcza** — przesadzony/nieprecyzyjny opis podbija pierwszy zakup, ale obniża powtórne zakupy, gdy rzeczywistość rozczarowuje [foodservicedirector.com]. Dla perfum oznacza to: **opis narracyjny musi być spójny z realnymi notami produktu**, nie z niej oderwany.

8. **Sama piramida nut jest częściowo artefaktem marketingowym, nie ścisłym rozkładem chemicznym** — Fragrantica sama to przyznaje: notatki są pisane "jak powinno pachnieć" bardziej niż jako techniczny opis formuły [fragrantica.com]. To dodatkowy argument za tym, że surowe dane o notach *same w sobie* już zawierają element narracyjny, ale wciąż nie oddają doświadczenia noszenia zapachu.

9. **Wzorzec liderów branży: struktura + narracja, nigdy zamiast siebie.** Sephora prowadzi jednocześnie blok strukturalny (Fragrance Family, Scent Type, Key Notes) i osobny blok narracyjny ("Fragrance Description", "About the Fragrance"). Notino dokłada trzecią warstwę — framing okazja/nastrój ("cytrusowe na energię", "drzewne na spokojny wieczór") [sephora.com, notino.co.uk]. **Confidence: MEDIUM-HIGH**

## Sprzeczności i zastrzeżenia

- Wiele przywoływanych w branży liczb ("storytelling podnosi konwersję o 30%", "72% konsumentów nie ufa generycznym opisom", case study Kiehl's +22%) pochodzi z blogów marketingowych/agencyjnych bez możliwego do zweryfikowania źródła pierwotnego — potraktowane jako niskiej wiarygodności "branżowy folklor", nie dowód.
- Żadne znalezione źródło nie podaje twardej, izolowanej liczby "o ile % rośnie konwersja dzięki lepszemu opisowi" w kontrolowanym eksperymencie e-commerce — najsilniejszy dowód (Wansink) pochodzi z gastronomii, nie e-commerce, choć mechanizm (framing na produkcie trudnym do zweryfikowania przed zakupem) jest bezpośrednio przenaszalny.
- Efekt language-evoked olfactory imagery jest moderowany przez indywidualną "potrzebę zapachu" (need for smell) — zbyt intensywny język sensoryczny może się nie sprawdzić u części odbiorców [sciencedirect.com 2024].

## Tabela weryfikacji

| Twierdzenie | Źródła | Pewność |
|---|---|---|
| Brak formalnej kary za duplicate content, ale utrata widoczności w selekcji wyników | Google (blog 2008, docs), Mueller 2021, 2 źródła wtórne | HIGH |
| Użytkownicy skanują, nie czytają liniowo; brakujące dane sensoryczne = porzucenia | Baymard (4400+ sesji testowych), NN/g | HIGH |
| `description` nieobowiązkowe do rich snippet; pochodzi z treści strony, nie meta/JSON-LD | Google Search Central docs (2 strony) | HIGH |
| Merchant Center `description` ma twarde limity i zakaz treści promo | Google Merchant Center support docs | HIGH |
| Sensoryczny, konkretny język zwiększa postrzeganą jakość/intencję zakupu | Wansink (Cornell, peer-reviewed), JCR 2023, Krishna 2012 | HIGH |
| Format "highlights" > ściana tekstu | Baymard (1 źródło) | MEDIUM |
| Struktura (Sephora/Notino) = dane + narracja jednocześnie, nie zamiennie | Obserwacja bezpośrednia stron + wtórne | MEDIUM-HIGH |
| Konkretne % konwersji z case studies agencyjnych (Kiehl's, ASOS, Sure Oak 42%) | Blogi marketingowe, brak izolowanej zmiennej | LOW |

## Rekomendacja dla tego sklepu

Sklep ma już infrastrukturę pod warstwę strukturalną (`searchText`, `notesNormalized`, fragrance finder) — to zgodne z tym, co robią liderzy rynku. Brakującym elementem jest krótki opis narracyjny **osobno od danych o notach**, nie zamiast nich:

1. **Struktura**: zostawić notes/scentFamily jako warstwę filtrowalną/porównywalną — to działa, potwierdzone przez badania i istniejący finder.
2. **Dodać 100–250 słów oryginalnego opisu na produkt**, pierwsze 1-2 zdania samodzielnie sensowne dla skanujących, reszta w formacie "highlights" (krótkie akapity/call-outy, nie ściana tekstu).
3. **Język konkretny, nie generyczny** — nie "drzewny, świeży", tylko odniesienie do faktycznych nut produktu (np. "spalona, ziemista nuta wetiwerii" zamiast "drzewny"). Musi być spójny z listą nut, żeby nie zawyżać oczekiwań (efekt Wansinka o powtórnych zakupach).
4. **Framing okazja/nastrój** jako trzecia, krótka warstwa (wzorzec Notino) — dobrze łapie długi ogon zapytań SEO.
5. **Nie kopiować opisu producenta 1:1** — to nie kara algorytmiczna, ale przegrywa się selekcję najlepszej strony z marką/większym sklepem; oryginalny tekst to też jedyne źródło danych do `searchText` poza samymi nutami (dopisuje się do `shortDescription` w denormalizowanej kolumnie wyszukiwania — czyli lepszy opis realnie poprawia też własne wyszukiwanie, nie tylko SEO Google).
6. **Nie inwestować w długość opisu pod kątem rich snippetów** — to nie jest wymagane pole; jeśli zależy na rich results, priorytet to `Review`/`AggregateRating` schema, nie długość `description`.

## Źródła (wybrane, pełna lista w wynikach sub-agentów)

1. [Baymard — Product Descriptions](https://baymard.com/blog/product-descriptions)
2. [Baymard — Structuring by Highlights](https://baymard.com/blog/structure-descriptions-by-highlights)
3. [Baymard — Descriptive Text/Graphics for Images](https://baymard.com/blog/product-images-descriptive-text)
4. [NN/g — Why Web Users Scan](https://www.nngroup.com/articles/why-web-users-scan-instead-reading/)
5. [Google Search Central — Duplicate Content](https://developers.google.com/search/docs/advanced/guidelines/duplicate-content)
6. [Search Engine Journal — Mueller on manufacturer descriptions](https://www.searchenginejournal.com/google-duplicate-product-descriptions/420899/)
7. [Google — Product snippet requirements](https://developers.google.com/search/docs/appearance/structured-data/product-snippet)
8. [Google — Search snippet sourcing](https://developers.google.com/search/docs/appearance/snippet)
9. [Google Merchant Center — description spec](https://support.google.com/merchants/answer/6324468)
10. [FoodService Director — Wansink menu study, +27% sales](https://www.foodservicedirector.com/menu-trends/menu-descriptions-help-sales-study-says)
11. [Journal of Consumer Research 2023 — sensory language](https://academic.oup.com/jcr/article-abstract/50/4/810/7072465)
12. [Krishna 2012 — Integrative Review of Sensory Marketing](https://aradhnakrishna.com/wp-content/uploads/2021/02/integrative_review.pdf)
13. [Sephora product page structure](https://www.sephora.com/product/prada-paradigme-eau-de-parfum-P517225)
14. [Fragrantica — Olfactory Pyramid critique](https://www.fragrantica.com/news/Olfactory-Pyramid-or-Perfumer-s-Nightmare-8810.html)
15. [Notino — notes/occasion structure](https://www.notino.co.uk/perfume-notes/)
