# Fonts

Self-hosted copies of the two Google Fonts the site uses, so pages don't wait on fonts.googleapis.com and
fonts.gstatic.com before they can paint. The `@font-face` rules are at the top of `styles/stylesheet.css`,
and every page preloads the two `-latin` files.

| File | Font | License |
| --- | --- | --- |
| `permanent-marker-latin.woff2` | Permanent Marker (Font Diner) | Apache 2.0, `LICENSE-PermanentMarker.txt` |
| `caveat-*.woff2` | Caveat (The Caveat Project Authors), variable weight (the site uses 500 and 700) | SIL Open Font License 1.1, `OFL-Caveat.txt` |

They're the files Google Fonts serves for
`https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Permanent+Marker&display=swap`
(Caveat v23, Permanent Marker v16), split by character range the same way. The file names never change
meaning, so `vercel.json` lets browsers cache them for a year.
