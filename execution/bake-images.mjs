/**
 * bake-images.mjs — Pre-bake Pokémon TCG card image URLs into custom set JSON files.
 *
 * Uses GitHub raw data from PokemonTCG/pokemon-tcg-data (no rate limits!)
 * to find card images for every unique name in our custom sets.
 *
 * Usage: node execution/bake-images.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');

const GITHUB_BASE = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en';

const CUSTOM_SETS = [
    'mega-evolution.json',
    'phantasmal-flames.json',
    'ascended-heroes.json',
];

// Real TCG sets to scan for card images (modern sets with HD art, ordered by preference)
const SOURCE_SETS = [
    // Scarlet & Violet era (best quality images)
    'sv8', 'sv7', 'sv6pt5', 'sv6', 'sv5', 'sv4pt5', 'sv4', 'sv3pt5', 'sv3', 'sv2', 'sv1',
    // Sword & Shield era
    'swsh12pt5', 'swsh12', 'swsh11', 'swsh10', 'swsh9', 'swsh8', 'swsh7', 'swsh6', 'swsh5',
    'swsh4', 'swsh3', 'swsh2', 'swsh1',
    // Sun & Moon era
    'sm12', 'sm11', 'sm10', 'sm9', 'sm8', 'sm7', 'sm6', 'sm5', 'sm4', 'sm3', 'sm2', 'sm1',
    // XY era (for Mega evolutions)
    'xy12', 'xy11', 'xy10', 'xy9', 'xy8', 'xy7', 'xy6', 'xy5', 'xy4', 'xy3', 'xy2', 'xy1',
    // Pokémon GO, Celebrations, etc.
    'pgo', 'cel25',
    // Base set (classics)
    'base1', 'base2', 'base3',
];

/** Strip variant suffixes to get the base Pokémon name */
function toBaseName(name) {
    return name
        .replace(/^Mega /i, '')
        .replace(/ ex$/i, '')
        .replace(/ EX$/i, '')
        .replace(/ V$/i, '')
        .replace(/ VMAX$/i, '')
        .replace(/ VSTAR$/i, '')
        .replace(/ GX$/i, '')
        .trim();
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/** Fetch all card data for a set from GitHub */
async function fetchSetData(setId) {
    const url = `${GITHUB_BASE}/${setId}.json`;
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    }
}

async function main() {
    console.log('🎴 Pokémon TCG Image Baker (GitHub Source)');
    console.log('════════════════════════════════════════');

    // Step 1: Collect all unique card names we need across all custom sets
    const allNeededNames = new Set();
    const setDatas = {};

    for (const filename of CUSTOM_SETS) {
        const filepath = resolve(DATA_DIR, filename);
        const data = JSON.parse(readFileSync(filepath, 'utf-8'));
        setDatas[filename] = { data, filepath };

        for (const rarityCards of Object.values(data.cards)) {
            for (const card of rarityCards) {
                allNeededNames.add(card.name);
            }
        }
    }

    console.log(`\n📋 Need images for ${allNeededNames.size} unique card names across all custom sets`);

    // Build base→originals map
    const baseToOriginals = new Map();
    for (const name of allNeededNames) {
        const base = toBaseName(name).toLowerCase();
        if (!baseToOriginals.has(base)) baseToOriginals.set(base, []);
        baseToOriginals.get(base).push(name);
    }

    console.log(`🔍 ${baseToOriginals.size} unique base names to look up\n`);

    // Step 2: Scan real TCG sets from GitHub to build a name→image lookup
    const nameToImage = new Map(); // lowercase base name → { small, large }
    let setsScanned = 0;

    for (const setId of SOURCE_SETS) {
        // Stop if we've found all names
        if (nameToImage.size >= baseToOriginals.size) {
            console.log(`  ✅ Found all ${baseToOriginals.size} names, stopping scan.`);
            break;
        }

        process.stdout.write(`  [${++setsScanned}/${SOURCE_SETS.length}] Scanning set ${setId}...`);
        const cards = await fetchSetData(setId);

        if (cards.length === 0) {
            console.log(' (empty or not found)');
            await sleep(100);
            continue;
        }

        let newFinds = 0;
        for (const card of cards) {
            if (!card.images || !card.images.small) continue;
            const baseName = toBaseName(card.name).toLowerCase();

            // Only store if we actually need this name AND haven't found it yet
            if (baseToOriginals.has(baseName) && !nameToImage.has(baseName)) {
                nameToImage.set(baseName, {
                    small: card.images.small,
                    large: card.images.large,
                });
                newFinds++;
            }
        }

        const remaining = baseToOriginals.size - nameToImage.size;
        console.log(` ${cards.length} cards, ${newFinds} new finds (${remaining} still needed)`);
        await sleep(100); // Small delay to be nice to GitHub
    }

    console.log(`\n📊 Found images for ${nameToImage.size}/${baseToOriginals.size} base names`);

    // List any missing names
    const missing = [];
    for (const [base, originals] of baseToOriginals) {
        if (!nameToImage.has(base)) {
            missing.push(...originals);
        }
    }
    if (missing.length > 0) {
        console.log(`⚠ Missing: ${missing.join(', ')}`);
    }

    // Step 3: Write imageMap into each custom set JSON
    for (const filename of CUSTOM_SETS) {
        const { data, filepath } = setDatas[filename];
        const imageMap = {};

        // Collect all names in this set
        const setNames = new Set();
        for (const rarityCards of Object.values(data.cards)) {
            for (const card of rarityCards) {
                setNames.add(card.name);
            }
        }

        let covered = 0;
        for (const name of setNames) {
            const base = toBaseName(name).toLowerCase();
            const images = nameToImage.get(base);
            if (images) {
                imageMap[name] = images;
                covered++;
            }
        }

        data.imageMap = imageMap;
        writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`\n✅ ${filename}: ${covered}/${setNames.size} cards with images`);
    }

    console.log('\n════════════════════════════════════════');
    console.log('🎉 Done! Image baking complete.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
