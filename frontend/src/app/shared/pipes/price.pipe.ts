import { Pipe, PipeTransform } from "@angular/core";

@Pipe({ name: "price", standalone: true })
export class PricePipe implements PipeTransform {
  transform(cents: number | undefined | null): string {
    if (cents == null) return "—";
    return (cents / 100).toFixed(2).replace(".", ",") + " zł";
  }
}
