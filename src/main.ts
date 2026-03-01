/**
 * Radiant Spirit — Pokémon Pack Opening Simulator
 * Main entry point — Auth-gated, production-ready
 */
import './style.css';
import crownZenithData from './data/crown-zenith.json';
import silverTempestData from './data/silver-tempest.json';
import pokemon151Data from './data/pokemon-151.json';
import evolvingSkiesData from './data/evolving-skies.json';
import paldeaEvolvedData from './data/paldea-evolved.json';
import { generatePack, type SetData, type PackCard } from './engine/pack-generator';
import { RARITY_DISPLAY, TYPE_GRADIENTS, isHit, isBigHit, isJackpot } from './engine/rarity-table';
import { createParticles, destroyParticles } from './effects/particles';
import { fetchSetCards, buildLookupMap, preloadImages, clearCache, type CardLookupMap, type CardLookupEntry } from './api/api-client';
import { formatPrice, getMarketPrice, calculatePackValue, getTopPulls, getValueTier, formatPriceDate } from './engine/price-engine';
import { getUser, signOut, onAuthChange, type AuthUser } from './auth';
import { renderAuthModal, bindAuthModalEvents, setModalMode } from './auth-modal';
import { saveCardsToCollection, loadCollection, clearUserCollection, collectionToPackCards } from './collection-sync';

// ─── State ─────────────────────────────────────────
const SETS: Record<string, SetData> = {
  'crown-zenith': crownZenithData as unknown as SetData,
  'silver-tempest': silverTempestData as unknown as SetData,
  'pokemon-151': pokemon151Data as unknown as SetData,
  'evolving-skies': evolvingSkiesData as unknown as SetData,
  'paldea-evolved': paldeaEvolvedData as unknown as SetData,
};

interface AppState {
  activeSetId: string;
  currentPack: PackCard[] | null;
  revealedCount: number;
  isOpening: boolean;
  packsOpened: number;
  totalHits: number;
  // Phase 2
  lookupMap: CardLookupMap | null;
  isLoadingApi: boolean;
  apiProgress: { loaded: number; total: number };
  apiError: string | null;
  showSummary: boolean;
  showInventory: boolean;
  inventory: PackCard[];
  selectedCard: PackCard | null;
  inventoryFilters: {
    type: string;
    rarity: string;
  };
  // Phase 3: Auth
  user: AuthUser | null;
  isAuthLoading: boolean;
  showAuthModal: boolean;
}

const INVENTORY_KEY = 'radiant_spirit_inventory';

function loadInventory(): PackCard[] {
  try {
    const data = localStorage.getItem(INVENTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load inventory', e);
    return [];
  }
}

function saveInventory(): void {
  try {
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(state.inventory));
  } catch (e) {
    console.error('Failed to save inventory', e);
  }
}

const state: AppState = {
  activeSetId: 'crown-zenith',
  currentPack: null,
  revealedCount: 0,
  isOpening: false,
  packsOpened: 0,
  totalHits: 0,
  lookupMap: null,
  isLoadingApi: false,
  apiProgress: { loaded: 0, total: 0 },
  apiError: null,
  showSummary: false,
  showInventory: false,
  inventory: loadInventory(),
  selectedCard: null,
  inventoryFilters: { type: 'All', rarity: 'All' },
  // Auth
  user: null,
  isAuthLoading: true,
  showAuthModal: false,
};

function getActiveSet(): SetData {
  return SETS[state.activeSetId];
}

// ─── API Integration ───────────────────────────────
async function loadApiData(): Promise<void> {
  const set = getActiveSet();
  const apiSetId = set.set.apiSetId;
  if (!apiSetId) {
    console.warn('[App] No apiSetId for this set — using emoji fallback');
    return;
  }

  state.isLoadingApi = true;
  state.apiError = null;
  render();

  try {
    // Fetch main set + gallery set (if exists)
    const allCards = await fetchSetCards(apiSetId, (loaded, total) => {
      state.apiProgress = { loaded, total };
      updateLoadingProgress();
    });

    // If there's a gallery sub-set, fetch that too
    const gallerySetId = set.set.apiGallerySetId;
    if (gallerySetId) {
      try {
        const galleryCards = await fetchSetCards(gallerySetId);
        allCards.push(...galleryCards);
      } catch (err) {
        console.warn('[App] Gallery fetch failed, continuing with main set:', err);
      }
    }

    const map = buildLookupMap(allCards);
    state.lookupMap = map;

    // Re-enrich any inventory cards from this set
    reEnrichInventory();

    // Preload small images for the most common cards
    const entries = Array.from(map.values()).slice(0, 50);
    preloadImages(entries);

    console.log(`[App] Loaded ${map.size} card entries for ${apiSetId}`);
  } catch (err) {
    console.error('[App] API load failed:', err);
    state.apiError = 'Card images unavailable — using placeholders';
  } finally {
    state.isLoadingApi = false;
    render();
  }
}

