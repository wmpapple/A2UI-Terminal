# A2UI 工作台 third-party notices

This application-wide engineering inventory is checked against the committed
`package-lock.json` and `src-tauri/Cargo.lock`. The `npm run audit:third-party`
gate requires every resolved production npm package and every resolved Windows
Rust package to declare a license, requires registry integrity/checksum data,
and requires every direct runtime dependency below to match its exact locked
version. The lock files are the authoritative transitive inventory.

## Reused A2UI material

- Source: `google/A2UI` (formerly referenced as `a2ui-project/a2ui`).
- Pinned commit: `981e82f1a3cef88456416fa6fd80d8490964df01`.
- Reused scope: v0.9.1 schema/example fixtures used by conformance tests; the
  production renderer and policy remain local trusted Rust code.
- License at that commit: Apache-2.0. The common Apache-2.0 license text is
  bundled under `assets/licenses/rust_xlsxwriter-Apache-2.0.txt`.

## Direct frontend runtime dependencies

Code editing reuses the following MIT-licensed packages already present through the Markdown editor:

- @codemirror/state 6.6.0 — MIT
- @codemirror/view 6.41.0 — MIT
- @codemirror/commands 6.10.3 — MIT
- @codemirror/language 6.12.3 — MIT
- @codemirror/language-data 6.5.2 — MIT
- @lezer/highlight 1.2.3 — MIT

| Package and locked version        | License           |
| --------------------------------- | ----------------- |
| @ant-design/icons 6.1.1           | MIT               |
| @tauri-apps/api 2.11.1            | Apache-2.0 OR MIT |
| @tauri-apps/plugin-process 2.3.1  | MIT OR Apache-2.0 |
| @tauri-apps/plugin-updater 2.10.1 | MIT OR Apache-2.0 |
| antd 6.3.6                        | MIT               |
| markdown-it 14.3.0                | MIT               |
| md-editor-rt 6.4.2                | MIT               |
| react 19.2.5                      | MIT               |
| react-dom 19.2.5                  | MIT               |
| zustand 5.0.12                    | MIT               |

## Direct Rust runtime dependencies

| Package and locked version  | License           | Upstream                                      |
| --------------------------- | ----------------- | --------------------------------------------- |
| base64 0.22.1               | MIT OR Apache-2.0 | github.com/marshallpierce/rust-base64         |
| csv 1.4.0                   | Unlicense/MIT     | github.com/BurntSushi/rust-csv                |
| docx-rs 0.4.22              | MIT               | github.com/bokuweb/docx-rs                    |
| futures-util 0.3.33         | MIT OR Apache-2.0 | github.com/rust-lang/futures-rs               |
| keyring 4.1.6               | MIT OR Apache-2.0 | github.com/open-source-cooperative/keyring-rs |
| pdf-extract 0.10.0          | MIT               | github.com/jrmuizel/pdf-extract               |
| printpdf 0.7.0              | MIT               | github.com/fschutt/printpdf                   |
| pulldown-cmark 0.13.0       | MIT               | github.com/raphlinus/pulldown-cmark           |
| quick-xml 0.39.4            | MIT               | github.com/tafia/quick-xml                    |
| reqwest 0.12.28             | MIT OR Apache-2.0 | github.com/seanmonstar/reqwest                |
| rusqlite 0.40.1             | MIT               | github.com/rusqlite/rusqlite                  |
| rust_xlsxwriter 0.99.0      | MIT OR Apache-2.0 | github.com/jmcnamara/rust_xlsxwriter          |
| serde 1.0.229               | MIT OR Apache-2.0 | github.com/serde-rs/serde                     |
| serde_json 1.0.151          | MIT OR Apache-2.0 | github.com/serde-rs/json                      |
| sha2 0.11.0                 | MIT OR Apache-2.0 | github.com/RustCrypto/hashes                  |
| tauri 2.11.5                | Apache-2.0 OR MIT | github.com/tauri-apps/tauri                   |
| tauri-plugin-dialog 2.7.2   | Apache-2.0 OR MIT | github.com/tauri-apps/plugins-workspace       |
| tauri-plugin-process 2.3.1  | Apache-2.0 OR MIT | github.com/tauri-apps/plugins-workspace       |
| tauri-plugin-updater 2.10.1 | Apache-2.0 OR MIT | github.com/tauri-apps/plugins-workspace       |
| tempfile 3.27.0             | MIT OR Apache-2.0 | github.com/Stebalien/tempfile                 |
| thiserror 2.0.19            | MIT OR Apache-2.0 | github.com/dtolnay/thiserror                  |
| tokio 1.53.1                | MIT               | github.com/tokio-rs/tokio                     |
| ttf-parser 0.19.2           | MIT OR Apache-2.0 | github.com/RazrFalcon/ttf-parser              |
| uuid 1.24.0                 | Apache-2.0 OR MIT | github.com/uuid-rs/uuid                       |
| walkdir 2.5.0               | Unlicense/MIT     | github.com/BurntSushi/walkdir                 |
| zeroize 1.9.0               | Apache-2.0 OR MIT | github.com/RustCrypto/utils                   |
| zip 6.0.0                   | MIT               | github.com/zip-rs/zip2                        |

## Export-specific retained license texts

S2.8 generation runs offline in Rust. The original license texts needed by its
generator/font delta remain archived under `assets/licenses` and
`assets/fonts/OFL.txt`.

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
notice are included by `tauri.conf.json` bundle resources. This is the S4.6
application-wide engineering audit. Final distribution still requires the
release owner's legal/compliance approval; this audit does not make a legal
conclusion about the application's own `UNLICENSED` source.
