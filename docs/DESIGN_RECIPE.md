# Design Recipe: 15 Best Practices for Your Fragrance E-Commerce Store

> **Reference Document** — Synthesized from stochastic consensus analysis of the Chogan website and premium fragrance e-commerce patterns. Keep this file open while implementing.

**Last updated:** 2026-04-09  
**Status:** Ready for Phase 0 implementation  
**Stack:** Angular 18 + Taiga UI + SCSS

---

## Table of Contents

- [Design Principes Overview](#design-principles-overview)
- [15 Best Practices (with code)](#15-best-practices-with-code)
- [Next Steps (Action Items)](#next-steps-action-items)
- [Implementation Priority](#implementation-priority)
- [Testing Checklist](#testing-checklist)

---

## Design Principles Overview

These 15 practices are grounded in three core principles that make fragrance e-commerce feel **clean, neat, and premium**:

1. **Information Scarcity Signals Luxury** — Generous whitespace, minimal content saturation. Let product photography dominate.
2. **Consistency Creates Safety** — Predictable spacing (8px grid), typography scale, colors. Users trust aligned, ordered interfaces.
3. **Mobile-First Simplicity** — Thumb-friendly interactions, readable text, graceful reflow. If it works on 320px, it works everywhere.

---

## 15 Best Practices (with code)

### **1. Spacing System: 8px Grid Multiples**

**What it does:** All spacing (padding, gaps, margins) uses 8px increments.

**Why:** Predictable spacing creates rhythm. Brain recognizes intentional ratios as professional.

**Implementation:**

Create `frontend/src/styles/_spacing.scss`:

```scss
// Spacing tokens — use these everywhere
$spacing-xs: 0.5rem;  // 8px
$spacing-sm: 1rem;    // 16px
$spacing-md: 1.5rem;  // 24px
$spacing-lg: 2rem;    // 32px
$spacing-xl: 2.5rem;  // 40px
$spacing-2xl: 3rem;   // 48px

// CSS variables (for JavaScript access if needed)
:root {
  --spacing-xs: 0.5rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 2.5rem;
  --spacing-2xl: 3rem;
}
```

**Usage in components:**

```scss
.product-grid {
  gap: var(--spacing-lg);  // 32px between items
}

.product-card {
  padding: var(--spacing-sm);  // 16px padding
}
```

✅ **Done:** Import `_spacing.scss` in your global styles and use consistently across all components.

---

### **2. Responsive Product Grid Layout**

**What it does:** 4-column desktop (1200px+) → 2–3 columns tablet → 1 column mobile (<768px).

**Why:** Mobile users scan images first (2-3 sec glance). Desktop can show more. Grid reflows without distortion.

**Implementation:**

```scss
// frontend/src/styles/_grid.scss

.product-grid {
  display: grid;
  gap: var(--spacing-lg);  // 32px
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  
  // Desktop: naturally 4 columns
  // (280px * 4 + 32px * 3 = 1216px, fills ~1200px+ screens)
  
  @media (max-width: 1024px) {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    // 2–3 columns on tablets
  }
  
  @media (max-width: 768px) {
    grid-template-columns: 1fr;  // 1 column on mobile
    gap: var(--spacing-md);  // Tighter on mobile
  }
}

.product-card {
  img {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border-radius: 8px;
  }
}
```

**Test points:**
- 320px (iPhone SE) — 1 column, image fills width
- 768px (iPad) — 2 columns, balanced
- 1024px (iPad Pro) — 3 columns
- 1440px (desktop) — 4 columns

✅ **Done:** Apply to your product listing component.

---

### **3. Color Palette: 3–4 Colors Maximum**

**What it does:** Limit palette to primary (black), secondary (gray), accent (1 brand color), and optionally error/success.

**Why:** Multiple saturated colors = noise. Luxury brands use restrained palettes (Cartier = gold + black + red).

**Implementation:**

Create `frontend/src/styles/_colors.scss`:

```scss
// Core palette
$color-primary: #1a1a1a;      // Deep black (text, headers, primary CTAs)
$color-surface: #ffffff;       // White (card backgrounds, surface)
$color-secondary: #6b6b6b;    // Neutral gray (supporting text, icons)
$color-accent: #c9a96e;       // Warm gold (prices, CTAs, focus states)
$color-border: #e5e5e5;        // Light gray (dividers, borders)

// Status colors
$color-error: #e63946;         // Red (errors, warnings)
$color-success: #2a9d8f;       // Teal (success, confirmation)

// CSS variables for Taiga override
:root {
  --tui-primary: #{$color-primary};
  --tui-accent-new: #{$color-accent};
  --tui-base-01: #{$color-surface};
  --tui-text-01: #{$color-primary};
  --tui-border-normal: #{$color-border};
}
```

**Usage:**

```scss
.button-primary {
  background: $color-accent;
  color: white;
  
  &:hover {
    opacity: 0.9;  // Fade, don't change color
  }
}

.text-secondary {
  color: $color-secondary;
}
```

✅ **Done:** Import `_colors.scss` globally and update your theme tokens.

---

### **4. Typography Scale: Consistent Hierarchy**

**What it does:** 3–4 font sizes with clear hierarchy and weight variations.

**Why:** Users recognize hierarchy in <500ms via size + weight. Consistent ratios feel intentional.

**Implementation:**

Create `frontend/src/styles/_typography.scss`:

```scss
// Font stack
$font-family-base: 'Inter', system-ui, -apple-system, sans-serif;
$font-family-accent: 'Inter', system-ui;  // Or 'Playfair Display' for serif

// Font sizes
$font-size-caption: 0.875rem;   // 12–14px (meta, SKU)
$font-size-body: 1rem;          // 14–16px (product description)
$font-size-subhead: 1.125rem;   // 18–20px (category, labels)
$font-size-h3: 1.5rem;          // 24px (product name)
$font-size-h2: 1.75rem;         // 28px (section header)
$font-size-h1: 2rem;            // 32px (page title)

// Font weights
$font-weight-light: 300;
$font-weight-regular: 400;
$font-weight-medium: 500;
$font-weight-semibold: 600;
$font-weight-bold: 700;

// Line heights (inversely proportional to size)
$line-height-tight: 1.2;        // Headings
$line-height-normal: 1.4;       // Subheadings
$line-height-relaxed: 1.6;      // Body text, captions

// Global defaults
body {
  font-family: $font-family-base;
  font-size: $font-size-body;
  font-weight: $font-weight-regular;
  line-height: $line-height-relaxed;
  color: $color-primary;
}

h1 {
  font-size: $font-size-h1;
  font-weight: $font-weight-bold;
  line-height: $line-height-tight;
  margin-bottom: $spacing-md;
}

h2 {
  font-size: $font-size-h2;
  font-weight: $font-weight-semibold;
  line-height: $line-height-tight;
  margin-bottom: $spacing-md;
}

h3 {
  font-size: $font-size-h3;
  font-weight: $font-weight-semibold;
  line-height: $line-height-normal;
}

.caption {
  font-size: $font-size-caption;
  font-weight: $font-weight-light;
  color: $color-secondary;
  line-height: $line-height-normal;
}
```

**Taiga UI integration:**

```html
<!-- Use Taiga typography directives -->
<h2 tuiHeading="h2">Product Name</h2>     <!-- 28px -->
<p tuiLabel="body">Description text</p>    <!-- 16px -->
<span tuiLabel="caption">100ml</span>      <!-- 12px -->
```

✅ **Done:** Import `_typography.scss` globally and apply to all text elements.

---

### **5. Product Card Information Order**

**What it does:** Stack info top-to-bottom: Image → Name → Meta → Price → CTA.

**Why:** Mirrors purchase decision flow. Users scan downward on mobile; no backtracking needed.

**Implementation:**

```typescript
// product-card.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TuiCardModule, TuiButtonModule } from '@taiga-ui/core';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, TuiCardModule, TuiButtonModule],
  template: `
    <tui-card class="product-card">
      <!-- 1. Image (largest) -->
      <img class="card-image" [src]="product.image" [alt]="product.name" />
      
      <!-- 2. Product name -->
      <h3 class="card-title">{{ product.name }}</h3>
      
      <!-- 3. Meta (scent profile, brand) -->
      <p class="card-meta">{{ product.scentProfile }}</p>
      
      <!-- 4. Price -->
      <p class="card-price">{{ product.price | number:'1.2-2' }} zł</p>
      
      <!-- 5. CTA -->
      <button 
        tuiButton 
        type="button"
        class="btn-primary"
        (click)="onAddToCart()">
        Do koszyka
      </button>
    </tui-card>
  `,
  styleUrls: ['./product-card.component.scss']
})
export class ProductCardComponent {
  @Input() product!: any;
  
  onAddToCart() {
    console.log('Adding to cart:', this.product.id);
    // Emit to parent or call service
  }
}
```

**Styling (`product-card.component.scss`):**

```scss
.product-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);  // 16px between sections
  
  .card-image {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 8px;
    margin-bottom: var(--spacing-sm);  // Extra space after image
  }
  
  .card-title {
    font-size: 1.125rem;
    font-weight: 600;
    line-height: 1.4;
    color: $color-primary;
  }
  
  .card-meta {
    font-size: 0.875rem;
    color: $color-secondary;
    margin-bottom: var(--spacing-xs);
  }
  
  .card-price {
    font-size: 1.125rem;
    font-weight: 600;
    color: $color-accent;
    font-family: 'Courier New', monospace;  // Monospace for stable width
    text-align: right;
    min-width: 4.5ch;  // Reserve space
  }
  
  .btn-primary {
    align-self: stretch;
    margin-top: auto;  // Push to bottom if heights vary
  }
}
```

✅ **Done:** Apply to your product card component.

---

### **6. Hover & Interactive States (Subtle Elevation)**

**What it does:** On hover, cards scale 1.03x and elevate shadow. Buttons fade opacity.

**Why:** Subtle feedback confirms responsiveness. Luxury ≠ flashy.

**Implementation:**

```scss
// Add to product-card.component.scss or global interactions.scss

.product-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  
  &:hover {
    transform: scale(1.03);  // 3% scale
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);  // Elevated
  }
}

// Button interactions
button {
  transition: opacity 0.15s ease, transform 0.1s ease;
  
  &:hover {
    opacity: 0.9;  // Fade
  }
  
  &:active {
    transform: scale(0.98);  // Press feedback
  }
}

// Focus state (accessibility critical)
button:focus-visible,
a:focus-visible {
  outline: 3px solid $color-accent;
  outline-offset: 2px;
}
```

✅ **Done:** Add hover states to product card and all interactive elements.

---

### **7. Mobile-First Responsive Design**

**What it does:** Design for mobile first, enhance for tablet/desktop. Text always ≥14px on mobile.

**Why:** 60%+ traffic on mobile. Mobile constraints force clarity.

**Implementation:**

```scss
// Mobile-first approach (default = mobile)

.product-grid {
  grid-template-columns: 1fr;  // 1 column default
  gap: var(--spacing-md);      // Tighter on mobile
}

.product-card-title {
  font-size: 1rem;  // 16px on mobile (not smaller!)
}

// Enhance for tablet (≥768px)
@media (min-width: 768px) {
  .product-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-lg);
  }
  
  .product-card-title {
    font-size: 1.125rem;
  }
}

// Enhance for desktop (≥1024px)
@media (min-width: 1024px) {
  .product-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

// High-DPI screens
@media (min-width: 1440px) {
  .product-grid {
    max-width: 1280px;
    margin: 0 auto;
  }
}
```

**Test breakpoints:**
- 320px (iPhone SE)
- 375px (iPhone 12)
- 600px (iPad mini)
- 1024px (iPad Pro)
- 1440px (desktop)

✅ **Done:** Test on real mobile devices, not just Chrome DevTools.

---

### **8. Loading States & Skeleton Screens**

**What it does:** While loading, show faded placeholder cards with shimmer animation. Never show empty state.

**Why:** Skeleton screens reduce perceived wait time by 40%. Shows layout instantly.

**Implementation:**

Create `skeleton-loader.component.ts`:

```typescript
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-skeleton-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="skeleton-grid">
      @for (i of [1, 2, 3, 4]; track i) {
        <div class="skeleton-card">
          <div class="skeleton-image"></div>
          <div class="skeleton-title"></div>
          <div class="skeleton-price"></div>
        </div>
      }
    </div>
  `,
  styleUrls: ['./skeleton-loader.component.scss']
})
export class SkeletonLoaderComponent {
  @Input() count: number = 4;
}
```

**Styling (`skeleton-loader.component.scss`):**

```scss
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacing-lg);
}

.skeleton-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.skeleton-image {
  aspect-ratio: 1;
  background: linear-gradient(
    90deg,
    #f0f0f0 25%,
    #e0e0e0 50%,
    #f0f0f0 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

.skeleton-title {
  height: 1.125rem;  // Text height
  background: #f0f0f0;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
  animation-delay: 0.1s;
}

.skeleton-price {
  height: 1rem;
  width: 4.5ch;
  background: #f0f0f0;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
  animation-delay: 0.2s;
  margin-left: auto;  // Right-align
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

// Image fade-in when loaded
img {
  animation: fadeIn 0.3s ease-in forwards;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

**Usage in product list:**

```typescript
@Component({
  template: `
    @if (isLoading) {
      <app-skeleton-loader [count]="4" />
    } @else {
      <div class="product-grid">
        @for (product of products; track product.id) {
          <app-product-card [product]="product" />
        }
      </div>
    }
  `
})
export class ProductListComponent {
  isLoading = true;
}
```

✅ **Done:** Add skeleton loader to product list and detail pages.

---

### **9. Typography: Line Length (65 Characters)**

**What it does:** Constrain body text to max 65 characters per line (~600px width).

**Why:** Shorter lines read 10–15% faster. Fragrance descriptions are prose, not dense specs.

**Implementation:**

```scss
// Add to global typography.scss

.prose {
  max-width: 65ch;  // Character-based max-width
  line-height: 1.6;
  font-size: 1rem;
}

.product-description {
  @extend .prose;
}

// On desktop, pair image + description side-by-side
@media (min-width: 1024px) {
  .product-detail {
    display: grid;
    grid-template-columns: 1fr 65ch;
    gap: var(--spacing-xl);  // 40px between image and text
  }
}
```

✅ **Done:** Apply `max-width: 65ch` to product descriptions and detail pages.

---

### **10. Card Borders & Shadows (Gestalt Closure)**

**What it does:** Define card boundaries using subtle shadows, never thick borders.

**Why:** Subtle boundaries feel premium. Thick borders look cheap. Brain auto-groups items within boundaries.

**Implementation:**

```scss
// Add to global cards.scss

.tui-card {
  border: none;
  border-radius: 4px;  // Minimal rounding
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);  // Subtle depth
  background: $color-surface;
}

// Optional: dividers between sections
.section-divider {
  border-top: 1px solid $color-border;  // Very light
  margin: var(--spacing-lg) 0;
}

// Focus state (instead of outline)
button:focus-visible {
  outline: 3px solid $color-accent;
  outline-offset: 2px;
  // Don't use border for focus—outlines are for accessibility
}
```

✅ **Done:** Update card styling to use subtle shadows, override default borders.

---

### **11. Button Styling (Primary CTA)**

**What it does:** Full-width on mobile, padded on desktop. Solid fill (no borders). Accent color.

**Why:** Full-width is thumb-friendly on mobile. Solid fill looks modern.

**Implementation:**

```scss
// Add to buttons.scss or global interactions.scss

.button-primary {
  padding: 0.875rem 2rem;      // 14px vertical, 32px horizontal (desktop)
  background: $color-accent;
  color: white;
  font-weight: 500;
  font-size: 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.15s ease;
  
  &:hover {
    opacity: 0.9;  // Subtle fade
  }
  
  &:active {
    transform: scale(0.98);
  }
  
  // Mobile: full-width
  @media (max-width: 768px) {
    width: 100%;
    padding: 1rem 2rem;  // Taller on mobile (48px min height)
    min-height: 48px;
  }
}

// Secondary button (less emphasis)
.button-secondary {
  padding: 0.875rem 2rem;
  background: transparent;
  color: $color-primary;
  border: 1px solid $color-border;
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s ease;
  
  &:hover {
    border-color: $color-primary;
  }
}
```

**Taiga UI approach:**

```html
<button tuiButton appearance="primary">Add to Cart</button>
<button tuiButton appearance="secondary">View Details</button>
```

✅ **Done:** Style primary and secondary buttons, ensure 48px+ height on mobile.

---

### **12. Pricing Display (Right-Aligned, Monospace)**

**What it does:** Right-align prices in monospace font to prevent layout shift when price width changes.

**Why:** Layout shifts (CLS) degrade UX. Monospace ensures "99 zł" and "9999 zł" occupy same width.

**Implementation:**

```scss
.card-price {
  text-align: right;
  font-family: 'Courier New', 'Courier', monospace;
  font-size: 1.125rem;
  font-weight: 600;
  color: $color-accent;
  min-width: 4.5ch;  // Reserve space for max price
}

// Example: both align to same column regardless of price width
.price-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  
  .price-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    
    .price {
      @extend .card-price;
      flex-shrink: 0;  // Don't compress on overflow
    }
  }
}
```

**HTML:**

```html
<!-- Both prices align right, no layout shift -->
<div class="price-item">
  <span>Small</span>
  <span class="price">249.99 zł</span>
</div>
<div class="price-item">
  <span>Large</span>
  <span class="price">9999.99 zł</span>
</div>
```

✅ **Done:** Apply monospace font to all prices, use right-alignment.

---

### **13. Form Inputs & Focus States**

**What it does:** Light border, dark border on focus, no default outline. Clear focus indicator.

**Why:** Outlines are often removed in modern design, breaking accessibility. Use border color instead.

**Implementation:**

```scss
// Add to forms.scss

input,
select,
textarea {
  border: 1px solid $color-border;
  border-radius: 4px;
  padding: 0.625rem 0.75rem;  // 10px vertical, 12px horizontal
  font-size: 1rem;
  background: $color-surface;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  font-family: inherit;
  
  &:focus {
    outline: none;  // Remove default outline
    border-color: $color-primary;  // Dark border on focus
    box-shadow: 0 0 0 3px rgba(26, 26, 26, 0.1);  // Subtle glow
  }
  
  &:disabled {
    background: #f5f5f5;
    cursor: not-allowed;
    opacity: 0.6;
  }
}

// Error state
input.error {
  border-color: $color-error;
  
  &:focus {
    box-shadow: 0 0 0 3px rgba(230, 57, 70, 0.1);
  }
}

// Label styling
label {
  display: block;
  margin-bottom: var(--spacing-xs);
  font-weight: 500;
  font-size: 0.875rem;
}
```

**Taiga UI approach:**

```typescript
<tui-input-module>
  <input tuiInput placeholder="Email" />
</tui-input-module>
```

✅ **Done:** Style form inputs with dark focus borders, apply to checkout/contact forms.

---

### **14. Variant Selection (Colors, Sizes)**

**What it does:** Color variants as pill buttons/swatches (40x40px). Size variants as dropdown. Disable if out-of-stock.

**Why:** Visual variant selection is faster than dropdowns alone. Disabled state signals unavailability.

**Implementation:**

```typescript
// variant-selector.component.ts
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Variant {
  id: string;
  name: string;
  hex?: string;  // For color variants
  stock: number;
}

@Component({
  selector: 'app-variant-selector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="variant-selector">
      <!-- Color swatches -->
      @if (colorVariants.length > 0) {
        <div class="variant-group">
          <label>Kolory:</label>
          <div class="color-swatches">
            @for (color of colorVariants; track color.id) {
              <button
                (click)="onSelectColor(color)"
                [style.backgroundColor]="color.hex"
                [class.selected]="selectedColorId === color.id"
                [disabled]="color.stock === 0"
                class="swatch"
                [title]="color.name + (color.stock === 0 ? ' (Brak)' : '')">
              </button>
            }
          </div>
        </div>
      }
      
      <!-- Size dropdown -->
      @if (sizeVariants.length > 0) {
        <div class="variant-group">
          <label for="size-select">Rozmiar:</label>
          <select 
            id="size-select"
            (change)="onSelectSize($event)"
            [disabled]="!selectedColorId">
            <option value="">-- Wybierz --</option>
            @for (size of sizeVariants; track size.id) {
              <option [value]="size.id" [disabled]="size.stock === 0">
                {{ size.name }} @if (size.stock === 0) { (Brak) }
              </option>
            }
          </select>
        </div>
      }
    </div>
  `,
  styleUrls: ['./variant-selector.component.scss']
})
export class VariantSelectorComponent {
  @Input() colorVariants: Variant[] = [];
  @Input() sizeVariants: Variant[] = [];
  @Output() variantSelected = new EventEmitter<{ colorId: string; sizeId: string }>();
  
  selectedColorId: string = '';
  selectedSizeId: string = '';
  
  onSelectColor(color: Variant) {
    if (color.stock > 0) {
      this.selectedColorId = color.id;
    }
  }
  
  onSelectSize(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.selectedSizeId = select.value;
    this.variantSelected.emit({
      colorId: this.selectedColorId,
      sizeId: this.selectedSizeId
    });
  }
}
```

**Styling (`variant-selector.component.scss`):**

```scss
.swatch {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  &.selected {
    border-color: $color-accent;
    box-shadow: 0 0 0 2px white, 0 0 0 4px $color-accent;
  }
  
  &:hover:not(:disabled) {
    border-color: $color-secondary;
  }
}

.color-swatches {
  display: flex;
  gap: var(--spacing-xs);
  flex-wrap: wrap;
}

select {
  border: 1px solid $color-border;
  border-radius: 4px;
  padding: 0.625rem 0.75rem;
  font-size: 1rem;
  width: 100%;
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}
```

✅ **Done:** Add to product detail pages.

---

### **15. Progressive Disclosure (Details on Click)**

**What it does:** Product cards show summary (image, name, price). Click "Details" → modal reveals full specs, reviews, ingredients.

**Why:** Cognitive overload kills conversions. Users decide in 3–5 seconds. Show "why buy?" first; specs second.

**Implementation:**

```typescript
// product-detail-modal.component.ts
import { Component, Inject, Input } from '@angular/core';
import { TUI_DIALOG_CONTEXT, TuiDialogContext } from '@taiga-ui/core';

@Component({
  selector: 'app-product-detail-modal',
  standalone: true,
  template: `
    <div class="modal-content">
      <div class="modal-header">
        <h2>{{ product.name }}</h2>
        <button (click)="close()">✕</button>
      </div>
      
      <div class="modal-body">
        <!-- Scent profile -->
        <section>
          <h3>Profil zapachu</h3>
          <p>{{ product.scentNotes }}</p>
        </section>
        
        <!-- Ingredients -->
        <section>
          <h3>Składniki</h3>
          <ul>
            @for (ingredient of product.ingredients; track ingredient) {
              <li>{{ ingredient }}</li>
            }
          </ul>
        </section>
        
        <!-- Reviews -->
        <section>
          <h3>Opinie ({{ product.reviewCount }})</h3>
          @for (review of product.reviews; track review.id) {
            <div class="review">
              <p><strong>{{ review.author }}</strong></p>
              <p>{{ review.text }}</p>
            </div>
          }
        </section>
      </div>
    </div>
  `,
  styleUrls: ['./product-detail-modal.component.scss']
})
export class ProductDetailModalComponent {
  @Input() product: any;
  
  constructor(@Inject(TUI_DIALOG_CONTEXT) private context: TuiDialogContext<null>) {}
  
  close() {
    this.context.$implicit.completeWith(null);
  }
}
```

**Usage (product card):**

```typescript
// In product-card.component.ts
import { TuiDialogService } from '@taiga-ui/core';

export class ProductCardComponent {
  constructor(private dialogService: TuiDialogService) {}
  
  onViewDetails() {
    this.dialogService.open(ProductDetailModalComponent, {
      data: { product: this.product }
    }).subscribe();
  }
}
```

**Styling (`product-detail-modal.component.scss`):**

```scss
.modal-content {
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--spacing-lg);
  border-bottom: 1px solid $color-border;
  margin-bottom: var(--spacing-lg);
}

section {
  margin-bottom: var(--spacing-xl);
  
  h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: var(--spacing-sm);
  }
}

.review {
  padding: var(--spacing-md);
  background: #f9f9f9;
  border-radius: 4px;
  margin-bottom: var(--spacing-sm);
  
  p {
    margin: 0;
    
    &:first-child {
      font-weight: 600;
      margin-bottom: var(--spacing-xs);
    }
  }
}
```

✅ **Done:** Add modal to product cards for detailed information.

---

## Next Steps (Action Items)

### **Step 1: Install Taiga UI**

Run in `frontend/` directory:

```bash
cd frontend
ng add @taiga-ui/cdk
ng add @taiga-ui/core
```

This installs:
- `@taiga-ui/cdk` — CDK (utilities, pipes, directives)
- `@taiga-ui/core` — Core components (buttons, cards, dialogs, etc.)

**Verify installation:**

```bash
# Check angular.json has Taiga in styles and scripts
cat angular.json | grep taiga

# You should see:
# "styles": ["./src/styles.scss", "@taiga-ui/core/styles/taiga-ui-theme.less", ...]
# "scripts": ["@taiga-ui/core/styles/taiga-ui-theme.less"]
```

**Status:** ⏳ Pending

---

### **Step 2: Set Up Global Design Tokens**

Create the following files:

**`frontend/src/styles/design-tokens.scss`:**

```scss
// ═══════════════════════════════════════════════════════════════════════════
// Design Tokens — Single source of truth for spacing, colors, typography
// ═══════════════════════════════════════════════════════════════════════════

// ── SPACING ──────────────────────────────────────────────────────────────
$spacing-xs: 0.5rem;    // 8px
$spacing-sm: 1rem;      // 16px
$spacing-md: 1.5rem;    // 24px
$spacing-lg: 2rem;      // 32px
$spacing-xl: 2.5rem;    // 40px
$spacing-2xl: 3rem;     // 48px

// ── COLORS ───────────────────────────────────────────────────────────────
$color-primary: #1a1a1a;      // Deep black
$color-surface: #ffffff;       // White
$color-secondary: #6b6b6b;    // Neutral gray
$color-accent: #c9a96e;       // Warm gold
$color-border: #e5e5e5;        // Light gray
$color-error: #e63946;         // Red
$color-success: #2a9d8f;       // Teal

// ── TYPOGRAPHY ───────────────────────────────────────────────────────────
$font-family-base: 'Inter', system-ui, -apple-system, sans-serif;

$font-size-caption: 0.875rem;
$font-size-body: 1rem;
$font-size-subhead: 1.125rem;
$font-size-h3: 1.5rem;
$font-size-h2: 1.75rem;
$font-size-h1: 2rem;

$font-weight-light: 300;
$font-weight-regular: 400;
$font-weight-medium: 500;
$font-weight-semibold: 600;
$font-weight-bold: 700;

// ── BORDER RADIUS ────────────────────────────────────────────────────────
$border-radius-sm: 4px;
$border-radius-md: 8px;
$border-radius-lg: 16px;

// ── SHADOWS ──────────────────────────────────────────────────────────────
$shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.08);
$shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
$shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);

