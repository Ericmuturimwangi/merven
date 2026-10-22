// Customer-facing business copy. Everything here must be true for Merven today.
// OWNER TO CONFIRM items are left empty on purpose: the site hides them until
// real, approved terms are added (no invented fees, timings or policies).

export const site = {
  name: "Merven Fashions",
  tagline: "Pieces for the moments that matter.",
  intro: "Thoughtfully selected dresses and everyday pieces for your wardrobe.",
  description:
    "Merven Fashions is a womenswear boutique in Kenya: a selected edit of dresses, separates and occasion pieces. Browse the collection and enquire on WhatsApp.",
  about: [
    "Merven Fashions is a womenswear boutique in Kenya. Rather than an endless catalogue, we keep a smaller edit of dresses, separates and pieces for occasions, chosen to be worn and re-worn.",
    "Every piece is listed with its price in Kenyan shillings and the sizes and colours we have. When something catches your eye, message us on WhatsApp and we'll help with sizing, availability and delivery.",
  ],
  locale: "en_KE",
};

export type DeliveryZone = { name: string; time: string; fee: string };

export const delivery = {
  summary: "We deliver within Kenya.",
  // OWNER TO CONFIRM: add zones once fees and timings are agreed, e.g.
  // { name: "Nairobi CBD", time: "Next working day", fee: "KES …" }.
  zones: [] as DeliveryZone[],
  notes: [
    "Delivery fees and timing depend on where you are. We confirm both with you on WhatsApp before you pay.",
    "We don't currently deliver outside Kenya.",
  ],
};

export const ordering = {
  steps: [
    { title: "Choose your piece", body: "Pick a colour and size on the product page. Sold-out options are marked." },
    {
      title: "Enquire on WhatsApp",
      body: "The button opens WhatsApp with the piece, price, size and colour already written in. Nothing is sent until you press send.",
    },
    {
      title: "We confirm with you",
      body: "We reply to confirm availability, the delivery fee and how to pay. Your order is placed only once we've agreed the details.",
    },
  ],
};

// OWNER TO CONFIRM: returns and exchange terms. Until set, customers are asked
// to check with us before ordering, rather than being shown an invented policy.
export const returnsPolicy: string | null = null;