/** Re-enrich existing inventory cards with latest API lookup data */
function reEnrichInventory(): void {
  if (!state.lookupMap || state.inventory.length === 0) return;
  let updated = 0;
  for (const card of state.inventory) {
    const compositeKey = `${card.name.toLowerCase()}|${card.number}`;
    const lookup = state.lookupMap.get(compositeKey)
      || findFuzzyMatch(card);
    if (lookup) {
      const oldImg = card.imageSmall;
      card.imageSmall = lookup.imageSmall;
      card.imageLarge = lookup.imageLarge;
      card.marketPrice = getMarketPrice(card, lookup);
      card.priceVariant = lookup.priceVariant;
      card.tcgplayerUrl = lookup.tcgplayerUrl;
      card.priceUpdatedAt = lookup.priceUpdatedAt;
      if (oldImg !== lookup.imageSmall) updated++;
    }
  }
  if (updated > 0) {
    saveInventory();
    console.log(`[App] Re-enriched ${updated} inventory cards with fresh images`);
  }
}

function updateLoadingProgress(): void {
  const el = document.getElementById('api-progress');
  if (el && state.apiProgress.total > 0) {
    const pct = Math.round((state.apiProgress.loaded / state.apiProgress.total) * 100);
    el.textContent = `Loading cards... ${state.apiProgress.loaded}/${state.apiProgress.total} (${pct}%)`;
    const bar = document.getElementById('api-progress-bar') as HTMLElement;
    if (bar) bar.style.width = `${pct}%`;
  }
}

/** Enrich a pack with API data (images + prices) */
function enrichPack(pack: PackCard[]): void {
  if (!state.lookupMap) return;
  for (const card of pack) {
    // Try composite key first (name+number), then number, then fuzzy name
    const compositeKey = `${card.name.toLowerCase()}|${card.number}`;
    const lookup = state.lookupMap.get(compositeKey)
      || findFuzzyMatch(card);
    if (lookup) {
      card.imageSmall = lookup.imageSmall;
      card.imageLarge = lookup.imageLarge;
      card.marketPrice = getMarketPrice(card, lookup);
      card.priceVariant = lookup.priceVariant;
      card.tcgplayerUrl = lookup.tcgplayerUrl;
      card.priceUpdatedAt = lookup.priceUpdatedAt;
    }
  }
}

/** Fuzzy match fallback: try matching by name, prefer same rarity.
 *  Logs a warning when used so mismatches can be caught. */
function findFuzzyMatch(card: PackCard): CardLookupEntry | undefined {
  if (!state.lookupMap) return undefined;
  let bestMatch: CardLookupEntry | undefined;
  for (const entry of state.lookupMap.values()) {
    if (entry.name.toLowerCase() === card.name.toLowerCase()) {
      if (!bestMatch) bestMatch = entry;
      // Prefer a match where the rarity also aligns
      if (entry.rarity?.toLowerCase().includes(card.rarity.replace('_', ' '))) {
        console.warn(`[Match] Fuzzy match used for "${card.name}" #${card.number} → API #${entry.number}`);
        return entry;
      }
    }
  }
  if (bestMatch) {
    console.warn(`[Match] Fuzzy match (name only) for "${card.name}" #${card.number} → API #${bestMatch.number}`);
  }
  return bestMatch;
}

