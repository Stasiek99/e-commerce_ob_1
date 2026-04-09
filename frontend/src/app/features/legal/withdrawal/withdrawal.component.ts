import { Component } from '@angular/core';

@Component({
  selector: 'app-withdrawal',
  standalone: true,
  template: `
    <div class="legal-page">
      <h1>Prawo odstąpienia od umowy</h1>
      <p class="version">Zgodnie z ustawą z dnia 30 maja 2014&nbsp;r. o prawach konsumenta (Dz.U. 2014 poz. 827)</p>

      <section>
        <h2>Prawo do odstąpienia</h2>
        <p>Masz prawo odstąpić od niniejszej umowy w terminie <strong>14 dni bez podania jakiejkolwiek przyczyny</strong>.</p>
        <p>Termin do odstąpienia od umowy wygasa po upływie 14 dni od dnia, w którym weszłeś/weszłaś w posiadanie towaru lub w którym osoba trzecia inna niż przewoźnik i wskazana przez Ciebie weszła w posiadanie towaru.</p>
        <p>Aby skorzystać z prawa odstąpienia od umowy, musisz poinformować nas:</p>
        <div class="contact-box">
          <p><strong>[Nazwa spółki]</strong></p>
          <p>[Adres]</p>
          <p>E-mail: <strong>zwroty&#64;fragrance-store.pl</strong></p>
        </div>
        <p>o swojej decyzji o odstąpieniu od niniejszej umowy w drodze jednoznacznego oświadczenia (na przykład pismo wysłane pocztą lub pocztą elektroniczną).</p>
        <p>Możesz skorzystać z wzoru formularza odstąpienia od umowy zamieszczonego poniżej, jednak nie jest to obowiązkowe.</p>
        <p>Aby zachować termin do odstąpienia od umowy, wystarczy, abyś wysłał(a) informację dotyczącą wykonania przysługującego Ci prawa odstąpienia od umowy przed upływem terminu do odstąpienia od umowy.</p>
      </section>

      <section>
        <h2>Skutki odstąpienia</h2>
        <p>W przypadku odstąpienia od niniejszej umowy zwracamy Ci wszystkie otrzymane od Ciebie płatności, w tym koszty dostarczenia towaru (z wyjątkiem dodatkowych kosztów wynikających z wybranego przez Ciebie sposobu dostarczenia innego niż najtańszy zwykły sposób dostarczenia oferowany przez nas), niezwłocznie, a w każdym przypadku nie później niż 14 dni od dnia, w którym zostaliśmy poinformowani o Twojej decyzji o wykonaniu prawa odstąpienia od niniejszej umowy.</p>
        <p>Zwrotu płatności dokonamy przy użyciu takich samych sposobów płatności, jakie zostały przez Ciebie użyte w pierwotnej transakcji, chyba że wyraźnie zgodziłeś/zgodziłaś się na inne rozwiązanie; w każdym przypadku nie poniesiesz żadnych opłat w związku z tym zwrotem.</p>
        <p>Możemy wstrzymać się ze zwrotem płatności do czasu otrzymania towaru lub do czasu dostarczenia nam dowodu jego odesłania, w zależności od tego, które zdarzenie nastąpi wcześniej.</p>
        <p>Proszę odesłać lub przekazać nam towar niezwłocznie, a w każdym razie nie później niż 14 dni od dnia, w którym poinformowałeś/poinformowałaś nas o odstąpieniu od niniejszej umowy. Termin jest zachowany, jeżeli odeślesz towar przed upływem terminu 14 dni.</p>
        <p>Będziesz musiał/a ponieść bezpośrednie koszty zwrotu towarów.</p>
        <p>Odpowiadasz tylko za zmniejszenie wartości towarów wynikające z korzystania z nich w sposób inny niż było to konieczne do stwierdzenia charakteru, cech i funkcjonowania towarów.</p>
      </section>

      <section>
        <h2>Wzór formularza odstąpienia od umowy</h2>
        <div class="form-template">
          <p>(formularz ten należy wypełnić i odesłać tylko w przypadku chęci odstąpienia od umowy)</p>
          <br>
          <p>Adresat: [Nazwa spółki], [Adres], zwroty&#64;fragrance-store.pl</p>
          <br>
          <p>Ja/My(*) niniejszym informuję/informujemy(*) o moim/naszym(*) odstąpieniu od umowy sprzedaży następujących rzeczy(*) / o świadczenie następującej usługi(*):</p>
          <p>Data zawarcia umowy(*)/odbioru(*):</p>
          <p>Numer zamówienia:</p>
          <p>Imię i nazwisko konsumenta(-ów):</p>
          <p>Adres konsumenta(-ów):</p>
          <br>
          <p>Podpis konsumenta(-ów) (tylko jeżeli formularz jest przesyłany w wersji papierowej):</p>
          <br>
          <p>Data:</p>
          <br>
          <p class="asterisk">(*) Niepotrzebne skreślić.</p>
        </div>
      </section>

      <section>
        <h2>Wyjątki od prawa odstąpienia</h2>
        <p>Prawo odstąpienia od umowy nie przysługuje w odniesieniu do umów:</p>
        <ul>
          <li>w której przedmiotem świadczenia jest rzecz nieprefabrykowana, wyprodukowana według specyfikacji konsumenta lub służąca zaspokojeniu jego zindywidualizowanych potrzeb;</li>
          <li>w której przedmiotem świadczenia jest rzecz ulegająca szybkiemu zepsuciu lub mająca krótki termin przydatności do użycia;</li>
          <li>w której przedmiotem świadczenia jest rzecz dostarczana w zapieczętowanym opakowaniu, której po otwarciu opakowania nie można zwrócić ze względu na ochronę zdrowia lub ze względów higienicznych, jeżeli opakowanie zostało otwarte po dostarczeniu.</li>
        </ul>
        <p class="note">Uwaga: perfumy i produkty do pielęgnacji ciała podlegają powyższemu wyjątku, jeżeli opakowanie zostało naruszone. Prosimy o zwrot produktów w oryginalnym, nienaruszonym opakowaniu.</p>
      </section>
    </div>
  `,
  styles: [`
    .legal-page { max-width: 740px; margin: 0 auto; padding: 40px 0; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .version { font-size: 13px; color: var(--color-secondary); margin-bottom: 40px; }
    section { margin-bottom: 32px; }
    h2 { font-size: 17px; font-weight: 700; margin-bottom: 12px; border-bottom: 1px solid var(--color-border); padding-bottom: 6px; }
    p { font-size: 14px; line-height: 1.7; margin-bottom: 10px; color: #333; }
    ul { padding-left: 20px; margin-bottom: 10px; }
    li { font-size: 14px; line-height: 1.7; margin-bottom: 6px; color: #333; }
    .contact-box { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 16px 20px; margin: 12px 0; }
    .contact-box p { margin: 4px 0; }
    .form-template { background: #f9f9f9; border: 1px dashed var(--color-border); border-radius: var(--radius-sm); padding: 20px; font-size: 13px; line-height: 1.8; }
    .form-template p { margin: 0; }
    .asterisk { font-style: italic; color: var(--color-secondary); }
    .note { background: #fff8e1; border-left: 3px solid #f59e0b; padding: 10px 14px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; font-style: italic; }
  `],
})
export class WithdrawalComponent {}
