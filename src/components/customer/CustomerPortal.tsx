import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Home,
  Lock,
  LogOut,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  User,
  UtensilsCrossed,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  MenuItem,
  Order,
  PricingSettings,
  Restaurant,
  ServiceDefinition,
  UserProfile,
} from '../../types/domain';
import { BrandMark, VegMarker, formatINR, formatTime } from '../BrandMark';
import { PWAInstallButton } from '../PWAInstallButton';

interface CustomerPortalProps {
  user: UserProfile;
  services: ServiceDefinition[];
  restaurants: Restaurant[];
  pricing: PricingSettings;
  onUserUpdated: (user: UserProfile) => void;
  onRefreshCatalog: () => Promise<void>;
  onLogout: () => void;
}

type CustomerTab = 'HOME' | 'SEARCH' | 'CART' | 'ORDERS' | 'PROFILE';

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

export const CustomerPortal: React.FC<CustomerPortalProps> = ({
  user,
  services,
  restaurants,
  pricing,
  onUserUpdated,
  onRefreshCatalog,
  onLogout,
}) => {
  const [tab, setTab] = useState<CustomerTab>('HOME');
  const [selectedServiceFilter, setSelectedServiceFilter] = useState<'ALL' | 'FOOD_DELIVERY' | 'SELF_PICKUP'>('ALL');
  const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);

  // Cart state (scoped to one restaurant at a time)
  const [cartRestaurantId, setCartRestaurantId] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [checkoutMode, setCheckoutMode] = useState<'FOOD_DELIVERY' | 'SELF_PICKUP'>('FOOD_DELIVERY');
  const [deliveryAddress, setDeliveryAddress] = useState(user.savedAddress || '');
  const [pickupInstructions, setPickupInstructions] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Orders state
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [justPlacedOrderNumber, setJustPlacedOrderNumber] = useState<string | null>(null);

  // Profile edit state
  const [profileName, setProfileName] = useState(user.name);
  const [profilePhone, setProfilePhone] = useState(user.phone);
  const [profileAddress, setProfileAddress] = useState(user.savedAddress || '');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const activeRestaurant = useMemo(
    () => restaurants.find((r) => r.id === activeRestaurantId) || null,
    [restaurants, activeRestaurantId]
  );

  const cartRestaurant = useMemo(
    () => restaurants.find((r) => r.id === cartRestaurantId) || null,
    [restaurants, cartRestaurantId]
  );

  const totalCartCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  const cartSubtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0),
    [cartItems]
  );

  const deliveryFee = useMemo(() => {
    if (cartItems.length === 0) return 0;
    if (checkoutMode === 'SELF_PICKUP') return pricing.selfPickupFee;
    return cartSubtotal >= pricing.freeDeliveryThreshold ? 0 : pricing.baseDeliveryFee;
  }, [cartItems.length, checkoutMode, cartSubtotal, pricing]);

  const platformFee = cartItems.length > 0 ? pricing.platformFee : 0;
  const cartTotal = cartSubtotal + deliveryFee + platformFee;

  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const res = await api.getCustomerOrders();
      setOrders(res.orders);
    } catch {
      // handled silently in background refresh
    } finally {
      setOrdersLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    if (tab === 'ORDERS') {
      loadOrders();
    }
  }, [tab]);

  useEffect(() => {
    if (cartRestaurant) {
      if (checkoutMode === 'FOOD_DELIVERY' && !cartRestaurant.supportsDelivery && cartRestaurant.supportsSelfPickup) {
        setCheckoutMode('SELF_PICKUP');
      } else if (checkoutMode === 'SELF_PICKUP' && !cartRestaurant.supportsSelfPickup && cartRestaurant.supportsDelivery) {
        setCheckoutMode('FOOD_DELIVERY');
      }
    }
  }, [cartRestaurant, checkoutMode]);

  const filteredRestaurants = useMemo(() => {
    return restaurants.filter((r) => {
      if (selectedServiceFilter === 'FOOD_DELIVERY' && !r.supportsDelivery) return false;
      if (selectedServiceFilter === 'SELF_PICKUP' && !r.supportsSelfPickup) return false;
      return true;
    });
  }, [restaurants, selectedServiceFilter]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return restaurants
      .map((rest) => {
        const restMatch =
          !q ||
          rest.name.toLowerCase().includes(q) ||
          rest.cuisine.toLowerCase().includes(q) ||
          rest.address.toLowerCase().includes(q);
        const matchingItems = rest.menu.filter((m) => {
          if (vegOnly && !m.isVeg) return false;
          if (!q) return true;
          return (
            restMatch ||
            m.name.toLowerCase().includes(q) ||
            m.category.toLowerCase().includes(q) ||
            m.description.toLowerCase().includes(q)
          );
        });
        return { restaurant: rest, items: matchingItems };
      })
      .filter((entry) => entry.items.length > 0 || (!vegOnly && entry.restaurant.name.toLowerCase().includes(q)));
  }, [restaurants, searchQuery, vegOnly]);

  const getCartQuantity = (menuItemId: string) =>
    cartItems.find((c) => c.menuItem.id === menuItemId)?.quantity || 0;

  const handleAddToCart = (restaurant: Restaurant, item: MenuItem) => {
    if (!restaurant.isOpen || !item.isAvailable) return;
    if (cartRestaurantId && cartRestaurantId !== restaurant.id && cartItems.length > 0) {
      // Replace cart cleanly with newly selected restaurant
      setCartRestaurantId(restaurant.id);
      setCartItems([{ menuItem: item, quantity: 1 }]);
      return;
    }
    setCartRestaurantId(restaurant.id);
    setCartItems((prev) => {
      const existing = prev.find((c) => c.menuItem.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.menuItem.id === item.id ? { ...c, quantity: Math.min(25, c.quantity + 1) } : c
        );
      }
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  };

  const handleDecrementCart = (menuItemId: string) => {
    setCartItems((prev) => {
      const next = prev
        .map((c) => (c.menuItem.id === menuItemId ? { ...c, quantity: c.quantity - 1 } : c))
        .filter((c) => c.quantity > 0);
      if (next.length === 0) {
        setCartRestaurantId(null);
      }
      return next;
    });
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cartRestaurant || cartItems.length === 0) return;
    setCheckoutError(null);
    setCheckoutBusy(true);
    try {
      const res = await api.placeOrder({
        restaurantId: cartRestaurant.id,
        serviceType: checkoutMode,
        items: cartItems.map((c) => ({ menuItemId: c.menuItem.id, quantity: c.quantity })),
        deliveryAddress: checkoutMode === 'FOOD_DELIVERY' ? deliveryAddress : undefined,
        pickupInstructions: checkoutMode === 'SELF_PICKUP' ? pickupInstructions : undefined,
        paymentMethod: checkoutMode === 'FOOD_DELIVERY' ? 'CASH_ON_DELIVERY' : 'PAY_AT_COUNTER',
      });
      setOrders((prev) => [res.order, ...prev]);
      setJustPlacedOrderNumber(res.order.orderNumber);
      setCartItems([]);
      setCartRestaurantId(null);
      setActiveRestaurantId(null);
      setTab('ORDERS');
      await onRefreshCatalog();
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to place order');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const res = await api.updateCustomerProfile({
        name: profileName,
        phone: profilePhone,
        savedAddress: profileAddress,
      });
      onUserUpdated(res.user);
      setDeliveryAddress(res.user.savedAddress || '');
      setProfileMsg('Profile saved.');
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : 'Could not update profile');
    } finally {
      setProfileBusy(false);
    }
  };

  const renderRestaurantDetail = (restaurant: Restaurant) => {
    const categories = Array.from(new Set(restaurant.menu.map((m) => m.category)));
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setActiveRestaurantId(null)}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[#0B0B0D] hover:text-[#FF6B00]"
        >
          <ArrowLeft className="h-4 w-4" />
          All Restaurants
        </button>

        {/* Restaurant Hero */}
        <div className="rounded-3xl bg-white border border-zinc-200 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
            <div className="lg:col-span-5 h-52 lg:h-auto bg-zinc-900">
              <img
                src={restaurant.imageUrl}
                alt={restaurant.name}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="lg:col-span-7 p-5 sm:p-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-[#FF6B00]">
                    {restaurant.isOpen ? 'Open for Orders' : 'Currently Closed'}
                  </span>
                  <span className="font-mono text-xs font-semibold text-[#0B0B0D]">
                    {restaurant.rating.toFixed(1)} ★
                  </span>
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#0B0B0D] mt-1">
                  {restaurant.name}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                  <span>{restaurant.cuisine}</span>
                  <span aria-hidden="true">·</span>
                  <span>{restaurant.prepTimeMins} min prep</span>
                  <span aria-hidden="true">·</span>
                  <span>{restaurant.address}</span>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-4 font-medium text-zinc-700">
                  <span>
                    Delivery: {restaurant.supportsDelivery ? 'Available' : 'Unavailable'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Self-Pickup: {restaurant.supportsSelfPickup ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                {totalCartCount > 0 && cartRestaurantId === restaurant.id && (
                  <button
                    type="button"
                    onClick={() => setTab('CART')}
                    className="min-h-[40px] rounded-xl bg-[#FFC700] px-4 py-2 font-bold text-[#0B0B0D] hover:bg-[#FFD335] transition-colors"
                  >
                    View Cart ({totalCartCount}) · {formatINR(cartSubtotal)}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Menu Categories */}
        <div className="space-y-6">
          {categories.map((category) => (
            <div key={category} className="space-y-3">
              <h2 className="font-display text-lg font-bold text-[#0B0B0D]">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {restaurant.menu
                  .filter((m) => m.category === category)
                  .map((item) => {
                    const qty = getCartQuantity(item.id);
                    const disabled = !restaurant.isOpen || !item.isAvailable;
                    return (
                      <div
                        key={item.id}
                        className="rounded-2xl bg-white border border-zinc-200 p-4 flex items-start justify-between gap-4"
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <VegMarker isVeg={item.isVeg} />
                            <h3 className="font-semibold text-sm text-[#0B0B0D] truncate">
                              {item.name}
                            </h3>
                          </div>
                          <p className="text-xs text-zinc-600 line-clamp-2">
                            {item.description}
                          </p>
                          <div className="font-mono text-sm font-bold text-[#0B0B0D] pt-1">
                            {formatINR(item.price)}
                          </div>
                        </div>

                        <div className="shrink-0">
                          {disabled ? (
                            <span className="inline-block text-xs font-medium text-zinc-400 py-2">
                              Unavailable
                            </span>
                          ) : qty === 0 ? (
                            <button
                              type="button"
                              onClick={() => handleAddToCart(restaurant, item)}
                              className="min-h-[44px] min-w-[84px] rounded-xl bg-[#0B0B0D] px-4 text-xs font-bold text-[#FFC700] hover:bg-zinc-800 transition-colors"
                            >
                              + Add
                            </button>
                          ) : (
                            <div className="inline-flex items-center rounded-xl bg-[#FFC700] text-[#0B0B0D] font-bold">
                              <button
                                type="button"
                                aria-label={`Decrease ${item.name}`}
                                onClick={() => handleDecrementCart(item.id)}
                                className="min-h-[44px] min-w-[36px] flex items-center justify-center hover:bg-black/5 rounded-l-xl"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="font-mono text-sm px-2">{qty}</span>
                              <button
                                type="button"
                                aria-label={`Increase ${item.name}`}
                                onClick={() => handleAddToCart(restaurant, item)}
                                className="min-h-[44px] min-w-[36px] flex items-center justify-center hover:bg-black/5 rounded-r-xl"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F6F6F7] text-[#0B0B0D] flex flex-col">
      {/* Sticky Top Bar (compact <= 56px mobile, 3-zone desktop contract) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-zinc-200 px-4 sm:px-8 h-14 flex items-center justify-between gap-4 lg:gap-8">
        <button
          type="button"
          onClick={() => {
            setTab('HOME');
            setActiveRestaurantId(null);
          }}
          className="whitespace-nowrap shrink-0"
        >
          <BrandMark size="sm" />
        </button>

        {/* Desktop Nav Links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-semibold text-zinc-600">
          {([
            ['HOME', 'Home'],
            ['SEARCH', 'Search'],
            ['CART', `Cart (${totalCartCount})`],
            ['ORDERS', 'Orders'],
            ['PROFILE', 'Profile'],
          ] as [CustomerTab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                if (key !== 'HOME') setActiveRestaurantId(null);
              }}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                tab === key
                  ? 'border-[#FF6B00] text-[#0B0B0D]'
                  : 'border-transparent hover:text-[#0B0B0D]'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={() => setTab('CART')}
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-[#0B0B0D] px-3.5 text-xs font-bold text-[#FFC700] hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
          >
            <ShoppingBag className="h-4 w-4" />
            <span>{totalCartCount > 0 ? `${totalCartCount} · ${formatINR(cartTotal)}` : 'Cart'}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-5 pb-24 lg:pb-10">
        {tab === 'HOME' && activeRestaurant && renderRestaurantDetail(activeRestaurant)}

        {tab === 'HOME' && !activeRestaurant && (
          <div className="space-y-8">
            {/* Hero Banner */}
            <section className="rounded-3xl bg-[#0B0B0D] text-white overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
              <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between gap-6">
                <div>
                  <div className="text-xs font-semibold text-[#FFC700]">
                    Food Delivery &amp; Self-Pickup Active
                  </div>
                  <h1 className="font-display text-2xl sm:text-4xl font-extrabold tracking-tight mt-2 text-balance">
                    Hot food at your door, or ready at the counter.
                  </h1>
                  <p className="text-sm text-zinc-300 mt-3 max-w-xl">
                    Order from trusted kitchens with transparent pricing: base delivery {formatINR(pricing.baseDeliveryFee)} (free over {formatINR(pricing.freeDeliveryThreshold)}) or {formatINR(pricing.selfPickupFee)} fee on self-pickup.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setTab('SEARCH')}
                    className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#FFC700] px-5 text-sm font-bold text-[#0B0B0D] hover:bg-[#FFD335] transition-colors"
                  >
                    <Search className="h-4 w-4" />
                    Search Dishes &amp; Kitchens
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('ORDERS')}
                    className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm font-semibold text-white hover:bg-zinc-900 transition-colors"
                  >
                    View Order History
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 h-48 sm:h-60 lg:h-auto bg-zinc-900">
                <img
                  src="/src/assets/images/hero_food_delivery_1795240191520.jpg"
                  alt="Yup! 369 food spread"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </section>

            {/* Services Row (Active vs Explicitly Disabled Unfinished Services) */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-display text-lg font-bold text-[#0B0B0D]">
                  Services
                </h2>
                <span className="text-xs text-zinc-500">
                  Only approved MVP services are enabled
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {services.map((svc) => {
                  const isActiveSelected =
                    (svc.id === 'FOOD_DELIVERY' && selectedServiceFilter === 'FOOD_DELIVERY') ||
                    (svc.id === 'SELF_PICKUP' && selectedServiceFilter === 'SELF_PICKUP');

                  if (svc.enabled) {
                    return (
                      <button
                        key={svc.id}
                        type="button"
                        onClick={() =>
                          setSelectedServiceFilter((prev) =>
                            prev === svc.id
                              ? 'ALL'
                              : (svc.id as 'FOOD_DELIVERY' | 'SELF_PICKUP')
                          )
                        }
                        className={`min-h-[88px] rounded-2xl border p-4 text-left transition-all flex flex-col justify-between ${
                          isActiveSelected
                            ? 'bg-[#FFC700] border-[#0B0B0D] text-[#0B0B0D]'
                            : 'bg-white border-zinc-200 text-[#0B0B0D] hover:border-zinc-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display font-bold text-sm">{svc.name}</span>
                          <UtensilsCrossed className="h-4 w-4 text-[#FF6B00] shrink-0" />
                        </div>
                        <span className="text-[11px] text-zinc-600 mt-2">
                          {isActiveSelected ? 'Filtering restaurants' : 'Active · Tap to filter'}
                        </span>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={svc.id}
                      type="button"
                      disabled
                      aria-disabled="true"
                      title={svc.statusNote}
                      className="min-h-[88px] rounded-2xl border border-dashed border-zinc-300 bg-zinc-100/80 p-4 text-left text-zinc-400 cursor-not-allowed flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display font-bold text-sm">{svc.name}</span>
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                      </div>
                      <span className="text-[11px] text-zinc-500 mt-2">
                        Disabled · Pending approval
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Restaurant Listing */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-[#0B0B0D]">
                  Restaurants Near You
                </h2>
                <div className="flex items-center gap-1 p-1 bg-zinc-200/70 rounded-xl">
                  {([
                    ['ALL', 'All'],
                    ['FOOD_DELIVERY', 'Delivery'],
                    ['SELF_PICKUP', 'Self-Pickup'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedServiceFilter(key)}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                        selectedServiceFilter === key
                          ? 'bg-white text-[#0B0B0D] shadow-sm'
                          : 'text-zinc-600 hover:text-[#0B0B0D]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredRestaurants.map((rest) => (
                  <button
                    key={rest.id}
                    type="button"
                    onClick={() => setActiveRestaurantId(rest.id)}
                    className="group text-left rounded-2xl bg-white border border-zinc-200 overflow-hidden hover:border-[#0B0B0D] transition-colors flex flex-col"
                  >
                    <div className="relative h-44 w-full bg-zinc-900 overflow-hidden">
                      <img
                        src={rest.imageUrl}
                        alt={rest.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                      />
                      {!rest.isOpen && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-xs font-bold text-white">
                          Currently Closed
                        </div>
                      )}
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-display font-bold text-base text-[#0B0B0D] truncate">
                            {rest.name}
                          </h3>
                          <span className="font-mono text-xs font-bold text-[#0B0B0D] shrink-0">
                            {rest.rating.toFixed(1)} ★
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
                          <span>{rest.cuisine}</span>
                          <span aria-hidden="true">·</span>
                          <span>{rest.prepTimeMins} min</span>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center justify-between text-[11px] font-medium text-zinc-500">
                        <span>
                          {rest.supportsDelivery && rest.supportsSelfPickup
                            ? 'Delivery & Self-Pickup'
                            : rest.supportsDelivery
                              ? 'Delivery Only'
                              : 'Self-Pickup Only'}
                        </span>
                        <span className="text-[#FF6B00] font-semibold">Menu →</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* SEARCH TAB */}
        {tab === 'SEARCH' && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-white border border-zinc-200 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search biryani, dosa, smash burger, noodles..."
                  className="w-full min-h-[44px] rounded-xl border border-zinc-300 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                />
              </div>
              <button
                type="button"
                onClick={() => setVegOnly((v) => !v)}
                className={`min-h-[44px] px-4 rounded-xl border text-xs font-bold transition-colors whitespace-nowrap ${
                  vegOnly
                    ? 'bg-emerald-700 border-emerald-700 text-white'
                    : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                {vegOnly ? 'Veg Only: ON' : 'Veg Only'}
              </button>
            </div>

            {searchResults.length === 0 ? (
              <div className="rounded-2xl bg-white border border-zinc-200 p-10 text-center text-sm text-zinc-500">
                No matching dishes or restaurants found for &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              <div className="space-y-6">
                {searchResults.map(({ restaurant, items }) => (
                  <div
                    key={restaurant.id}
                    className="rounded-2xl bg-white border border-zinc-200 p-4 sm:p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-100">
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveRestaurantId(restaurant.id);
                            setTab('HOME');
                          }}
                          className="font-display text-lg font-bold text-[#0B0B0D] hover:text-[#FF6B00] text-left"
                        >
                          {restaurant.name}
                        </button>
                        <div className="text-xs text-zinc-500">
                          {restaurant.cuisine} · {restaurant.prepTimeMins} min · {restaurant.rating.toFixed(1)} ★
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveRestaurantId(restaurant.id);
                          setTab('HOME');
                        }}
                        className="min-h-[36px] text-xs font-semibold text-[#FF6B00] hover:underline"
                      >
                        Open Kitchen →
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {items.map((item) => {
                        const qty = getCartQuantity(item.id);
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50/70 p-3"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <VegMarker isVeg={item.isVeg} />
                                <span className="text-sm font-semibold truncate">{item.name}</span>
                              </div>
                              <div className="font-mono text-xs font-bold text-zinc-700 mt-1">
                                {formatINR(item.price)}
                              </div>
                            </div>
                            {qty === 0 ? (
                              <button
                                type="button"
                                disabled={!restaurant.isOpen || !item.isAvailable}
                                onClick={() => handleAddToCart(restaurant, item)}
                                className="min-h-[40px] px-3.5 rounded-xl bg-[#0B0B0D] text-xs font-bold text-[#FFC700] disabled:opacity-40 shrink-0"
                              >
                                + Add
                              </button>
                            ) : (
                              <div className="inline-flex items-center rounded-xl bg-[#FFC700] text-[#0B0B0D] font-bold shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleDecrementCart(item.id)}
                                  className="min-h-[40px] min-w-[32px] flex items-center justify-center"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="font-mono text-xs px-1.5">{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => handleAddToCart(restaurant, item)}
                                  className="min-h-[40px] min-w-[32px] flex items-center justify-center"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CART & CHECKOUT TAB */}
        {tab === 'CART' && (
          <div className="max-w-3xl mx-auto">
            {cartItems.length === 0 || !cartRestaurant ? (
              <div className="rounded-3xl bg-white border border-zinc-200 p-10 text-center space-y-4">
                <ShoppingBag className="h-10 w-10 text-zinc-300 mx-auto" />
                <h2 className="font-display text-xl font-bold text-[#0B0B0D]">
                  Your cart is empty
                </h2>
                <p className="text-sm text-zinc-500">
                  Browse active restaurants to add dishes for delivery or self-pickup.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('HOME')}
                  className="min-h-[44px] rounded-xl bg-[#FFC700] px-6 text-sm font-bold text-[#0B0B0D] hover:bg-[#FFD335]"
                >
                  Browse Restaurants
                </button>
              </div>
            ) : (
              <form onSubmit={handlePlaceOrder} className="space-y-5">
                <div className="rounded-3xl bg-white border border-zinc-200 p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-100">
                    <div>
                      <div className="text-xs text-zinc-500">Ordering from</div>
                      <h2 className="font-display text-xl font-bold text-[#0B0B0D]">
                        {cartRestaurant.name}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCartItems([]);
                        setCartRestaurantId(null);
                      }}
                      className="min-h-[40px] inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear Cart
                    </button>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-zinc-100">
                    {cartItems.map(({ menuItem, quantity }) => (
                      <div key={menuItem.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <VegMarker isVeg={menuItem.isVeg} />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{menuItem.name}</div>
                            <div className="font-mono text-xs text-zinc-500">
                              {formatINR(menuItem.price)} each
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="inline-flex items-center rounded-xl bg-zinc-100 border border-zinc-200">
                            <button
                              type="button"
                              onClick={() => handleDecrementCart(menuItem.id)}
                              className="min-h-[40px] min-w-[34px] flex items-center justify-center"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="font-mono text-xs font-bold px-2">{quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleAddToCart(cartRestaurant, menuItem)}
                              className="min-h-[40px] min-w-[34px] flex items-center justify-center"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <span className="font-mono text-sm font-bold w-16 text-right">
                            {formatINR(menuItem.price * quantity)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fulfillment: Delivery vs Self-Pickup */}
                <div className="rounded-3xl bg-white border border-zinc-200 p-5 sm:p-6 space-y-4">
                  <h3 className="font-display text-base font-bold text-[#0B0B0D]">
                    1. Choose Fulfillment Mode
                  </h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={!cartRestaurant.supportsDelivery}
                      onClick={() => setCheckoutMode('FOOD_DELIVERY')}
                      className={`min-h-[52px] rounded-2xl border p-3 text-left transition-colors disabled:opacity-40 ${
                        checkoutMode === 'FOOD_DELIVERY'
                          ? 'bg-[#FFC700] border-[#0B0B0D] text-[#0B0B0D]'
                          : 'bg-white border-zinc-200 text-zinc-700'
                      }`}
                    >
                      <div className="text-xs font-bold">Food Delivery</div>
                      <div className="text-[11px] mt-0.5">
                        {cartSubtotal >= pricing.freeDeliveryThreshold
                          ? 'Free delivery unlocked'
                          : `Fee ${formatINR(pricing.baseDeliveryFee)}`}
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={!cartRestaurant.supportsSelfPickup}
                      onClick={() => setCheckoutMode('SELF_PICKUP')}
                      className={`min-h-[52px] rounded-2xl border p-3 text-left transition-colors disabled:opacity-40 ${
                        checkoutMode === 'SELF_PICKUP'
                          ? 'bg-[#FFC700] border-[#0B0B0D] text-[#0B0B0D]'
                          : 'bg-white border-zinc-200 text-zinc-700'
                      }`}
                    >
                      <div className="text-xs font-bold">Self-Pickup</div>
                      <div className="text-[11px] mt-0.5">
                        Collect at counter · Fee {formatINR(pricing.selfPickupFee)}
                      </div>
                    </button>
                  </div>

                  {checkoutMode === 'FOOD_DELIVERY' ? (
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                        Delivery Address
                      </label>
                      <input
                        type="text"
                        required
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder="House/Flat No, Street, Area, Landmark"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3 text-xs text-zinc-700">
                        <strong>Pickup Kitchen:</strong> {cartRestaurant.address} (Est. prep {cartRestaurant.prepTimeMins} min)
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                          Pickup Note (Optional)
                        </label>
                        <input
                          type="text"
                          value={pickupInstructions}
                          onChange={(e) => setPickupInstructions(e.target.value)}
                          placeholder="e.g. Arriving in 15 mins, extra napkins"
                          className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC700]"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Honest Payment Section (No Fake Online Payment Gateway) */}
                <div className="rounded-3xl bg-white border border-zinc-200 p-5 sm:p-6 space-y-3">
                  <h3 className="font-display text-base font-bold text-[#0B0B0D]">
                    2. Payment Method (MVP)
                  </h3>
                  <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-4 text-xs text-zinc-800 space-y-1">
                    <div className="font-bold text-sm text-[#0B0B0D]">
                      {checkoutMode === 'FOOD_DELIVERY'
                        ? 'Cash on Delivery (Pay Rider on Arrival)'
                        : 'Pay at Restaurant Counter on Pickup'}
                    </div>
                    <p className="text-zinc-600">
                      Digital/UPI gateway integration is intentionally disabled in this MVP. Payment stays pending until collected at delivery or counter.
                    </p>
                  </div>

                  {/* Bill Summary */}
                  <div className="pt-3 border-t border-zinc-100 space-y-2 text-sm">
                    <div className="flex justify-between text-zinc-600">
                      <span>Item Subtotal</span>
                      <span className="font-mono">{formatINR(cartSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-600">
                      <span>{checkoutMode === 'FOOD_DELIVERY' ? 'Delivery Fee' : 'Self-Pickup Fee'}</span>
                      <span className="font-mono">{formatINR(deliveryFee)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-600">
                      <span>Platform Fee</span>
                      <span className="font-mono">{formatINR(platformFee)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-base text-[#0B0B0D] pt-2 border-t border-zinc-200">
                      <span>Total Due on {checkoutMode === 'FOOD_DELIVERY' ? 'Delivery' : 'Pickup'}</span>
                      <span className="font-mono">{formatINR(cartTotal)}</span>
                    </div>
                  </div>

                  {checkoutError && (
                    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-medium text-red-800">
                      {checkoutError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={checkoutBusy}
                    className="w-full min-h-[48px] rounded-xl bg-[#0B0B0D] text-[#FFC700] font-bold text-sm hover:bg-zinc-900 active:scale-[0.99] transition-all disabled:opacity-50"
                  >
                    {checkoutBusy
                      ? 'Submitting Order...'
                      : `Place ${checkoutMode === 'FOOD_DELIVERY' ? 'Delivery' : 'Self-Pickup'} Order · ${formatINR(cartTotal)}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ORDERS TAB (Honest Milestone Tracking — NO Fake GPS) */}
        {tab === 'ORDERS' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-[#0B0B0D]">
                  Your Orders
                </h1>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Honest order milestone updates (live GPS map telemetry is not enabled in MVP).
                </p>
              </div>
              <button
                type="button"
                onClick={loadOrders}
                className="min-h-[40px] rounded-xl border border-zinc-300 bg-white px-3.5 text-xs font-semibold hover:bg-zinc-50"
              >
                {ordersLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {justPlacedOrderNumber && (
              <div className="rounded-2xl bg-[#FFC700]/25 border border-[#FFC700] px-4 py-3 flex items-center justify-between gap-3 text-xs font-semibold text-[#0B0B0D]">
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-[#FF6B00] shrink-0" />
                  <span>
                    Order <strong>{justPlacedOrderNumber}</strong> placed! Payment remains pending until delivery or counter pickup.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setJustPlacedOrderNumber(null)}
                  className="text-zinc-600 hover:text-[#0B0B0D]"
                >
                  Dismiss
                </button>
              </div>
            )}

            {orders.length === 0 ? (
              <div className="rounded-3xl bg-white border border-zinc-200 p-10 text-center text-sm text-zinc-500">
                No orders yet. Place your first Food Delivery or Self-Pickup order from Home.
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-3xl bg-white border border-zinc-200 p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-zinc-100">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          <span className="font-mono font-bold text-[#0B0B0D]">
                            {order.orderNumber}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {order.serviceType === 'FOOD_DELIVERY' ? 'Food Delivery' : 'Self-Pickup'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatTime(order.createdAt)}</span>
                        </div>
                        <h3 className="font-display text-lg font-bold text-[#0B0B0D] mt-1">
                          {order.restaurantName}
                        </h3>
                      </div>

                      <div className="text-right">
                        <div className="text-xs font-bold text-[#FF6B00]">
                          {order.status.replace(/_/g, ' ')}
                        </div>
                        <div className="font-mono text-base font-bold text-[#0B0B0D] mt-0.5">
                          {formatINR(order.totalAmount)}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {order.paymentMethod === 'CASH_ON_DELIVERY' ? 'Cash on Delivery' : 'Pay at Counter'} · {order.paymentStatus.replace(/_/g, ' ')}
                        </div>
                      </div>
                    </div>

                    {/* Items summary */}
                    <div className="text-xs text-zinc-700 space-y-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span>
                            {item.quantity} × {item.name}
                          </span>
                          <span className="font-mono">{formatINR(item.price * item.quantity)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Delivery / Pickup / Rider Info */}
                    <div className="rounded-2xl bg-zinc-50 border border-zinc-200/80 p-3.5 text-xs space-y-1.5">
                      {order.serviceType === 'FOOD_DELIVERY' ? (
                        <>
                          <div className="flex items-start gap-2 text-zinc-700">
                            <MapPin className="h-4 w-4 text-[#FF6B00] shrink-0 mt-0.5" />
                            <span>
                              <strong>Deliver to:</strong> {order.deliveryAddress}
                            </span>
                          </div>
                          {order.assignedRiderName ? (
                            <div className="text-zinc-700 pl-6">
                              <strong>Assigned Rider:</strong> {order.assignedRiderName} ({order.assignedRiderPhone}) · Plate {order.assignedRiderPlate} · Status: {order.riderJobStatus}
                            </div>
                          ) : (
                            <div className="text-zinc-500 pl-6">
                              Rider assignment pending from dispatch.
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-start gap-2 text-zinc-700">
                          <Store className="h-4 w-4 text-[#FF6B00] shrink-0 mt-0.5" />
                          <span>
                            <strong>Pickup at:</strong> {order.restaurantAddress} — {order.pickupInstructions}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Honest Milestones */}
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-zinc-500">
                        Status Timeline
                      </div>
                      <div className="space-y-1.5">
                        {order.milestones.map((m, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 text-zinc-800">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                              <span>{m.label}</span>
                            </div>
                            <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                              {formatTime(m.timestamp)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PROFILE TAB */}
        {tab === 'PROFILE' && (
          <div className="max-w-xl mx-auto space-y-5">
            <div className="rounded-3xl bg-white border border-zinc-200 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-zinc-100">
                <div>
                  <h1 className="font-display text-xl font-bold text-[#0B0B0D]">
                    Customer Profile
                  </h1>
                  <p className="text-xs text-zinc-500 mt-0.5">{user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Saved Delivery Address
                  </label>
                  <input
                    type="text"
                    value={profileAddress}
                    onChange={(e) => setProfileAddress(e.target.value)}
                    placeholder="Your default delivery address"
                    className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-3.5 text-sm"
                  />
                </div>

                {profileMsg && (
                  <div className="text-xs font-semibold text-emerald-700">{profileMsg}</div>
                )}

                <button
                  type="submit"
                  disabled={profileBusy}
                  className="w-full min-h-[46px] rounded-xl bg-[#0B0B0D] text-sm font-bold text-[#FFC700] hover:bg-zinc-900 disabled:opacity-50"
                >
                  {profileBusy ? 'Saving...' : 'Save Changes'}
                </button>
              </form>
            </div>

            <PWAInstallButton variant="card" />
          </div>
        )}
      </main>

      {/* Mobile Bottom Thumb Navigation Bar (<= 64px, 5 destinations) */}
      <nav
        aria-label="Customer mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-zinc-200 pb-safe"
      >
        <div className="grid grid-cols-5 h-16 items-center">
          {([
            ['HOME', 'Home', Home],
            ['SEARCH', 'Search', Search],
            ['CART', totalCartCount > 0 ? `Cart (${totalCartCount})` : 'Cart', ShoppingBag],
            ['ORDERS', 'Orders', Clock],
            ['PROFILE', 'Profile', User],
          ] as const).map(([key, label, Icon]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  if (key !== 'HOME') setActiveRestaurantId(null);
                }}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-[#FF6B00]' : 'text-zinc-500'
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
                <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
