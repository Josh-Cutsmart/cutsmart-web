Drop custom quote fonts in this folder.

Recommended formats:
- `.woff2`
- `.woff`

Next step after adding a font file:
1. Open `/app/quote-fonts.css`
2. Add an `@font-face` entry that points to the file in `/public/fonts`
3. Add the font name to `/lib/quote-font-options.ts`

Example:

```css
@font-face {
  font-family: "My Signature Font";
  src:
    url("/fonts/my-signature-font.woff2") format("woff2"),
    url("/fonts/my-signature-font.woff") format("woff");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

Then add this in `/lib/quote-font-options.ts`:

```ts
{ label: "My Signature Font", value: "\"My Signature Font\", cursive" }
```
