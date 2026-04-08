import { CarrierCode, OrderStatus, PaymentStatus, ShipmentStatus } from '../enums';

export interface AddressDto {
  id: string;
  firstName: string;
  lastName: string;
  company?: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
}

export interface CreateAddressDto {
  firstName: string;
  lastName: string;
  company?: string;
  street: string;
  city: string;
  postalCode: string;
  country?: string;
  phone: string;
  isDefault?: boolean;
}

export interface CreateOrderDto {
  addressId?: string;
  newAddress?: CreateAddressDto;
  carrierCode: CarrierCode;
  inpostLockerCode?: string;
  notes?: string;
}

export interface OrderItemDto {
  id: string;
  snapshotName: string;
  snapshotSku: string;
  snapshotPrice: number;
  quantity: number;
  totalPrice: number;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  items: OrderItemDto[];
  snapshotFirstName: string;
  snapshotLastName: string;
  snapshotStreet: string;
  snapshotCity: string;
  snapshotPostalCode: string;
  snapshotCountry: string;
  snapshotPhone: string;
  snapshotEmail: string;
  carrierCode: CarrierCode;
  inpostLockerCode?: string;
  itemsTotalInCents: number;
  shippingCostInCents: number;
  discountInCents: number;
  totalInCents: number;
  notes?: string;
  payment?: {
    status: PaymentStatus;
    paidAt?: string;
  };
  shipment?: {
    status: ShipmentStatus;
    trackingNumber?: string;
    labelUrl?: string;
  };
  createdAt: string;
}

export interface CreateOrderResponseDto {
  orderId: string;
  orderNumber: string;
  paymentUrl: string;
}
