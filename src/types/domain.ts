export type UserRole = 'CUSTOMER' | 'RIDER' | 'OWNER';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

export type RiderApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type ServiceType =
  | 'FOOD_DELIVERY'
  | 'SELF_PICKUP'
  | 'GROCERY'
  | 'PARCEL'
  | 'BIKE_TAXI';

export interface ServiceDefinition {
  id: ServiceType;
  name: string;
  tagline: string;
  enabled: boolean;
  statusNote: string;
}

export type OrderStatus =
  | 'PLACED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'COMPLETED'
  | 'CANCELLED';

export type RiderJobStatus = 'UNASSIGNED' | 'ASSIGNED' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED';

export type PaymentMethod = 'CASH_ON_DELIVERY' | 'PAY_AT_COUNTER';

export type PaymentStatus = 'PENDING_COLLECTION' | 'COLLECTED_ON_DELIVERY' | 'PAID_AT_COUNTER';

export type RiderServiceKey = 'FOOD_DELIVERY' | 'GROCERY' | 'PARCEL' | 'BIKE_TAXI';

export interface RiderServiceApproval {
  requested: boolean;
  status: RiderApprovalStatus | 'DISABLED';
  notes?: string;
  updatedAt?: string;
}

export type RiderServiceApprovals = Record<RiderServiceKey, RiderServiceApproval>;

export interface RiderBankDetails {
  accountHolderName: string;
  dummyAccountNumber: string;
  dummyIfscCode: string;
  dummyPayoutRef: string;
}

export interface RiderDocuments {
  dummyGovIdRef: string;
  dummyLicenseRef: string;
  dummyVehiclePlate: string;
  dummyVehicleType: 'Scooter' | 'Motorcycle' | 'E-Bike' | 'Bicycle';
  dummyPayoutRef: string;
  dummyBankDetails?: RiderBankDetails;
  submittedAt: string;
}

export interface UserProfile {
  id: string;
  role: UserRole;
  name: string;
  email: string;
  phone: string;
  cityArea?: string;
  status: AccountStatus;
  savedAddress?: string;
  // Unified Rider account fields
  approvalStatus?: RiderApprovalStatus;
  documentStatus?: RiderApprovalStatus;
  documentNotes?: string;
  serviceApprovals?: RiderServiceApprovals;
  approvalNotes?: string;
  isOnline?: boolean;
  documents?: RiderDocuments | null;
  createdAt: string;
}

export type RiderApprovalTarget = 'DOCUMENTS' | 'SERVICE_FOOD_DELIVERY' | 'REGISTRATION';

export interface RiderApprovalHistoryEntry {
  id: string;
  riderId: string;
  riderName: string;
  riderEmail: string;
  target: RiderApprovalTarget;
  serviceKey?: RiderServiceKey;
  previousStatus?: RiderApprovalStatus | 'NONE';
  newStatus: RiderApprovalStatus;
  reason: string;
  actorId: string;
  actorRole: UserRole | 'SYSTEM';
  actorEmail: string;
  timestamp: string;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  category: string;
  price: number;
  isVeg: boolean;
  isAvailable: boolean;
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  address: string;
  prepTimeMins: number;
  rating: number;
  imageUrl: string;
  isOpen: boolean;
  supportsDelivery: boolean;
  supportsSelfPickup: boolean;
  menu: MenuItem[];
}

export interface OrderItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  isVeg: boolean;
}

export interface OrderMilestone {
  status: string;
  label: string;
  timestamp: string;
  actor: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  serviceType: 'FOOD_DELIVERY' | 'SELF_PICKUP';
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  platformFee: number;
  totalAmount: number;
  riderFee: number;
  deliveryAddress?: string;
  pickupInstructions?: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  assignedRiderId?: string | null;
  assignedRiderName?: string | null;
  assignedRiderPhone?: string | null;
  assignedRiderPlate?: string | null;
  riderJobStatus: RiderJobStatus;
  milestones: OrderMilestone[];
  createdAt: string;
  updatedAt: string;
}

export interface PricingSettings {
  baseDeliveryFee: number;
  freeDeliveryThreshold: number;
  platformFee: number;
  selfPickupFee: number;
  riderCommissionPercent: number;
  updatedAt: string;
}

export interface RiderEarningEntry {
  id: string;
  orderId: string;
  orderNumber: string;
  riderId: string;
  restaurantName: string;
  amount: number;
  payoutStatus: 'UNPAID_PENDING_MANUAL_REVIEW' | 'SETTLED_MANUALLY';
  manualPayoutId?: string | null;
  completedAt: string;
}

export interface ManualPayoutRecord {
  id: string;
  riderId: string;
  riderName: string;
  amount: number;
  referenceNumber: string;
  methodNote: string;
  recordedBy: string;
  recordedAt: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorRole: UserRole | 'SYSTEM';
  actorEmail: string;
  action: string;
  target: string;
  details: string;
}

export interface PublicCatalog {
  services: ServiceDefinition[];
  restaurants: Restaurant[];
  pricing: PricingSettings;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface OwnerOverviewResponse {
  metrics: {
    totalOrders: number;
    activeOrders: number;
    completedOrders: number;
    grossOrderVolume: number;
    totalCustomers: number;
    totalRiders: number;
    pendingRiderApprovals: number;
    onlineApprovedRiders: number;
    openRestaurants: number;
    pendingManualPayoutTotal: number;
  };
  orders: Order[];
  customers: (UserProfile & { orderCount: number })[];
  riders: (UserProfile & {
    totalEarned: number;
    totalPaidManually: number;
    pendingBalance: number;
    completedDeliveries: number;
  })[];
  restaurants: Restaurant[];
  pricing: PricingSettings;
  payouts: ManualPayoutRecord[];
  riderApprovalHistory: RiderApprovalHistoryEntry[];
  auditLogs: AuditLogEntry[];
}

export interface RiderEarningsResponse {
  summary: {
    totalEarned: number;
    totalPaidManually: number;
    pendingManualPayout: number;
    completedDeliveries: number;
  };
  ledger: RiderEarningEntry[];
  payoutRecords: ManualPayoutRecord[];
}
