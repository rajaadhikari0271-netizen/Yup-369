import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import type {
  AuditLogEntry,
  ManualPayoutRecord,
  MenuItem,
  Order,
  OrderItem,
  OrderStatus,
  PricingSettings,
  Restaurant,
  RiderApprovalHistoryEntry,
  RiderApprovalStatus,
  RiderApprovalTarget,
  RiderBankDetails,
  RiderDocuments,
  RiderEarningEntry,
  RiderServiceApprovals,
  RiderServiceKey,
  ServiceDefinition,
  UserProfile,
  UserRole,
} from './src/types/domain.ts';

interface StoredUser extends UserProfile {
  passwordHash: string;
  passwordSalt: string;
}

interface OwnerCredential {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  claimedAt: string;
}

interface AppStore {
  users: StoredUser[];
  ownerCredential: OwnerCredential | null;
  restaurants: Restaurant[];
  orders: Order[];
  pricing: PricingSettings;
  riderEarnings: RiderEarningEntry[];
  manualPayouts: ManualPayoutRecord[];
  riderApprovalHistory: RiderApprovalHistoryEntry[];
  auditLogs: AuditLogEntry[];
  orderCounter: number;
}

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');

// Session signing key from env or ephemeral in-memory 256-bit secret
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const SERVICES: ServiceDefinition[] = [
  {
    id: 'FOOD_DELIVERY',
    name: 'Food Delivery',
    tagline: 'Hot meals delivered from local kitchens',
    enabled: true,
    statusNote: 'Active',
  },
  {
    id: 'SELF_PICKUP',
    name: 'Self-Pickup',
    tagline: 'Skip delivery fees and collect at counter',
    enabled: true,
    statusNote: 'Active',
  },
  {
    id: 'GROCERY',
    name: 'Grocery',
    tagline: 'Daily essentials & fresh produce',
    enabled: false,
    statusNote: 'Disabled until implemented and approved',
  },
  {
    id: 'PARCEL',
    name: 'Parcel',
    tagline: 'Intra-city point-to-point packages',
    enabled: false,
    statusNote: 'Disabled until implemented and approved',
  },
  {
    id: 'BIKE_TAXI',
    name: 'Bike Taxi',
    tagline: 'Quick two-wheeler commuter rides',
    enabled: false,
    statusNote: 'Disabled until implemented and approved',
  },
];

function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return { hash: derived, salt: actualSalt };
}