// ─── Render ────────────────────────────────────────
function render(): void {
  const app = document.getElementById('app')!;

  // Show auth loading spinner
  if (state.isAuthLoading) {
    app.innerHTML = `
      <div class="landing-page">
        <div class="landing-loader">
          <div class="landing-logo-icon">✦</div>
          <div class="api-loading-spinner"></div>
        </div>
      </div>
    `;
    return;
  }

  // Show landing page if not authenticated
  if (!state.user) {
    app.innerHTML = `
      ${renderLanding()}
      ${renderAuthModal(state.showAuthModal)}
    `;
    bindLandingEvents();
    return;
  }

  // Authenticated — show the full app
  const set = getActiveSet();

  app.innerHTML = `
    <header class="app-header">
      <div class="app-logo">✦ RADIANT SPIRIT</div>
      <div class="header-actions">
        <button class="open-btn small-btn" id="MyCollectionBtn">My Collection</button>
        <div class="set-selector">
          <label for="set-select">Expansion</label>
          <select id="set-select">
            ${Object.entries(SETS).map(([id, s]) =>
    `<option value="${id}" ${id === state.activeSetId ? 'selected' : ''}>${s.set.name}</option>`
  ).join('')}
          </select>
        </div>
        <div class="auth-header-user">
          <span class="auth-avatar">👤</span>
          <span class="auth-name">${state.user.displayName}</span>
          <button class="auth-signout-btn" id="signout-btn">Sign Out</button>
        </div>
      </div>
    </header>

    <main class="stage">
      ${state.isLoadingApi ? renderLoading() : ''}
      ${state.apiError ? `<div class="api-error">${state.apiError}</div>` : ''}
      ${state.showInventory ? renderInventory() :
      state.showSummary && state.currentPack ? renderPackSummary() :
        state.currentPack ? renderRevealArea() : renderPackSelect(set)}
    </main>

    <footer class="stats-banner">
      <span>Packs Opened: <span class="stat-value">${state.packsOpened}</span></span>
      <span>Hits: <span class="stat-value">${state.totalHits}</span></span>
      <span>Hit Rate: <span class="stat-value">${state.packsOpened > 0 ? Math.round((state.totalHits / state.packsOpened) * 100) : 0}%</span></span>
    </footer>

    <div class="screen-flash" id="screen-flash"></div>
    ${renderModal()}
    ${renderAuthModal(state.showAuthModal)}
  `;

  bindEvents();
  bindAuthEvents();
}

// ─── Landing Page ──────────────────────────────────
function renderLanding(): string {
  return `
    <div class="landing-page">
      <div class="landing-bg-glow"></div>
      <div class="landing-content">
        <div class="landing-logo">
          <span class="landing-logo-icon">✦</span>
          <h1 class="landing-title">RADIANT SPIRIT</h1>
        </div>
        <p class="landing-tagline">Open virtual Pokémon booster packs. Build your collection. Track market values.</p>
        <div class="landing-features">
          <div class="landing-feature">
            <span class="landing-feature-icon">🎴</span>
            <span>HD card art from every expansion</span>
          </div>
          <div class="landing-feature">
            <span class="landing-feature-icon">💰</span>
            <span>Live TCGPlayer market prices</span>
          </div>
          <div class="landing-feature">
            <span class="landing-feature-icon">📦</span>
            <span>Persistent cloud collection</span>
          </div>
        </div>
        <div class="landing-actions">
          <button class="landing-cta-primary" id="landing-signup-btn">Create Free Account</button>
          <button class="landing-cta-secondary" id="landing-signin-btn">Sign In</button>
        </div>
        <p class="landing-legal">Free to play · No credit card required</p>
      </div>
    </div>
  `;
}

function bindLandingEvents(): void {
  document.getElementById('landing-signup-btn')?.addEventListener('click', () => {
    setModalMode('signup');
    state.showAuthModal = true;
    render();
  });

  document.getElementById('landing-signin-btn')?.addEventListener('click', () => {
    setModalMode('signin');
    state.showAuthModal = true;
    render();
  });

  // Bind auth modal events if modal is open
  if (state.showAuthModal) {
    bindAuthModalEvents(
      (user) => {
        state.user = user;
        state.showAuthModal = false;
        loadCloudCollection();
        loadAllSetsApiData();
        render();
      },
      () => {
        render();
      }
    );
  }
}

function renderLoading(): string {
  return `
    <div class="api-loading">
      <div class="api-loading-spinner"></div>
      <div class="api-loading-text" id="api-progress">Loading card data...</div>
      <div class="api-progress-track">
        <div class="api-progress-bar" id="api-progress-bar"></div>
      </div>
    </div>
  `;
}

function renderPackSelect(set: SetData): string {
  return `
    <h1 class="set-title">${set.set.name}</h1>
    <p class="set-subtitle">${set.set.series} · ${set.set.totalCards} Cards</p>
    <div class="pack-container" id="pack-container">
      <div class="pack-wrapper">
        <span class="pack-icon">🎴</span>
        <span class="pack-set-name">${set.set.name}</span>
        <span class="pack-label">Booster Pack</span>
      </div>
    </div>
    <button class="open-btn" id="open-btn" ${state.isLoadingApi ? 'disabled' : ''}>Open Pack</button>
  `;
}

