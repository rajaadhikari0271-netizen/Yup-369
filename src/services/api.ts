import type {
  AuthResponse,
  MenuItem,
  Order,
  OrderStatus,
  OwnerOverviewResponse,
  PaymentMethod,
  PricingSettings,
  PublicCatalog,
  Restaurant,
  RiderApprovalHistoryEntry,
  RiderApprovalStatus,
  RiderBankDetails,
  RiderDocuments,
  RiderEarningsResponse,
  RiderServiceKey,
  UserProfile,
} from '../types/domain';

let memoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  // Public
  getCatalog: () => request<PublicCatalog>('/api/public/catalog'),

  // Auth
  register: (payload: {
    role: 'CUSTOMER' | 'RIDER';
    name: string;
    email: string;
    phone: string;
    password: string;
    savedAddress?: string;
    cityArea?: string;
    riderOnboarding?: {
      dummyGovIdRef: string;
      dummyLicenseRef: string;
      dummyVehiclePlate: string;
      dummyVehicleType: RiderDocuments['dummyVehicleType'];
      requestedServices: RiderServiceKey[];
      dummyBankDetails: RiderBankDetails;
    };
  }) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  me: () => request<{ user: UserProfile }>('/api/auth/me'),

  getOwnerStatus: () =>
    request<{ configured: boolean; mode: 'env_configured' | 'claimed' | 'claim_required' }>(
      '/api/auth/owner-status'
    ),

  ownerBootstrap: (payload: { name: string; email: string; passcode: string }) =>
    request<AuthResponse>('/api/auth/owner-bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ownerLogin: (payload: { email: string; passcode: string }) =>
    request<AuthResponse>('/api/auth/owner-login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Customer
  updateCustomerProfile: (payload: { name: string; phone: string; savedAddress: string }) =>
    request<{ user: UserProfile }>('/api/customer/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getCustomerOrders: () => request<{ orders: Order[] }>('/api/customer/orders'),

  placeOrder: (payload: {
    restaurantId: string;
    serviceType: 'FOOD_DELIVERY' | 'SELF_PICKUP';
    items: { menuItemId: string; quantity: number }[];
    deliveryAddress?: string;
    pickupInstructions?: string;
    paymentMethod: PaymentMethod;
  }) =>
    request<{ order: Order }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Rider
  getRiderProfile: () => request<{ user: UserProfile }>('/api/rider/profile'),

  submitRiderDocuments: (payload: {
    cityArea?: string;
    dummyGovIdRef: string;
    dummyLicenseRef: string;
    dummyVehiclePlate: string;
    dummyVehicleType: RiderDocuments['dummyVehicleType'];
    dummyPayoutRef: string;
    dummyBankDetails: RiderBankDetails;
    requestedServices?: RiderServiceKey[];
  }) =>
    request<{ user: UserProfile }>('/api/rider/documents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleRiderAvailability: (isOnline: boolean) =>
    request<{ user: UserProfile }>('/api/rider/availability', {
      method: 'PATCH',
      body: JSON.stringify({ isOnline }),
    }),

  getRiderJobs: () => request<{ jobs: Order[] }>('/api/rider/jobs'),

  respondToJob: (orderId: string, action: 'ACCEPT' | 'REJECT', reason?: string) =>
    request<{ order: Order }>(`/api/rider/jobs/${encodeURIComponent(orderId)}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    }),

  confirmPickup: (orderId: string) =>
    request<{ order: Order }>(`/api/rider/jobs/${encodeURIComponent(orderId)}/pickup`, {
      method: 'POST',
    }),

  completeDelivery: (orderId: string) =>
    request<{ order: Order }>(`/api/rider/jobs/${encodeURIComponent(orderId)}/complete`, {
      method: 'POST',
    }),

  getRiderEarnings: () => request<RiderEarningsResponse>('/api/rider/earnings'),

  // Owner
  getOwnerOverview: () => request<OwnerOverviewResponse>('/api/owner/overview'),

  getOwnerRiders: (params?: { q?: string; status?: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ riders: OwnerOverviewResponse['riders'] }>(`/api/owner/riders${suffix}`);
  },

  getRiderApprovalHistory: (riderId: string) =>
    request<{ history: RiderApprovalHistoryEntry[] }>(
      `/api/owner/riders/${encodeURIComponent(riderId)}/history`
    ),

  updateCustomerStatus: (customerId: string, status: 'ACTIVE' | 'SUSPENDED') =>
    request<{ customer: UserProfile }>(`/api/owner/customers/${encodeURIComponent(customerId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  updateRiderApproval: (
    riderId: string,
    approvalStatus: RiderApprovalStatus,
    approvalNotes?: string
  ) =>
    request<{ rider: UserProfile }>(`/api/owner/riders/${encodeURIComponent(riderId)}/approval`, {
      method: 'PATCH',
      body: JSON.stringify({ approvalStatus, approvalNotes }),
    }),

  updateRiderDocumentStatus: (
    riderId: string,
    documentStatus: RiderApprovalStatus,
    approvalNotes?: string
  ) =>
    request<{ rider: UserProfile }>(`/api/owner/riders/${encodeURIComponent(riderId)}/documents-status`, {
      method: 'PATCH',
      body: JSON.stringify({ documentStatus, approvalNotes }),
    }),

  updateRiderServiceApproval: (
    riderId: string,
    serviceKey: RiderServiceKey,
    status: RiderApprovalStatus,
    notes?: string
  ) =>
    request<{ rider: UserProfile }>(`/api/owner/riders/${encodeURIComponent(riderId)}/service-approval`, {
      method: 'PATCH',
      body: JSON.stringify({ serviceKey, status, notes }),
    }),

  createRestaurant: (payload: {
    name: string;
    cuisine: string;
    address: string;
    prepTimeMins: number;
    supportsDelivery: boolean;
    supportsSelfPickup: boolean;
  }) =>
    request<{ restaurant: Restaurant }>('/api/owner/restaurants', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateRestaurant: (
    restaurantId: string,
    payload: Partial<Pick<Restaurant, 'isOpen' | 'supportsDelivery' | 'supportsSelfPickup' | 'prepTimeMins' | 'name' | 'cuisine'>>
  ) =>
    request<{ restaurant: Restaurant }>(`/api/owner/restaurants/${encodeURIComponent(restaurantId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  addMenuItem: (
    restaurantId: string,
    payload: { name: string; description: string; category: string; price: number; isVeg: boolean }
  ) =>
    request<{ item: MenuItem; restaurant: Restaurant }>(
      `/api/owner/restaurants/${encodeURIComponent(restaurantId)}/menu`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateMenuItem: (
    itemId: string,
    payload: Partial<Pick<MenuItem, 'isAvailable' | 'price' | 'name'>>
  ) =>
    request<{ item: MenuItem }>(`/api/owner/menu/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  updateOrderStatus: (orderId: string, status: OrderStatus) =>
    request<{ order: Order }>(`/api/owner/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  assignRider: (orderId: string, riderId: string) =>
    request<{ order: Order }>(`/api/owner/orders/${encodeURIComponent(orderId)}/assign-rider`, {
      method: 'POST',
      body: JSON.stringify({ riderId }),
    }),

  updatePricing: (payload: Partial<PricingSettings>) =>
    request<{ pricing: PricingSettings }>('/api/owner/pricing', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  recordManualPayout: (payload: {
    riderId: string;
    amount: number;
    referenceNumber: string;
    methodNote: string;
  }) =>
    request('/api/owner/payouts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
