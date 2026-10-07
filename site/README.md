# Omega website

Static site (no build step, no trackers) deployed to GitHub Pages by
`.github/workflows/pages.yml` whenever `site/` changes on `main`.

- **Preview locally:** `cd site && python3 -m http.server 8000`
- **Edit products, prices, links, contact:** `config.js` only.
- **Take payments:** create a Stripe Payment Link (or Lemon Squeezy / Gumroad / Ko-fi
  product), paste its `https://` URL into `checkoutUrl`, and set `status: "available"`.
  The site never handles card data.
- **One-time GitHub setup:** repo Settings → Pages → Source: *GitHub Actions*.
  Site URL will be `https://omega-ghub.github.io/Omega/` until you add a custom domain.