function renderRevealArea(): string {
  const pack = state.currentPack!;
  const allRevealed = state.revealedCount >= pack.length;

  if (allRevealed) {
    return `
      <h1 class="set-title">Your Pulls</h1>
      <p class="set-subtitle">${getActiveSet().set.name} · Pack #${state.packsOpened}</p>
      <div class="reveal-area">
        ${pack.map((card, i) => renderCardSlot(card, i, true, 'pack')).join('')}
      </div>
      <div class="post-reveal-actions">
        <button class="open-btn summary-btn" id="view-summary-btn">📊 Pack Summary</button>
        <button class="open-btn" id="open-another-btn">Open Another Pack</button>
      </div>
    `;
  }

  return `
    <h1 class="set-title">Tap to Reveal</h1>
    <p class="set-subtitle">Card ${state.revealedCount + 1} of ${pack.length}</p>
    <div class="reveal-area">
      ${pack.map((card, i) => renderCardSlot(card, i, i < state.revealedCount, 'pack')).join('')}
    </div>
  `;
}

function renderCardSlot(card: PackCard, index: number, isRevealed: boolean, source: 'pack' | 'inventory' = 'pack', count: number = 1): string {
  const rarityInfo = RARITY_DISPLAY[card.rarity] || RARITY_DISPLAY.common;
  const gradient = TYPE_GRADIENTS[card.type] || TYPE_GRADIENTS.Normal;
  const isNext = index === state.revealedCount && !isRevealed;
  const hasImage = !!card.imageSmall;
  const valueTier = getValueTier(card.marketPrice ?? null);

  return `
    <div class="card-slot ${isRevealed ? 'revealed' : ''} ${isNext ? 'next-card' : ''}"
         data-index="${index}"
         data-source="${source}"
         data-rarity="${card.rarity}"
         id="card-slot-${index}">
      <div class="card-inner">
        <div class="card-back">
          <div class="card-back-pattern">🎴</div>
        </div>
        <div class="card-front">
          <div class="card-image-area">
            <div class="card-type-bg" style="background: ${gradient};"></div>
            ${hasImage
      ? `<img class="card-image" src="${card.imageSmall}" alt="${card.name}" loading="lazy" />`
      : `<span class="pokemon-emoji">${card.emoji}</span>`}
            ${card.isReverseHolo ? '<div class="reverse-holo-overlay"></div>' : ''}
          </div>
          <div class="card-info">
            <div class="card-name">${card.name}</div>
            <div class="card-rarity-label ${card.rarity}">
              ${card.isReverseHolo ? '◆ Reverse Holo' : card.isGallery ? '★ Gallery' : rarityInfo.label}
              ${card.number ? ` · #${card.number}` : ''}
            </div>
          </div>
          ${isRevealed && card.marketPrice !== undefined && card.marketPrice !== null
      ? `<div class="price-badge ${valueTier}">${formatPrice(card.marketPrice)}</div>`
      : ''}
          ${count > 1 ? `<div class="duplicate-badge">x${count}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ─── Inventory ─────────────────────────────────────
function renderInventory(): string {
  if (state.inventory.length === 0) {
    return `
      <div class="inventory-empty">
        <h1 class="set-title">My Collection</h1>
        <p class="set-subtitle">You haven't opened any packs yet!</p>
        <button class="open-btn" id="InventoryBackBtn" style="margin-top:2rem">Back to Pack Select</button>
      </div>
    `;
  }

  const types = ['All', ...Array.from(new Set(state.inventory.map(c => c.type)))].sort();
  const rarities = ['All', ...Array.from(new Set(state.inventory.map(c => c.rarity)))];

  let filteredInventory = state.inventory;
  if (state.inventoryFilters.type !== 'All') {
    filteredInventory = filteredInventory.filter(c => c.type === state.inventoryFilters.type);
  }
  if (state.inventoryFilters.rarity !== 'All') {
    filteredInventory = filteredInventory.filter(c => c.rarity === state.inventoryFilters.rarity);
  }

  // Sort inventory by value DESC
  const totalValue = filteredInventory.reduce((sum, card) => sum + (card.marketPrice ?? 0), 0);

  const grouped = new Map<string, { card: PackCard; count: number }>();
  for (const card of filteredInventory) {
    const key = `${card.number}-${card.name}`;
    if (grouped.has(key)) {
      grouped.get(key)!.count++;
    } else {
      grouped.set(key, { card, count: 1 });
    }
  }

  const invSorted = Array.from(grouped.values()).sort((a, b) => (b.card.marketPrice ?? 0) - (a.card.marketPrice ?? 0));

  return `
    <div class="inventory-view">
      <h1 class="set-title">My Collection</h1>
      <p class="set-subtitle">Filtered Cards: ${filteredInventory.length} (Total: ${state.inventory.length}) · Display Value: ${formatPrice(totalValue)}</p>
      
      <div class="inventory-controls" style="display: flex; gap: 1rem; align-items: center; justify-content: center; margin: 1rem 0;">
        <div class="set-selector">
          <label for="filter-type">Type</label>
          <select id="filter-type">
            ${types.map(t => `<option value="${t}" ${t === state.inventoryFilters.type ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="set-selector">
          <label for="filter-rarity">Rarity</label>
          <select id="filter-rarity">
            ${rarities.map(r => `<option value="${r}" ${r === state.inventoryFilters.rarity ? 'selected' : ''}>${r === 'All' ? 'All' : (RARITY_DISPLAY[r]?.label || r)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="post-reveal-actions" style="margin-bottom: 2rem;">
         <button class="open-btn secondary-btn" id="InventoryBackBtn">← Back</button>
         <button class="open-btn secondary-btn" id="InventoryClearBtn" style="background:var(--accent-red);color:white">Clear Collection</button>
      </div>

      ${invSorted.length > 0 ? `
      <div class="collection-tray">
        ${invSorted.map((item, i) => renderCardSlot(item.card, i, true, 'inventory', item.count)).join('')}
      </div>
      ` : `
      <p style="text-align:center; color: var(--text-muted); margin-top: 2rem;">No cards match the selected filters.</p>
      `}
    </div>
  `;
}

// ─── Pack Summary ──────────────────────────────────
function renderPackSummary(): string {
  const pack = state.currentPack!;
  const totalValue = calculatePackValue(pack);
  const topPulls = getTopPulls(pack, 3);
  const allByPrice = [...pack].sort((a, b) => (b.marketPrice ?? 0) - (a.marketPrice ?? 0));
  const priceDate = pack.find(c => c.priceUpdatedAt)?.priceUpdatedAt || null;
  const hasPrices = pack.some(c => c.marketPrice !== null && c.marketPrice !== undefined);

  return `
    <div class="pack-summary">
      <h1 class="set-title">Pack Summary</h1>
      <p class="set-subtitle">${getActiveSet().set.name} · Pack #${state.packsOpened}</p>

      ${hasPrices ? `
      <div class="summary-total-value">
        <span class="total-label">PACK VALUE</span>
        <span class="total-price">${formatPrice(totalValue)}</span>
      </div>

      ${topPulls.length > 0 ? `
      <div class="summary-section">
        <h2 class="summary-heading">🏆 TOP PULLS</h2>
        <div class="top-pulls-row">
          ${topPulls.map(card => `
            <div class="top-pull-card">
              ${card.imageSmall
      ? `<img class="top-pull-img" src="${card.imageSmall}" alt="${card.name}" />`
      : `<div class="top-pull-emoji">${card.emoji}</div>`}
              <div class="top-pull-price ${getValueTier(card.marketPrice ?? null)}">${formatPrice(card.marketPrice)}</div>
              <div class="top-pull-name">${card.name}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <div class="summary-section">
        <h2 class="summary-heading">📊 BREAKDOWN</h2>
        <div class="price-breakdown">
          ${allByPrice.map(card => `
            <div class="breakdown-row">
              <span class="breakdown-name">
                <span class="breakdown-rarity-dot ${card.rarity}"></span>
                ${card.name}
              </span>
              <span class="breakdown-dots"></span>
              <span class="breakdown-price">${formatPrice(card.marketPrice)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="summary-source">
        Source: TCGPlayer · Updated ${formatPriceDate(priceDate)}
      </div>
      ` : `
      <div class="summary-no-prices">
        <p>Price data unavailable for this pack.</p>
      </div>
      `}

      <div class="post-reveal-actions">
        <button class="open-btn secondary-btn" id="back-to-pulls-btn">← Back to Pulls</button>
        <button class="open-btn" id="open-another-btn">Open Another Pack</button>
      </div>
    </div>
  `;
}

// ─── Events ────────────────────────────────────────
function bindEvents(): void {
  const setSelect = document.getElementById('set-select') as HTMLSelectElement;
  setSelect?.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    state.activeSetId = target.value;
    state.currentPack = null;
    state.revealedCount = 0;
    state.isOpening = false;
    state.lookupMap = null;
    state.showSummary = false;
    render();
    loadApiData();
  });

  const openBtn = document.getElementById('open-btn');
  openBtn?.addEventListener('click', openPack);

  const openAnotherBtn = document.getElementById('open-another-btn');
  openAnotherBtn?.addEventListener('click', () => {
    destroyParticles();
    state.currentPack = null;
    state.revealedCount = 0;
    state.isOpening = false;
    state.showSummary = false;
    render();
  });

  const viewSummaryBtn = document.getElementById('view-summary-btn');
  viewSummaryBtn?.addEventListener('click', () => {
    state.showSummary = true;
    render();
  });

  const backToPullsBtn = document.getElementById('back-to-pulls-btn');
  backToPullsBtn?.addEventListener('click', () => {
    state.showSummary = false;
    render();
  });

  const myCollectionBtn = document.getElementById('MyCollectionBtn');
  myCollectionBtn?.addEventListener('click', () => {
    state.showInventory = true;
    render();
  });

  const invBackBtn = document.getElementById('InventoryBackBtn');
  invBackBtn?.addEventListener('click', () => {
    state.showInventory = false;
    render();
  });

  const invClearBtn = document.getElementById('InventoryClearBtn');
  invClearBtn?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear your entire collection? This cannot be undone.')) {
      state.inventory = [];
      saveInventory();
      // Also clear from Supabase
      if (state.user) {
        const { error } = await clearUserCollection(state.user.id);
        if (error) console.warn('[Sync] Failed to clear cloud collection:', error);
        else console.log('[Sync] Cloud collection cleared');
      }
      render();
    }
  });

  const filterType = document.getElementById('filter-type') as HTMLSelectElement;
  filterType?.addEventListener('change', (e) => {
    state.inventoryFilters.type = (e.target as HTMLSelectElement).value;
    render();
  });

  const filterRarity = document.getElementById('filter-rarity') as HTMLSelectElement;
  filterRarity?.addEventListener('change', (e) => {
    state.inventoryFilters.rarity = (e.target as HTMLSelectElement).value;
    render();
  });

  // Card click to reveal
  if (state.currentPack && state.revealedCount < state.currentPack.length) {
    const nextSlot = document.getElementById(`card-slot-${state.revealedCount}`);
    nextSlot?.addEventListener('click', revealNextCard);

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        revealNextCard();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  // Modal events
  document.getElementById('modal-close')?.addEventListener('click', () => {
    state.selectedCard = null;
    render();
  });

  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      state.selectedCard = null;
      render();
    }
  });

  document.querySelectorAll('.card-slot.revealed').forEach(el => {
    el.addEventListener('click', () => {
      const source = el.getAttribute('data-source');
      const idx = parseInt(el.getAttribute('data-index') || '0', 10);
      if (source === 'inventory') {
        let filteredInventory = state.inventory;
        if (state.inventoryFilters.type !== 'All') {
          filteredInventory = filteredInventory.filter(c => c.type === state.inventoryFilters.type);
        }
        if (state.inventoryFilters.rarity !== 'All') {
          filteredInventory = filteredInventory.filter(c => c.rarity === state.inventoryFilters.rarity);
        }

        const grouped = new Map<string, { card: PackCard; count: number }>();
        for (const card of filteredInventory) {
          const key = `${card.number}-${card.name}`;
          if (grouped.has(key)) {
            grouped.get(key)!.count++;
          } else {
            grouped.set(key, { card, count: 1 });
          }
        }
        const invSorted = Array.from(grouped.values()).sort((a, b) => (b.card.marketPrice ?? 0) - (a.card.marketPrice ?? 0));
        state.selectedCard = invSorted[idx]?.card || null;
      } else {
        state.selectedCard = state.currentPack?.[idx] || null;
      }
      render();
    });
  });

  // Pack hover tilt
  const packContainer = document.getElementById('pack-container');
  if (packContainer) {
    packContainer.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = packContainer.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      const wrapper = packContainer.querySelector('.pack-wrapper') as HTMLElement;
      if (wrapper) {
        wrapper.style.transform = `perspective(600px) rotateY(${x * 15}deg) rotateX(${-y * 15}deg)`;
      }
    });
    packContainer.addEventListener('mouseleave', () => {
      const wrapper = packContainer.querySelector('.pack-wrapper') as HTMLElement;
      if (wrapper) {
        wrapper.style.transform = '';
      }
    });
  }
}