// ── CSS VARIABLES (for JS access) ────────────────────────────────────────
:root {
  --spacing-xs: 0.5rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 2.5rem;
  --spacing-2xl: 3rem;

  --color-primary: #1a1a1a;
  --color-surface: #ffffff;
  --color-secondary: #6b6b6b;
  --color-accent: #c9a96e;
  --color-border: #e5e5e5;
  --color-error: #e63946;
  --color-success: #2a9d8f;

  // Taiga UI overrides
  --tui-primary: #1a1a1a;
  --tui-accent-new: #c9a96e;
  --tui-base-01: #ffffff;
  --tui-text-01: #1a1a1a;
}
```

**Import in `frontend/src/styles.scss`:**

```scss
@import 'styles/design-tokens';
@import 'styles/spacing';
@import 'styles/colors';
@import 'styles/typography';
@import 'styles/interactions';
// ... rest of global styles
```

**Update `angular.json` to include design tokens:**

```json
{
  "projects": {
    "frontend": {
      "architect": {
        "build": {
          "options": {
            "styles": [
              "src/styles.scss",
              "node_modules/@taiga-ui/core/styles/taiga-ui-theme.less",
              "node_modules/@taiga-ui/core/styles/taiga-ui-theme-dark.less"
            ]
          }
        }
      }
    }
  }
}
```

**Status:** ⏳ Pending

---

### **Step 3: Start with Product Card Component (Highest Impact)**

The product card is the foundation. Once it's clean, all other components follow.

**Create `frontend/src/app/shared/product-card/product-card.component.ts`:**

```typescript
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TuiCardModule, TuiButtonModule } from '@taiga-ui/core';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, TuiCardModule, TuiButtonModule],
  templateUrl: './product-card.component.html',
  styleUrls: ['./product-card.component.scss']
})
export class ProductCardComponent {
  @Input() product: any;
  
