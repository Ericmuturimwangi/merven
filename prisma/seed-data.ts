// Placeholder catalogue: 6 categories × 5 products. All copy, prices and stock
// are illustrative and should be replaced with the boutique's real range.

export type SeedVariant = { colour: string; hex: string; sizes: string[] };
export type SeedProduct = {
  name: string;
  category: string;
  priceKES: number;
  featured?: boolean;
  description: string;
  details: string;
  colours: SeedVariant[];
  /** Per-size price overrides in KES, e.g. larger sizes. */
  sizePrices?: Record<string, number>;
};

export const seedCategories = [
  { name: "Dresses", slug: "dresses", description: "Wrap, slip, shirt and midi dresses for days that ask for something easy and polished." },
  { name: "Tops & Blouses", slug: "tops-blouses", description: "Silk-feel blouses, crisp shirts and fitted tops." },
  { name: "Skirts & Trousers", slug: "skirts-trousers", description: "Wide legs, pleats and bias-cut skirts." },
  { name: "Tailoring", slug: "tailoring", description: "Blazers, waistcoats and co-ords cut for the working week." },
  { name: "Knitwear", slug: "knitwear", description: "Light knits for cool Kenyan mornings and evenings." },
  { name: "Occasion", slug: "occasion", description: "Gowns and statement pieces for weddings, ruracio and celebrations." },
];

const LETTER = ["XS", "S", "M", "L", "XL"];
const CORE = ["S", "M", "L", "XL"];
const UK = ["8", "10", "12", "14", "16"];

