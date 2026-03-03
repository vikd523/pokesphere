/**
 * Pack Generator — Generates a realistic 10-card booster pack.
 *
 * Pack structure:
 *   Slots 1-4: Common
 *   Slots 5-7: Uncommon
 *   Slot 8:    Rare+ (weighted random)
 *   Slot 9:    Reverse Holo (any rarity) OR Gallery card
 *   Slot 10:   Basic Energy
 */

export interface CardData {
    number: string;
    name: string;
    type: string;
    emoji: string;
    // Pre-baked image URLs (from imageMap in custom set JSON)
    imageSmall?: string;
    imageLarge?: string;
}

export interface PackCard extends CardData {
    rarity: string;
    isReverseHolo: boolean;
    isGallery: boolean;
    slotIndex: number;
    // Phase 2: API-enriched fields
    imageSmall?: string;
    imageLarge?: string;
    marketPrice?: number | null;
    priceVariant?: string;
    tcgplayerUrl?: string | null;
    priceUpdatedAt?: string | null;
    setId?: string;
}

export interface SetData {
    set: {
        id: string;
        name: string;
        series: string;
        releaseDate: string;
        totalCards: number;
        apiSetId?: string;
        apiGallerySetId?: string;
        tcgGroupId?: number;
    };
    rarityWeights: Record<string, number>;
    reverseHoloGalleryChance: number;
    cards: Record<string, CardData[]>;
}

/** Weighted random selection from a probability table */
function weightedPick(weights: Record<string, number>): string {
    const r = Math.random();
    let cumulative = 0;
    for (const [key, weight] of Object.entries(weights)) {
        cumulative += weight;
        if (r <= cumulative) return key;
    }
    // Fallback (shouldn't reach here if weights sum to ~1.0)
    return Object.keys(weights)[0];
}

/** Pick N unique random cards from an array */
function sampleUnique(pool: CardData[], count: number): CardData[] {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Pick a single random card from an array */
function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a 10-card pack from the given set data.
 */
export function generatePack(setData: SetData): PackCard[] {
    const pack: PackCard[] = [];
    const { cards, rarityWeights, reverseHoloGalleryChance } = setData;

    // Slots 1-4: Commons
    const commons = sampleUnique(cards.common || [], 4);
    commons.forEach((card, i) => {
        pack.push({
            ...card,
            rarity: 'common',
            isReverseHolo: false,
            isGallery: false,
            slotIndex: i,
        });
    });

    // Slots 5-7: Uncommons
    const uncommons = sampleUnique(cards.uncommon || [], 3);
    uncommons.forEach((card, i) => {
        pack.push({
            ...card,
            rarity: 'uncommon',
            isReverseHolo: false,
            isGallery: false,
            slotIndex: 4 + i,
        });
    });

    // Slot 8: Rare+ (weighted roll)
    const rolledRarity = weightedPick(rarityWeights);
    const rarePool = cards[rolledRarity] || cards.rare || [];
    const rareCard = pickRandom(rarePool);
    pack.push({
        ...rareCard,
        rarity: rolledRarity,
        isReverseHolo: false,
        isGallery: false,
        slotIndex: 7,
    });

    // Slot 9: Reverse Holo OR Gallery card
    const isGalleryPull = Math.random() < reverseHoloGalleryChance && cards.gallery && cards.gallery.length > 0;

    if (isGalleryPull) {
        const galleryCard = pickRandom(cards.gallery);
        pack.push({
            ...galleryCard,
            rarity: 'gallery',
            isReverseHolo: false,
            isGallery: true,
            slotIndex: 8,
        });
    } else {
        // Reverse holo — pick from any rarity pool (common/uncommon/rare)
        const reversePool = [
            ...(cards.common || []),
            ...(cards.uncommon || []),
            ...(cards.rare || []),
        ];
        const reverseCard = pickRandom(reversePool);

        pack.push({
            ...reverseCard,
            rarity: 'reverse_holo',
            isReverseHolo: true,
            isGallery: false,
            slotIndex: 8,
        });
    }

    // Slot 10: Basic Energy
    const energyCard = pickRandom(cards.energy || []);
    pack.push({
        ...energyCard,
        rarity: 'energy',
        isReverseHolo: false,
        isGallery: false,
        slotIndex: 9,
    });

    return pack;
}