  onAddToCart() {
    console.log('Adding to cart:', this.product.id);
  }
  
  onViewDetails() {
    console.log('View details:', this.product.id);
  }
}
```

**Template (`product-card.component.html`):**

```html
<tui-card class="product-card">
  <img class="card-image" [src]="product.image" [alt]="product.name" />
  <h3 class="card-title">{{ product.name }}</h3>
  <p class="card-meta">{{ product.scentProfile }}</p>
  <p class="card-price">{{ product.price | number:'1.2-2' }} zł</p>
  
  <button 
    tuiButton
    type="button"
    class="btn-primary"
    (click)="onAddToCart()">
    Do koszyka
  </button>
  
  <a class="card-link" (click)="onViewDetails()">
    Szczegóły
  </a>
</tui-card>
```

**Styling (`product-card.component.scss`):**

(Use styles from **Practice #5** above)

**Test:**

```bash
ng serve
# Visit http://localhost:4200
# Verify card looks clean, loads without errors
```

**Status:** ⏳ Pending

---

### **Step 4: Test on Real Mobile Devices**

**Don't rely on Chrome DevTools alone.** Test on actual devices:

**Mobile devices to test:**
- iPhone SE (320px)
- iPhone 12 (375px)
- Samsung Galaxy S21 (360px)
- iPad (768px)

**Network throttling (Chrome DevTools):**
1. Open DevTools → Network tab
2. Select "Slow 3G" to simulate slow networks
3. Verify images load progressively
4. Check skeleton loaders appear

**Landscape orientation:**
- Rotate phone to landscape
- Verify layout doesn't break
- Text remains readable (font size ≥14px)
- Buttons still accessible

**Accessibility check:**
- Tab through all interactive elements
- Verify focus indicators visible
- Test with screen reader (NVDA on Windows, VoiceOver on macOS)

**Performance check (Lighthouse):**
```bash
# Run Lighthouse in Chrome DevTools
# Target: LCP <2.5s, CLS <0.1, FID <100ms
```

**Status:** ⏳ Pending

---

## Implementation Priority

### Phase 0 (MVP — Week 1–2)

These are **critical** for the initial design system:

1. ✅ Spacing system (8px grid) — 2 hrs
2. ✅ Responsive grid layout — 4 hrs
3. ✅ Color palette — 1 hr
4. ✅ Typography scale — 2 hrs
5. ✅ Product card layout — 4 hrs
6. ✅ Hover states — 2 hrs
7. ✅ Mobile responsive — 6 hrs
8. ✅ Loading skeletons — 4 hrs
9. ✅ Line length (65ch) — 1 hr
10. ✅ Card borders/shadows — 1 hr
11. ✅ Button styling — 2 hrs
12. ✅ Price display (monospace) — 1 hr

**Total: ~36 hours**

### Phase 1 (Enhancement — Week 3+)

These are **nice-to-have** for detail pages and checkout:

13. Form inputs & focus states — 3 hrs
14. Variant selection — 4 hrs
15. Progressive disclosure (modals) — 4 hrs

**Total: ~11 hours**

---

## Testing Checklist

### Before shipping each practice:

- [ ] Desktop (1440px, 1024px) — Visually correct
- [ ] Tablet (768px, 600px) — Layout reflows gracefully
- [ ] Mobile (375px, 320px) — Full-width, readable, thumb-friendly
- [ ] Landscape — No horizontal scroll, readable
- [ ] Slow 3G — Images load progressively, skeletons show
- [ ] Focus states — Tab navigation works, focus visible
- [ ] Color contrast — WCAG AA (4.5:1 text, 3:1 UI elements)
- [ ] Screen reader — All text readable, buttons labeled
- [ ] Lighthouse — LCP <2.5s, CLS <0.1, FID <100ms

---

## Questions?

Refer back to this document as you implement each practice. When stuck:

1. Check the code snippet for your practice
2. Test on real mobile device
3. Run Lighthouse
4. Verify WCAG accessibility

**This document is your recipe. Follow it step-by-step, and your fragrance store will feel clean, premium, and professional.**

---

**Created:** 2026-04-09  
**Last updated:** 2026-04-09  
**Status:** Ready for implementation
