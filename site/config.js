// ============================================================================
// Site settings. This is the ONLY file you need to edit to run the store.
//
// HOW PAYMENTS WORK: this is a static site, so it never touches card data.
// Each product's "checkoutUrl" points at a hosted checkout page from a payment
// provider (Stripe Payment Links, Lemon Squeezy, Gumroad, Ko-fi, PayPal...).
// Create the product there, paste its link below, push, done.
// Leave checkoutUrl empty ("") and the button becomes "Notify me".
// ============================================================================
window.SITE = {
  handle: "@omega.gorillatag",
  // Public contact address used for "Notify me" and the contact section.
  // Use a dedicated address you are happy to publish.
  contactEmail: "",
  social: [
    // { label: "YouTube", url: "https://..." },
    // { label: "TikTok",  url: "https://..." },
    // { label: "GitHub",  url: "https://github.com/omega-ghub" },
    { label: "GitHub", url: "https://github.com/omega-ghub/Omega" },
  ],
};

window.PRODUCTS = [
  // type: "app" | "merch"  ·  status: "available" | "soon"
  {
    id: "omega-creator",
    type: "app",
    name: "Omega Creator, perpetual license",
    blurb: "Every workspace, no export limits, local AI features. Yours to keep, with 1 year of updates.",
    price: "$150",
    status: "soon",
    checkoutUrl: "",
  },
  {
    id: "omega-creator-monthly",
    type: "app",
    name: "Omega Creator, monthly",
    blurb: "Same as above, billed monthly. Cancel in two clicks, no fees.",
    price: "$12/mo",
    status: "soon",
    checkoutUrl: "",
  },
  {
    id: "gtl-supporter",
    type: "app",
    name: "Gorilla Tag Labs, supporter pack",
    blurb: "Early access and supporter perks for Gorilla Tag Labs projects.",
    price: "$5",
    status: "soon",
    checkoutUrl: "",
  },
  {
    id: "tee-omega",
    type: "merch",
    name: "Omega logo tee",
    blurb: "Heavyweight black tee, red Ω on the chest.",
    price: "$28",
    status: "soon",
    checkoutUrl: "",
  },
  {
    id: "hoodie-omega",
    type: "merch",
    name: "Omega hoodie",
    blurb: "Midweight black hoodie with a back print.",
    price: "$55",
    status: "soon",
    checkoutUrl: "",
  },
  {
    id: "sticker-pack",
    type: "merch",
    name: "Sticker pack",
    blurb: "Five die-cut vinyl stickers.",
    price: "$8",
    status: "soon",
    checkoutUrl: "",
  },
];
