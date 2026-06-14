import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface ReviewSummary {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  adminReply: string | null;
  helpfulCount: number;
  createdAt: string;
  verifiedPurchase: boolean;
  authorName: string;
}

export interface ReviewsPage {
  data: ReviewSummary[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface CreateReviewDto {
  productId: string;
  orderId?: string;
  rating: number;
  title?: string;
  body?: string;
}

@Injectable({ providedIn: 'root' })
export class ReviewsService {
  private readonly http = inject(HttpClient);

  getByProduct(productId: string, page = 1, sort: 'recent' | 'helpful' = 'recent') {
    return this.http.get<ReviewsPage>(
      `${environment.apiUrl}/reviews/product/${productId}`,
      { params: { page: String(page), limit: '10', sort } },
    );
  }

  submit(dto: CreateReviewDto) {
    return this.http.post<{ id: string }>(`${environment.apiUrl}/reviews`, dto);
  }

  markHelpful(id: string) {
    return this.http.post<{ id: string; helpfulCount: number }>(
      `${environment.apiUrl}/reviews/${id}/helpful`,
      {},
    );
  }

  getMine() {
    return this.http.get<any[]>(`${environment.apiUrl}/reviews/mine`);
  }

  getEligibleOrder(productId: string) {
    return this.http.get<{ orderId: string | null }>(
      `${environment.apiUrl}/reviews/eligible-order`,
      { params: { productId } },
    );
  }
}
