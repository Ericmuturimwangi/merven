// Proposed boutique copy for the 8 real products (reviewed 2026-10-22).
//
// Names and descriptions describe only what is visible in the uploaded photos.
// `details` (fabric/care) is cleared: the current text was left over from the
// placeholder catalogue and does not describe these garments. Add verified
// fabric and care information through the admin once confirmed.
//
// Colour swatches (colourHex) are cleared where the swatch was inherited from a
// placeholder and contradicts the colour name (e.g. "Red" shown as sage green).
// Colour names, sizes, stock, prices, categories and slugs are NOT changed here.
//
// `expect` holds the values read from the live database on 2026-10-22. A row is
// only updated if it still matches, so later admin edits are never overwritten.

export type CataloguePatch = {
  products: {
    id: string;
    expect: { name: string; description: string };
    set: { name: string; description: string; details: null };
  }[];
  images: { id: string; productId: string; expectAlt: string; alt: string }[];
  clearSwatches: { variantId: string; expectColour: string; expectHex: string }[];
};

export const patch: CataloguePatch = {
  products: [
    {
      id: "cmvhz9kbr001melni5527o6dw", // /products/imani-pussy-bow-blouse
      expect: {
        name: "French-style Polka Dot A-Line High-Waist Summer Vintage Elegant Waist-Cinching Figure-Flattering Skirt Tie Dress",
        description: "French-style Polka Dot A-Line High-Waist Summer Vintage Elegant Waist-Cinching Figure-Flattering Skirt Tie Dress",
      },
      set: {
        name: "Polka Dot Tie-Waist Dress",
        description: "A sleeveless polka-dot dress with a V-neckline, a tie at the waist and a full, flared skirt.",
        details: null,
      },
    },
    {
      id: "cmvhz9ebk000uelniatqp9dm5", // /products/kitenge-panel-fit-and-flare-dress
      expect: {
        name: "Fishbone Dress",
        description: "A fitted bodice and full skirt with a contrast kitenge panel at the waist. Concealed back zip and side pockets.",
      },
      set: {
        name: "Strapless Corset Dress",
        description: "A strapless dress with a structured, corset-style bodice and a full, flared skirt.",
        details: null,
      },
    },
    {
      id: "cmvhz9wro003celnia3uhkfkj", // /products/makena-wide-leg-trousers
      expect: {
        name: "Makena Wide-Leg Trousers",
        description: "High-rise, full-length trousers with front pleats and a wide leg that falls straight from the hip.",
      },
      set: {
        name: "High-Waist Straight Trousers",
        description: "High-waisted trousers with a pressed front crease and a long, straight leg.",
        details: null,
      },
    },
    {
      id: "cmvhzaq2b007eelninaiafsje", // /products/malaika-one-shoulder-gown
      expect: {
        name: "Summer Vintage Patchwork Floral Print Square Collar Empire Waist Polyester Long Dress",
        description: "Summer Vintage Patchwork Floral Print Square Collar Empire Waist Polyester Long Dress",
      },
      set: {
        name: "Floral Maxi Dress",
        description:
          "A floor-length floral maxi dress with a fitted waist and a full skirt. The photos show two prints: a bright floral with puff sleeves and a square neckline, and a dark floral with ruffled sleeves.",
        details: null,
      },
    },
    {
      id: "cmvhzairy006eelnimv1clnul", // /products/nyokabi-ribbed-knit-dress
      expect: { name: "Capriset", description: "A body-skimming capriset" },
      set: {
        name: "Scarf-Neck Ruffle Top",
        description: "A halter-style top with a long scarf tie at the neck and ruffled front panels.",
        details: null,
      },
    },
    {
      id: "cmvhzaoha0076elni8kbifugc", // /products/wangari-knit-co-ord-skirt
      expect: {
        name: "French Retro Standing Collar Lantern Sleeve Printed Dress",
        description:
          "French Retro Standing Collar Lantern Sleeve Printed Dress for Women in Autumn New Collection Waist Slimming A-line Short Skirt",
      },
      set: {
        name: "Lantern Sleeve Floral Dress",
        description:
          "A printed floral dress with a stand collar, full lantern sleeves and a defined waist. The photos show the available prints.",
        details: null,
      },
    },
    {
      id: "cmvhzamug006yelnim1pu1td4", // /products/wangari-knit-co-ord-top
      expect: { name: "collar sleeved dress", description: "collar sleeved dress" },
      set: {
        name: "Asymmetric Ruched Dress",
        description: "A sleeveless dress with an asymmetric neckline, a gathered, close-fitting bodice and a flared skirt that falls below the knee.",
        details: null,
      },
    },
    {
      id: "cmvhza7w1004velni0kn206gg", // /products/wanjiku-single-breasted-blazer
      expect: {
        name: "European American-style Chic Casual Polka-dot Dress Women 2026",
        description: "European American-style Chic Casual Polka-dot Dress Women 2026 Summer New Slim-fit Elegant Leisure A-line",
      },
      set: {
        name: "Polka Dot Tiered Maxi Dress",
        description: "A navy polka-dot maxi dress with a square neckline, ruffled straps, a tie at the back and a tiered skirt.",
        details: null,
      },
    },
  ],

  images: [
    {
      id: "cmvjexviy000208kwhccnvddd",
      productId: "cmvhz9kbr001melni5527o6dw",
      expectAlt: "French-style Polka Dot A-Line High-Waist Summer Vintage Elegant Waist-Cinching Figure-Flattering Skirt Tie Dress",
      alt: "Polka Dot Tie-Waist Dress, white with black dots, front view",
    },
    { id: "cmvjezzyv000007jty5vmd3le", productId: "cmvhz9ebk000uelniatqp9dm5", expectAlt: "Fishbone Dress", alt: "Strapless Corset Dress in white, front view" },
    {
      id: "cmvjew5di000108kwvj6h3sr2",
      productId: "cmvhz9wro003celnia3uhkfkj",
      expectAlt:
        "European American High Quality Women New High Waist Drape Straight Simple Suit Trousers Women's Suit Pants New Style Pants",
      alt: "High-Waist Straight Trousers in black, front view",
    },
    {
      id: "cmvi0kau10002h2nilys8q0dn",
      productId: "cmvhzaq2b007eelninaiafsje",
      expectAlt: "Summer Vintage Patchwork Floral Print Square Collar Empire Waist Polyester Long Dress",
      alt: "Floral Maxi Dress in a bright multicolour floral print with puff sleeves",
    },
    {
      id: "cmvi0ks8o0003h2niilg7ff6q",
      productId: "cmvhzaq2b007eelninaiafsje",
      expectAlt:
        "Retro-style Best-selling Womens Polyester Dress Europe America Digital-print Pleated Design Vacation Vibe Ruffled Hem Elegant",
      alt: "Floral Maxi Dress in a dark floral print with ruffled sleeves",
    },
    { id: "cmvi0on5f0004h2ni63cwubs6", productId: "cmvhzairy006eelnimv1clnul", expectAlt: "capriset", alt: "Scarf-Neck Ruffle Top in a teal paisley print, on a mannequin" },
    { id: "cmvi0oxyt0005h2niaqt4r52q", productId: "cmvhzairy006eelnimv1clnul", expectAlt: "capriset", alt: "Scarf-Neck Ruffle Top in a leopard print, on a mannequin" },
    {
      id: "cmvi014zh0001woniqeqnnokv",
      productId: "cmvhzaoha0076elni8kbifugc",
      expectAlt: "2025 Spring Roman Stand Collar Tunic A-Line Midi Dress for Women Lantern Sleeve Empire Printed Lace Dress",
      alt: "Lantern Sleeve Floral Dress in a peach and coral floral print",
    },
    {
      id: "cmvi01rqo0002wonilxtm3tad",
      productId: "cmvhzaoha0076elni8kbifugc",
      expectAlt: "Clothes Women Dress Vintage Stand Collar Floral Dress Long Sleeve Tie-Waist A-Line Vacation Fashion Women",
      alt: "Lantern Sleeve Floral Dress in an ivory and red floral print with a tie waist",
    },
    {
      id: "cmvhzyprl0000wonijqiz9xwn",
      productId: "cmvhzaoha0076elni8kbifugc",
      expectAlt: "French Retro Standing Collar Lantern Sleeve Printed Dress for Women in Autumn New Collection Waist Slimming A-line Short Dress",
      alt: "Lantern Sleeve Floral Dress in a lilac and blue floral print with a belt",
    },
    { id: "cmvi0cy8w0000h2ni9rxm67fx", productId: "cmvhzamug006yelnim1pu1td4", expectAlt: "collar sleeved dress", alt: "Asymmetric Ruched Dress in black" },
    { id: "cmvi0dhk70001h2nipivxc24z", productId: "cmvhzamug006yelnim1pu1td4", expectAlt: "collar sleeved dress red", alt: "Asymmetric Ruched Dress in wine red" },
    {
      id: "cmvjer1ks0006h2nirtzsjnqv",
      productId: "cmvhza7w1004velni0kn206gg",
      expectAlt: "European American-style Chic Casual Polka-dot Dress Women 2026 Summer New Slim-fit Elegant Leisure A-line",
      alt: "Polka Dot Tiered Maxi Dress in navy, front and back views",
    },
    // cmvjeu3py000008kwwzkdw0rf (second photo of the polka dot dress) shows a different
    // garment (a pink tweed jacket and dress). Left unchanged: owner to remove or move it.
  ],

  clearSwatches: [
    { variantId: "cmvhzaqij007gelni9l7srjna", expectColour: "Retro", expectHex: "#1f5b45" },
    { variantId: "cmvhzaqub007ielniirzmmazr", expectColour: "Retro", expectHex: "#1f5b45" },
    { variantId: "cmvhzaqa6007felnikrrb9w2x", expectColour: "Emerald", expectHex: "#1f5b45" },
    { variantId: "cmvhzaqoj007helnionc08917", expectColour: "Emerald", expectHex: "#1f5b45" },
    { variantId: "cmvhzar03007jelnivsqzpkx8", expectColour: "Emerald", expectHex: "#1f5b45" },
    { variantId: "cmvhzaj0h006felni4fqud603", expectColour: "Blue", expectHex: "#4a3226" },
    { variantId: "cmvhzaopa0077elnipxie6ihr", expectColour: "Purple", expectHex: "#8fa38a" },
    { variantId: "cmvhzaoxt0078elni5qf4xhk6", expectColour: "Orange", expectHex: "#8fa38a" },
    { variantId: "cmvhzap430079elnig1jxec5c", expectColour: "Red", expectHex: "#8fa38a" },
    { variantId: "cmvhzapab007aelnirwyhkdt0", expectColour: "Red", expectHex: "#8fa38a" },
    { variantId: "cmvhzan1j006zelni3v6r61bs", expectColour: "Black", expectHex: "#8fa38a" },
    { variantId: "cmvhzana20070elnikwii7ud3", expectColour: "Red", expectHex: "#8fa38a" },
  ],
};
