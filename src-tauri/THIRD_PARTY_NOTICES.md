# Third-party notices for bundled export support

S2.8 generation runs offline in Rust. Cargo.lock pins the resolved graph. This
inventory covers dependencies newly introduced by S2.8, plus tempfile promoted
to a direct runtime dependency; existing V1 dependencies remain part of the
application-wide release audit.

## Generators

- docx-rs 0.4.22 — MIT. Source: https://github.com/bokuweb/docx-rs
- rust_xlsxwriter 0.99.0 — MIT OR Apache-2.0. Source: https://github.com/jmcnamara/rust_xlsxwriter
- printpdf 0.7.0 — MIT. Source: https://github.com/fschutt/printpdf
- pulldown-cmark 0.13.0 — MIT; local Markdown parser, default HTML/CLI features disabled. Source: https://github.com/raphlinus/pulldown-cmark
- unicase 2.9.0 — MIT OR Apache-2.0; parser dependency (MIT license text bundled).
- ttf-parser 0.19.2 — existing locked dependency, now directly used for glyph-width measurement (MIT text already bundled).

Original license texts are archived under assets/licenses. Where a dependency
offers MIT OR Apache-2.0, this distribution elects MIT; combined license texts
are retained unchanged. Build-time dependencies in the locked delta are included
conservatively.

## Additional dependency inventory

| Package                                 | Upstream license  |
| --------------------------------------- | ----------------- |
| aliasable-0.1.3                         | MIT               |
| allsorts-0.14.2                         | Apache-2.0        |
| bitreader-0.3.11                        | MIT OR Apache-2.0 |
| brotli-decompressor-2.5.1               | BSD-3-Clause/MIT  |
| bstr-1.13.1                             | MIT OR Apache-2.0 |
| either-1.18.0                           | MIT OR Apache-2.0 |
| glyph-names-0.2.0                       | BSD-3-Clause      |
| itertools-0.10.5                        | MIT/Apache-2.0    |
| lazy_static-1.5.0                       | MIT OR Apache-2.0 |
| linked-hash-map-0.5.6                   | MIT/Apache-2.0    |
| lopdf-0.31.0                            | MIT               |
| md5-0.7.0                               | Apache-2.0/MIT    |
| ouroboros-0.17.2                        | MIT OR Apache-2.0 |
| ouroboros_macro-0.17.2                  | MIT OR Apache-2.0 |
| owned_ttf_parser-0.19.0                 | Apache-2.0        |
| pom-3.4.0                               | MIT               |
| rustc-hash-1.1.0                        | Apache-2.0/MIT    |
| static_assertions-1.1.0                 | MIT OR Apache-2.0 |
| tempfile-3.27.0                         | MIT OR Apache-2.0 |
| ttf-parser-0.19.2                       | MIT OR Apache-2.0 |
| typed-path-0.12.3                       | MIT OR Apache-2.0 |
| ucd-trie-0.1.7                          | MIT OR Apache-2.0 |
| unicode-canonical-combining-class-0.5.0 | Apache-2.0        |
| unicode-general-category-0.6.0          | Apache-2.0        |
| unicode-joining-type-0.7.0              | Apache-2.0        |
| zip-8.6.0                               | MIT               |

## Bundled font

- Original unmodified Noto Sans SC variable TrueType font, upstream Sans2.004.
- Source: https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf
- Local asset: assets/fonts/NotoSansSC-VF.ttf
- SHA-256: D68BAFCB48A2707749396AA12BBBD833CB70401F3A9A689FD2902C7E0D295964
- License: SIL Open Font License 1.1, retained in assets/fonts/OFL.txt.
- Copyright and naming records remain embedded in the original font.
- Embedded at compile time (include_bytes); no system font or runtime download
  is required.
- This TrueType asset replaces the prior CFF OTF asset: printpdf 0.7 emits a
  CIDFontType2/FontFile2 font program and requires compatible TrueType outlines.
- No font is sold separately. The application does not rename or distribute
  a modified standalone font.

## Rendering and security review

Default optional image generation features of docx-rs/printpdf are disabled.
PDF uses local glyph subsetting; its Unicode mapping is rebuilt from actual
source lines after subsetting. Missing glyphs or ambiguous mappings fail
explicitly instead of silently losing text. P0 supports basic text/layout only,
not lossless Office/PDF round trips. CSV/XLSX escape formula-like text; XLSX
cells are written as strings without formulas, macros or hyperlinks.

The 2026-09-10 acceptance correction parses basic Markdown blocks locally and
measures glyph advances for wrapping. Text is drawn with a small stroke to
improve the original variable font's default light weight; the font bytes are
unchanged. Markdown images are represented by alt text without loading files or
URLs; raw HTML is inert text, never executed or rendered as a web page.

Generator licenses, selected additional license texts, the OFL text and this
notice are included by tauri.conf.json bundle.resources. This is an engineering
review of the locked S2.8 delta, not a substitute for the application-wide
legal/release review.