export const seedProducts: SeedProduct[] = [
  // Dresses
  {
    name: "Amani Wrap Midi Dress",
    category: "dresses",
    priceKES: 6500,
    featured: true,
    description: "A true wrap dress in a fluid crepe that moves with you. The tie waist adjusts to your shape and the midi length works from office to evening.\n\nFlutter sleeves and a deep hem give it an easy, unhurried swing.",
    details: "Polyester crepe. Unlined. Machine wash cold, line dry. Model wears size S.",
    colours: [
      { colour: "Emerald", hex: "#1f5b45", sizes: LETTER },
      { colour: "Black", hex: "#1a1a1a", sizes: LETTER },
    ],
  },
  {
    name: "Zuri Linen Shirt Dress",
    category: "dresses",
    priceKES: 5800,
    description: "Relaxed shirt dress in washed linen-blend, with a self belt and patch pockets. Wear it buttoned, or open over trousers.",
    details: "55% linen, 45% viscose. Gets softer with every wash. Iron while damp.",
    colours: [
      { colour: "Sand", hex: "#cdb994", sizes: CORE },
      { colour: "Olive", hex: "#5d6340", sizes: CORE },
    ],
  },
  {
    name: "Kitenge Panel Fit & Flare Dress",
    category: "dresses",
    priceKES: 7200,
    featured: true,
    description: "A fitted bodice and full skirt with a contrast kitenge panel at the waist. Concealed back zip and side pockets.",
    details: "Cotton wax print panels with cotton sateen body. Hand wash cold. Do not tumble dry.",
    colours: [{ colour: "Indigo Print", hex: "#2e3a6b", sizes: UK }],
    sizePrices: { "16": 7600 },
  },
  {
    name: "Nia Satin Slip Dress",
    category: "dresses",
    priceKES: 5400,
    description: "Bias-cut slip in a soft satin with adjustable straps. Layer it under knitwear by day, or wear it alone after dark.",
    details: "Polyester satin. Hand wash or delicate cycle. Cool iron on reverse.",
    colours: [
      { colour: "Champagne", hex: "#d8c3a0", sizes: LETTER },
      { colour: "Wine", hex: "#5a1f2b", sizes: LETTER },
    ],
  },
  {
    name: "Wanjiru Tiered Maxi Dress",
    category: "dresses",
    priceKES: 6900,
    description: "Three soft tiers, a smocked back and short puff sleeves. Made for long lunches and coastal weekends.",
    details: "100% cotton voile, fully lined. Machine wash cold.",
    colours: [{ colour: "Terracotta", hex: "#b4583a", sizes: CORE }],
  },

  // Tops & Blouses
  {
    name: "Imani Pussy-Bow Blouse",
    category: "tops-blouses",
    priceKES: 3800,
    featured: true,
    description: "A classic bow-neck blouse in a weighty satin crepe. Tuck it into tailoring or wear it loose over denim.",
    details: "Polyester satin crepe. Machine wash cold, gentle cycle.",
    colours: [
      { colour: "Ivory", hex: "#efe7d6", sizes: LETTER },
      { colour: "Cobalt", hex: "#2547a0", sizes: LETTER },
    ],
  },
  {
    name: "Pendo Poplin Shirt",
    category: "tops-blouses",
    priceKES: 3200,
    description: "Oversized cotton poplin shirt with dropped shoulders and a curved hem. A crisp base for everything else.",
    details: "100% cotton poplin. Machine wash 30°C. Iron on medium.",
    colours: [
      { colour: "White", hex: "#f6f4ef", sizes: CORE },
      { colour: "Blue Stripe", hex: "#7f9cc4", sizes: CORE },
    ],
  },
  {
    name: "Shiro Square-Neck Top",
    category: "tops-blouses",
    priceKES: 2500,
    description: "Fitted rib-knit top with a square neckline and short sleeves. Clean under blazers, easy on its own.",
    details: "95% cotton, 5% elastane. Machine wash cold.",
    colours: [
      { colour: "Black", hex: "#1a1a1a", sizes: LETTER },
      { colour: "Mocha", hex: "#6f5443", sizes: LETTER },
      { colour: "Ivory", hex: "#efe7d6", sizes: LETTER },
    ],
  },
  {
    name: "Neema Embroidered Blouse",
    category: "tops-blouses",
    priceKES: 4200,
    description: "Lightweight cotton blouse with tonal embroidery across the yoke and gathered sleeves.",
    details: "100% cotton lawn. Hand wash cold. Dry flat.",
    colours: [{ colour: "White", hex: "#f6f4ef", sizes: CORE }],
  },
  {
    name: "Halima Draped Cami",
    category: "tops-blouses",
    priceKES: 2800,
    description: "A cowl-neck camisole that drapes softly at the front. Adjustable straps.",
    details: "Polyester satin. Hand wash cold.",
    colours: [
      { colour: "Champagne", hex: "#d8c3a0", sizes: LETTER },
      { colour: "Black", hex: "#1a1a1a", sizes: LETTER },
    ],
  },

  // Skirts & Trousers
  {
    name: "Makena Wide-Leg Trousers",
    category: "skirts-trousers",
    priceKES: 4800,
    featured: true,
    description: "High-rise, full-length trousers with front pleats and a wide leg that falls straight from the hip.",
    details: "Polyester-viscose suiting with a little stretch. Machine wash cold.",
    colours: [
      { colour: "Camel", hex: "#b08a5a", sizes: UK },
      { colour: "Black", hex: "#1a1a1a", sizes: UK },
    ],
  },
  {
    name: "Achieng Pleated Midi Skirt",
    category: "skirts-trousers",
    priceKES: 4200,
    description: "Fine knife pleats in a satin-finish fabric, on an elasticated back waist for comfort.",
    details: "Polyester satin. Hang to dry; pleats are permanent.",
    colours: [
      { colour: "Sage", hex: "#8fa38a", sizes: CORE },
      { colour: "Gold", hex: "#b9934b", sizes: CORE },
    ],
  },
  {
    name: "Wairimu Linen Trousers",
    category: "skirts-trousers",
    priceKES: 4400,
    description: "Drawstring-waist linen trousers with deep pockets and a relaxed, straight leg.",
    details: "55% linen, 45% cotton. Machine wash cold.",
    colours: [
      { colour: "Natural", hex: "#d9ccb4", sizes: LETTER },
      { colour: "Black", hex: "#1a1a1a", sizes: LETTER },
    ],
  },
  {
    name: "Ankara Wrap Skirt",
    category: "skirts-trousers",
    priceKES: 3900,
    description: "A wrap midi skirt in bold Ankara print with a long tie that can be wound twice around the waist.",
    details: "100% cotton wax print. Hand wash cold, separately.",
    colours: [{ colour: "Orange Print", hex: "#d06a2b", sizes: ["S/M", "L/XL"] }],
  },
  {
    name: "Atieno Satin Bias Skirt",
    category: "skirts-trousers",
    priceKES: 3600,
    description: "A bias-cut satin skirt that skims the body and ends mid-calf. Elasticated waist.",
    details: "Polyester satin. Hand wash cold. Cool iron on reverse.",
    colours: [
      { colour: "Emerald", hex: "#1f5b45", sizes: LETTER },
      { colour: "Champagne", hex: "#d8c3a0", sizes: LETTER },
    ],
  },

  // Tailoring
  {
    name: "Wanjiku Single-Breasted Blazer",
    category: "tailoring",
    priceKES: 8900,
    featured: true,
    description: "A softly structured blazer with a single button, notched lapels and a longline cut. Half-lined.",
    details: "Polyester-viscose suiting. Dry clean recommended.",
    colours: [
      { colour: "Camel", hex: "#b08a5a", sizes: UK },
      { colour: "Black", hex: "#1a1a1a", sizes: UK },
    ],
  },
  {
    name: "Sanaa Tailored Waistcoat",
    category: "tailoring",
    priceKES: 4600,
    description: "A fitted, V-neck waistcoat with welt pockets. Wear it alone or as part of a three-piece.",
    details: "Polyester-viscose suiting, lined. Dry clean.",
    colours: [{ colour: "Charcoal", hex: "#3a3836", sizes: UK }],
  },
  {
    name: "Baraka Cropped Suit Jacket",
    category: "tailoring",
    priceKES: 7800,
    description: "Boxy, cropped jacket with patch pockets. It pairs with the matching trousers.",
    details: "Linen-blend suiting. Dry clean.",
    colours: [{ colour: "Stone", hex: "#c2b6a3", sizes: UK }],
  },
  {
    name: "Baraka Straight Suit Trousers",
    category: "tailoring",
    priceKES: 5200,
    description: "Mid-rise straight trousers with pressed creases, made to match the Baraka jacket.",
    details: "Linen-blend suiting. Dry clean.",
    colours: [{ colour: "Stone", hex: "#c2b6a3", sizes: UK }],
  },
  {
    name: "Kamau Belted Trench",
    category: "tailoring",
    priceKES: 12500,
    description: "A lightweight trench with storm flaps, a removable belt and a relaxed fit for the long rains.",
    details: "Water-repellent cotton blend. Dry clean.",
    colours: [{ colour: "Khaki", hex: "#a8936b", sizes: CORE }],
    sizePrices: { XL: 13200 },
  },

  // Knitwear
  {
    name: "Mumbi Fine-Knit Cardigan",
    category: "knitwear",
    priceKES: 4500,
    description: "A slim, cropped cardigan in a fine-gauge knit with pearl-effect buttons.",
    details: "Viscose-nylon blend. Hand wash cold. Dry flat.",
    colours: [
      { colour: "Cream", hex: "#ede3cf", sizes: CORE },
      { colour: "Black", hex: "#1a1a1a", sizes: CORE },
    ],
  },
  {
    name: "Nyokabi Ribbed Knit Dress",
    category: "knitwear",
    priceKES: 6200,
    featured: true,
    description: "A body-skimming rib-knit midi with a mock neck and long sleeves. Easy to dress up or down.",
    details: "Viscose blend rib knit. Hand wash cold. Dry flat.",
    colours: [
      { colour: "Chocolate", hex: "#4a3226", sizes: LETTER },
      { colour: "Oat", hex: "#d6c8ad", sizes: LETTER },
    ],
  },
  {
    name: "Kerubo V-Neck Jumper",
    category: "knitwear",
    priceKES: 4900,
    description: "A relaxed V-neck jumper in a soft, light knit for cool evenings.",
    details: "Acrylic-wool blend. Hand wash cold. Dry flat.",
    colours: [{ colour: "Rust", hex: "#9b4a2a", sizes: CORE }],
  },
  {
    name: "Wangari Knit Co-ord Top",
    category: "knitwear",
    priceKES: 3700,
    description: "Short-sleeved knit top with a boat neck. The matching skirt is sold separately.",
    details: "Cotton blend knit. Hand wash cold.",
    colours: [{ colour: "Sage", hex: "#8fa38a", sizes: LETTER }],
  },
  {
    name: "Wangari Knit Co-ord Skirt",
    category: "knitwear",
    priceKES: 3900,
    description: "A pull-on knit midi skirt that matches the Wangari top.",
    details: "Cotton blend knit. Hand wash cold.",
    colours: [{ colour: "Sage", hex: "#8fa38a", sizes: LETTER }],
  },

  // Occasion
  {
    name: "Malaika One-Shoulder Gown",
    category: "occasion",
    priceKES: 16500,
    featured: true,
    description: "A floor-length one-shoulder gown in heavy crepe with a thigh-high slit and a draped shoulder.",
    details: "Polyester crepe, fully lined. Dry clean only.",
    colours: [
      { colour: "Emerald", hex: "#1f5b45", sizes: UK },
      { colour: "Wine", hex: "#5a1f2b", sizes: UK },
    ],
  },
  {
    name: "Ruracio Sequin Midi Dress",
    category: "occasion",
    priceKES: 14800,
    description: "A tonal sequin midi on a soft mesh base, with long sleeves and a fluted hem.",
    details: "Sequins on polyester mesh, lined. Spot clean or dry clean.",
    colours: [{ colour: "Gold", hex: "#b9934b", sizes: UK }],
  },
  {
    name: "Abeni Organza Sleeve Dress",
    category: "occasion",
    priceKES: 11200,
    description: "A structured satin bodice with dramatic sheer organza sleeves and a knee-length skirt.",
    details: "Satin body, organza sleeves, fully lined. Dry clean only.",
    colours: [{ colour: "Black", hex: "#1a1a1a", sizes: UK }],
  },
  {
    name: "Kito Kaftan Gown",
    category: "occasion",
    priceKES: 9800,
    description: "A flowing kaftan with an embellished neckline. One generous size fits most.",
    details: "Chiffon with bead detailing. Hand wash cold. Dry flat.",
    colours: [
      { colour: "Ivory", hex: "#efe7d6", sizes: ["One size"] },
      { colour: "Cobalt", hex: "#2547a0", sizes: ["One size"] },
    ],
  },
  {
    name: "Saida Plissé Cape Dress",
    category: "occasion",
    priceKES: 18000,
    description: "A column dress with an attached plissé cape that falls from the shoulders. Our showpiece for the season.",
    details: "Polyester plissé over crepe lining. Dry clean only.",
    colours: [{ colour: "Champagne", hex: "#d8c3a0", sizes: UK }],
  },
];
