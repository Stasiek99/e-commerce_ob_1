export type EmailJobData =
  | {
      type: 'order_confirmation';
      payload: {
        to: string;
        orderNumber: string;
        firstName: string;
        items: Array<{ name: string; quantity: number; price: number }>;
        totalInCents: number;
        carrierCode?: string;
      };
    }
  | {
      type: 'payment_confirmed';
      payload: {
        to: string;
        orderNumber: string;
        firstName: string;
        totalInCents: number;
      };
    }
  | {
      type: 'payment_confirmed_with_invoice';
      payload: {
        to: string;
        orderNumber: string;
        firstName: string;
        items: Array<{ name: string; quantity: number; price: number }>;
        shippingCostInCents: number;
        totalInCents: number;
        invoiceUrl: string;
        // Buffer serialised to base64 for Redis transport
        invoicePdfBase64: string;
      };
    }
  | {
      type: 'order_cancellation';
      payload: {
        to: string;
        orderNumber: string;
        firstName: string;
        totalInCents: number;
        isRefund: boolean;
      };
    }
  | {
      type: 'shipping_notification';
      payload: {
        to: string;
        orderNumber: string;
        firstName: string;
        carrier: string;
        trackingNumber: string;
        trackingUrl?: string;
      };
    }
  | {
      type: 'email_verification';
      payload: { to: string; firstName: string; verifyUrl: string };
    }
  | {
      type: 'email_change';
      payload: { to: string; firstName: string; newEmail: string; verifyUrl: string };
    }
  | {
      type: 'password_reset';
      payload: { to: string; firstName: string; resetUrl: string };
    }
  | {
      type: 'new_order_notification';
      payload: {
        to: string;
        orderNumber: string;
        customerEmail: string;
        totalInCents: number;
        items: Array<{ name: string; quantity: number; price: number }>;
        carrierCode: string;
        adminUrl?: string;
      };
    }
  | {
      type: 'low_stock_alert';
      payload: {
        to: string;
        orderNumber: string;
        items: Array<{ sku: string; name: string; stock: number; isOutOfStock: boolean }>;
      };
    }
  | {
      type: 'back_in_stock';
      payload: {
        to: string;
        firstName: string;
        productName: string;
        variantLabel: string;
        productUrl: string;
      };
    }
  | {
      type: 'review_request';
      payload: {
        to: string;
        firstName: string;
        orderNumber: string;
        products: Array<{ name: string; imageUrl?: string; reviewUrl: string }>;
      };
    }
  | {
      type: 'return_confirmation';
      payload: {
        to: string;
        firstName: string;
        orderNumber: string;
        requestId: string;
        type: 'WITHDRAWAL' | 'COMPLAINT';
        items: Array<{ productName: string; quantity: number }>;
      };
    }
  | {
      type: 'return_admin_notification';
      payload: {
        to: string;
        requestId: string;
        orderNumber: string;
        customerName: string;
        email: string;
        phone?: string;
        type: 'WITHDRAWAL' | 'COMPLAINT';
        deliveryDate?: string;
        items: Array<{ productName: string; quantity: number }>;
        reason?: string;
        requestedResolution?: string;
        bankAccount?: string;
      };
    }
  | {
      type: 'magic_link_login';
      payload: { to: string; firstName: string; magicUrl: string };
    };