function openPack(): void {
  if (state.isOpening || state.isLoadingApi) return;
  state.isOpening = true;
  state.showSummary = false;

  const setData = getActiveSet();
  state.currentPack = generatePack(setData);
  state.revealedCount = 0;
  state.packsOpened++;

  // Sort pack: energy first → commons → uncommons → rare+ last (drama!)
  state.currentPack.sort((a, b) => {
    const tierA = RARITY_DISPLAY[a.rarity]?.tier ?? 0;
    const tierB = RARITY_DISPLAY[b.rarity]?.tier ?? 0;
    return tierA - tierB;
  });

  // Re-assign slot indices after sort
  state.currentPack.forEach((card, i) => {
    card.slotIndex = i;
  });

  // Enrich with API data
  enrichPack(state.currentPack);

  // Preload images for this pack
  if (state.lookupMap) {
    const packEntries = state.currentPack
      .map(c => state.lookupMap!.get(`${c.name.toLowerCase()}|${c.number}`))
      .filter((e): e is CardLookupEntry => !!e);
    preloadImages(packEntries);
  }

  // Add all to inventory (localStorage cache + Supabase primary)
  state.inventory.push(...state.currentPack);
  saveInventory();

  // Always persist to Supabase (user is guaranteed to exist)
  saveCardsToCollection(state.user!.id, state.currentPack, state.activeSetId)
    .then(result => {
      if (result.error) console.warn('[Sync] Failed to save to Supabase:', result.error);
      else console.log('[Sync] Pack saved to Supabase');
    });

  render();
}

