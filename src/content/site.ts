// Editable business copy. PLACEHOLDER values must be confirmed by Merven Fashions
// before launch (delivery fees, timings, contact details).

export const site = {
  name: "Merven Fashions",
  tagline: "Considered clothing for the modern Kenyan woman.",
  description:
    "Merven Fashions is a Kenyan women's boutique: dresses, tailoring, knitwear and occasion wear, chosen with care. Browse the collection and enquire on WhatsApp.",
  locale: "en_KE",
  instagram: null as string | null,
};

export const delivery = {
  summary: "We deliver within Kenya only.",
  // PLACEHOLDER: confirm zones, fees and timings with the boutique.
  zones: [
    { name: "Nairobi CBD & environs", time: "Same or next working day", fee: "From KES 300" },
    { name: "Greater Nairobi (Kiambu, Machakos, Kajiado)", time: "1–2 working days", fee: "From KES 450" },
    { name: "Rest of Kenya (via courier)", time: "2–4 working days", fee: "From KES 600" },
  ],
  notes: [
    "Orders are confirmed by our team on WhatsApp before dispatch.",
    "Delivery fees are confirmed with you on WhatsApp and depend on location and parcel size.",
    "We do not currently ship outside Kenya.",
  ],
};