function verifyPassword(password: string, storedHash: string, storedSalt: string): boolean {
  const { hash } = hashPassword(password, storedSalt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function timingSafeStringMatch(input: string, expected: string): boolean {
  const a = Buffer.from(input, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface TokenPayload {
  userId: string;
  role: UserRole;
  email: string;
  exp: number;
}

function signToken(payload: Omit<TokenPayload, 'exp'>): string {
  const fullPayload: TokenPayload = {
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12h session
  };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (!timingSafeStringMatch(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.userId || !parsed.role || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function createSeedStore(): AppStore {
  const now = new Date().toISOString();
  const custPwd = hashPassword('Customer@369');

  const restaurants: Restaurant[] = [
    {
      id: 'rest-1',
      name: 'Nizam Handi Biryani',
      cuisine: 'Hyderabadi · Mughlai',
      address: '14 Residency Road, Indiranagar',
      prepTimeMins: 25,
      rating: 4.7,
      imageUrl: '/src/assets/images/rest_biryani_house_1795240192372.jpg',
      isOpen: true,
      supportsDelivery: true,
      supportsSelfPickup: true,
      menu: [
        {
          id: 'item-101',
          restaurantId: 'rest-1',
          name: 'Hyderabadi Chicken Dum Biryani',
          description: 'Slow-cooked saffron basmati rice layered with marinated chicken, caramelized onions, and mirchi ka salan.',
          category: 'Biryani',
          price: 289,
          isVeg: false,
          isAvailable: true,
        },
        {
          id: 'item-102',
          restaurantId: 'rest-1',
          name: 'Subz Zafrani Dum Biryani',
          description: 'Aromatic basmati rice baked with seasonal vegetables, paneer cubes, and mint raita.',
          category: 'Biryani',
          price: 239,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-103',
          restaurantId: 'rest-1',
          name: 'Tandoori Chicken Tikka (6 pcs)',
          description: 'Charcoal-grilled boneless chicken marinated in hung curd and roasted spices.',
          category: 'Starters',
          price: 259,
          isVeg: false,
          isAvailable: true,
        },
        {
          id: 'item-104',
          restaurantId: 'rest-1',
          name: 'Paneer Peshawari Tikka',
          description: 'Smoky cottage cheese skewers glazed with crushed coriander and yellow chilli.',
          category: 'Starters',
          price: 229,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-105',
          restaurantId: 'rest-1',
          name: 'Double Ka Meetha',
          description: 'Warm saffron-soaked bread pudding garnished with roasted pistachios.',
          category: 'Desserts',
          price: 119,
          isVeg: true,
          isAvailable: true,
        },
      ],
    },
    {
      id: 'rest-2',
      name: '369 Burger Garage',
      cuisine: 'Smash Burgers · Fries',
      address: '82 100 Feet Road, Koramangala',
      prepTimeMins: 18,
      rating: 4.6,
      imageUrl: '/src/assets/images/rest_burger_garage_1795240191244.jpg',
      isOpen: true,
      supportsDelivery: true,
      supportsSelfPickup: true,
      menu: [
        {
          id: 'item-201',
          restaurantId: 'rest-2',
          name: 'Double Cheddar Smash Burger',
          description: 'Two seared patties, aged cheddar, house pickles, and smoky garage sauce on toasted brioche.',
          category: 'Burgers',
          price: 249,
          isVeg: false,
          isAvailable: true,
        },
        {
          id: 'item-202',
          restaurantId: 'rest-2',
          name: 'Crispy Herb Paneer Burger',
          description: 'Spiced crunchy paneer fillet with jalapeño slaw and garlic mayo.',
          category: 'Burgers',
          price: 199,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-203',
          restaurantId: 'rest-2',
          name: 'Peri-Peri Crinkle Fries',
          description: 'Golden crispy fries dusted with house peri-peri spice and cheddar dip.',
          category: 'Sides',
          price: 119,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-204',
          restaurantId: 'rest-2',
          name: 'Hot Wings Basket (6 pcs)',
          description: 'Crispy chicken wings tossed in tangy cayenne honey glaze.',
          category: 'Sides',
          price: 219,
          isVeg: false,
          isAvailable: true,
        },
      ],
    },
    {
      id: 'rest-3',
      name: 'Udupi Express Kitchen',
      cuisine: 'South Indian · Tiffin',
      address: '5 Church Street, MG Road',
      prepTimeMins: 15,
      rating: 4.8,
      imageUrl: '/src/assets/images/rest_south_express_1795240190513.jpg',
      isOpen: true,
      supportsDelivery: true,
      supportsSelfPickup: true,
      menu: [
        {
          id: 'item-301',
          restaurantId: 'rest-3',
          name: 'Ghee Roast Masala Dosa',
          description: 'Crisp fermented crepe roasted in pure ghee, stuffed with tempered potato masala, served with 3 chutneys & sambar.',
          category: 'Dosa',
          price: 135,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-302',
          restaurantId: 'rest-3',
          name: 'Podi Button Idli (10 pcs)',
          description: 'Steamed mini rice cakes tossed in roasted gun-powder podi and warm ghee.',
          category: 'Tiffin',
          price: 115,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-303',
          restaurantId: 'rest-3',
          name: 'Rava Onion Dosa',
          description: 'Lacy semolina crisp dosa studded with green chillies, curry leaves, and shallots.',
          category: 'Dosa',
          price: 145,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-304',
          restaurantId: 'rest-3',
          name: 'Madras Filter Kaapi',
          description: 'Traditional frothy decoction coffee brewed with chicory and farm milk.',
          category: 'Beverages',
          price: 55,
          isVeg: true,
          isAvailable: true,
        },
      ],
    },
    {
      id: 'rest-4',
      name: 'Wok & Flame Street',
      cuisine: 'Indo-Chinese · Bowls',
      address: '29 Lavelle Road, Shanthala Nagar',
      prepTimeMins: 22,
      rating: 4.5,
      imageUrl: '/src/assets/images/rest_wok_street_1795240192235.jpg',
      isOpen: true,
      supportsDelivery: true,
      supportsSelfPickup: true,
      menu: [
        {
          id: 'item-401',
          restaurantId: 'rest-4',
          name: 'Burnt Garlic Veg Hakka Noodles',
          description: 'High-flame wok noodles tossed with crisp bell peppers, scallions, and toasted garlic.',
          category: 'Noodles & Rice',
          price: 189,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-402',
          restaurantId: 'rest-4',
          name: 'Crispy Chilli Paneer Bowl',
          description: 'Wok-tossed cottage cheese cubes in smoky soy-chilli glaze over steamed fried rice.',
          category: 'Bowls',
          price: 229,
          isVeg: true,
          isAvailable: true,
        },
        {
          id: 'item-403',
          restaurantId: 'rest-4',
          name: 'Schezwan Chicken Fried Rice',
          description: 'Fiery house-made Schezwan peppercorn fried rice with diced chicken and spring onion.',
          category: 'Noodles & Rice',
          price: 239,
          isVeg: false,
          isAvailable: true,
        },
        {
          id: 'item-404',
          restaurantId: 'rest-4',
          name: 'Steamed Veg Momos (8 pcs)',
          description: 'Delicate dumplings filled with ginger-cabbage mince and fiery red chilli dip.',
          category: 'Dimsum',
          price: 149,
          isVeg: true,
          isAvailable: true,
        },
      ],
    },
  ];

  const users: StoredUser[] = [
    {
      id: 'cust-1',
      role: 'CUSTOMER',
      name: 'Arjun Mehta',
      email: 'arjun@customer.demo',
      phone: '+91 90000 11223',
      status: 'ACTIVE',
      savedAddress: 'Flat 402, Amber Heights, Indiranagar 2nd Stage',
      passwordHash: custPwd.hash,
      passwordSalt: custPwd.salt,
      createdAt: now,
    },
  ];

  const sampleOrder2: Order = {
    id: 'ord-1002',
    orderNumber: 'YUP-1002',
    customerId: 'cust-1',
    customerName: 'Arjun Mehta',
    customerPhone: '+91 90000 11223',
    restaurantId: 'rest-3',
    restaurantName: 'Udupi Express Kitchen',
    restaurantAddress: '5 Church Street, MG Road',
    serviceType: 'SELF_PICKUP',
    items: [
      {
        menuItemId: 'item-301',
        name: 'Ghee Roast Masala Dosa',
        price: 135,
        quantity: 2,
        isVeg: true,
      },
    ],
    subtotal: 270,
    deliveryFee: 0,
    platformFee: 6,
    totalAmount: 276,
    riderFee: 0,
    pickupInstructions: 'Collect at Counter #2 using Order YUP-1002',
    paymentMethod: 'PAY_AT_COUNTER',
    paymentStatus: 'PENDING_COLLECTION',
    status: 'PREPARING',
    assignedRiderId: null,
    assignedRiderName: null,
    assignedRiderPhone: null,
    assignedRiderPlate: null,
    riderJobStatus: 'UNASSIGNED',
    milestones: [
      { status: 'PLACED', label: 'Self-pickup order placed (Pay at Counter)', timestamp: now, actor: 'Customer' },
      { status: 'CONFIRMED', label: 'Accepted by kitchen', timestamp: now, actor: 'Owner' },
      { status: 'PREPARING', label: 'Kitchen preparing order', timestamp: now, actor: 'Owner' },
    ],
    createdAt: now,
    updatedAt: now,
  };

  return {
    users,
    ownerCredential: null,
    restaurants,
    orders: [sampleOrder2],
    pricing: {
      baseDeliveryFee: 29,
      freeDeliveryThreshold: 399,
      platformFee: 6,
      selfPickupFee: 0,
      riderCommissionPercent: 80,
      updatedAt: now,
    },
    riderEarnings: [],
    manualPayouts: [],
    riderApprovalHistory: [],
    auditLogs: [
      {
        id: 'audit-1',
        timestamp: now,
        actorId: 'system',
        actorRole: 'SYSTEM',
        actorEmail: 'system@yup369.local',
        action: 'MVP_SEED_INITIALIZED',
        target: 'Platform Store',
        details: 'Initialized Yup! 369 MVP with Food Delivery & Self-Pickup active; Grocery, Parcel, and Bike Taxi disabled.',
      },
    ],
    orderCounter: 1002,
  };
}

function buildDefaultServiceApprovals(foodStatus: RiderApprovalStatus = 'PENDING'): RiderServiceApprovals {
  const now = new Date().toISOString();
  return {
    FOOD_DELIVERY: {
      requested: true,
      status: foodStatus,
      notes: foodStatus === 'APPROVED' ? 'Approved for Food Delivery by Owner' : 'Awaiting separate Owner service approval',
      updatedAt: now,
    },
    GROCERY: {
      requested: false,
      status: 'DISABLED',
      notes: 'Disabled until Grocery delivery is implemented and approved',
    },
    PARCEL: {
      requested: false,
      status: 'DISABLED',
      notes: 'Disabled until Parcel delivery is implemented and approved',
    },
    BIKE_TAXI: {
      requested: false,
      status: 'DISABLED',
      notes: 'Disabled until Bike Taxi is implemented and approved',
    },
  };
}

function syncUnifiedRiderApproval(rider: StoredUser) {
  if (rider.role !== 'RIDER') return;
  if (!rider.documentStatus) {
    rider.documentStatus = rider.approvalStatus || 'PENDING';
  }
  if (!rider.serviceApprovals) {
    rider.serviceApprovals = buildDefaultServiceApprovals(rider.approvalStatus || 'PENDING');
  }
  const foodStatus = rider.serviceApprovals.FOOD_DELIVERY.status;
  if (rider.documentStatus === 'APPROVED' && foodStatus === 'APPROVED') {
    rider.approvalStatus = 'APPROVED';
  } else if (rider.documentStatus === 'REJECTED' || foodStatus === 'REJECTED') {
    rider.approvalStatus = 'REJECTED';
    rider.isOnline = false;
  } else {
    rider.approvalStatus = 'PENDING';
    rider.isOnline = false;
  }
}

function normalizeStore(rawStore: AppStore): AppStore {
  if (!Array.isArray(rawStore.riderApprovalHistory)) {
    rawStore.riderApprovalHistory = [];
  }
  const legacyDemoRiderIds = new Set(['rider-1', 'rider-2']);
  const legacyDemoRiderEmails = new Set(['vikram@rider.demo', 'sneha@rider.demo']);
  rawStore.users = rawStore.users.filter(
    (u) => !(u.role === 'RIDER' && (legacyDemoRiderIds.has(u.id) || legacyDemoRiderEmails.has(u.email)))
  );
  rawStore.riderApprovalHistory = rawStore.riderApprovalHistory.filter(
    (h) => !legacyDemoRiderIds.has(h.riderId) && !legacyDemoRiderEmails.has(h.riderEmail) && !h.id.startsWith('rah-seed-')
  );
  rawStore.riderEarnings = (rawStore.riderEarnings || []).filter(
    (e) => !legacyDemoRiderIds.has(e.riderId) && e.id !== 'earn-1001'
  );
  rawStore.orders = (rawStore.orders || []).filter(
    (o) => !(o.id === 'ord-1001' && o.assignedRiderId && legacyDemoRiderIds.has(o.assignedRiderId))
  );
  for (const user of rawStore.users) {
    if (user.role === 'RIDER') {
      if (!user.cityArea) user.cityArea = 'Bengaluru';
      if (!user.documentNotes) {
        user.documentNotes = user.approvalNotes || 'Awaiting Owner document verification';
      }
      if (user.documents && !user.documents.dummyBankDetails) {
        user.documents.dummyBankDetails = {
          accountHolderName: `${user.name} (Test)`,
          dummyAccountNumber: `TEST-ACCT-${user.id.toUpperCase()}`,
          dummyIfscCode: 'MOCK0003690',
          dummyPayoutRef: user.documents.dummyPayoutRef || 'DUMMY-PAY-000',
        };
      }
      syncUnifiedRiderApproval(user);
    }
  }
  return rawStore;
}

function loadStore(): AppStore {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    const seed = normalizeStore(createSeedStore());
    fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return normalizeStore(JSON.parse(raw) as AppStore);
  } catch {
    const seed = normalizeStore(createSeedStore());
    fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
}

let store: AppStore = loadStore();

function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
}

function sanitizeUser(u: StoredUser): UserProfile {
  const { passwordHash: _ph, passwordSalt: _ps, ...rest } = u;
  return rest;
}

function appendAudit(
  actorId: string,
  actorRole: UserRole | 'SYSTEM',
  actorEmail: string,
  action: string,
  target: string,
  details: string
) {
  store.auditLogs.unshift({
    id: `audit-${crypto.randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    actorId,
    actorRole,
    actorEmail,
    action,
    target,
    details,
  });
  if (store.auditLogs.length > 500) {
    store.auditLogs = store.auditLogs.slice(0, 500);
  }
}

function appendRiderApprovalHistory(entry: Omit<RiderApprovalHistoryEntry, 'id' | 'timestamp'>) {
  store.riderApprovalHistory.unshift({
    id: `rah-${crypto.randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (store.riderApprovalHistory.length > 500) {
    store.riderApprovalHistory = store.riderApprovalHistory.slice(0, 500);
  }
}

function getEnvOwnerConfig(): { email: string; passcode: string } | null {
  const passcode = process.env.OWNER_ADMIN_PASSCODE?.trim();
  if (!passcode) return null;
  const email = (process.env.OWNER_ADMIN_EMAIL?.trim() || 'owner@yup369.local').toLowerCase();
  return { email, passcode };
}

function isOwnerConfigured(): boolean {
  return Boolean(getEnvOwnerConfig() || store.ownerCredential);
}

function validateDummyDocumentRef(value: string, fieldLabel: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 4 || trimmed.length > 40) {
    return `${fieldLabel} must be 4–40 characters.`;
  }
  const digitsOnly = trimmed.replace(/[\s-]/g, '');
  // Block real 12-digit Aadhaar or 9-18 digit numeric bank account numbers
  if (/^\d{9,18}$/.test(digitsOnly)) {
    return `${fieldLabel} looks like a real Aadhaar or bank account number. Use a synthetic dummy reference (e.g., MOCK-ID-1042 or TEST-ACCT-001).`;
  }
  return null;
}

function validateDummyBankDetails(raw: unknown): { data?: RiderBankDetails; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'Dummy bank details structure is required.' };
  }
  const obj = raw as Record<string, unknown>;
  const holder = typeof obj.accountHolderName === 'string' ? obj.accountHolderName.trim() : '';
  const acct = typeof obj.dummyAccountNumber === 'string' ? obj.dummyAccountNumber.trim() : '';
  const ifsc = typeof obj.dummyIfscCode === 'string' ? obj.dummyIfscCode.trim().toUpperCase() : '';
  const payoutRef = typeof obj.dummyPayoutRef === 'string' ? obj.dummyPayoutRef.trim() : '';

  if (holder.length < 2) {
    return { error: 'Dummy account holder name is required.' };
  }
  const acctErr = validateDummyDocumentRef(acct, 'Dummy Bank Account Number');
  if (acctErr) return { error: acctErr };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) && !/^(MOCK|TEST|DEMO)[A-Z0-9-]{3,16}$/.test(ifsc)) {
    return { error: 'Dummy IFSC / Routing code must be a synthetic test code (e.g. MOCK0003690).' };
  }
  const payErr = validateDummyDocumentRef(payoutRef, 'Dummy Payout Reference');
  if (payErr) return { error: payErr };

  return {
    data: {
      accountHolderName: holder,
      dummyAccountNumber: acct.toUpperCase(),
      dummyIfscCode: ifsc,
      dummyPayoutRef: payoutRef,
    },
  };
}

interface AuthenticatedRequest extends Request {
  auth?: TokenPayload;
}

function requireAuth(allowedRoles?: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    if (payload.role === 'OWNER') {
      if (!isOwnerConfigured()) {
        res.status(401).json({ error: 'Owner portal is not configured' });
        return;
      }
      if (allowedRoles && !allowedRoles.includes('OWNER')) {
        res.status(403).json({ error: 'Access denied for role' });
        return;
      }
      req.auth = payload;
      next();
      return;
    }

    const user = store.users.find((u) => u.id === payload.userId);
    if (!user) {
      res.status(401).json({ error: 'Account not found' });
      return;
    }
    if (user.status === 'SUSPENDED') {
      res.status(403).json({ error: 'Account is suspended. Contact Owner support.' });
      return;
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      res.status(403).json({ error: 'Access denied for this role' });
      return;
    }
    req.auth = payload;
    next();
  };
}

function computeRiderFinancials(riderId: string) {
  const earnings = store.riderEarnings.filter((e) => e.riderId === riderId);
  const payouts = store.manualPayouts.filter((p) => p.riderId === riderId);
  const totalEarned = earnings.reduce((acc, e) => acc + e.amount, 0);
  const totalPaidManually = payouts.reduce((acc, p) => acc + p.amount, 0);
  const pendingManualPayout = Math.max(0, totalEarned - totalPaidManually);
  return {
    totalEarned,
    totalPaidManually,
    pendingManualPayout,
    completedDeliveries: earnings.length,
    earnings,
    payouts,
  };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Public Catalog: active/disabled services, restaurants, menus, pricing
  app.get('/api/public/catalog', (_req, res) => {
    res.json({
      services: SERVICES,
      restaurants: store.restaurants,
      pricing: store.pricing,
    });
  });

  // Public Auth: Register Customer or Rider ONLY (blocks Owner registration)
  app.post('/api/auth/register', (req, res) => {
    const { role, name, email, phone, password, savedAddress, cityArea, riderOnboarding } = req.body ?? {};
    if (role === 'OWNER') {
      res.status(403).json({ error: 'Public Owner registration is strictly disabled.' });
      return;
    }
    if (role !== 'CUSTOMER' && role !== 'RIDER') {
      res.status(400).json({ error: 'Role must be CUSTOMER or RIDER.' });
      return;
    }
    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof phone !== 'string' ||
      typeof password !== 'string'
    ) {
      res.status(400).json({ error: 'Name, email, phone, and password are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    if (!cleanName || cleanName.length < 2) {
      res.status(400).json({ error: 'Please enter a valid full name.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (cleanPhone.length < 8) {
      res.status(400).json({ error: 'Please enter a valid phone number.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    if (store.users.some((u) => u.email === cleanEmail)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    let riderDocs: RiderDocuments | null = null;
    let serviceApprovals: RiderServiceApprovals | undefined = undefined;
    let cleanCityArea: string | undefined = undefined;

    if (role === 'RIDER') {
      cleanCityArea = typeof cityArea === 'string' && cityArea.trim().length >= 2 ? cityArea.trim() : '';
      if (!cleanCityArea) {
        res.status(400).json({ error: 'Operating city / area is required for Rider registration.' });
        return;
      }
      if (!riderOnboarding || typeof riderOnboarding !== 'object') {
        res.status(400).json({ error: 'Vehicle, service selection, and dummy bank details are required for Rider registration.' });
        return;
      }

      const {
        dummyGovIdRef,
        dummyLicenseRef,
        dummyVehiclePlate,
        dummyVehicleType,
        requestedServices,
        dummyBankDetails,
      } = riderOnboarding as Record<string, unknown>;

      if (
        typeof dummyGovIdRef !== 'string' ||
        typeof dummyLicenseRef !== 'string' ||
        typeof dummyVehiclePlate !== 'string'
      ) {
        res.status(400).json({ error: 'Dummy Gov ID, Driving Licence, and Vehicle Registration Number are required.' });
        return;
      }

      for (const [val, label] of [
        [dummyGovIdRef, 'Dummy Gov ID Reference'],
        [dummyLicenseRef, 'Dummy Driving Licence Number'],
        [dummyVehiclePlate, 'Vehicle Registration Number'],
      ] as const) {
        const err = validateDummyDocumentRef(val, label);
        if (err) {
          res.status(400).json({ error: err });
          return;
        }
      }

      if (!Array.isArray(requestedServices) || requestedServices.length === 0) {
        res.status(400).json({ error: 'Select at least one active service (Food Delivery).' });
        return;
      }
      const disabledAttempt = requestedServices.find((s) => s !== 'FOOD_DELIVERY');
      if (disabledAttempt) {
        res.status(400).json({ error: `Service ${String(disabledAttempt)} is disabled until implemented and approved.` });
        return;
      }

      const bankCheck = validateDummyBankDetails(dummyBankDetails);
      if (bankCheck.error || !bankCheck.data) {
        res.status(400).json({ error: bankCheck.error || 'Invalid dummy bank details.' });
        return;
      }

      const allowedVehicles = ['Scooter', 'Motorcycle', 'E-Bike', 'Bicycle'];
      const vehicleType =
        typeof dummyVehicleType === 'string' && allowedVehicles.includes(dummyVehicleType)
          ? (dummyVehicleType as RiderDocuments['dummyVehicleType'])
          : 'Scooter';

      riderDocs = {
        dummyGovIdRef: dummyGovIdRef.trim(),
        dummyLicenseRef: dummyLicenseRef.trim(),
        dummyVehiclePlate: dummyVehiclePlate.trim().toUpperCase(),
        dummyVehicleType: vehicleType,
        dummyPayoutRef: bankCheck.data.dummyPayoutRef,
        dummyBankDetails: bankCheck.data,
        submittedAt: now,
      };
      serviceApprovals = buildDefaultServiceApprovals('PENDING');
    }

    const { hash, salt } = hashPassword(password);
    const newUser: StoredUser = {
      id: `${role.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
      role,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      cityArea: cleanCityArea,
      status: 'ACTIVE',
      savedAddress: typeof savedAddress === 'string' ? savedAddress.trim() : '',
      approvalStatus: role === 'RIDER' ? 'PENDING' : undefined,
      documentStatus: role === 'RIDER' ? 'PENDING' : undefined,
      serviceApprovals,
      approvalNotes:
        role === 'RIDER'
          ? 'Documents & Food Delivery service awaiting separate Owner approval'
          : undefined,
      documentNotes:
        role === 'RIDER'
          ? 'Submitted during registration; awaiting Owner document review'
          : undefined,
      isOnline: role === 'RIDER' ? false : undefined,
      documents: riderDocs,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: now,
    };

    store.users.push(newUser);
    if (role === 'RIDER') {
      appendRiderApprovalHistory({
        riderId: newUser.id,
        riderName: newUser.name,
        riderEmail: newUser.email,
        target: 'REGISTRATION',
        serviceKey: 'FOOD_DELIVERY',
        previousStatus: 'NONE',
        newStatus: 'PENDING',
        reason: `Unified Rider registered (${riderDocs?.dummyVehicleType} · ${riderDocs?.dummyVehiclePlate}); Docs=PENDING, Food Delivery=PENDING`,
        actorId: newUser.id,
        actorRole: 'RIDER',
        actorEmail: newUser.email,
      });
    }
    appendAudit(
      newUser.id,
      role,
      cleanEmail,
      `${role}_REGISTERED`,
      newUser.name,
      role === 'RIDER'
        ? `Unified Rider registered (${riderDocs?.dummyVehicleType} · ${riderDocs?.dummyVehiclePlate}); documentStatus=PENDING, FOOD_DELIVERY=PENDING`
        : 'Customer account created'
    );
    saveStore();

    const token = signToken({ userId: newUser.id, role: newUser.role, email: newUser.email });
    res.status(201).json({ token, user: sanitizeUser(newUser) });
  });

  // Customer & Rider Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = store.users.find((u) => u.email === cleanEmail);
    if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    if (user.status === 'SUSPENDED') {
      res.status(403).json({ error: 'This account has been suspended by the Owner.' });
      return;
    }
    const token = signToken({ userId: user.id, role: user.role, email: user.email });
    res.json({ token, user: sanitizeUser(user) });
  });

  // Current Session Check
  app.get('/api/auth/me', requireAuth(), (req: AuthenticatedRequest, res) => {
    const auth = req.auth!;
    if (auth.role === 'OWNER') {
      const envOwner = getEnvOwnerConfig();
      const email = envOwner ? envOwner.email : store.ownerCredential?.email || auth.email;
      const name = store.ownerCredential?.name || 'Platform Owner';
      res.json({
        user: {
          id: auth.userId,
          role: 'OWNER',
          name,
          email,
          phone: 'Private Admin',
          status: 'ACTIVE',
          createdAt: store.ownerCredential?.claimedAt || new Date().toISOString(),
        } satisfies UserProfile,
      });
      return;
    }
    const user = store.users.find((u) => u.id === auth.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user: sanitizeUser(user) });
  });

  // Private Owner Status (reveals only whether Owner login is ready or needs first-run claim)
  app.get('/api/auth/owner-status', (_req, res) => {
    const envOwner = getEnvOwnerConfig();
    if (envOwner) {
      res.json({ configured: true, mode: 'env_configured' });
      return;
    }
    if (store.ownerCredential) {
      res.json({ configured: true, mode: 'claimed' });
      return;
    }
    res.json({ configured: false, mode: 'claim_required' });
  });

  // One-time Owner Bootstrap (ONLY active when OWNER_ADMIN_PASSCODE env is unset AND no owner claimed yet)
  app.post('/api/auth/owner-bootstrap', (req, res) => {
    if (isOwnerConfigured()) {
      res.status(403).json({ error: 'Owner credentials are already configured.' });
      return;
    }
    const { name, email, passcode } = req.body ?? {};
    if (typeof name !== 'string' || typeof email !== 'string' || typeof passcode !== 'string') {
      res.status(400).json({ error: 'Name, email, and private passcode are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    if (!cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Enter a valid Owner name and email.' });
      return;
    }
    if (passcode.trim().length < 8) {
      res.status(400).json({ error: 'Owner passcode must be at least 8 characters.' });
      return;
    }

    const { hash, salt } = hashPassword(passcode.trim());
    const now = new Date().toISOString();
    store.ownerCredential = {
      id: 'owner-1',
      name: cleanName,
      email: cleanEmail,
      passwordHash: hash,
      passwordSalt: salt,
      claimedAt: now,
    };
    appendAudit('owner-1', 'OWNER', cleanEmail, 'OWNER_CREDENTIALS_CLAIMED', cleanEmail, 'First-run private Owner account claimed and locked');
    saveStore();

    const token = signToken({ userId: 'owner-1', role: 'OWNER', email: cleanEmail });
    res.status(201).json({
      token,
      user: {
        id: 'owner-1',
        role: 'OWNER',
        name: cleanName,
        email: cleanEmail,
        phone: 'Private Admin',
        status: 'ACTIVE',
        createdAt: now,
      } satisfies UserProfile,
    });
  });

  // Private Owner Login
  app.post('/api/auth/owner-login', (req, res) => {
    if (!isOwnerConfigured()) {
      res.status(409).json({ error: 'Owner account not claimed yet. Complete first-run setup.' });
      return;
    }
    const { email, passcode } = req.body ?? {};
    if (typeof email !== 'string' || typeof passcode !== 'string') {
      res.status(400).json({ error: 'Owner email and passcode are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanPass = passcode.trim();

    const envOwner = getEnvOwnerConfig();
    if (envOwner) {
      const emailOk = timingSafeStringMatch(cleanEmail, envOwner.email);
      const passOk = timingSafeStringMatch(cleanPass, envOwner.passcode);
      if (!emailOk || !passOk) {
        res.status(401).json({ error: 'Invalid private Owner credentials.' });
        return;
      }
      const token = signToken({ userId: 'owner-env', role: 'OWNER', email: envOwner.email });
      appendAudit('owner-env', 'OWNER', envOwner.email, 'OWNER_LOGIN', envOwner.email, 'Owner signed in via environment secret');
      saveStore();
      res.json({
        token,
        user: {
          id: 'owner-env',
          role: 'OWNER',
          name: 'Platform Owner',
          email: envOwner.email,
          phone: 'Private Admin',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
        } satisfies UserProfile,
      });
      return;
    }

    const claimed = store.ownerCredential!;
    if (
      !timingSafeStringMatch(cleanEmail, claimed.email) ||
      !verifyPassword(cleanPass, claimed.passwordHash, claimed.passwordSalt)
    ) {
      res.status(401).json({ error: 'Invalid private Owner credentials.' });
      return;
    }
    const token = signToken({ userId: claimed.id, role: 'OWNER', email: claimed.email });
    appendAudit(claimed.id, 'OWNER', claimed.email, 'OWNER_LOGIN', claimed.email, 'Owner signed in');
    saveStore();
    res.json({
      token,
      user: {
        id: claimed.id,
        role: 'OWNER',
        name: claimed.name,
        email: claimed.email,
        phone: 'Private Admin',
        status: 'ACTIVE',
        createdAt: claimed.claimedAt,
      } satisfies UserProfile,
    });
  });

  // ---------------- CUSTOMER ROUTES ----------------
  app.patch('/api/customer/profile', requireAuth(['CUSTOMER']), (req: AuthenticatedRequest, res) => {
    const user = store.users.find((u) => u.id === req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    const { name, phone, savedAddress } = req.body ?? {};
    if (typeof name === 'string' && name.trim().length >= 2) user.name = name.trim();
    if (typeof phone === 'string' && phone.trim().length >= 8) user.phone = phone.trim();
    if (typeof savedAddress === 'string') user.savedAddress = savedAddress.trim();
    saveStore();
    res.json({ user: sanitizeUser(user) });
  });

  app.get('/api/customer/orders', requireAuth(['CUSTOMER']), (req: AuthenticatedRequest, res) => {
    const orders = store.orders
      .filter((o) => o.customerId === req.auth!.userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ orders });
  });

  app.post('/api/orders', requireAuth(['CUSTOMER']), (req: AuthenticatedRequest, res) => {
    const customer = store.users.find((u) => u.id === req.auth!.userId);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    const { restaurantId, serviceType, items, deliveryAddress, pickupInstructions, paymentMethod } = req.body ?? {};

    if (serviceType !== 'FOOD_DELIVERY' && serviceType !== 'SELF_PICKUP') {
      res.status(400).json({
        error: 'Only Food Delivery and Restaurant Self-Pickup are active in MVP. Grocery, Parcel, and Bike Taxi are disabled.',
      });
      return;
    }

    const restaurant = store.restaurants.find((r) => r.id === restaurantId);
    if (!restaurant) {
      res.status(404).json({ error: 'Restaurant not found.' });
      return;
    }
    if (!restaurant.isOpen) {
      res.status(400).json({ error: `${restaurant.name} is currently closed.` });
      return;
    }
    if (serviceType === 'FOOD_DELIVERY' && !restaurant.supportsDelivery) {
      res.status(400).json({ error: `${restaurant.name} does not support delivery right now.` });
      return;
    }
    if (serviceType === 'SELF_PICKUP' && !restaurant.supportsSelfPickup) {
      res.status(400).json({ error: `${restaurant.name} does not support self-pickup right now.` });
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Your cart is empty.' });
      return;
    }

    const orderItems: OrderItem[] = [];
    for (const rawItem of items) {
      const qty = Number(rawItem?.quantity);
      if (!rawItem?.menuItemId || !Number.isInteger(qty) || qty < 1 || qty > 25) {
        res.status(400).json({ error: 'Invalid cart item quantity.' });
        return;
      }
      const menuItem = restaurant.menu.find((m) => m.id === rawItem.menuItemId);
      if (!menuItem || !menuItem.isAvailable) {
        res.status(400).json({ error: `Item ${rawItem?.menuItemId} is unavailable.` });
        return;
      }
      orderItems.push({
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: qty,
        isVeg: menuItem.isVeg,
      });
    }

    if (serviceType === 'FOOD_DELIVERY') {
      if (typeof deliveryAddress !== 'string' || deliveryAddress.trim().length < 6) {
        res.status(400).json({ error: 'Please enter a complete delivery address.' });
        return;
      }
      if (paymentMethod !== 'CASH_ON_DELIVERY') {
        res.status(400).json({ error: 'Food Delivery orders in MVP use Cash on Delivery only.' });
        return;
      }
    } else {
      if (paymentMethod !== 'PAY_AT_COUNTER') {
        res.status(400).json({ error: 'Self-Pickup orders in MVP use Pay at Counter only.' });
        return;
      }
    }

    const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const pricing = store.pricing;
    const deliveryFee =
      serviceType === 'SELF_PICKUP'
        ? pricing.selfPickupFee
        : subtotal >= pricing.freeDeliveryThreshold
          ? 0
          : pricing.baseDeliveryFee;
    const platformFee = pricing.platformFee;
    const totalAmount = subtotal + deliveryFee + platformFee;
    const riderFee =
      serviceType === 'FOOD_DELIVERY'
        ? Math.max(15, Math.round((pricing.baseDeliveryFee * pricing.riderCommissionPercent) / 100))
        : 0;

    store.orderCounter += 1;
    const orderNumber = `YUP-${store.orderCounter}`;
    const now = new Date().toISOString();

    const newOrder: Order = {
      id: `ord-${store.orderCounter}`,
      orderNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      restaurantAddress: restaurant.address,
      serviceType,
      items: orderItems,
      subtotal,
      deliveryFee,
      platformFee,
      totalAmount,
      riderFee,
      deliveryAddress: serviceType === 'FOOD_DELIVERY' ? deliveryAddress.trim() : undefined,
      pickupInstructions:
        serviceType === 'SELF_PICKUP'
          ? (typeof pickupInstructions === 'string' && pickupInstructions.trim()
              ? pickupInstructions.trim()
              : `Collect at ${restaurant.name} counter with order ${orderNumber}`)
          : undefined,
      paymentMethod,
      paymentStatus: 'PENDING_COLLECTION',
      status: 'PLACED',
      assignedRiderId: null,
      assignedRiderName: null,
      assignedRiderPhone: null,
      assignedRiderPlate: null,
      riderJobStatus: 'UNASSIGNED',
      milestones: [
        {
          status: 'PLACED',
          label:
            serviceType === 'FOOD_DELIVERY'
              ? 'Order placed · Cash on Delivery pending'
              : 'Self-pickup order placed · Pay at Counter pending',
          timestamp: now,
          actor: customer.name,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    if (serviceType === 'FOOD_DELIVERY' && typeof deliveryAddress === 'string') {
      customer.savedAddress = deliveryAddress.trim();
    }

    store.orders.unshift(newOrder);
    appendAudit(
      customer.id,
      'CUSTOMER',
      customer.email,
      'ORDER_PLACED',
      orderNumber,
      `${serviceType} order at ${restaurant.name} for ₹${totalAmount} (${paymentMethod})`
    );
    saveStore();

    res.status(201).json({ order: newOrder });
  });

  // ---------------- RIDER ROUTES ----------------
  app.get('/api/rider/profile', requireAuth(['RIDER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.auth!.userId);
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    res.json({ user: sanitizeUser(rider) });
  });

  app.post('/api/rider/documents', requireAuth(['RIDER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.auth!.userId);
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    const {
      cityArea,
      dummyGovIdRef,
      dummyLicenseRef,
      dummyVehiclePlate,
      dummyVehicleType,
      dummyPayoutRef,
      dummyBankDetails,
      requestedServices,
    } = req.body ?? {};
    if (
      typeof dummyGovIdRef !== 'string' ||
      typeof dummyLicenseRef !== 'string' ||
      typeof dummyVehiclePlate !== 'string'
    ) {
      res.status(400).json({ error: 'Dummy Gov ID, Driving Licence, and Vehicle Registration Number are required.' });
      return;
    }

    for (const [val, label] of [
      [dummyGovIdRef, 'Dummy ID Reference'],
      [dummyLicenseRef, 'Dummy Driving Licence Reference'],
      [dummyVehiclePlate, 'Vehicle Registration Number'],
    ] as const) {
      const err = validateDummyDocumentRef(val, label);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }

    const bankInput = dummyBankDetails || {
      accountHolderName: `${rider.name} (Test)`,
      dummyAccountNumber: `TEST-ACCT-${rider.id.toUpperCase()}`,
      dummyIfscCode: 'MOCK0003690',
      dummyPayoutRef: typeof dummyPayoutRef === 'string' ? dummyPayoutRef : '',
    };
    const bankCheck = validateDummyBankDetails(bankInput);
    if (bankCheck.error || !bankCheck.data) {
      res.status(400).json({ error: bankCheck.error || 'Invalid dummy bank details.' });
      return;
    }

    if (Array.isArray(requestedServices)) {
      const disabledAttempt = requestedServices.find((s) => s !== 'FOOD_DELIVERY');
      if (disabledAttempt) {
        res.status(400).json({ error: `Service ${String(disabledAttempt)} is disabled until implemented and approved.` });
        return;
      }
    }

    if (typeof cityArea === 'string' && cityArea.trim().length >= 2) {
      rider.cityArea = cityArea.trim();
    }

    const allowedVehicles = ['Scooter', 'Motorcycle', 'E-Bike', 'Bicycle'];
    const vehicleType = allowedVehicles.includes(dummyVehicleType) ? dummyVehicleType : 'Scooter';
    const docs: RiderDocuments = {
      dummyGovIdRef: dummyGovIdRef.trim(),
      dummyLicenseRef: dummyLicenseRef.trim(),
      dummyVehiclePlate: dummyVehiclePlate.trim().toUpperCase(),
      dummyVehicleType: vehicleType,
      dummyPayoutRef: bankCheck.data.dummyPayoutRef,
      dummyBankDetails: bankCheck.data,
      submittedAt: new Date().toISOString(),
    };

    const previousDocStatus = rider.documentStatus || 'PENDING';
    rider.documents = docs;
    // Submitting/updating documents always resets documentStatus to PENDING (never auto-approved)
    rider.documentStatus = 'PENDING';
    rider.documentNotes = 'Updated dummy documents & bank details submitted for Owner review';
    rider.approvalNotes = 'Updated dummy documents & bank details submitted for Owner review';
    syncUnifiedRiderApproval(rider);

    appendRiderApprovalHistory({
      riderId: rider.id,
      riderName: rider.name,
      riderEmail: rider.email,
      target: 'DOCUMENTS',
      previousStatus: previousDocStatus,
      newStatus: 'PENDING',
      reason: `Rider resubmitted vehicle (${docs.dummyVehiclePlate}), licence (${docs.dummyLicenseRef}), and dummy bank details`,
      actorId: rider.id,
      actorRole: 'RIDER',
      actorEmail: rider.email,
    });
    appendAudit(
      rider.id,
      'RIDER',
      rider.email,
      'RIDER_DUMMY_DOCS_SUBMITTED',
      rider.name,
      `Submitted vehicle (${docs.dummyVehiclePlate}), licence (${docs.dummyLicenseRef}), and dummy bank (${bankCheck.data.dummyAccountNumber}); documentStatus=PENDING`
    );
    saveStore();
    res.json({ user: sanitizeUser(rider) });
  });

  app.patch('/api/rider/availability', requireAuth(['RIDER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.auth!.userId);
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    syncUnifiedRiderApproval(rider);
    if (
      rider.documentStatus !== 'APPROVED' ||
      rider.serviceApprovals?.FOOD_DELIVERY.status !== 'APPROVED'
    ) {
      res.status(403).json({
        error: 'You cannot go online until the Owner approves both your dummy documents and Food Delivery service.',
      });
      return;
    }
    const { isOnline } = req.body ?? {};
    rider.isOnline = Boolean(isOnline);
    appendAudit(
      rider.id,
      'RIDER',
      rider.email,
      'RIDER_AVAILABILITY_UPDATED',
      rider.name,
      `Rider status changed to ${rider.isOnline ? 'ONLINE' : 'OFFLINE'}`
    );
    saveStore();
    res.json({ user: sanitizeUser(rider) });
  });

  app.get('/api/rider/jobs', requireAuth(['RIDER']), (req: AuthenticatedRequest, res) => {
    const jobs = store.orders
      .filter((o) => o.assignedRiderId === req.auth!.userId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ jobs });
  });

  app.post('/api/rider/jobs/:orderId/respond', requireAuth(['RIDER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.auth!.userId);
    const order = store.orders.find((o) => o.id === req.params.orderId);
    if (!rider || !order) {
      res.status(404).json({ error: 'Job or rider not found.' });
      return;
    }
    if (order.assignedRiderId !== rider.id) {
      res.status(403).json({ error: 'This job is not assigned to you.' });
      return;
    }
    if (order.riderJobStatus !== 'ASSIGNED') {
      res.status(400).json({ error: 'Job response already recorded.' });
      return;
    }
    const { action, reason } = req.body ?? {};
    const now = new Date().toISOString();

    if (action === 'ACCEPT') {
      order.riderJobStatus = 'ACCEPTED';
      if (order.status === 'PLACED') order.status = 'CONFIRMED';
      order.milestones.push({
        status: order.status,
        label: `Rider ${rider.name} accepted delivery job`,
        timestamp: now,
        actor: rider.name,
      });
      order.updatedAt = now;
      appendAudit(rider.id, 'RIDER', rider.email, 'RIDER_ACCEPTED_JOB', order.orderNumber, 'Rider accepted assigned delivery');
      saveStore();
      res.json({ order });
      return;
    }

    if (action === 'REJECT') {
      order.assignedRiderId = null;
      order.assignedRiderName = null;
      order.assignedRiderPhone = null;
      order.assignedRiderPlate = null;
      order.riderJobStatus = 'REJECTED';
      order.milestones.push({
        status: order.status,
        label: `Rider ${rider.name} declined job${typeof reason === 'string' && reason.trim() ? `: ${reason.trim()}` : ''}`,
        timestamp: now,
        actor: rider.name,
      });
      order.updatedAt = now;
      appendAudit(
        rider.id,
        'RIDER',
        rider.email,
        'RIDER_REJECTED_JOB',
        order.orderNumber,
        typeof reason === 'string' && reason.trim() ? reason.trim() : 'Declined by rider; awaiting reassignment'
      );
      saveStore();
      res.json({ order });
      return;
    }

    res.status(400).json({ error: 'Action must be ACCEPT or REJECT.' });
  });

  app.post('/api/rider/jobs/:orderId/pickup', requireAuth(['RIDER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.auth!.userId);
    const order = store.orders.find((o) => o.id === req.params.orderId);
    if (!rider || !order) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (order.assignedRiderId !== rider.id || order.riderJobStatus !== 'ACCEPTED') {
      res.status(403).json({ error: 'You must accept this assigned job before confirming pickup.' });
      return;
    }
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED' || order.status === 'PICKED_UP') {
      res.status(400).json({ error: 'Pickup already confirmed or order closed.' });
      return;
    }
    const now = new Date().toISOString();
    order.status = 'PICKED_UP';
    order.updatedAt = now;
    order.milestones.push({
      status: 'PICKED_UP',
      label: `Picked up from ${order.restaurantName} by ${rider.name}`,
      timestamp: now,
      actor: rider.name,
    });
    appendAudit(rider.id, 'RIDER', rider.email, 'RIDER_PICKUP_CONFIRMED', order.orderNumber, `Picked up from ${order.restaurantName}`);
    saveStore();
    res.json({ order });
  });

  app.post('/api/rider/jobs/:orderId/complete', requireAuth(['RIDER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.auth!.userId);
    const order = store.orders.find((o) => o.id === req.params.orderId);
    if (!rider || !order) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (order.assignedRiderId !== rider.id || order.status !== 'PICKED_UP') {
      res.status(400).json({ error: 'Confirm pickup before marking delivery complete.' });
      return;
    }
    const now = new Date().toISOString();
    order.status = 'COMPLETED';
    order.riderJobStatus = 'COMPLETED';
    order.paymentStatus = 'COLLECTED_ON_DELIVERY';
    order.updatedAt = now;
    order.milestones.push({
      status: 'COMPLETED',
      label: `Delivered to customer · ₹${order.totalAmount} COD collected`,
      timestamp: now,
      actor: rider.name,
    });

    // Record earning as UNPAID_PENDING_MANUAL_REVIEW (Never auto-approve payouts!)
    if (!store.riderEarnings.some((e) => e.orderId === order.id)) {
      store.riderEarnings.unshift({
        id: `earn-${order.orderNumber}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        riderId: rider.id,
        restaurantName: order.restaurantName,
        amount: order.riderFee,
        payoutStatus: 'UNPAID_PENDING_MANUAL_REVIEW',
        manualPayoutId: null,
        completedAt: now,
      });
    }

    appendAudit(
      rider.id,
      'RIDER',
      rider.email,
      'RIDER_DELIVERY_COMPLETED',
      order.orderNumber,
      `Delivery completed; ₹${order.riderFee} rider fee queued for manual Owner payout review`
    );
    saveStore();
    res.json({ order });
  });

  app.get('/api/rider/earnings', requireAuth(['RIDER']), (req: AuthenticatedRequest, res) => {
    const fin = computeRiderFinancials(req.auth!.userId);
    res.json({
      summary: {
        totalEarned: fin.totalEarned,
        totalPaidManually: fin.totalPaidManually,
        pendingManualPayout: fin.pendingManualPayout,
        completedDeliveries: fin.completedDeliveries,
      },
      ledger: fin.earnings,
      payoutRecords: fin.payouts,
    });
  });

  // ---------------- OWNER / SUPER ADMIN ROUTES ----------------
  app.get('/api/owner/overview', requireAuth(['OWNER']), (_req, res) => {
    const customers = store.users
      .filter((u) => u.role === 'CUSTOMER')
      .map((u) => ({
        ...sanitizeUser(u),
        orderCount: store.orders.filter((o) => o.customerId === u.id).length,
      }));

    const riders = store.users
      .filter((u) => u.role === 'RIDER')
      .map((u) => {
        const fin = computeRiderFinancials(u.id);
        return {
          ...sanitizeUser(u),
          totalEarned: fin.totalEarned,
          totalPaidManually: fin.totalPaidManually,
          pendingBalance: fin.pendingManualPayout,
          completedDeliveries: fin.completedDeliveries,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const activeOrders = store.orders.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length;
    const completedOrders = store.orders.filter((o) => o.status === 'COMPLETED').length;
    const grossOrderVolume = store.orders
      .filter((o) => o.status !== 'CANCELLED')
      .reduce((acc, o) => acc + o.totalAmount, 0);

    res.json({
      metrics: {
        totalOrders: store.orders.length,
        activeOrders,
        completedOrders,
        grossOrderVolume,
        totalCustomers: customers.length,
        totalRiders: riders.length,
        pendingRiderApprovals: riders.filter((r) => r.approvalStatus === 'PENDING').length,
        onlineApprovedRiders: riders.filter((r) => r.approvalStatus === 'APPROVED' && r.isOnline).length,
        openRestaurants: store.restaurants.filter((r) => r.isOpen).length,
        pendingManualPayoutTotal: riders.reduce((acc, r) => acc + r.pendingBalance, 0),
      },
      orders: store.orders,
      customers,
      riders,
      restaurants: store.restaurants,
      pricing: store.pricing,
      payouts: store.manualPayouts,
      riderApprovalHistory: store.riderApprovalHistory,
      auditLogs: store.auditLogs,
    });
  });

  app.get('/api/owner/riders', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';

    const riders = store.users
      .filter((u) => u.role === 'RIDER')
      .map((u) => {
        const fin = computeRiderFinancials(u.id);
        return {
          ...sanitizeUser(u),
          totalEarned: fin.totalEarned,
          totalPaidManually: fin.totalPaidManually,
          pendingBalance: fin.pendingManualPayout,
          completedDeliveries: fin.completedDeliveries,
        };
      })
      .filter((r) => {
        if (q && !r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) {
          return false;
        }
        const docStatus = r.documentStatus || r.approvalStatus || 'PENDING';
        const foodStatus = r.serviceApprovals?.FOOD_DELIVERY?.status || r.approvalStatus || 'PENDING';
        if (statusFilter === 'APPROVED') {
          return docStatus === 'APPROVED' && foodStatus === 'APPROVED';
        }
        if (statusFilter === 'PENDING') {
          return docStatus === 'PENDING' || foodStatus === 'PENDING';
        }
        if (statusFilter === 'REJECTED') {
          return docStatus === 'REJECTED' || foodStatus === 'REJECTED';
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ riders });
  });

  app.get('/api/owner/riders/:id/history', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.params.id && u.role === 'RIDER');
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    const history = store.riderApprovalHistory.filter((h) => h.riderId === rider.id);
    res.json({ history });
  });

  app.patch('/api/owner/customers/:id/status', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const customer = store.users.find((u) => u.id === req.params.id && u.role === 'CUSTOMER');
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    const { status } = req.body ?? {};
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
      res.status(400).json({ error: 'Status must be ACTIVE or SUSPENDED' });
      return;
    }
    customer.status = status;
    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      'CUSTOMER_STATUS_UPDATED',
      customer.email,
      `Account marked ${status}`
    );
    saveStore();
    res.json({ customer: sanitizeUser(customer) });
  });

  app.patch('/api/owner/riders/:id/approval', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.params.id && u.role === 'RIDER');
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    const { approvalStatus, approvalNotes } = req.body ?? {};
    const valid: RiderApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!valid.includes(approvalStatus)) {
      res.status(400).json({ error: 'Invalid approval status' });
      return;
    }
    const cleanNote = typeof approvalNotes === 'string' ? approvalNotes.trim() : '';
    if (approvalStatus === 'REJECTED' && cleanNote.length < 3) {
      res.status(400).json({ error: 'Please provide a rejection reason (at least 3 characters).' });
      return;
    }
    const prevDoc = rider.documentStatus || 'PENDING';
    const prevSvc = rider.serviceApprovals?.FOOD_DELIVERY?.status || 'PENDING';

    rider.documentStatus = approvalStatus;
    rider.documentNotes = cleanNote || `Document verification marked ${approvalStatus} by Owner`;
    if (!rider.serviceApprovals) {
      rider.serviceApprovals = buildDefaultServiceApprovals(approvalStatus);
    } else {
      rider.serviceApprovals.FOOD_DELIVERY = {
        ...rider.serviceApprovals.FOOD_DELIVERY,
        status: approvalStatus,
        notes: cleanNote || `Food Delivery service marked ${approvalStatus} by Owner`,
        updatedAt: new Date().toISOString(),
      };
    }
    if (cleanNote) {
      rider.approvalNotes = cleanNote;
    }
    syncUnifiedRiderApproval(rider);

    appendRiderApprovalHistory({
      riderId: rider.id,
      riderName: rider.name,
      riderEmail: rider.email,
      target: 'DOCUMENTS',
      previousStatus: prevDoc,
      newStatus: approvalStatus,
      reason: rider.documentNotes,
      actorId: req.auth!.userId,
      actorRole: 'OWNER',
      actorEmail: req.auth!.email,
    });
    appendRiderApprovalHistory({
      riderId: rider.id,
      riderName: rider.name,
      riderEmail: rider.email,
      target: 'SERVICE_FOOD_DELIVERY',
      serviceKey: 'FOOD_DELIVERY',
      previousStatus: prevSvc === 'DISABLED' ? 'PENDING' : prevSvc,
      newStatus: approvalStatus,
      reason: rider.serviceApprovals.FOOD_DELIVERY.notes || `Set to ${approvalStatus}`,
      actorId: req.auth!.userId,
      actorRole: 'OWNER',
      actorEmail: req.auth!.email,
    });
    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      `RIDER_${approvalStatus}`,
      `${rider.name} (${rider.email})`,
      rider.approvalNotes || `Document & Food Delivery approval set to ${approvalStatus}`
    );
    saveStore();
    res.json({ rider: sanitizeUser(rider) });
  });

  app.patch('/api/owner/riders/:id/documents-status', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.params.id && u.role === 'RIDER');
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    const { documentStatus, approvalNotes } = req.body ?? {};
    const valid: RiderApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!valid.includes(documentStatus)) {
      res.status(400).json({ error: 'Invalid document status' });
      return;
    }
    const cleanReason = typeof approvalNotes === 'string' ? approvalNotes.trim() : '';
    if (documentStatus === 'REJECTED' && cleanReason.length < 3) {
      res.status(400).json({ error: 'Please add a document rejection reason (at least 3 characters).' });
      return;
    }
    const prevStatus = rider.documentStatus || 'PENDING';
    const resolvedReason =
      cleanReason ||
      (documentStatus === 'APPROVED'
        ? 'Dummy documents & vehicle details approved by Owner'
        : 'Documents returned to Pending review by Owner');

    rider.documentStatus = documentStatus;
    rider.documentNotes = resolvedReason;
    rider.approvalNotes = resolvedReason;
    syncUnifiedRiderApproval(rider);

    appendRiderApprovalHistory({
      riderId: rider.id,
      riderName: rider.name,
      riderEmail: rider.email,
      target: 'DOCUMENTS',
      previousStatus: prevStatus,
      newStatus: documentStatus,
      reason: resolvedReason,
      actorId: req.auth!.userId,
      actorRole: 'OWNER',
      actorEmail: req.auth!.email,
    });
    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      `RIDER_DOCS_${documentStatus}`,
      `${rider.name} (${rider.email})`,
      `Document status: ${documentStatus} · ${resolvedReason}`
    );
    saveStore();
    res.json({ rider: sanitizeUser(rider) });
  });

  app.patch('/api/owner/riders/:id/service-approval', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const rider = store.users.find((u) => u.id === req.params.id && u.role === 'RIDER');
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    const { serviceKey, status, notes } = req.body ?? {};
    const validServices: RiderServiceKey[] = ['FOOD_DELIVERY', 'GROCERY', 'PARCEL', 'BIKE_TAXI'];
    if (typeof serviceKey !== 'string' || !validServices.includes(serviceKey as RiderServiceKey)) {
      res.status(400).json({ error: 'Invalid service key' });
      return;
    }
    if (serviceKey !== 'FOOD_DELIVERY') {
      res.status(400).json({
        error: `${String(serviceKey)} is disabled in MVP until implemented and approved at platform level.`,
      });
      return;
    }
    const activeServiceKey: RiderServiceKey = 'FOOD_DELIVERY';
    const validStatuses: RiderApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid service approval status' });
      return;
    }
    const cleanReason = typeof notes === 'string' ? notes.trim() : '';
    if (status === 'REJECTED' && cleanReason.length < 3) {
      res.status(400).json({ error: 'Please add a Food Delivery rejection reason (at least 3 characters).' });
      return;
    }
    if (!rider.serviceApprovals) {
      rider.serviceApprovals = buildDefaultServiceApprovals('PENDING');
    }
    const prevServiceStatus = rider.serviceApprovals[activeServiceKey]?.status || 'PENDING';
    const resolvedReason =
      cleanReason ||
      (status === 'APPROVED'
        ? 'Food Delivery service approved by Owner'
        : 'Food Delivery service set to Pending by Owner');

    rider.serviceApprovals[activeServiceKey] = {
      requested: true,
      status,
      notes: resolvedReason,
      updatedAt: new Date().toISOString(),
    };
    if (status === 'REJECTED') {
      rider.approvalNotes = `Food Delivery rejected: ${resolvedReason}`;
    } else if (rider.documentStatus === 'APPROVED' && status === 'APPROVED') {
      rider.approvalNotes = 'Documents and Food Delivery service approved by Owner';
    }
    syncUnifiedRiderApproval(rider);

    appendRiderApprovalHistory({
      riderId: rider.id,
      riderName: rider.name,
      riderEmail: rider.email,
      target: 'SERVICE_FOOD_DELIVERY',
      serviceKey: activeServiceKey,
      previousStatus: prevServiceStatus === 'DISABLED' ? 'PENDING' : prevServiceStatus,
      newStatus: status,
      reason: resolvedReason,
      actorId: req.auth!.userId,
      actorRole: 'OWNER',
      actorEmail: req.auth!.email,
    });
    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      `RIDER_SERVICE_${activeServiceKey}_${status}`,
      `${rider.name} (${rider.email})`,
      `Food Delivery service: ${status} · ${resolvedReason}`
    );
    saveStore();
    res.json({ rider: sanitizeUser(rider) });
  });

  app.post('/api/owner/restaurants', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const { name, cuisine, address, prepTimeMins, supportsDelivery, supportsSelfPickup } = req.body ?? {};
    if (typeof name !== 'string' || typeof cuisine !== 'string' || typeof address !== 'string') {
      res.status(400).json({ error: 'Name, cuisine, and address are required.' });
      return;
    }
    const newRestaurant: Restaurant = {
      id: `rest-${crypto.randomUUID().slice(0, 6)}`,
      name: name.trim(),
      cuisine: cuisine.trim(),
      address: address.trim(),
      prepTimeMins: Math.max(10, Math.min(90, Number(prepTimeMins) || 25)),
      rating: 4.5,
      imageUrl: '/src/assets/images/rest_biryani_house_1795240192372.jpg',
      isOpen: true,
      supportsDelivery: supportsDelivery !== false,
      supportsSelfPickup: supportsSelfPickup !== false,
      menu: [],
    };
    store.restaurants.push(newRestaurant);
    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      'RESTAURANT_CREATED',
      newRestaurant.name,
      `Added restaurant at ${newRestaurant.address}`
    );
    saveStore();
    res.status(201).json({ restaurant: newRestaurant });
  });

  app.patch('/api/owner/restaurants/:id', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const restaurant = store.restaurants.find((r) => r.id === req.params.id);
    if (!restaurant) {
      res.status(404).json({ error: 'Restaurant not found' });
      return;
    }
    const { isOpen, supportsDelivery, supportsSelfPickup, prepTimeMins, name, cuisine } = req.body ?? {};
    if (typeof isOpen === 'boolean') restaurant.isOpen = isOpen;
    if (typeof supportsDelivery === 'boolean') restaurant.supportsDelivery = supportsDelivery;
    if (typeof supportsSelfPickup === 'boolean') restaurant.supportsSelfPickup = supportsSelfPickup;
    if (typeof prepTimeMins === 'number' && prepTimeMins >= 5 && prepTimeMins <= 120) {
      restaurant.prepTimeMins = Math.round(prepTimeMins);
    }
    if (typeof name === 'string' && name.trim()) restaurant.name = name.trim();
    if (typeof cuisine === 'string' && cuisine.trim()) restaurant.cuisine = cuisine.trim();

    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      'RESTAURANT_UPDATED',
      restaurant.name,
      `Open=${restaurant.isOpen}, Delivery=${restaurant.supportsDelivery}, Pickup=${restaurant.supportsSelfPickup}`
    );
    saveStore();
    res.json({ restaurant });
  });

  app.post('/api/owner/restaurants/:id/menu', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const restaurant = store.restaurants.find((r) => r.id === req.params.id);
    if (!restaurant) {
      res.status(404).json({ error: 'Restaurant not found' });
      return;
    }
    const { name, description, category, price, isVeg } = req.body ?? {};
    const numPrice = Number(price);
    if (typeof name !== 'string' || !name.trim() || !Number.isFinite(numPrice) || numPrice <= 0) {
      res.status(400).json({ error: 'Valid item name and positive price are required.' });
      return;
    }
    const newItem: MenuItem = {
      id: `item-${crypto.randomUUID().slice(0, 6)}`,
      restaurantId: restaurant.id,
      name: name.trim(),
      description: typeof description === 'string' && description.trim() ? description.trim() : 'Freshly prepared to order.',
      category: typeof category === 'string' && category.trim() ? category.trim() : 'Specials',
      price: Math.round(numPrice),
      isVeg: Boolean(isVeg),
      isAvailable: true,
    };
    restaurant.menu.push(newItem);
    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      'MENU_ITEM_ADDED',
      `${restaurant.name} · ${newItem.name}`,
      `Added item at ₹${newItem.price}`
    );
    saveStore();
    res.status(201).json({ item: newItem, restaurant });
  });

  app.patch('/api/owner/menu/:itemId', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    for (const restaurant of store.restaurants) {
      const item = restaurant.menu.find((m) => m.id === req.params.itemId);
      if (item) {
        const { isAvailable, price, name } = req.body ?? {};
        if (typeof isAvailable === 'boolean') item.isAvailable = isAvailable;
        if (typeof price === 'number' && price > 0) item.price = Math.round(price);
        if (typeof name === 'string' && name.trim()) item.name = name.trim();
        appendAudit(
          req.auth!.userId,
          'OWNER',
          req.auth!.email,
          'MENU_ITEM_UPDATED',
          `${restaurant.name} · ${item.name}`,
          `Available=${item.isAvailable}, Price=₹${item.price}`
        );
        saveStore();
        res.json({ item });
        return;
      }
    }
    res.status(404).json({ error: 'Menu item not found' });
  });

  app.patch('/api/owner/orders/:orderId/status', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const order = store.orders.find((o) => o.id === req.params.orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const { status } = req.body ?? {};
    const allowed: OrderStatus[] = [
      'CONFIRMED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'COMPLETED',
      'CANCELLED',
    ];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: 'Invalid order status update.' });
      return;
    }
    const now = new Date().toISOString();
    order.status = status;
    order.updatedAt = now;
    if (order.serviceType === 'SELF_PICKUP' && status === 'COMPLETED') {
      order.paymentStatus = 'PAID_AT_COUNTER';
    }
    const labels: Record<string, string> = {
      CONFIRMED: 'Order confirmed by restaurant/owner',
      PREPARING: 'Kitchen is preparing the order',
      READY_FOR_PICKUP:
        order.serviceType === 'SELF_PICKUP'
          ? 'Ready at counter for self-pickup'
          : 'Order packed and ready for rider pickup',
      COMPLETED:
        order.serviceType === 'SELF_PICKUP'
          ? 'Self-pickup completed & paid at counter'
          : 'Order marked completed by Owner',
      CANCELLED: 'Order cancelled by Owner',
    };
    order.milestones.push({
      status,
      label: labels[status] || status,
      timestamp: now,
      actor: 'Owner',
    });
    appendAudit(req.auth!.userId, 'OWNER', req.auth!.email, 'ORDER_STATUS_UPDATED', order.orderNumber, `Status set to ${status}`);
    saveStore();
    res.json({ order });
  });

  app.post('/api/owner/orders/:orderId/assign-rider', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const order = store.orders.find((o) => o.id === req.params.orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (order.serviceType !== 'FOOD_DELIVERY') {
      res.status(400).json({ error: 'Self-pickup orders do not require a rider.' });
      return;
    }
    const { riderId } = req.body ?? {};
    const rider = store.users.find((u) => u.id === riderId && u.role === 'RIDER');
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    syncUnifiedRiderApproval(rider);
    if (
      rider.documentStatus !== 'APPROVED' ||
      rider.serviceApprovals?.FOOD_DELIVERY.status !== 'APPROVED' ||
      rider.status !== 'ACTIVE'
    ) {
      res.status(400).json({
        error: 'Only riders with Owner-approved documents and Food Delivery service approval can be assigned jobs.',
      });
      return;
    }
    if (!rider.isOnline) {
      res.status(400).json({ error: 'Selected rider is currently offline.' });
      return;
    }

    const now = new Date().toISOString();
    order.assignedRiderId = rider.id;
    order.assignedRiderName = rider.name;
    order.assignedRiderPhone = rider.phone;
    order.assignedRiderPlate = rider.documents?.dummyVehiclePlate || 'Unlisted';
    order.riderJobStatus = 'ASSIGNED';
    if (order.status === 'PLACED') {
      order.status = 'CONFIRMED';
    }
    order.updatedAt = now;
    order.milestones.push({
      status: order.status,
      label: `Assigned to rider ${rider.name} (awaiting rider acceptance)`,
      timestamp: now,
      actor: 'Owner',
    });

    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      'RIDER_ASSIGNED',
      order.orderNumber,
      `Assigned ${rider.name} (${rider.email}) to delivery order`
    );
    saveStore();
    res.json({ order });
  });

  app.patch('/api/owner/pricing', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const { baseDeliveryFee, freeDeliveryThreshold, platformFee, selfPickupFee, riderCommissionPercent } = req.body ?? {};
    const next: PricingSettings = {
      baseDeliveryFee: Math.max(0, Math.round(Number(baseDeliveryFee ?? store.pricing.baseDeliveryFee))),
      freeDeliveryThreshold: Math.max(0, Math.round(Number(freeDeliveryThreshold ?? store.pricing.freeDeliveryThreshold))),
      platformFee: Math.max(0, Math.round(Number(platformFee ?? store.pricing.platformFee))),
      selfPickupFee: Math.max(0, Math.round(Number(selfPickupFee ?? store.pricing.selfPickupFee))),
      riderCommissionPercent: Math.max(10, Math.min(100, Math.round(Number(riderCommissionPercent ?? store.pricing.riderCommissionPercent)))),
      updatedAt: new Date().toISOString(),
    };
    store.pricing = next;
    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      'PRICING_UPDATED',
      'Platform Pricing',
      `Delivery ₹${next.baseDeliveryFee} (free ≥ ₹${next.freeDeliveryThreshold}), Platform ₹${next.platformFee}, Rider ${next.riderCommissionPercent}%`
    );
    saveStore();
    res.json({ pricing: store.pricing });
  });

  // Manual Payout Records (Strictly manual — never automatic)
  app.post('/api/owner/payouts', requireAuth(['OWNER']), (req: AuthenticatedRequest, res) => {
    const { riderId, amount, referenceNumber, methodNote } = req.body ?? {};
    const rider = store.users.find((u) => u.id === riderId && u.role === 'RIDER');
    if (!rider) {
      res.status(404).json({ error: 'Rider not found' });
      return;
    }
    const numAmount = Math.round(Number(amount));
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: 'Payout amount must be greater than ₹0.' });
      return;
    }
    const fin = computeRiderFinancials(rider.id);
    if (numAmount > fin.pendingManualPayout) {
      res.status(400).json({
        error: `Amount ₹${numAmount} exceeds rider's pending manual payout balance of ₹${fin.pendingManualPayout}.`,
      });
      return;
    }
    if (typeof referenceNumber !== 'string' || referenceNumber.trim().length < 3) {
      res.status(400).json({ error: 'Manual settlement reference number is required.' });
      return;
    }

    const payoutId = `pay-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const record: ManualPayoutRecord = {
      id: payoutId,
      riderId: rider.id,
      riderName: rider.name,
      amount: numAmount,
      referenceNumber: referenceNumber.trim(),
      methodNote: typeof methodNote === 'string' && methodNote.trim() ? methodNote.trim() : 'Manual Owner Settlement',
      recordedBy: req.auth!.email,
      recordedAt: now,
    };

    // Mark matching unpaid earnings ledger entries as settled manually where cumulative settled covers them
    let remainingToCover = fin.totalPaidManually + numAmount;
    const chronologicalEarnings = [...store.riderEarnings]
      .filter((e) => e.riderId === rider.id)
      .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
    for (const entry of chronologicalEarnings) {
      if (remainingToCover >= entry.amount) {
        entry.payoutStatus = 'SETTLED_MANUALLY';
        if (!entry.manualPayoutId) entry.manualPayoutId = payoutId;
        remainingToCover -= entry.amount;
      }
    }

    store.manualPayouts.unshift(record);
    appendAudit(
      req.auth!.userId,
      'OWNER',
      req.auth!.email,
      'MANUAL_PAYOUT_RECORDED',
      `${rider.name} (${rider.email})`,
      `Recorded manual payout of ₹${numAmount} (Ref: ${record.referenceNumber})`
    );
    saveStore();
    res.status(201).json({ payout: record });
  });

  const httpServer = http.createServer(app);

  // Vite middleware in development, static assets in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Yup! 369 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