function revealNextCard(): void {
  if (!state.currentPack || state.revealedCount >= state.currentPack.length) return;

  const card = state.currentPack[state.revealedCount];
  const slot = document.getElementById(`card-slot-${state.revealedCount}`);

  if (slot) {
    slot.classList.add('revealed');

    // Add price badge dynamically
    if (card.marketPrice !== undefined && card.marketPrice !== null) {
      const front = slot.querySelector('.card-front');
      if (front && !front.querySelector('.price-badge')) {
        const badge = document.createElement('div');
        badge.className = `price-badge ${getValueTier(card.marketPrice)}`;
        badge.textContent = formatPrice(card.marketPrice);
        front.appendChild(badge);
      }
    }

    if (isHit(card.rarity)) {
      state.totalHits++;
      triggerHitEffects(card, slot);
    }
  }

  state.revealedCount++;

  setTimeout(() => {
    if (state.revealedCount < state.currentPack!.length) {
      const nextSlot = document.getElementById(`card-slot-${state.revealedCount}`);
      nextSlot?.addEventListener('click', revealNextCard);

      const keyHandler = (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          revealNextCard();
          document.removeEventListener('keydown', keyHandler);
        }
      };
      document.addEventListener('keydown', keyHandler);
    } else {
      setTimeout(() => render(), 600);
    }
  }, 100);
}

function triggerHitEffects(card: PackCard, slot: HTMLElement): void {
  const rect = slot.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  if (isBigHit(card.rarity)) {
    createParticles(centerX, centerY, 'intense');
    triggerScreenShake(isJackpot(card.rarity) ? 'heavy' : 'light');
    triggerScreenFlash();
  } else if (isHit(card.rarity)) {
    createParticles(centerX, centerY, 'subtle');
  }
}

function triggerScreenShake(intensity: 'light' | 'heavy'): void {
  const app = document.getElementById('app')!;
  const amount = intensity === 'heavy' ? 8 : 3;
  const duration = intensity === 'heavy' ? 500 : 300;

  const start = performance.now();
  function shake(time: number) {
    const elapsed = time - start;
    if (elapsed > duration) {
      app.style.transform = '';
      return;
    }
    const progress = 1 - elapsed / duration;
    const x = (Math.random() - 0.5) * amount * 2 * progress;
    const y = (Math.random() - 0.5) * amount * 2 * progress;
    app.style.transform = `translate(${x}px, ${y}px)`;
    requestAnimationFrame(shake);
  }
  requestAnimationFrame(shake);
}

function triggerScreenFlash(): void {
  const flash = document.getElementById('screen-flash');
  if (!flash) return;
  flash.style.opacity = '0.6';
  flash.style.transition = 'opacity 0.1s';
  setTimeout(() => {
    flash.style.transition = 'opacity 0.5s';
    flash.style.opacity = '0';
  }, 100);
}

// ─── Debug API ─────────────────────────────────────
(window as any).__debug = {
  generatePack: () => generatePack(getActiveSet()),
  state,
  sets: SETS,
  clearLookup: () => { state.lookupMap = null; },
};

// ─── Modal ─────────────────────────────────────────
function renderModal(): string {
  if (!state.selectedCard) return '';
  const card = state.selectedCard;
  const image = card.imageLarge || card.imageSmall;

  return `
    <div class="modal-overlay" id="modal-overlay">
      <div class="card-modal">
        <button class="modal-close" id="modal-close">×</button>
        ${image
      ? `<img src="${image}" alt="${card.name}" class="modal-image" />`
      : `<div class="modal-emoji">${card.emoji}</div>`}
        <div class="modal-details">
          <h2>${card.name}</h2>
          <div class="modal-rarity ${card.rarity}">${card.rarity.replace(/_/g, ' ')} ${card.isGallery ? '(Gallery)' : ''}</div>
          <div class="modal-set">Set: ${getActiveSet().set.name} · #${card.number}</div>
          <div class="modal-price-box">
            <span class="modal-price-label">Market Value</span>
            <span class="modal-price-value ${getValueTier(card.marketPrice ?? null)}">${formatPrice(card.marketPrice)}</span>
          </div>
          ${card.tcgplayerUrl ? `<a href="${card.tcgplayerUrl}" target="_blank" rel="noopener noreferrer" class="tcg-link">View on TCGPlayer →</a>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ─── Auth Events ───────────────────────────────────
function bindAuthEvents(): void {
  const signoutBtn = document.getElementById('signout-btn');
  signoutBtn?.addEventListener('click', async () => {
    await signOut();
    state.user = null;
    // Clear local state — user must log in again
    state.inventory = [];
    state.currentPack = null;
    state.revealedCount = 0;
    state.showSummary = false;
    state.showInventory = false;
    state.packsOpened = 0;
    state.totalHits = 0;
    state.lookupMap = null;
    saveInventory();
    render();
  });

  if (state.showAuthModal) {
    bindAuthModalEvents(
      (user) => {
        state.user = user;
        state.showAuthModal = false;
        // Load cloud collection and API data
        loadCloudCollection();
        loadAllSetsApiData();
        render();
      },
      () => {
        // Re-render to update modal state (errors, mode toggle)
        render();
      }
    );
  }
}

async function loadCloudCollection(): Promise<void> {
  if (!state.user) return;
  const { cards, error } = await loadCollection(state.user.id);
  if (error) {
    console.warn('[Sync] Failed to load cloud collection:', error);
    return;
  }
  if (cards.length > 0) {
    // Merge cloud collection into local state
    const cloudCards = collectionToPackCards(cards);
    state.inventory = cloudCards;
    saveInventory();
    console.log(`[Sync] Loaded ${cards.length} cards from cloud`);
    render();
  }
}

// ─── Init ──────────────────────────────────────────
// Clear stale cache to force fresh composite-key lookups
clearCache();
render();

// Check auth state
async function initAuth(): Promise<void> {
  const user = await getUser();
  state.user = user;
  state.isAuthLoading = false;
  render();

  if (user) {
    await loadCloudCollection();
    await loadAllSetsApiData();
  }

  // Listen for auth changes (e.g., token refresh)
  onAuthChange((updatedUser) => {
    const wasLoggedOut = !state.user;
    state.user = updatedUser;
    render();
    // If user just logged in via onAuthStateChange, load their data
    if (wasLoggedOut && updatedUser) {
      loadCloudCollection();
      loadAllSetsApiData();
    }
  });
}

initAuth();

// Load API data for ALL sets so inventory cards across expansions get correct images
async function loadAllSetsApiData(): Promise<void> {
  // Load active set first (user sees it immediately)
  await loadApiData();

  // Then load remaining sets in background for inventory re-enrichment
  const otherSetIds = Object.keys(SETS).filter(id => id !== state.activeSetId);
  for (const setId of otherSetIds) {
    const set = SETS[setId];
    const apiSetId = set.set.apiSetId;
    if (!apiSetId) continue;

    try {
      const allCards = await fetchSetCards(apiSetId);
      const gallerySetId = set.set.apiGallerySetId;
      if (gallerySetId) {
        try {
          const galleryCards = await fetchSetCards(gallerySetId);
          allCards.push(...galleryCards);
        } catch { /* gallery fetch optional */ }
      }
      // Build temporary lookup and re-enrich inventory from it
      const map = buildLookupMap(allCards);
      const prevMap = state.lookupMap;
      state.lookupMap = map;
      reEnrichInventory();
      state.lookupMap = prevMap; // Restore active set's map
    } catch (err) {
      console.warn(`[Init] Failed to load ${setId} for inventory enrichment:`, err);
    }
  }
}
